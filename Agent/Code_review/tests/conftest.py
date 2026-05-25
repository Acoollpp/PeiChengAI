import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def api_paths(tmp_path):
    return {
        "database_path": tmp_path / "data" / "tasks.db",
        "reports_dir": tmp_path / "reports",
        "workspaces_dir": tmp_path / "workspaces",
    }


@pytest.fixture
def api_scheduler():
    from app.scheduler import InMemoryScheduler

    return InMemoryScheduler()


@pytest.fixture
def api_event_bus():
    from app.events import InMemoryEventBus

    return InMemoryEventBus()


@pytest.fixture
def api_client(api_paths, api_repository, api_scheduler, api_event_bus):
    from app.main import create_app

    app = create_app(
        **api_paths,
        start_worker=False,
        repo=api_repository,
        scheduler=api_scheduler,
        event_bus=api_event_bus,
    )
    with TestClient(app) as client:
        yield client


@pytest.fixture
def api_repository(repository):
    return repository


@pytest.fixture
def repository():
    from app.testing import InMemoryTaskRepository

    repo = InMemoryTaskRepository()
    repo.init_schema()
    return repo
