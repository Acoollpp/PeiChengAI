from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.database import MAX_ERROR_MESSAGE_LENGTH, _canonicalize_utc
from app.models import TaskStatus
from app.repositories import validate_repository_keys


class InMemoryTaskRepository:
    def __init__(self):
        self.users: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}
        self.repository_permissions: dict[str, set[str]] = {}
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
            "is_admin": False,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
        }
        self.users[user["id"]] = user
        return dict(user)

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        user = self.users.get(user_id)
        return dict(user) if user else None

    def list_users_with_task_counts(self) -> list[dict[str, Any]]:
        users = []
        for user in self.users.values():
            task_count = sum(1 for task in self.tasks.values() if task["user_id"] == user["id"])
            users.append({**user, "task_count": task_count})
        return [
            dict(user)
            for user in sorted(
                users,
                key=lambda item: (item["created_at"], item["id"]),
                reverse=True,
            )
        ]

    def create_user(
        self,
        *,
        name: str,
        phone: str,
        is_admin: bool = False,
        is_active: bool = True,
    ) -> dict[str, Any] | None:
        if any(user["phone"] == phone for user in self.users.values()):
            return None
        now = _utc_now()
        user = {
            "id": str(uuid.uuid4()),
            "name": name,
            "phone": phone,
            "is_admin": is_admin,
            "is_active": is_active,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
        }
        self.users[user["id"]] = user
        return dict(user)

    def update_user(
        self,
        user_id: str,
        *,
        name: str,
        is_admin: bool,
        is_active: bool,
    ) -> dict[str, Any] | None:
        user = self.users.get(user_id)
        if user is None:
            return None
        user["name"] = name
        user["is_admin"] = is_admin
        user["is_active"] = is_active
        user["updated_at"] = _utc_now()
        return dict(user)

    def set_user_admin_if_phone_matches(self, phone: str, admin_phones: tuple[str, ...]) -> None:
        for user in self.users.values():
            if user["phone"] == phone and phone in admin_phones:
                user["is_admin"] = True
                user["updated_at"] = _utc_now()

    def list_user_repository_permissions(self, user_id: str) -> list[str]:
        return validate_repository_keys(self.repository_permissions.get(user_id, set()))

    def set_user_repository_permissions(self, user_id: str, repository_keys: list[str]) -> list[str]:
        if user_id not in self.users:
            raise KeyError(user_id)
        safe_keys = validate_repository_keys(repository_keys)
        self.repository_permissions[user_id] = set(safe_keys)
        return self.list_user_repository_permissions(user_id)

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
        repository_key: str | None = None,
        repository_name: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        task_id = task_id or str(uuid.uuid4())
        task = {
            "id": task_id,
            "user_id": user_id,
            "svn_url": svn_url,
            "repository_key": repository_key,
            "repository_name": repository_name,
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

    def get_admin_dashboard(self) -> dict[str, Any]:
        today = _utc_now().date()
        status_counts = {status.value: 0 for status in TaskStatus}
        user_counts = {user_id: 0 for user_id in self.users}
        repository_usage: dict[tuple[str | None, str | None], int] = {}
        today_task_total = 0

        for task in self.tasks.values():
            status_counts[task["status"].value] += 1
            user_counts[task["user_id"]] = user_counts.get(task["user_id"], 0) + 1
            repository_key = task.get("repository_key")
            repository_name = task.get("repository_name")
            repository_usage[(repository_key, repository_name)] = (
                repository_usage.get((repository_key, repository_name), 0) + 1
            )
            if _canonicalize_utc(task["created_at"]).date() == today:
                today_task_total += 1

        user_usage = [
            {
                "user_id": user["id"],
                "name": user["name"],
                "phone": user["phone"],
                "task_count": user_counts.get(user["id"], 0),
            }
            for user in self.users.values()
        ]
        repository_rows = [
            {
                "repository_key": repository_key,
                "repository_name": repository_name,
                "task_count": task_count,
            }
            for (repository_key, repository_name), task_count in repository_usage.items()
        ]

        return {
            "user_total": len(self.users),
            "admin_total": sum(1 for user in self.users.values() if user.get("is_admin", False)),
            "active_user_total": sum(1 for user in self.users.values() if user.get("is_active", True)),
            "task_total": len(self.tasks),
            "today_task_total": today_task_total,
            "status_counts": status_counts,
            "user_usage": sorted(user_usage, key=lambda item: (-item["task_count"], item["name"])),
            "repository_usage": sorted(
                repository_rows,
                key=lambda item: (-item["task_count"], item["repository_key"] or ""),
            ),
            "recent_tasks": [dict(task) for task in self._ordered_tasks()[:10]],
        }

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
