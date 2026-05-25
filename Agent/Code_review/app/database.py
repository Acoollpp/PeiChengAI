from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.models import TaskStatus

MAX_ERROR_MESSAGE_LENGTH = 2000


class TaskRepository:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def init_schema(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    svn_url TEXT NOT NULL,
                    old_revision TEXT NOT NULL,
                    new_revision TEXT NOT NULL,
                    requester TEXT,
                    status TEXT NOT NULL,
                    report_path TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at)")

    def create_task(
        self,
        *,
        svn_url: str,
        old_revision: str,
        new_revision: str,
        report_path: str,
        requester: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        task_id = task_id or str(uuid.uuid4())
        requester = (requester or "anonymous").strip() or "anonymous"
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO tasks (
                    id, svn_url, old_revision, new_revision, requester, status,
                    report_path, error_message, created_at, started_at, finished_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
                """,
                (
                    task_id,
                    svn_url,
                    old_revision,
                    new_revision,
                    requester,
                    TaskStatus.pending.value,
                    report_path,
                    now,
                    now,
                ),
            )
        task = self.get_task(task_id)
        if task is None:
            raise RuntimeError("created task could not be loaded")
        return task

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return _row_to_task(row)

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def claim_next_task(self) -> dict[str, Any] | None:
        now = _utc_now_iso()
        with self.connect() as connection:
            row = connection.execute(
                """
                UPDATE tasks
                SET status = ?, started_at = ?, updated_at = ?
                WHERE id = (
                    SELECT id FROM tasks
                    WHERE status = ?
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                ) AND status = ?
                RETURNING *
                """,
                (
                    TaskStatus.running.value,
                    now,
                    now,
                    TaskStatus.pending.value,
                    TaskStatus.pending.value,
                ),
            ).fetchone()
        return _row_to_task(row)

    def mark_success(self, task_id: str) -> dict[str, Any]:
        now = _utc_now_iso()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET status = ?, finished_at = ?, updated_at = ?, error_message = NULL
                WHERE id = ?
                """,
                (TaskStatus.success.value, now, now, task_id),
            )
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        task = _row_to_task(row)
        if task is None:
            raise KeyError(task_id)
        return task

    def mark_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        now = _utc_now_iso()
        safe_error = error_message[:MAX_ERROR_MESSAGE_LENGTH]
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET status = ?, finished_at = ?, updated_at = ?, error_message = ?
                WHERE id = ?
                """,
                (TaskStatus.failed.value, now, now, safe_error, task_id),
            )
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        task = _row_to_task(row)
        if task is None:
            raise KeyError(task_id)
        return task

    def delete_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc_iso(cutoff_iso)
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks WHERE created_at < ? ORDER BY created_at ASC, id ASC",
                (cutoff,),
            ).fetchall()
            connection.executemany(
                "DELETE FROM tasks WHERE id = ?",
                [(row["id"],) for row in rows],
            )
        return [_row_to_task(row) for row in rows]

    def list_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc_iso(cutoff_iso)
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks WHERE created_at < ? ORDER BY created_at ASC, id ASC",
                (cutoff,),
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def delete_tasks_by_ids(self, task_ids: list[str]) -> int:
        if not task_ids:
            return 0
        with self.connect() as connection:
            cursor = connection.executemany(
                "DELETE FROM tasks WHERE id = ?",
                [(task_id,) for task_id in task_ids],
            )
        return cursor.rowcount

    def fail_stale_running_tasks(
        self,
        cutoff_iso: str | datetime,
        error_message: str,
    ) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc_iso(cutoff_iso)
        now = _utc_now_iso()
        safe_error = error_message[:MAX_ERROR_MESSAGE_LENGTH]
        with self.connect() as connection:
            rows = connection.execute(
                """
                UPDATE tasks
                SET status = ?, finished_at = ?, updated_at = ?, error_message = ?
                WHERE status = ? AND updated_at < ?
                RETURNING *
                """,
                (
                    TaskStatus.failed.value,
                    now,
                    now,
                    safe_error,
                    TaskStatus.running.value,
                    cutoff,
                ),
            ).fetchall()
        return [_row_to_task(row) for row in rows]


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _canonicalize_utc_iso(value: str | datetime) -> str:
    if isinstance(value, datetime):
        parsed = value
    else:
        if value.endswith("Z"):
            value = f"{value[:-1]}+00:00"
        parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def _row_to_task(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    task = dict(row)
    task["status"] = TaskStatus(task["status"])
    return task
