import anyio

from app.events import InMemoryEventBus, format_sse


def test_format_sse_outputs_named_event_and_json_data():
    text = format_sse("task_updated", {"task_id": "task-1", "status": "running"})

    assert text.startswith("event: task_updated\n")
    assert 'data: {"task_id":"task-1","status":"running"}\n\n' in text


def test_in_memory_event_bus_publishes_to_user_stream():
    async def run():
        bus = InMemoryEventBus()
        stream = bus.subscribe("user-1")

        await bus.publish("user-1", "task_updated", {"task_id": "task-1"})
        event = await stream.__anext__()

        assert event["event"] == "task_updated"
        assert event["data"] == {"task_id": "task-1"}

    anyio.run(run)
