from app.scheduler import InMemoryScheduler


def test_scheduler_claims_only_one_running_task_per_user():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-1", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert first == {"user_id": "user-1", "task_id": "task-1"}
    assert second is None


def test_scheduler_releases_user_and_claims_next_task():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-1", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    scheduler.complete_task(first["user_id"], first["task_id"])
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert second == {"user_id": "user-1", "task_id": "task-2"}


def test_scheduler_rotates_between_users():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-2", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert {first["user_id"], second["user_id"]} == {"user-1", "user-2"}


def test_scheduler_can_rebuild_from_pending_tasks():
    scheduler = InMemoryScheduler()
    scheduler.rebuild_from_tasks(
        [
            {"id": "task-1", "user_id": "user-1", "status": "pending"},
            {"id": "task-2", "user_id": "user-1", "status": "success"},
        ]
    )

    assert scheduler.claim_next_task(lock_ttl_seconds=60) == {
        "user_id": "user-1",
        "task_id": "task-1",
    }
