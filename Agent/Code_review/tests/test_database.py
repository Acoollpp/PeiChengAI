from datetime import UTC, datetime, timedelta

import pytest

from app.database import TaskRepository
from app.models import TaskStatus


def make_repository(tmp_path):
    repository = TaskRepository(tmp_path / "data" / "tasks.db")
    repository.init_schema()
    return repository


def create_sample_task(
    repository,
    *,
    task_id="task-1",
    requester="alice",
    report_path="reports/task-1.md",
):
    return repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=requester,
        report_path=report_path,
        task_id=task_id,
    )


def test_create_and_get_task_stores_pending_status_and_requester(tmp_path):
    repository = make_repository(tmp_path)

    created = create_sample_task(repository, requester="reviewer")
    fetched = repository.get_task(created["id"])

    assert created["status"] == TaskStatus.pending
    assert fetched is not None
    assert fetched["id"] == created["id"]
    assert fetched["status"] == TaskStatus.pending
    assert fetched["requester"] == "reviewer"
    assert fetched["report_path"] == "reports/task-1.md"


@pytest.mark.parametrize("requester", [None, "", "   "])
def test_create_task_defaults_empty_requester_to_anonymous(tmp_path, requester):
    repository = make_repository(tmp_path)

    created = create_sample_task(repository, requester=requester)
    fetched = repository.get_task(created["id"])

    assert created["requester"] == "anonymous"
    assert fetched["requester"] == "anonymous"


def test_claim_next_task_claims_oldest_pending_task(tmp_path):
    repository = make_repository(tmp_path)
    older = create_sample_task(repository, task_id="older")
    newer = create_sample_task(repository, task_id="newer")

    claimed = repository.claim_next_task()
    next_claimed = repository.claim_next_task()

    assert claimed is not None
    assert claimed["id"] == older["id"]
    assert claimed["status"] == TaskStatus.running
    assert claimed["started_at"] is not None
    assert repository.get_task(older["id"])["status"] == TaskStatus.running
    assert next_claimed is not None
    assert next_claimed["id"] == newer["id"]


def test_claim_next_task_does_not_return_same_task_twice_from_same_database(tmp_path):
    database_path = tmp_path / "data" / "tasks.db"
    first_repository = TaskRepository(database_path)
    second_repository = TaskRepository(database_path)
    first_repository.init_schema()
    only_task = create_sample_task(first_repository, task_id="only")

    first_claim = first_repository.claim_next_task()
    second_claim = second_repository.claim_next_task()

    assert first_claim is not None
    assert first_claim["id"] == only_task["id"]
    assert second_claim is None


def test_mark_success_sets_success_status_and_finished_at(tmp_path):
    repository = make_repository(tmp_path)
    task = create_sample_task(repository)

    updated = repository.mark_success(task["id"])

    assert updated["status"] == TaskStatus.success
    assert updated["finished_at"] is not None
    assert repository.get_task(task["id"])["finished_at"] == updated["finished_at"]


def test_mark_failed_sets_failed_status_finished_at_and_truncates_error(tmp_path):
    repository = make_repository(tmp_path)
    task = create_sample_task(repository)
    long_error = "x" * 5000

    updated = repository.mark_failed(task["id"], long_error)

    assert updated["status"] == TaskStatus.failed
    assert updated["finished_at"] is not None
    assert updated["error_message"] == "x" * 2000


def test_list_tasks_orders_newest_first(tmp_path):
    repository = make_repository(tmp_path)
    first = create_sample_task(repository, task_id="first")
    second = create_sample_task(repository, task_id="second")
    third = create_sample_task(repository, task_id="third")

    tasks = repository.list_tasks()

    assert [task["id"] for task in tasks] == [third["id"], second["id"], first["id"]]


def test_delete_older_than_returns_deleted_records_and_removes_them(tmp_path):
    repository = make_repository(tmp_path)
    old_task = create_sample_task(repository, task_id="old")
    kept_task = create_sample_task(repository, task_id="kept")
    old_created_at = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    cutoff = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    with repository.connect() as connection:
        connection.execute(
            "UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?",
            (old_created_at, old_created_at, old_task["id"]),
        )

    deleted = repository.delete_older_than(cutoff)

    assert [task["id"] for task in deleted] == [old_task["id"]]
    assert deleted[0]["status"] == TaskStatus.pending
    assert repository.get_task(old_task["id"]) is None
    assert repository.get_task(kept_task["id"]) is not None


def test_delete_older_than_accepts_timezone_aware_datetime_cutoff(tmp_path):
    repository = make_repository(tmp_path)
    old_task = create_sample_task(repository, task_id="old")
    kept_task = create_sample_task(repository, task_id="kept")
    old_created_at = datetime(2026, 5, 20, 12, 0, tzinfo=UTC).isoformat()
    kept_created_at = datetime(2026, 5, 22, 12, 0, tzinfo=UTC).isoformat()
    cutoff = datetime(2026, 5, 21, 12, 0, tzinfo=UTC)
    with repository.connect() as connection:
        connection.execute(
            "UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?",
            (old_created_at, old_created_at, old_task["id"]),
        )
        connection.execute(
            "UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?",
            (kept_created_at, kept_created_at, kept_task["id"]),
        )

    deleted = repository.delete_older_than(cutoff)

    assert [task["id"] for task in deleted] == [old_task["id"]]
    assert repository.get_task(old_task["id"]) is None
    assert repository.get_task(kept_task["id"]) is not None


def test_delete_older_than_treats_z_cutoff_as_utc_equivalent(tmp_path):
    repository = make_repository(tmp_path)
    task = create_sample_task(repository, task_id="same-instant")
    created_at = "2026-05-22T12:00:00+00:00"
    with repository.connect() as connection:
        connection.execute(
            "UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?",
            (created_at, created_at, task["id"]),
        )

    deleted = repository.delete_older_than("2026-05-22T12:00:00Z")

    assert deleted == []
    assert repository.get_task(task["id"]) is not None


def test_fail_stale_running_tasks_marks_old_running_task_failed(tmp_path):
    repository = make_repository(tmp_path)
    stale = create_sample_task(repository, task_id="stale")
    fresh = create_sample_task(repository, task_id="fresh")
    repository.claim_next_task()
    repository.claim_next_task()
    stale_time = datetime(2026, 5, 20, 12, 0, tzinfo=UTC).isoformat()
    fresh_time = datetime(2026, 5, 22, 12, 0, tzinfo=UTC).isoformat()
    cutoff = datetime(2026, 5, 21, 12, 0, tzinfo=UTC)
    with repository.connect() as connection:
        connection.execute(
            "UPDATE tasks SET updated_at = ?, started_at = ? WHERE id = ?",
            (stale_time, stale_time, stale["id"]),
        )
        connection.execute(
            "UPDATE tasks SET updated_at = ?, started_at = ? WHERE id = ?",
            (fresh_time, fresh_time, fresh["id"]),
        )

    failed = repository.fail_stale_running_tasks(cutoff, "stale worker task")

    assert [task["id"] for task in failed] == [stale["id"]]
    assert repository.get_task(stale["id"])["status"] == TaskStatus.failed
    assert repository.get_task(stale["id"])["error_message"] == "stale worker task"
    assert repository.get_task(fresh["id"])["status"] == TaskStatus.running
