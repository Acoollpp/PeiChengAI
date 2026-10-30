from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import select
from sqlmodel import delete
from sqlmodel import Session

from app.api.routes import whitebox_tasks
from app.core.config import settings
from app.models import (
    UserRole,
    WhiteboxAgent,
    WhiteboxAgentStatus,
    WhiteboxTaskStatus,
    WhiteboxTestTask,
)
from tests.utils.user import authentication_token_from_key, create_key_user


AGENT_TOKEN = "change-this-whitebox-agent-token"


def _agent_headers(token: str = AGENT_TOKEN) -> dict[str, str]:
    return {"X-Whitebox-Agent-Token": token}


def _register_agent(client: TestClient) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/whitebox-agents/heartbeat",
        headers=_agent_headers(),
        json={
            "name": "whitebox-pc-01",
            "machine_id": "WB-PC-01",
            "status": "idle",
            "capabilities": {"tool": "demo"},
        },
    )
    assert response.status_code == 200
    return response.json()


def _create_task(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/whitebox-tasks",
        headers=headers,
        data={
            "source_url": "svn://repo/project",
            "revision": "12345",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_create_whitebox_task_queues_task(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))

    content = _create_task(client, normal_user_token_headers)

    assert content["project_name"] == "project"
    assert content["source_url"] == "svn://repo/project"
    assert content["revision"] == "12345"
    assert content["test_config"] is None
    assert content["status"] == WhiteboxTaskStatus.queued
    assert content["input_files"] == []


def test_agent_can_claim_task_and_upload_result(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    db.exec(delete(WhiteboxTestTask))
    db.exec(delete(WhiteboxAgent))
    db.commit()
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))
    _register_agent(client)
    task = _create_task(client, normal_user_token_headers)

    claim = client.post(
        f"{settings.API_V1_STR}/whitebox-agents/claim-task",
        headers=_agent_headers(),
    )

    assert claim.status_code == 200
    claimed = claim.json()
    assert claimed["id"] == task["id"]
    assert claimed["status"] == WhiteboxTaskStatus.claimed

    status = client.post(
        f"{settings.API_V1_STR}/whitebox-agent-tasks/{task['id']}/status",
        headers=_agent_headers(),
        json={"status": "running", "message": "started"},
    )
    assert status.status_code == 200
    assert status.json()["status"] == WhiteboxTaskStatus.running
    assert status.json()["error_message"] == "started"

    log = client.post(
        f"{settings.API_V1_STR}/whitebox-agent-tasks/{task['id']}/logs",
        headers=_agent_headers(),
        json={"message": "line 1\nline 2"},
    )
    assert log.status_code == 200

    result = client.post(
        f"{settings.API_V1_STR}/whitebox-agent-tasks/{task['id']}/result",
        headers=_agent_headers(),
        data={"status": "success", "summary": "passed"},
        files={"report_uploads": ("report.txt", b"report body", "text/plain")},
    )
    assert result.status_code == 200
    completed = result.json()
    assert completed["status"] == WhiteboxTaskStatus.success
    assert completed["result_files"][0]["file_name"] == "report.txt"
    assert completed["error_message"] == "passed"

    download = client.get(
        f"{settings.API_V1_STR}/whitebox-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
    )
    assert download.status_code == 200
    assert download.content == b"report body"


def test_agent_heartbeat_creates_and_updates_agent(client: TestClient) -> None:
    first = _register_agent(client)
    assert first["status"] == WhiteboxAgentStatus.idle
    assert first["machine_id"] == "WB-PC-01"

    second = client.post(
        f"{settings.API_V1_STR}/whitebox-agents/heartbeat",
        headers=_agent_headers(),
        json={
            "name": "whitebox-pc-01-renamed",
            "machine_id": "WB-PC-01",
            "status": "busy",
            "capabilities": {"tool": "demo-v2"},
        },
    )

    assert second.status_code == 200
    content = second.json()
    assert content["id"] == first["id"]
    assert content["name"] == "whitebox-pc-01-renamed"
    assert content["status"] == WhiteboxAgentStatus.busy
    assert content["capabilities"]["tool"] == "demo-v2"


def test_idle_heartbeat_marks_stale_running_task_timeout(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    db.exec(delete(WhiteboxTestTask))
    db.exec(delete(WhiteboxAgent))
    db.commit()
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "WHITEBOX_TASK_TIMEOUT_SECONDS", 60)
    agent = _register_agent(client)
    task = _create_task(client, normal_user_token_headers)
    claim = client.post(
        f"{settings.API_V1_STR}/whitebox-agents/claim-task",
        headers=_agent_headers(),
    )
    assert claim.status_code == 200

    stale_started_at = whitebox_tasks._utcnow() - timedelta(seconds=120)
    task_model = db.get(WhiteboxTestTask, task["id"])
    assert task_model is not None
    task_model.status = WhiteboxTaskStatus.running
    task_model.started_at = stale_started_at
    task_model.updated_at = stale_started_at
    db.add(task_model)
    db.commit()

    heartbeat = client.post(
        f"{settings.API_V1_STR}/whitebox-agents/heartbeat",
        headers=_agent_headers(),
        json={
            "name": "whitebox-pc-01",
            "machine_id": agent["machine_id"],
            "status": "idle",
            "capabilities": {"tool": "demo"},
        },
    )

    assert heartbeat.status_code == 200
    refreshed_task = db.exec(select(WhiteboxTestTask)).one()
    assert refreshed_task.status == WhiteboxTaskStatus.timeout
    assert refreshed_task.finished_at is not None
    assert "超过 60 秒" in (refreshed_task.error_message or "")


def test_normal_user_cannot_access_other_user_whitebox_task(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))
    other_user, other_key = create_key_user(db)
    other_headers = authentication_token_from_key(client=client, key=other_key.key, db=db)
    other_task = _create_task(client, other_headers)

    response = client.get(
        f"{settings.API_V1_STR}/whitebox-tasks/{other_task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_admin_default_whitebox_task_list_only_includes_own_tasks(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))
    user_task = _create_task(client, normal_user_token_headers)
    admin, admin_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(client=client, key=admin_key.key, db=db)
    admin_task = _create_task(client, admin_headers)

    response = client.get(f"{settings.API_V1_STR}/whitebox-tasks", headers=admin_headers)

    assert response.status_code == 200
    ids = {task["id"] for task in response.json()["data"]}
    assert admin_task["id"] in ids
    assert user_task["id"] not in ids


def test_admin_can_list_all_whitebox_tasks_with_all_scope(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "WHITEBOX_STORAGE_DIR", str(tmp_path))
    user_task = _create_task(client, normal_user_token_headers)
    admin, admin_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(client=client, key=admin_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/whitebox-tasks?scope=all",
        headers=admin_headers,
    )

    assert response.status_code == 200
    ids = {task["id"] for task in response.json()["data"]}
    assert user_task["id"] in ids


def test_normal_user_cannot_list_all_whitebox_tasks(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/whitebox-tasks?scope=all",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
