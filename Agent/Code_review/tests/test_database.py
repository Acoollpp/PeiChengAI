from datetime import UTC, datetime, timedelta

import pytest

from app.models import TaskStatus


def create_sample_task(
    repository,
    *,
    task_id="task-1",
    requester="alice",
    report_path="reports/task-1.md",
    user_id=None,
):
    if user_id is None:
        user = repository.get_or_create_user(name=requester or "anonymous", phone="13800138000")
        user_id = user["id"]
    return repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=requester or "",
        report_path=report_path,
        user_id=user_id,
        task_id=task_id,
    )


def test_get_or_create_user_creates_and_updates_by_phone(repository):
    created = repository.get_or_create_user(name="张三", phone="13800138000")
    updated = repository.get_or_create_user(name="张三丰", phone="13800138000")

    assert created["id"] == updated["id"]
    assert updated["name"] == "张三丰"
    assert updated["phone"] == "13800138000"
    assert updated["last_seen_at"] >= created["last_seen_at"]


def test_repository_stores_user_repository_permissions(repository):
    user = repository.get_or_create_user(name="alice", phone="13800138000")

    repository.set_user_repository_permissions(user["id"], ["power", "energy", "home", "home"])

    assert repository.list_user_repository_permissions(user["id"]) == ["energy", "home", "power"]


def test_repository_replaces_user_repository_permissions(repository):
    user = repository.get_or_create_user(name="alice", phone="13800138000")
    repository.set_user_repository_permissions(user["id"], ["home", "power"])

    repository.set_user_repository_permissions(user["id"], ["bs"])

    assert repository.list_user_repository_permissions(user["id"]) == ["bs"]


def test_repository_permissions_require_existing_user(repository):
    with pytest.raises(KeyError):
        repository.set_user_repository_permissions("missing-user", ["home"])


def test_create_and_get_task_stores_pending_status_and_requester(repository):
    created = create_sample_task(repository, requester="reviewer")
    fetched = repository.get_task(created["id"])

    assert created["status"] == TaskStatus.pending
    assert fetched is not None
    assert fetched["id"] == created["id"]
    assert fetched["status"] == TaskStatus.pending
    assert fetched["requester"] == "reviewer"
    assert fetched["report_path"] == "reports/task-1.md"


@pytest.mark.parametrize("requester", [None, "", "   "])
def test_create_task_defaults_empty_requester_to_anonymous(repository, requester):
    created = create_sample_task(repository, requester=requester)
    fetched = repository.get_task(created["id"])

    assert created["requester"] == "anonymous"
    assert fetched["requester"] == "anonymous"


def test_create_task_stores_user_id_and_requester(repository):
    user = repository.get_or_create_user(name="李四", phone="13900139000")

    task = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/task.md",
        user_id=user["id"],
        task_id="task-1",
    )

    assert task["user_id"] == user["id"]
    assert task["requester"] == "李四"
    assert repository.get_task_for_user("task-1", user["id"])["id"] == "task-1"
    assert repository.get_task_for_user("task-1", "other-user") is None


def test_claim_next_task_claims_oldest_pending_task(repository):
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


def test_claim_next_task_does_not_return_same_task_twice_from_same_repository(repository):
    only_task = create_sample_task(repository, task_id="only")

    first_claim = repository.claim_next_task()
    second_claim = repository.claim_next_task()

    assert first_claim is not None
    assert first_claim["id"] == only_task["id"]
    assert second_claim is None


def test_mark_success_sets_success_status_and_finished_at(repository):
    task = create_sample_task(repository)

    updated = repository.mark_success(task["id"])

    assert updated["status"] == TaskStatus.success
    assert updated["finished_at"] is not None
    assert repository.get_task(task["id"])["finished_at"] == updated["finished_at"]


def test_mark_failed_sets_failed_status_finished_at_and_truncates_error(repository):
    task = create_sample_task(repository)
    long_error = "x" * 5000

    updated = repository.mark_failed(task["id"], long_error)

    assert updated["status"] == TaskStatus.failed
    assert updated["finished_at"] is not None
    assert updated["error_message"] == "x" * 2000


def test_user_stats_counts_statuses(repository):
    user = repository.get_or_create_user(name="王五", phone="13700137000")
    first = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/first.md",
        user_id=user["id"],
        task_id="first",
    )
    second = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r2",
        new_revision="r3",
        requester=user["name"],
        report_path="reports/second.md",
        user_id=user["id"],
        task_id="second",
    )
    repository.mark_success(first["id"])
    repository.mark_enqueue_failed(second["id"], "redis unavailable")

    stats = repository.get_user_stats(user["id"])

    assert stats["total"] == 2
    assert stats["success"] == 1
    assert stats["enqueue_failed"] == 1


def test_list_tasks_orders_newest_first(repository):
    first = create_sample_task(repository, task_id="first")
    second = create_sample_task(repository, task_id="second")
    third = create_sample_task(repository, task_id="third")

    tasks = repository.list_tasks()

    assert [task["id"] for task in tasks] == [third["id"], second["id"], first["id"]]


def test_list_tasks_for_user_filters_to_owner(repository):
    first_user = repository.get_or_create_user(name="first", phone="13100131000")
    second_user = repository.get_or_create_user(name="second", phone="13200132000")
    first = create_sample_task(repository, task_id="first", user_id=first_user["id"])
    create_sample_task(repository, task_id="second", user_id=second_user["id"])

    tasks = repository.list_tasks_for_user(first_user["id"])

    assert [task["id"] for task in tasks] == [first["id"]]


def test_delete_older_than_returns_deleted_records_and_removes_them(repository):
    old_task = create_sample_task(repository, task_id="old")
    kept_task = create_sample_task(repository, task_id="kept")
    old_created_at = datetime.now(UTC) - timedelta(days=2)
    cutoff = datetime.now(UTC) - timedelta(days=1)
    repository.tasks[old_task["id"]]["created_at"] = old_created_at
    repository.tasks[old_task["id"]]["updated_at"] = old_created_at

    deleted = repository.delete_older_than(cutoff)

    assert [task["id"] for task in deleted] == [old_task["id"]]
    assert deleted[0]["status"] == TaskStatus.pending
    assert repository.get_task(old_task["id"]) is None
    assert repository.get_task(kept_task["id"]) is not None


def test_delete_older_than_accepts_timezone_aware_datetime_cutoff(repository):
    old_task = create_sample_task(repository, task_id="old")
    kept_task = create_sample_task(repository, task_id="kept")
    old_created_at = datetime(2026, 5, 20, 12, 0, tzinfo=UTC)
    kept_created_at = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    cutoff = datetime(2026, 5, 21, 12, 0, tzinfo=UTC)
    repository.tasks[old_task["id"]]["created_at"] = old_created_at
    repository.tasks[old_task["id"]]["updated_at"] = old_created_at
    repository.tasks[kept_task["id"]]["created_at"] = kept_created_at
    repository.tasks[kept_task["id"]]["updated_at"] = kept_created_at

    deleted = repository.delete_older_than(cutoff)

    assert [task["id"] for task in deleted] == [old_task["id"]]
    assert repository.get_task(old_task["id"]) is None
    assert repository.get_task(kept_task["id"]) is not None


def test_delete_older_than_treats_z_cutoff_as_utc_equivalent(repository):
    task = create_sample_task(repository, task_id="same-instant")
    created_at = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    repository.tasks[task["id"]]["created_at"] = created_at
    repository.tasks[task["id"]]["updated_at"] = created_at

    deleted = repository.delete_older_than("2026-05-22T12:00:00Z")

    assert deleted == []
    assert repository.get_task(task["id"]) is not None


def test_fail_stale_running_tasks_marks_old_running_task_failed(repository):
    stale = create_sample_task(repository, task_id="stale")
    fresh = create_sample_task(repository, task_id="fresh")
    repository.mark_running(stale["id"], worker_id="worker-a")
    repository.mark_running(fresh["id"], worker_id="worker-a")
    stale_time = datetime(2026, 5, 20, 12, 0, tzinfo=UTC)
    fresh_time = datetime(2026, 5, 22, 12, 0, tzinfo=UTC)
    cutoff = datetime(2026, 5, 21, 12, 0, tzinfo=UTC)
    repository.tasks[stale["id"]]["heartbeat_at"] = stale_time
    repository.tasks[stale["id"]]["updated_at"] = stale_time
    repository.tasks[fresh["id"]]["heartbeat_at"] = fresh_time
    repository.tasks[fresh["id"]]["updated_at"] = fresh_time

    failed = repository.fail_stale_running_tasks(cutoff, "stale worker task")

    assert [task["id"] for task in failed] == [stale["id"]]
    assert repository.get_task(stale["id"])["status"] == TaskStatus.failed
    assert repository.get_task(stale["id"])["error_message"] == "stale worker task"
    assert repository.get_task(fresh["id"])["status"] == TaskStatus.running
