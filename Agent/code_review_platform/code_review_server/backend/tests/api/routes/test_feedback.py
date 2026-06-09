from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import UserRole
from tests.utils.user import authentication_token_from_key, create_key_user


def _create_feedback(client: TestClient, headers: dict[str, str], description: str) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=headers,
        data={"description": description},
    )
    assert response.status_code == 200
    return response.json()


def _headers_for_new_user(client: TestClient, db: Session) -> dict[str, str]:
    _, api_key = create_key_user(db)
    return authentication_token_from_key(client=client, key=api_key.key, db=db)


def test_create_feedback_text_only(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    description = "页面加载后希望保留筛选条件"

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": description},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["description"] == description
    assert content["status"] == "pending"
    assert content["screenshot_count"] == 0
    assert content["screenshots"] == []
    assert "screenshot_path" not in content
    assert "file_path" not in str(content)


def test_create_feedback_with_screenshot_and_read_it(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图里按钮遮挡了文字"},
        files={"screenshot": ("screen.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["has_screenshot"] is True
    assert content["screenshot_name"] == "screen.png"
    assert content["screenshot_content_type"] == "image/png"
    assert content["screenshot_size"] == len(b"png-bytes")
    assert "screenshot_path" not in content

    screenshot_response = client.get(
        f"{settings.API_V1_STR}/feedback/{content['id']}/screenshot",
        headers=normal_user_token_headers,
    )
    assert screenshot_response.status_code == 200
    assert screenshot_response.content == b"png-bytes"
    assert screenshot_response.headers["content-type"] == "image/png"


def test_create_feedback_rejects_blank_description(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "   "},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Feedback description must not be empty"


def test_create_feedback_rejects_non_image_screenshot(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "上传了错误格式"},
        files={"screenshot": ("notes.txt", b"text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Screenshot must be a PNG, JPG, or WEBP image"


def test_create_feedback_rejects_oversized_screenshot(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图太大"},
        files={"screenshot": ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Screenshot must not exceed 5MB"


def test_normal_user_lists_only_own_feedback(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    own_feedback = _create_feedback(client, normal_user_token_headers, "自己的意见")
    other_headers = _headers_for_new_user(client, db)
    other_feedback = _create_feedback(client, other_headers, "其他人的意见")

    response = client.get(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    feedback_ids = {item["id"] for item in content["data"]}
    assert own_feedback["id"] in feedback_ids
    assert other_feedback["id"] not in feedback_ids


def test_admin_lists_all_feedback(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    first_feedback = _create_feedback(client, normal_user_token_headers, "第一个意见")
    other_headers = _headers_for_new_user(client, db)
    second_feedback = _create_feedback(client, other_headers, "第二个意见")
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    response = client.get(
        f"{settings.API_V1_STR}/feedback",
        headers=admin_headers,
    )

    assert response.status_code == 200
    content = response.json()
    feedback_ids = {item["id"] for item in content["data"]}
    assert first_feedback["id"] in feedback_ids
    assert second_feedback["id"] in feedback_ids


def test_normal_user_cannot_read_other_user_feedback(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    other_headers = _headers_for_new_user(client, db)
    other_feedback = _create_feedback(client, other_headers, "其他人的详情")

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_normal_user_cannot_read_other_user_screenshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    other_headers = _headers_for_new_user(client, db)
    upload_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=other_headers,
        data={"description": "其他人的截图"},
        files={"screenshot": ("screen.png", b"png-bytes", "image/png")},
    )
    assert upload_response.status_code == 200
    other_feedback = upload_response.json()

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshot",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_normal_user_cannot_update_feedback_status(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    feedback = _create_feedback(client, normal_user_token_headers, "不能自己关闭")

    response = client.patch(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/status",
        headers=normal_user_token_headers,
        json={"status": "resolved"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_admin_can_update_feedback_status_to_resolved(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    feedback = _create_feedback(client, normal_user_token_headers, "管理员可以关闭")
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    response = client.patch(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/status",
        headers=admin_headers,
        json={"status": "resolved"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["id"] == feedback["id"]
    assert content["status"] == "resolved"
    assert content["updated_at"]
