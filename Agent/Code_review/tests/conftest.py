import pytest
from fastapi.testclient import TestClient

from app.database import TaskRepository


@pytest.fixture
def api_paths(tmp_path):
    return {
        "database_path": tmp_path / "data" / "tasks.db",
        "reports_dir": tmp_path / "reports",
        "workspaces_dir": tmp_path / "workspaces",
    }


@pytest.fixture
def api_client(api_paths):
    from app.main import create_app

    app = create_app(**api_paths, start_worker=False)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def api_repository(api_paths):
    return TaskRepository(api_paths["database_path"])
