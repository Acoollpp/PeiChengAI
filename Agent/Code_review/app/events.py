from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator

from redis import Redis


def format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class InMemoryEventBus:
    def __init__(self):
        self.queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def publish(self, user_id: str, event: str, data: dict) -> None:
        for queue in list(self.queues[user_id]):
            await queue.put({"event": event, "data": data})

    def subscribe(self, user_id: str) -> AsyncIterator[dict]:
        queue: asyncio.Queue = asyncio.Queue()
        self.queues[user_id].append(queue)

        async def stream() -> AsyncIterator[dict]:
            try:
                while True:
                    yield await queue.get()
            finally:
                self.queues[user_id].remove(queue)

        return stream()


class RedisEventBus:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def publish(self, user_id: str, event: str, data: dict) -> None:
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        self.redis.publish(f"events:user:{user_id}", payload)
