from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path
from typing import Protocol


MAX_WORKER_ERROR_LENGTH = 1000


class Runner(Protocol):
    def run(self, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        pass


class Worker:
    def __init__(
        self,
        repo,
        runner: Runner,
        prompt_template: str,
        workspaces_dir: Path,
        timeout_seconds: int,
    ):
        self.repo = repo
        self.runner = runner
        self.prompt_template = prompt_template
        self.workspaces_dir = Path(workspaces_dir)
        self.timeout_seconds = timeout_seconds

    def process_one(self) -> bool:
        task = self.repo.claim_next_task()
        if task is None:
            return False

        task_id = task["id"]
        try:
            workspace = (self.workspaces_dir / task_id).resolve()
            workspace.mkdir(parents=True, exist_ok=True)
            skills_link = workspace / "skills"
            source = self.workspaces_dir.parent.parent / "skills"
            if source.exists() and not skills_link.exists():
                shutil.copytree(str(source), str(skills_link))
            report_path = Path(task["report_path"]).resolve()
            report_path.parent.mkdir(parents=True, exist_ok=True)

            prompt = self.prompt_template.format(
                svn_url=task["svn_url"],
                old_revision=task["old_revision"],
                new_revision=task["new_revision"],
                report_path=str(report_path),
            )
            return_code, stdout, stderr = self.runner.run(prompt, workspace, self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            timeout = exc.timeout if exc.timeout is not None else self.timeout_seconds
            self.repo.mark_failed(task_id, f"Codex runner timeout after {timeout} seconds")
            return True
        except Exception as exc:
            self.repo.mark_failed(task_id, _sanitize_error(f"Codex runner failed: {exc}"))
            return True

        if return_code != 0:
            details = stderr or stdout
            self.repo.mark_failed(
                task_id,
                _sanitize_error(f"Codex runner exited with code {return_code}: {details}"),
            )
            return True

        if not report_path.exists() or report_path.stat().st_size == 0:
            details = stderr or stdout
            message = "报告未生成或为空"
            if details:
                message = f"{message}。Codex output: {details}"
            self.repo.mark_failed(task_id, _sanitize_error(message))
            return True

        self.repo.mark_success(task_id)
        return True


class WorkerThread:
    def __init__(self, worker: Worker, poll_seconds: float):
        self.worker = worker
        self.poll_seconds = poll_seconds
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> bool:
        self._stop_event.set()
        if self._thread is None:
            return True
        self._thread.join(timeout=max(self.poll_seconds + 1, 1))
        return not self._thread.is_alive()

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            processed = self.worker.process_one()
            if not processed:
                self._stop_event.wait(self.poll_seconds)


def _sanitize_error(message: str) -> str:
    words = ["[redacted]" if _looks_like_env_assignment(word) else word for word in message.split()]
    return " ".join(words)[:MAX_WORKER_ERROR_LENGTH]


def _looks_like_env_assignment(word: str) -> bool:
    key, separator, _value = word.partition("=")
    return bool(separator and key and key.replace("_", "").isupper())
