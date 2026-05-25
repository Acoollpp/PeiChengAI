from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.database import MAX_ERROR_MESSAGE_LENGTH, _canonicalize_utc
from app.models import TaskStatus


class InMemoryTaskRepository:
    def __init__(self):
        self.users: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}
        self.base_dir = Path.cwd()

    def init_schema(self) -> None:
        return None

    def get_or_create_user(self, *, name: str, phone: str) -> dict[str, Any]:
        now = _utc_now()
        for user in self.users.values():
            if user["phone"] == phone:
                user["name"] = name
                user["updated_at"] = now
                user["last_seen_at"] = now
                return dict(user)
        user = {
            "id": str(uuid.uuid4()),
            "name": name,
            "phone": phone,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
        }
        self.users[user["id"]] = user
        return dict(user)

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        user = self.users.get(user_id)
        return dict(user) if user else None

    def create_task(
        self,
        *,
        svn_url: str,
        old_revision: str,
        new_revision: str,
        report_path: str,
        user_id: str,
        requester: str,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        task_id = task_id or str(uuid.uuid4())
        task = {
            "id": task_id,
            "user_id": user_id,
            "svn_url": svn_url,
            "old_revision": old_revision,
            "new_revision": new_revision,
            "requester": requester.strip() or "anonymous",
            "status": TaskStatus.pending,
            "report_path": report_path,
            "error_message": None,
            "claimed_by": None,
            "heartbeat_at": None,
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "updated_at": now,
        }
        self.tasks[task_id] = task
        return dict(task)

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        task = self.tasks.get(task_id)
        return dict(task) if task else None

    def get_task_for_user(self, task_id: str, user_id: str) -> dict[str, Any] | None:
        task = self.tasks.get(task_id)
        if not task or task["user_id"] != user_id:
            return None
        return dict(task)

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        return [dict(task) for task in self._ordered_tasks()[:limit]]

    def list_tasks_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        tasks = [task for task in self._ordered_tasks() if task["user_id"] == user_id]
        return [dict(task) for task in tasks[:limit]]

    def claim_next_task(self) -> dict[str, Any] | None:
        pending = [
            task for task in self.tasks.values() if task["status"] == TaskStatus.pending
        ]
        if not pending:
            return None
        task = sorted(pending, key=lambda item: (item["created_at"], item["id"]))[0]
        return self.mark_running(task["id"], worker_id="")

    def mark_running(self, task_id: str, *, worker_id: str) -> dict[str, Any]:
        task = self._require_task(task_id)
        now = _utc_now()
        task["status"] = TaskStatus.running
        task["started_at"] = task["started_at"] or now
        task["updated_at"] = now
        task["heartbeat_at"] = now
        task["claimed_by"] = worker_id
        return dict(task)

    def refresh_heartbeat(self, task_id: str) -> None:
        task = self._require_task(task_id)
        now = _utc_now()
        task["updated_at"] = now
        task["heartbeat_at"] = now

    def mark_success(self, task_id: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.success, None)

    def mark_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.failed, error_message)

    def mark_enqueue_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.enqueue_failed, error_message)

    def get_user_stats(self, user_id: str) -> dict[str, int]:
        stats = {status.value: 0 for status in TaskStatus}
        for task in self.tasks.values():
            if task["user_id"] == user_id:
                stats[task["status"].value] += 1
        stats["total"] = sum(stats[status.value] for status in TaskStatus)
        return stats

    def delete_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        deleted = [
            task for task in self.tasks.values() if _canonicalize_utc(task["created_at"]) < cutoff
        ]
        for task in deleted:
            del self.tasks[task["id"]]
        return [dict(task) for task in sorted(deleted, key=lambda item: (item["created_at"], item["id"]))]

    def list_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        tasks = [
            task for task in self.tasks.values() if _canonicalize_utc(task["created_at"]) < cutoff
        ]
        return [dict(task) for task in sorted(tasks, key=lambda item: (item["created_at"], item["id"]))]

    def delete_tasks_by_ids(self, task_ids: list[str]) -> int:
        count = 0
        for task_id in task_ids:
            if task_id in self.tasks:
                del self.tasks[task_id]
                count += 1
        return count

    def fail_stale_running_tasks(
        self,
        cutoff_iso: str | datetime,
        error_message: str,
    ) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        failed = []
        for task in self.tasks.values():
            heartbeat_at = task["heartbeat_at"]
            if (
                task["status"] == TaskStatus.running
                and heartbeat_at is not None
                and _canonicalize_utc(heartbeat_at) < cutoff
            ):
                self._mark_finished(task["id"], TaskStatus.failed, error_message)
                failed.append(dict(task))
        return sorted(failed, key=lambda item: (item["created_at"], item["id"]))

    def _mark_finished(
        self,
        task_id: str,
        status: TaskStatus,
        error_message: str | None,
    ) -> dict[str, Any]:
        task = self._require_task(task_id)
        now = _utc_now()
        task["status"] = status
        task["finished_at"] = now
        task["updated_at"] = now
        task["error_message"] = (
            error_message[:MAX_ERROR_MESSAGE_LENGTH] if error_message is not None else None
        )
        return dict(task)

    def _ordered_tasks(self) -> list[dict[str, Any]]:
        return sorted(
            self.tasks.values(),
            key=lambda item: (item["created_at"], item["id"]),
            reverse=True,
        )

    def _require_task(self, task_id: str) -> dict[str, Any]:
        task = self.tasks.get(task_id)
        if task is None:
            raise KeyError(task_id)
        return task


def _utc_now() -> datetime:
    return datetime.now(UTC)
