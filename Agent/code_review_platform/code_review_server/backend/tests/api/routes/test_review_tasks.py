from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import UserCreate, UserRole
from tests.utils.user import (
    authentication_token_from_email,
    user_authentication_headers,
)
from tests.utils.utils import random_email, random_lower_string


def _create_review_task(
    client: TestClient, headers: dict[str, str], old_revision: str = "1"
) -> dict:
    data = {
        "svn_url": "https://svn.example.com/project/trunk",
        "old_revision": old_revision,
        "new_revision": "r2",
    }
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=headers,
        json=data,
    )
    assert response.status_code == 200
    return response.json()


def test_create_review_task_normalizes_revisions(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "1",
            "new_revision": "r2",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["svn_url"] == "https://svn.example.com/project/trunk"
    assert content["old_revision"] == "r1"
    assert content["new_revision"] == "r2"
    assert content["status"] == "created"


def test_create_review_task_rejects_same_revision(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "1",
            "new_revision": "r1",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Old and new revisions must differ"


def test_upload_and_read_review_task_report(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": ("report.md", b"# Review\n\nLooks good.\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["status"] == "success"
    assert uploaded["report_path"]

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 200
    assert read_response.headers["content-type"].startswith("text/markdown")
    assert read_response.text == "# Review\n\nLooks good.\n"


def test_normal_user_cannot_read_other_user_task(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    other_headers = authentication_token_from_email(
        client=client, email=random_email(), db=db
    )
    task = _create_review_task(client, other_headers)

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_admin_or_superuser_can_list_all_tasks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    user_task = _create_review_task(client, normal_user_token_headers, old_revision="3")
    other_headers = authentication_token_from_email(
        client=client, email=random_email(), db=db
    )
    other_task = _create_review_task(client, other_headers, old_revision="5")
    admin_password = random_lower_string()
    admin = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=admin_password),
    )
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = user_authentication_headers(
        client=client, email=admin.email, password=admin_password
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    listed_ids = {task["id"] for task in content["data"]}
    assert user_task["id"] in listed_ids
    assert other_task["id"] in listed_ids
    assert content["count"] >= 2

    admin_response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=admin_headers,
    )

    assert admin_response.status_code == 200
    admin_listed_ids = {task["id"] for task in admin_response.json()["data"]}
    assert user_task["id"] in admin_listed_ids
    assert other_task["id"] in admin_listed_ids


def test_role_admin_can_read_other_user_task_detail(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    user_task = _create_review_task(client, normal_user_token_headers, old_revision="7")
    admin_password = random_lower_string()
    admin = crud.create_user(
        session=db,
        user_create=UserCreate(email=random_email(), password=admin_password),
    )
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = user_authentication_headers(
        client=client, email=admin.email, password=admin_password
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{user_task['id']}",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["id"] == user_task["id"]
