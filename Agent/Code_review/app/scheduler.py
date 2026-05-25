from __future__ import annotations

from collections import OrderedDict, deque
from typing import Protocol

from redis import Redis


class Scheduler(Protocol):
    def enqueue_task(self, user_id: str, task_id: str) -> None:
        pass

    def claim_next_task(self, *, lock_ttl_seconds: int) -> dict[str, str] | None:
        pass

    def complete_task(self, user_id: str, task_id: str) -> None:
        pass

    def refresh_lock(self, user_id: str, task_id: str, *, lock_ttl_seconds: int) -> None:
        pass

    def rebuild_from_tasks(self, tasks: list[dict]) -> None:
        pass


class RedisScheduler:
    CLAIM_SCRIPT = """
    local ready = redis.call('SPOP', KEYS[1])
    if not ready then return nil end
    local lock_key = ARGV[1] .. ready
    if redis.call('EXISTS', lock_key) == 1 then
      return nil
    end
    local queue_key = ARGV[2] .. ready
    local task_id = redis.call('LPOP', queue_key)
    if not task_id then
      return nil
    end
    redis.call('SET', lock_key, task_id, 'EX', ARGV[3])
    if redis.call('LLEN', queue_key) > 0 then
      redis.call('SADD', KEYS[1], ready)
    end
    return {ready, task_id}
    """

    def __init__(self, redis: Redis):
        self.redis = redis

    def enqueue_task(self, user_id: str, task_id: str) -> None:
        self.redis.rpush(f"queue:user:{user_id}", task_id)
        if not self.redis.exists(f"running:user:{user_id}"):
            self.redis.sadd("users:ready", user_id)
        self.redis.set(f"task:user:{task_id}", user_id)

    def claim_next_task(self, *, lock_ttl_seconds: int) -> dict[str, str] | None:
        result = self.redis.eval(
            self.CLAIM_SCRIPT,
            1,
            "users:ready",
            "running:user:",
            "queue:user:",
            str(lock_ttl_seconds),
        )
        if not result:
            return None
        user_id, task_id = [_decode(part) for part in result]
        return {"user_id": user_id, "task_id": task_id}

    def complete_task(self, user_id: str, task_id: str) -> None:
        lock_key = f"running:user:{user_id}"
        current = self.redis.get(lock_key)
        if current is None or _decode(current) == task_id:
            self.redis.delete(lock_key)
        if self.redis.llen(f"queue:user:{user_id}") > 0:
            self.redis.sadd("users:ready", user_id)

    def refresh_lock(self, user_id: str, task_id: str, *, lock_ttl_seconds: int) -> None:
        lock_key = f"running:user:{user_id}"
        current = self.redis.get(lock_key)
        if current is not None and _decode(current) == task_id:
            self.redis.expire(lock_key, lock_ttl_seconds)

    def rebuild_from_tasks(self, tasks: list[dict]) -> None:
        for task in tasks:
            if str(task["status"]) == "pending":
                self.enqueue_task(task["user_id"], task["id"])


class InMemoryScheduler:
    def __init__(self):
        self.queues: OrderedDict[str, deque[str]] = OrderedDict()
        self.running: dict[str, str] = {}

    def enqueue_task(self, user_id: str, task_id: str) -> None:
        queue = self.queues.setdefault(user_id, deque())
        queue.append(task_id)

    def claim_next_task(self, *, lock_ttl_seconds: int) -> dict[str, str] | None:
        for user_id in list(self.queues):
            if user_id in self.running:
                continue
            queue = self.queues[user_id]
            if not queue:
                del self.queues[user_id]
                continue
            task_id = queue.popleft()
            self.running[user_id] = task_id
            if queue:
                self.queues.move_to_end(user_id)
            else:
                del self.queues[user_id]
            return {"user_id": user_id, "task_id": task_id}
        return None

    def complete_task(self, user_id: str, task_id: str) -> None:
        if self.running.get(user_id) == task_id:
            del self.running[user_id]

    def refresh_lock(self, user_id: str, task_id: str, *, lock_ttl_seconds: int) -> None:
        return None

    def rebuild_from_tasks(self, tasks: list[dict]) -> None:
        self.queues.clear()
        self.running.clear()
        for task in tasks:
            if str(task["status"]) == "pending":
                self.enqueue_task(task["user_id"], task["id"])


def _decode(value) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)
