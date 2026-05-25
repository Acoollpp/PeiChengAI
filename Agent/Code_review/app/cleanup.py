from __future__ import annotations

import logging
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.database import TaskRepository

logger = logging.getLogger(__name__)


def cleanup_old_tasks(
    repo: TaskRepository,
    workspaces_dir: Path,
    retention_days: int,
    reports_dir: Path | None = None,
) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    old_tasks = repo.list_older_than(cutoff)
    deleted_task_ids: list[str] = []
    reports_root = Path(reports_dir).resolve() if reports_dir is not None else None
    workspaces_root = Path(workspaces_dir).resolve()

    for task in old_tasks:
        report_path = Path(task["report_path"]).resolve()
        workspace_path = (workspaces_root / task["id"]).resolve()

        if reports_root is not None and not report_path.is_relative_to(reports_root):
            logger.warning("Skipping report outside managed report directory for task %s", task["id"])
            continue
        if not workspace_path.is_relative_to(workspaces_root):
            logger.warning("Skipping workspace outside managed workspace directory for task %s", task["id"])
            continue

        try:
            if report_path.exists():
                report_path.unlink()
            if workspace_path.exists():
                shutil.rmtree(workspace_path)
        except OSError:
            logger.exception("Failed to delete files for task %s", task["id"])
            continue

        deleted_task_ids.append(task["id"])

    return repo.delete_tasks_by_ids(deleted_task_ids)
