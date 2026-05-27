import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import app.codex_runner
from app.codex_runner import CodexRunner
from app.models import TaskStatus
from app.scheduler import InMemoryScheduler
from app.testing import InMemoryTaskRepository
from app.worker import Worker, WorkerThread


PROMPT_TEMPLATE = """
Review {svn_url} from {old_revision} to {new_revision}.
Write the report to {report_path}.
"""


class FakeRunner:
    def __init__(
        self,
        *,
        return_code=0,
        stdout="",
        stderr="",
        writes_report=True,
        report_text="review report",
        error=None,
    ):
        self.return_code = return_code
        self.stdout = stdout
        self.stderr = stderr
        self.writes_report = writes_report
        self.report_text = report_text
        self.error = error
        self.calls = []

    def run(self, prompt: str, cwd: Path, timeout_seconds: int):
        self.calls.append((prompt, cwd, timeout_seconds))
        if self.error is not None:
            raise self.error
        if self.writes_report:
            report_path = _extract_report_path(prompt)
            report_path.write_text(self.report_text, encoding="utf-8")
        return self.return_code, self.stdout, self.stderr


def make_repository(tmp_path):
    repository = InMemoryTaskRepository()
    repository.base_dir = tmp_path
    repository.init_schema()
    return repository


def create_task(repository, *, task_id="task-1", report_path=None, user_id=None, requester="alice"):
    if user_id is None:
        user = repository.get_or_create_user(name=requester, phone="13800138000")
        user_id = user["id"]
    if report_path is None:
        report_path = repository.base_dir / "reports" / f"{task_id}.md"
    return repository.create_task(
        svn_url="https://example.test/svn/project",
        old_revision="100",
        new_revision="101",
        requester=requester,
        report_path=str(report_path),
        user_id=user_id,
        task_id=task_id,
    )


def make_worker(tmp_path, repository, runner, scheduler=None, event_bus=None):
    if scheduler is None:
        scheduler = InMemoryScheduler()
        for task in repository.list_tasks():
            if task["status"] == TaskStatus.pending:
                scheduler.enqueue_task(task["user_id"], task["id"])
    if event_bus is None:
        event_bus = RecordingEventBus()
    return Worker(
        repo=repository,
        scheduler=scheduler,
        event_bus=event_bus,
        runner=runner,
        prompt_template=PROMPT_TEMPLATE,
        workspaces_dir=tmp_path / "workspaces",
        timeout_seconds=30,
        worker_id="worker-test",
        lock_ttl_seconds=60,
    )


def test_process_one_claims_from_scheduler_and_releases_user_lock(tmp_path):
    repository = make_repository(tmp_path)
    user = repository.get_or_create_user(name="张三", phone="13800138000")
    task = create_task(repository, user_id=user["id"], requester=user["name"])
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task(user["id"], task["id"])
    event_bus = RecordingEventBus()
    worker = make_worker(tmp_path, repository, FakeRunner(), scheduler=scheduler, event_bus=event_bus)

    processed = worker.process_one()

    assert processed is True
    assert repository.get_task(task["id"])["status"] == TaskStatus.success
    assert scheduler.claim_next_task(lock_ttl_seconds=60) is None
    assert event_bus.events[-1]["event"] == "task_updated"


def test_process_one_marks_task_success_when_runner_writes_report(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    worker = make_worker(tmp_path, repository, FakeRunner())

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.success
    assert updated["error_message"] is None


def test_process_one_marks_failed_when_report_is_missing(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    worker = make_worker(
        tmp_path,
        repository,
        FakeRunner(stdout="codex finished without writing report", writes_report=False),
    )

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.failed
    assert "报告未生成或为空" in updated["error_message"]
    assert "codex finished without writing report" in updated["error_message"]


def test_process_one_marks_failed_when_report_says_materials_unavailable(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    worker = make_worker(
        tmp_path,
        repository,
        FakeRunner(report_text="## 结论\n材料不可用/无法完成代码级审查\n"),
    )

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.failed
    assert updated["error_message"] == "材料不可用/无法完成代码级审查"


def test_process_one_marks_failed_with_sanitized_truncated_error_on_nonzero_return(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    stderr = "failure line\nSECRET_ENV=do-not-keep\n" + ("x" * 3000)
    runner = FakeRunner(return_code=2, stdout="ignored stdout", stderr=stderr, writes_report=False)
    worker = make_worker(tmp_path, repository, runner)

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.failed
    assert "Codex runner exited with code 2" in updated["error_message"]
    assert "\n" not in updated["error_message"]
    assert "[redacted]" in updated["error_message"]
    assert "do-not-keep" not in updated["error_message"]
    assert len(updated["error_message"]) <= 1000


def test_process_one_marks_failed_with_timeout_message(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    runner = FakeRunner(error=subprocess.TimeoutExpired(cmd=["codex"], timeout=30))
    worker = make_worker(tmp_path, repository, runner)

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.failed
    assert "timeout" in updated["error_message"].lower()
    assert "30" in updated["error_message"]


def test_process_one_returns_false_when_no_pending_tasks(tmp_path):
    repository = make_repository(tmp_path)
    worker = make_worker(tmp_path, repository, FakeRunner())

    assert worker.process_one() is False


def test_process_one_renders_prompt_with_task_values_and_creates_workspace(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    runner = FakeRunner()
    worker = make_worker(tmp_path, repository, runner)

    processed = worker.process_one()

    assert processed is True
    prompt, cwd, timeout_seconds = runner.calls[0]
    expected_report_path = (tmp_path / "reports" / "task-1.md").resolve()
    assert task["svn_url"] in prompt
    assert task["old_revision"] in prompt
    assert task["new_revision"] in prompt
    assert str(expected_report_path) in prompt
    assert cwd == (tmp_path / "workspaces" / task["id"]).resolve()
    assert cwd.is_dir()
    assert timeout_seconds == 30


def test_process_one_marks_failed_when_prompt_template_is_malformed(tmp_path):
    repository = make_repository(tmp_path)
    task = create_task(repository)
    worker = make_worker(tmp_path, repository, FakeRunner())
    worker.prompt_template = "Review {missing_key}"

    processed = worker.process_one()

    updated = repository.get_task(task["id"])
    assert processed is True
    assert updated["status"] == TaskStatus.failed
    assert updated["error_message"]
    assert "missing_key" in updated["error_message"]


def test_process_one_resolves_relative_report_path_with_path_resolve(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    repository = make_repository(tmp_path)
    task = create_task(repository, report_path="relative-report.md")
    runner = FakeRunner()
    worker = make_worker(tmp_path, repository, runner)
    worker.workspaces_dir = tmp_path / "nested" / "workspaces"

    processed = worker.process_one()

    prompt, _cwd, _timeout_seconds = runner.calls[0]
    assert processed is True
    assert repository.get_task(task["id"])["status"] == TaskStatus.success
    assert str((tmp_path / "relative-report.md").resolve()) in prompt
    assert str((tmp_path / "nested" / "relative-report.md").resolve()) not in prompt


def test_codex_runner_invokes_subprocess_without_shell(monkeypatch, tmp_path):
    calls = []

    monkeypatch.setattr("app.codex_runner._resolve_command", lambda command: command)

    class FakeProcess:
        returncode = 0

        def __init__(self, command, **kwargs):
            calls.append((command, kwargs))

        def poll(self):
            return self.returncode

        def communicate(self):
            return "out", "err"

    monkeypatch.setattr(subprocess, "Popen", FakeProcess)
    runner = CodexRunner("codex", ("exec", "--flag"))

    result = runner.run("prompt text", tmp_path, 45)

    assert result == (0, "out", "err")
    assert calls == [
        (
            ["codex", "exec", "--flag", "prompt text"],
            {
                "cwd": tmp_path,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
            },
        )
    ]


def test_codex_runner_terminates_when_materials_unavailable_report_is_written(monkeypatch, tmp_path):
    report_path = tmp_path / "report.md"
    calls = []

    class FakeProcess:
        def __init__(self):
            self.returncode = None
            self.stdout = SimpleNamespace(read=lambda: "")
            self.stderr = SimpleNamespace(read=lambda: "")

        def poll(self):
            if not report_path.exists():
                report_path.write_text("材料不可用/无法完成代码级审查", encoding="utf-8")
            return self.returncode

        def terminate(self):
            calls.append("terminate")
            self.returncode = 0

        def wait(self, timeout=None):
            calls.append(("wait", timeout))
            return self.returncode

        def kill(self):
            calls.append("kill")
            self.returncode = -9

        def communicate(self):
            return "", ""

    monkeypatch.setattr("app.codex_runner._resolve_command", lambda command: command)
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())

    runner = CodexRunner("codex", ("exec",))
    return_code, stdout, stderr = runner.run(
        f"Write the report to {report_path}.\n",
        tmp_path,
        30,
    )

    assert return_code == 0
    assert stdout == ""
    assert stderr == ""
    assert calls[0] == "terminate"


def test_codex_runner_prefers_real_windows_codex_binary(monkeypatch, tmp_path):
    calls = []
    real_codex = tmp_path / "OpenAI" / "Codex" / "bin" / "version-id" / "codex.exe"
    real_codex.parent.mkdir(parents=True)
    real_codex.write_text("", encoding="utf-8")

    monkeypatch.setattr(app.codex_runner.os, "name", "nt")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr("app.codex_runner.shutil.which", lambda command: f"C:\\WindowsApps\\{command}")

    class FakeProcess:
        returncode = 0

        def __init__(self, command, **kwargs):
            calls.append(command)

        def poll(self):
            return self.returncode

        def communicate(self):
            return "out", "err"

    monkeypatch.setattr(subprocess, "Popen", FakeProcess)
    runner = CodexRunner("codex", ("exec",))

    runner.run("prompt text", tmp_path, 45)

    assert calls[0][0] == str(real_codex)


def test_worker_thread_starts_daemon_loop_and_stops_without_hanging():
    worker = CountingWorker()
    thread = WorkerThread(worker, poll_seconds=0.01)

    thread.start()
    time.sleep(0.03)
    stopped = thread.stop()

    assert worker.calls > 0
    assert stopped is True
    assert thread._thread is not None
    assert thread._thread.daemon is True
    assert not thread._thread.is_alive()


def test_worker_thread_stop_returns_false_when_thread_is_still_alive():
    worker = BlockingWorker()
    thread = WorkerThread(worker, poll_seconds=0.01)

    thread.start()
    worker.entered.wait(timeout=1)
    stopped = thread.stop()
    worker.release.set()

    assert stopped is False


def _extract_report_path(prompt: str) -> Path:
    return Path(prompt.rsplit("Write the report to ", 1)[1].strip().rstrip("."))


class CountingWorker:
    def __init__(self):
        self.calls = 0

    def process_one(self) -> bool:
        self.calls += 1
        return False


class BlockingWorker:
    def __init__(self):
        self.entered = __import__("threading").Event()
        self.release = __import__("threading").Event()

    def process_one(self) -> bool:
        self.entered.set()
        self.release.wait(timeout=5)
        return False


class RecordingEventBus:
    def __init__(self):
        self.events = []

    async def publish(self, user_id, event, data):
        self.events.append({"user_id": user_id, "event": event, "data": data})
