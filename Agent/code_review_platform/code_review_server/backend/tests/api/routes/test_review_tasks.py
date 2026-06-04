from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import UserRole
from tests.utils.user import (
    authentication_token_from_key,
    create_key_user,
)
from tests.utils.utils import random_lower_string


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


def _create_named_svn_user_task(
    *,
    client: TestClient,
    db: Session,
    full_name: str,
    svn_username: str,
    old_revision: str = "1",
) -> dict:
    user, api_key = create_key_user(db)
    user.full_name = full_name
    user.svn_username = f"{svn_username}-{random_lower_string()}"
    db.add(user)
    db.commit()
    db.refresh(user)
    user_headers = authentication_token_from_key(
        client=client, key=api_key.key, db=db
    )
    task = _create_review_task(client, user_headers, old_revision=old_revision)
    return {
        "task": task,
        "headers": user_headers,
        "user": user,
        "svn_username": user.svn_username,
    }


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


def test_delete_review_task_removes_task_row(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    task = _create_review_task(client, normal_user_token_headers)

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Review task deleted"}

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 404


def test_delete_review_task_removes_existing_report_file(
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
        files={"upload": ("report.md", b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    report_path = Path(upload_response.json()["report_path"])
    assert report_path.is_file()

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Review task deleted"}
    assert not report_path.exists()

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 404


def test_delete_review_task_succeeds_when_report_file_is_missing(
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
        files={"upload": ("report.md", b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    report_path = Path(upload_response.json()["report_path"])
    report_path.unlink()

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Review task deleted"}


def test_delete_review_task_keeps_task_when_report_file_delete_fails(
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
        files={"upload": ("report.md", b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    report_path = Path(upload_response.json()["report_path"])
    assert report_path.is_file()

    original_unlink = Path.unlink

    def fail_report_unlink(
        self: Path, missing_ok: bool = False
    ) -> None:
        if self == report_path:
            raise OSError("cannot delete")
        original_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", fail_report_unlink)

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to delete review task report"

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 200


def test_normal_user_cannot_delete_other_user_task(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    task = _create_review_task(client, other_headers)

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_normal_user_cannot_read_other_user_task(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
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
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    other_task = _create_review_task(client, other_headers, old_revision="5")
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
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


def test_admin_task_list_includes_user_identity_fields(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    user, api_key = create_key_user(db)
    user.full_name = "张三"
    svn_username = f"zhangsan-{random_lower_string()}"
    user.svn_username = svn_username
    db.add(user)
    db.commit()
    db.refresh(user)
    user_headers = authentication_token_from_key(
        client=client, key=api_key.key, db=db
    )
    task = _create_review_task(client, user_headers, old_revision="9")

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    listed_task = next(item for item in content["data"] if item["id"] == task["id"])
    assert listed_task["user_name"] == "张三"
    assert listed_task["svn_username"] == svn_username


def test_admin_can_filter_review_tasks_by_user_name(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    zhang = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张三",
        svn_username="zhang",
        old_revision="11",
    )
    li = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="李四",
        svn_username="lisi",
        old_revision="12",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"user_name": "张"},
    )

    assert response.status_code == 200
    content = response.json()
    listed_ids = {task["id"] for task in content["data"]}
    assert zhang["task"]["id"] in listed_ids
    assert li["task"]["id"] not in listed_ids


def test_admin_can_filter_review_tasks_by_svn_username(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    wang = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="王五",
        svn_username="wang",
        old_revision="13",
    )
    zhao = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="赵六",
        svn_username="zhao",
        old_revision="14",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"svn_username": "wang"},
    )

    assert response.status_code == 200
    content = response.json()
    listed_ids = {task["id"] for task in content["data"]}
    assert wang["task"]["id"] in listed_ids
    assert zhao["task"]["id"] not in listed_ids


def test_review_task_filters_are_combined_with_and(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    matching = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张三",
        svn_username="zhang",
        old_revision="15",
    )
    name_only = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张四",
        svn_username="li",
        old_revision="16",
    )
    svn_only = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="王五",
        svn_username="zhang",
        old_revision="17",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=superuser_token_headers,
        params={"user_name": "张", "svn_username": matching["svn_username"]},
    )

    assert response.status_code == 200
    content = response.json()
    listed_ids = {task["id"] for task in content["data"]}
    assert matching["task"]["id"] in listed_ids
    assert name_only["task"]["id"] not in listed_ids
    assert svn_only["task"]["id"] not in listed_ids


def test_normal_user_filters_only_search_own_review_tasks(
    client: TestClient,
    db: Session,
) -> None:
    own = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张三",
        svn_username="zhang",
        old_revision="18",
    )
    other = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="张四",
        svn_username="zhang",
        old_revision="19",
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks",
        headers=own["headers"],
        params={"user_name": "张", "svn_username": "zhang"},
    )

    assert response.status_code == 200
    content = response.json()
    listed_ids = {task["id"] for task in content["data"]}
    assert own["task"]["id"] in listed_ids
    assert other["task"]["id"] not in listed_ids


def test_normal_user_task_stats_only_count_own_tasks(
    client: TestClient,
    db: Session,
) -> None:
    _, own_api_key = create_key_user(db)
    own_headers = authentication_token_from_key(
        client=client, key=own_api_key.key, db=db
    )
    own_task = _create_review_task(client, own_headers, old_revision="31")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{own_task['id']}/status",
        headers=own_headers,
        json={"status": "success"},
    )
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    other_task = _create_review_task(client, other_headers, old_revision="32")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{other_task['id']}/status",
        headers=other_headers,
        json={"status": "failed"},
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=own_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 1
    assert content["success"] == 1
    assert content["running"] == 0
    assert content["failed_or_error"] == 0
    assert content["by_status"]["success"] == 1
    assert content["by_status"]["failed"] == 0


def test_admin_task_stats_count_all_tasks(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    baseline_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=superuser_token_headers,
    )
    assert baseline_response.status_code == 200
    baseline = baseline_response.json()

    _, success_api_key = create_key_user(db)
    success_headers = authentication_token_from_key(
        client=client, key=success_api_key.key, db=db
    )
    success_task = _create_review_task(client, success_headers, old_revision="33")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{success_task['id']}/status",
        headers=success_headers,
        json={"status": "success"},
    )
    _, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    running_task = _create_review_task(client, other_headers, old_revision="34")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{running_task['id']}/status",
        headers=other_headers,
        json={"status": "running_codex"},
    )
    failed_task = _create_review_task(client, other_headers, old_revision="35")
    client.patch(
        f"{settings.API_V1_STR}/review-tasks/{failed_task['id']}/status",
        headers=other_headers,
        json={"status": "environment_error"},
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] - baseline["total"] == 3
    assert content["success"] - baseline["success"] == 1
    assert content["running"] - baseline["running"] == 1
    assert content["failed_or_error"] - baseline["failed_or_error"] == 1
    assert content["by_status"]["success"] - baseline["by_status"]["success"] == 1
    assert (
        content["by_status"]["running_codex"]
        - baseline["by_status"]["running_codex"]
        == 1
    )
    assert (
        content["by_status"]["environment_error"]
        - baseline["by_status"]["environment_error"]
        == 1
    )


def test_task_stats_include_all_status_keys_with_zero_counts(
    client: TestClient, db: Session
) -> None:
    _, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert set(content["by_status"]) == {
        "created",
        "checking_environment",
        "running_codex",
        "uploading_report",
        "success",
        "failed",
        "environment_error",
        "cancelled",
    }
    for count in content["by_status"].values():
        assert isinstance(count, int)
        assert count == 0
    assert content["total"] == 0


def test_role_admin_can_read_other_user_task_detail(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    user_task = _create_review_task(client, normal_user_token_headers, old_revision="7")
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{user_task['id']}",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert response.json()["id"] == user_task["id"]
