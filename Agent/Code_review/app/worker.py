from __future__ import annotations

import asyncio
import inspect
import logging
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Protocol


MAX_WORKER_ERROR_LENGTH = 1000
MATERIALS_UNAVAILABLE_MESSAGE = "材料不可用/无法完成代码级审查"
logger = logging.getLogger(__name__)


class Runner(Protocol):
    def run(self, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        pass


class Worker:
    def __init__(
        self,
        repo,
        scheduler,
        event_bus,
        runner: Runner,
        prompt_template: str,
        workspaces_dir: Path,
        svn_exports_dir: Path,
        timeout_seconds: int,
        worker_id: str,
        lock_ttl_seconds: int,
    ):
        self.repo = repo
        self.scheduler = scheduler
        self.event_bus = event_bus
        self.runner = runner
        self.prompt_template = prompt_template
        self.workspaces_dir = Path(workspaces_dir)
        self.svn_exports_dir = Path(svn_exports_dir)
        self.timeout_seconds = timeout_seconds
        self.worker_id = worker_id
        self.lock_ttl_seconds = lock_ttl_seconds

    def process_one(self) -> bool:
        claim = self.scheduler.claim_next_task(lock_ttl_seconds=self.lock_ttl_seconds)
        if claim is None:
            return False

        task = self.repo.mark_running(claim["task_id"], worker_id=self.worker_id)
        task_id = task["id"]
        user_id = task["user_id"]
        try:
            workspace = (self.workspaces_dir / task_id).resolve()
            workspace.mkdir(parents=True, exist_ok=True)
            svn_export_dir = (self.svn_exports_dir / task_id).resolve()
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
                svn_export_dir=str(svn_export_dir),
            )
            return_code, stdout, stderr = self.runner.run(prompt, workspace, self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            timeout = exc.timeout if exc.timeout is not None else self.timeout_seconds
            self.repo.mark_failed(task_id, f"Codex runner timeout after {timeout} seconds")
            self._complete_task(user_id, task_id, "failed")
            self._remove_task_svn_export_dir(task_id)
            return True
        except Exception as exc:
            self.repo.mark_failed(task_id, _sanitize_error(f"Codex runner failed: {exc}"))
            self._complete_task(user_id, task_id, "failed")
            self._remove_task_svn_export_dir(task_id)
            return True

        if return_code != 0:
            details = stderr or stdout
            self.repo.mark_failed(
                task_id,
                _sanitize_error(f"Codex runner exited with code {return_code}: {details}"),
            )
            self._complete_task(user_id, task_id, "failed")
            self._remove_task_svn_export_dir(task_id)
            return True

        if not report_path.exists() or report_path.stat().st_size == 0:
            details = stderr or stdout
            message = "报告未生成或为空"
            if details:
                message = f"{message}。Codex output: {details}"
            self.repo.mark_failed(task_id, _sanitize_error(message))
            self._complete_task(user_id, task_id, "failed")
            self._remove_task_svn_export_dir(task_id)
            return True

        report_text = report_path.read_text(encoding="utf-8", errors="replace")
        if _report_says_materials_unavailable(report_text):
            self.repo.mark_failed(task_id, MATERIALS_UNAVAILABLE_MESSAGE)
            self._complete_task(user_id, task_id, "failed")
            self._remove_task_svn_export_dir(task_id)
            return True

        self.repo.mark_success(task_id)
        self._complete_task(user_id, task_id, "success")
        self._remove_task_svn_export_dir(task_id)
        return True

    def _complete_task(self, user_id: str, task_id: str, status: str) -> None:
        self.scheduler.complete_task(user_id, task_id)
        self._publish_event(user_id, "task_updated", {"task_id": task_id, "status": status})

    def _publish_event(self, user_id: str, event: str, data: dict) -> None:
        result = self.event_bus.publish(user_id, event, data)
        if inspect.isawaitable(result):
            asyncio.run(result)

    def _remove_task_svn_export_dir(self, task_id: str) -> None:
        root = self.svn_exports_dir.resolve()
        path = (root / task_id).resolve()
        if path == root or not path.is_relative_to(root):
            return
        if path.exists():
            try:
                shutil.rmtree(path)
            except OSError:
                logger.warning("Failed to remove SVN export directory for task %s", task_id, exc_info=True)


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


def _report_says_materials_unavailable(report_text: str) -> bool:
    normalized = report_text.replace(" ", "")
    return (
        MATERIALS_UNAVAILABLE_MESSAGE in normalized
        or ("材料不可用" in normalized and "无法完成代码级审查" in normalized)
        or ("SVN" in report_text and "E160013" in report_text and "path not found" in report_text)
    )


def _looks_like_env_assignment(word: str) -> bool:
    key, separator, _value = word.partition("=")
    return bool(separator and key and key.replace("_", "").isupper())
