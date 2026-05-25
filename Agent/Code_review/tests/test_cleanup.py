from datetime import UTC, datetime
from pathlib import Path

from app.cleanup import cleanup_old_tasks
from app.models import TaskStatus
from app.testing import InMemoryTaskRepository


def make_repository(tmp_path):
    repository = InMemoryTaskRepository()
    repository.base_dir = tmp_path
    repository.init_schema()
    return repository


def create_task(repository, *, task_id, report_path):
    user = repository.get_or_create_user(name="alice", phone=f"1380013{len(repository.tasks):04d}")
    return repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path=str(report_path),
        user_id=user["id"],
        task_id=task_id,
    )


def set_created_at(repository, task_id, created_at):
    repository.tasks[task_id]["created_at"] = created_at
    repository.tasks[task_id]["updated_at"] = created_at


def test_cleanup_old_tasks_deletes_old_task_report_and_workspace(tmp_path):
    repository = make_repository(tmp_path)
    workspaces_dir = tmp_path / "workspaces"
    old_report = tmp_path / "reports" / "old.md"
    old_report.parent.mkdir()
    old_report.write_text("old report", encoding="utf-8")
    old_workspace = workspaces_dir / "old"
    old_workspace.mkdir(parents=True)
    (old_workspace / "checkout.txt").write_text("old checkout", encoding="utf-8")
    create_task(repository, task_id="old", report_path=old_report)
    set_created_at(repository, "old", datetime(2026, 5, 1, tzinfo=UTC))

    deleted_count = cleanup_old_tasks(repository, workspaces_dir, retention_days=7)

    assert deleted_count == 1
    assert repository.get_task("old") is None
    assert not old_report.exists()
    assert not old_workspace.exists()


def test_cleanup_old_tasks_keeps_newer_task_report_and_workspace(tmp_path):
    repository = make_repository(tmp_path)
    workspaces_dir = tmp_path / "workspaces"
    new_report = tmp_path / "reports" / "new.md"
    new_report.parent.mkdir()
    new_report.write_text("new report", encoding="utf-8")
    new_workspace = workspaces_dir / "new"
    new_workspace.mkdir(parents=True)
    (new_workspace / "checkout.txt").write_text("new checkout", encoding="utf-8")
    create_task(repository, task_id="new", report_path=new_report)
    set_created_at(repository, "new", datetime.now(UTC))

    deleted_count = cleanup_old_tasks(repository, workspaces_dir, retention_days=7)

    assert deleted_count == 0
    assert repository.get_task("new") is not None
    assert new_report.exists()
    assert new_workspace.exists()


def test_cleanup_old_tasks_ignores_missing_report_and_workspace(tmp_path):
    repository = make_repository(tmp_path)
    workspaces_dir = tmp_path / "workspaces"
    missing_report = tmp_path / "reports" / "missing.md"
    create_task(repository, task_id="missing-assets", report_path=missing_report)
    set_created_at(repository, "missing-assets", datetime(2026, 5, 1, tzinfo=UTC))

    deleted_count = cleanup_old_tasks(repository, workspaces_dir, retention_days=7)

    assert deleted_count == 1
    assert repository.get_task("missing-assets") is None


def test_cleanup_old_tasks_keeps_metadata_when_report_delete_fails(tmp_path, monkeypatch):
    repository = make_repository(tmp_path)
    workspaces_dir = tmp_path / "workspaces"
    old_report = tmp_path / "reports" / "old.md"
    old_report.parent.mkdir()
    old_report.write_text("old report", encoding="utf-8")
    create_task(repository, task_id="old", report_path=old_report)
    set_created_at(repository, "old", datetime(2026, 5, 1, tzinfo=UTC))

    def fail_unlink(self):
        if self == old_report:
            raise OSError("locked")
        return original_unlink(self)

    original_unlink = Path.unlink
    monkeypatch.setattr(Path, "unlink", fail_unlink)

    deleted_count = cleanup_old_tasks(
        repository,
        reports_dir=tmp_path / "reports",
        workspaces_dir=workspaces_dir,
        retention_days=7,
    )

    assert deleted_count == 0
    assert repository.get_task("old") is not None


def test_cleanup_old_tasks_skips_report_outside_reports_dir(tmp_path):
    repository = make_repository(tmp_path)
    workspaces_dir = tmp_path / "workspaces"
    reports_dir = tmp_path / "reports"
    outside_report = tmp_path / "outside.md"
    outside_report.write_text("outside", encoding="utf-8")
    create_task(repository, task_id="outside", report_path=outside_report)
    set_created_at(repository, "outside", datetime(2026, 5, 1, tzinfo=UTC))

    deleted_count = cleanup_old_tasks(
        repository,
        reports_dir=reports_dir,
        workspaces_dir=workspaces_dir,
        retention_days=7,
    )

    assert deleted_count == 0
    assert outside_report.exists()
    assert repository.get_task("outside") is not None


def test_fail_stale_running_tasks_marks_failed_and_keeps_user_queue_recoverable(repository):
    user = repository.get_or_create_user(name="张三", phone="13800138000")
    task = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/task.md",
        user_id=user["id"],
        task_id="task-1",
    )
    repository.mark_running(task["id"], worker_id="worker-a")

    failed = repository.fail_stale_running_tasks("2999-01-01T00:00:00+00:00", "stale worker task")

    assert failed[0]["id"] == "task-1"
    assert repository.get_task("task-1")["status"] == TaskStatus.failed
