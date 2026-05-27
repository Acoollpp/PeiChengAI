from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.models import TaskStatus
from app.repositories import validate_repository_keys

MAX_ERROR_MESSAGE_LENGTH = 2000


class TaskRepository:
    def __init__(self, database):
        self.database = database

    def init_schema(self) -> None:
        with self.database.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    last_seen_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE")
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id),
                    svn_url TEXT NOT NULL,
                    old_revision TEXT NOT NULL,
                    new_revision TEXT NOT NULL,
                    requester TEXT,
                    status TEXT NOT NULL,
                    report_path TEXT,
                    error_message TEXT,
                    claimed_by TEXT,
                    heartbeat_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL,
                    started_at TIMESTAMPTZ,
                    finished_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks (user_id, created_at DESC)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat ON tasks (heartbeat_at)")
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_key TEXT")
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_name TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_repository_permissions (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    repository_key TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (user_id, repository_key)
                )
                """
            )

    def get_or_create_user(self, *, name: str, phone: str) -> dict[str, Any]:
        now = _utc_now()
        user_id = str(uuid.uuid4())
        with self.database.connect() as connection:
            row = connection.execute(
                """
                INSERT INTO users (id, name, phone, created_at, updated_at, last_seen_at)
                VALUES (%(id)s, %(name)s, %(phone)s, %(now)s, %(now)s, %(now)s)
                ON CONFLICT (phone) DO UPDATE
                SET name = EXCLUDED.name,
                    updated_at = EXCLUDED.updated_at,
                    last_seen_at = EXCLUDED.last_seen_at
                RETURNING *
                """,
                {"id": user_id, "name": name, "phone": phone, "now": now},
            ).fetchone()
        if row is None:
            raise RuntimeError("user could not be loaded")
        return dict(row)

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = %(id)s", {"id": user_id}).fetchone()
        return dict(row) if row is not None else None

    def list_users_with_task_counts(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT users.*, COUNT(tasks.id) AS task_count
                FROM users
                LEFT JOIN tasks ON tasks.user_id = users.id
                GROUP BY users.id
                ORDER BY users.created_at DESC, users.id DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def create_user(
        self,
        *,
        name: str,
        phone: str,
        is_admin: bool = False,
        is_active: bool = True,
    ) -> dict[str, Any] | None:
        now = _utc_now()
        user_id = str(uuid.uuid4())
        with self.database.connect() as connection:
            row = connection.execute(
                """
                INSERT INTO users (
                    id, name, phone, is_admin, is_active, created_at, updated_at, last_seen_at
                )
                VALUES (
                    %(id)s, %(name)s, %(phone)s, %(is_admin)s, %(is_active)s,
                    %(now)s, %(now)s, %(now)s
                )
                ON CONFLICT (phone) DO NOTHING
                RETURNING *
                """,
                {
                    "id": user_id,
                    "name": name,
                    "phone": phone,
                    "is_admin": is_admin,
                    "is_active": is_active,
                    "now": now,
                },
            ).fetchone()
        return dict(row) if row is not None else None

    def update_user(
        self,
        user_id: str,
        *,
        name: str,
        is_admin: bool,
        is_active: bool,
    ) -> dict[str, Any] | None:
        now = _utc_now()
        with self.database.connect() as connection:
            row = connection.execute(
                """
                UPDATE users
                SET name = %(name)s,
                    is_admin = %(is_admin)s,
                    is_active = %(is_active)s,
                    updated_at = %(now)s
                WHERE id = %(id)s
                RETURNING *
                """,
                {
                    "id": user_id,
                    "name": name,
                    "is_admin": is_admin,
                    "is_active": is_active,
                    "now": now,
                },
            ).fetchone()
        return dict(row) if row is not None else None

    def set_user_admin_if_phone_matches(self, phone: str, admin_phones: tuple[str, ...]) -> None:
        if phone not in admin_phones:
            return
        now = _utc_now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET is_admin = TRUE,
                    updated_at = %(now)s
                WHERE phone = %(phone)s
                """,
                {"phone": phone, "now": now},
            )

    def list_user_repository_permissions(self, user_id: str) -> list[str]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT repository_key
                FROM user_repository_permissions
                WHERE user_id = %(user_id)s
                ORDER BY repository_key ASC
                """,
                {"user_id": user_id},
            ).fetchall()
        return validate_repository_keys([str(row["repository_key"]) for row in rows])

    def set_user_repository_permissions(self, user_id: str, repository_keys: list[str]) -> list[str]:
        if self.get_user(user_id) is None:
            raise KeyError(user_id)
        safe_keys = validate_repository_keys(repository_keys)
        now = _utc_now()
        with self.database.connect() as connection:
            connection.execute(
                "DELETE FROM user_repository_permissions WHERE user_id = %(user_id)s",
                {"user_id": user_id},
            )
            for repository_key in safe_keys:
                connection.execute(
                    """
                    INSERT INTO user_repository_permissions (user_id, repository_key, created_at)
                    VALUES (%(user_id)s, %(repository_key)s, %(now)s)
                    """,
                    {"user_id": user_id, "repository_key": repository_key, "now": now},
                )
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
        requester = requester.strip() or "anonymous"
        with self.database.connect() as connection:
            row = connection.execute(
                """
                INSERT INTO tasks (
                    id, user_id, svn_url, old_revision, new_revision, requester, status,
                    report_path, error_message, claimed_by, heartbeat_at, created_at,
                    started_at, finished_at, updated_at, repository_key, repository_name
                )
                VALUES (
                    %(id)s, %(user_id)s, %(svn_url)s, %(old_revision)s, %(new_revision)s,
                    %(requester)s, %(status)s, %(report_path)s, NULL, NULL, NULL,
                    %(now)s, NULL, NULL, %(now)s, %(repository_key)s, %(repository_name)s
                )
                RETURNING *
                """,
                {
                    "id": task_id,
                    "user_id": user_id,
                    "svn_url": svn_url,
                    "old_revision": old_revision,
                    "new_revision": new_revision,
                    "requester": requester,
                    "status": TaskStatus.pending.value,
                    "report_path": report_path,
                    "now": now,
                    "repository_key": repository_key,
                    "repository_name": repository_name,
                },
            ).fetchone()
        task = _row_to_task(row)
        if task is None:
            raise RuntimeError("created task could not be loaded")
        return task

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id = %(id)s", {"id": task_id}).fetchone()
        return _row_to_task(row)

    def get_task_for_user(self, task_id: str, user_id: str) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM tasks WHERE id = %(id)s AND user_id = %(user_id)s",
                {"id": task_id, "user_id": user_id},
            ).fetchone()
        return _row_to_task(row)

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT %(limit)s",
                {"limit": limit},
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def list_tasks_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM tasks
                WHERE user_id = %(user_id)s
                ORDER BY created_at DESC, id DESC
                LIMIT %(limit)s
                """,
                {"user_id": user_id, "limit": limit},
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def claim_next_task(self) -> dict[str, Any] | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT id FROM tasks
                WHERE status = %(status)s
                ORDER BY created_at ASC, id ASC
                LIMIT 1
                """,
                {"status": TaskStatus.pending.value},
            ).fetchone()
        if row is None:
            return None
        return self.mark_running(row["id"], worker_id="")

    def mark_running(self, task_id: str, *, worker_id: str) -> dict[str, Any]:
        now = _utc_now()
        with self.database.connect() as connection:
            row = connection.execute(
                """
                UPDATE tasks
                SET status = %(status)s,
                    started_at = COALESCE(started_at, %(now)s),
                    updated_at = %(now)s,
                    heartbeat_at = %(now)s,
                    claimed_by = %(worker_id)s
                WHERE id = %(id)s
                RETURNING *
                """,
                {
                    "id": task_id,
                    "status": TaskStatus.running.value,
                    "worker_id": worker_id,
                    "now": now,
                },
            ).fetchone()
        task = _row_to_task(row)
        if task is None:
            raise KeyError(task_id)
        return task

    def refresh_heartbeat(self, task_id: str) -> None:
        now = _utc_now()
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE tasks SET heartbeat_at = %(now)s, updated_at = %(now)s WHERE id = %(id)s",
                {"id": task_id, "now": now},
            )

    def mark_success(self, task_id: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.success, None)

    def mark_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.failed, error_message)

    def mark_enqueue_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        return self._mark_finished(task_id, TaskStatus.enqueue_failed, error_message)

    def get_user_stats(self, user_id: str) -> dict[str, int]:
        stats = {status.value: 0 for status in TaskStatus}
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM tasks
                WHERE user_id = %(user_id)s
                GROUP BY status
                """,
                {"user_id": user_id},
            ).fetchall()
        for row in rows:
            stats[str(row["status"])] = int(row["count"])
        stats["total"] = sum(stats[status.value] for status in TaskStatus)
        return stats

    def get_admin_dashboard(self) -> dict[str, Any]:
        status_counts = {status.value: 0 for status in TaskStatus}
        with self.database.connect() as connection:
            totals = connection.execute(
                """
                SELECT
                    COUNT(*) AS user_total,
                    COUNT(*) FILTER (WHERE is_admin) AS admin_total,
                    COUNT(*) FILTER (WHERE is_active) AS active_user_total
                FROM users
                """
            ).fetchone()
            task_totals = connection.execute(
                """
                SELECT
                    COUNT(*) AS task_total,
                    COUNT(*) FILTER (WHERE created_at::date = %(today)s) AS today_task_total
                FROM tasks
                """,
                {"today": _utc_now().date()},
            ).fetchone()
            status_rows = connection.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM tasks
                GROUP BY status
                """
            ).fetchall()
            user_usage_rows = connection.execute(
                """
                SELECT
                    users.id AS user_id,
                    users.name,
                    users.phone,
                    COUNT(tasks.id) AS task_count
                FROM users
                LEFT JOIN tasks ON tasks.user_id = users.id
                GROUP BY users.id, users.name, users.phone
                ORDER BY task_count DESC, users.name ASC
                """
            ).fetchall()
            repository_usage_rows = connection.execute(
                """
                SELECT repository_key, repository_name, COUNT(*) AS task_count
                FROM tasks
                GROUP BY repository_key, repository_name
                ORDER BY task_count DESC, repository_key ASC NULLS FIRST
                """
            ).fetchall()
            recent_task_rows = connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT 10"
            ).fetchall()

        for row in status_rows:
            status_counts[str(row["status"])] = int(row["count"])

        return {
            "user_total": int(totals["user_total"]) if totals is not None else 0,
            "admin_total": int(totals["admin_total"]) if totals is not None else 0,
            "active_user_total": int(totals["active_user_total"]) if totals is not None else 0,
            "task_total": int(task_totals["task_total"]) if task_totals is not None else 0,
            "today_task_total": int(task_totals["today_task_total"]) if task_totals is not None else 0,
            "status_counts": status_counts,
            "user_usage": [
                {
                    "user_id": row["user_id"],
                    "name": row["name"],
                    "phone": row["phone"],
                    "task_count": int(row["task_count"]),
                }
                for row in user_usage_rows
            ],
            "repository_usage": [
                {
                    "repository_key": row["repository_key"],
                    "repository_name": row["repository_name"],
                    "task_count": int(row["task_count"]),
                }
                for row in repository_usage_rows
            ],
            "recent_tasks": [_row_to_task(row) for row in recent_task_rows],
        }

    def delete_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                DELETE FROM tasks
                WHERE created_at < %(cutoff)s
                RETURNING *
                """,
                {"cutoff": cutoff},
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def list_older_than(self, cutoff_iso: str | datetime) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks WHERE created_at < %(cutoff)s ORDER BY created_at ASC, id ASC",
                {"cutoff": cutoff},
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def delete_tasks_by_ids(self, task_ids: list[str]) -> int:
        if not task_ids:
            return 0
        with self.database.connect() as connection:
            rows = connection.execute(
                "DELETE FROM tasks WHERE id = ANY(%(task_ids)s) RETURNING id",
                {"task_ids": task_ids},
            ).fetchall()
        return len(rows)

    def fail_stale_running_tasks(
        self,
        cutoff_iso: str | datetime,
        error_message: str,
    ) -> list[dict[str, Any]]:
        cutoff = _canonicalize_utc(cutoff_iso)
        now = _utc_now()
        safe_error = error_message[:MAX_ERROR_MESSAGE_LENGTH]
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                UPDATE tasks
                SET status = %(status)s,
                    finished_at = %(now)s,
                    updated_at = %(now)s,
                    error_message = %(error_message)s
                WHERE status = %(running)s
                  AND heartbeat_at < %(cutoff)s
                RETURNING *
                """,
                {
                    "status": TaskStatus.failed.value,
                    "now": now,
                    "error_message": safe_error,
                    "running": TaskStatus.running.value,
                    "cutoff": cutoff,
                },
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def _mark_finished(
        self,
        task_id: str,
        status: TaskStatus,
        error_message: str | None,
    ) -> dict[str, Any]:
        now = _utc_now()
        safe_error = error_message[:MAX_ERROR_MESSAGE_LENGTH] if error_message is not None else None
        with self.database.connect() as connection:
            row = connection.execute(
                """
                UPDATE tasks
                SET status = %(status)s,
                    finished_at = %(now)s,
                    updated_at = %(now)s,
                    error_message = %(error_message)s
                WHERE id = %(id)s
                RETURNING *
                """,
                {
                    "id": task_id,
                    "status": status.value,
                    "now": now,
                    "error_message": safe_error,
                },
            ).fetchone()
        task = _row_to_task(row)
        if task is None:
            raise KeyError(task_id)
        return task


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _canonicalize_utc(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        if value.endswith("Z"):
            value = f"{value[:-1]}+00:00"
        parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _row_to_task(row) -> dict[str, Any] | None:
    if row is None:
        return None
    task = dict(row)
    task["status"] = TaskStatus(task["status"])
    return task
