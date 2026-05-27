def test_local_asgi_uses_in_memory_dependencies():
    from app.local_asgi import app
    from app.events import InMemoryEventBus
    from app.scheduler import InMemoryScheduler
    from app.testing import InMemoryTaskRepository

    assert isinstance(app.state.repo, InMemoryTaskRepository)
    assert isinstance(app.state.scheduler, InMemoryScheduler)
    assert isinstance(app.state.event_bus, InMemoryEventBus)
