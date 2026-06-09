from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from sqlmodel import select

from app.core.config import settings
from app.models import Feedback, FeedbackScreenshot, UserRole
from app.services import feedback_service
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


def _assert_private_paths_not_exposed(content: object) -> None:
    if isinstance(content, dict):
        assert "file_path" not in content
        assert "screenshot_path" not in content
        for value in content.values():
            _assert_private_paths_not_exposed(value)
    elif isinstance(content, list):
        for item in content:
            _assert_private_paths_not_exposed(item)


def _assert_no_feedback_saved(db: Session, description: str) -> None:
    feedbacks = db.exec(
        select(Feedback).where(Feedback.description == description)
    ).all()
    assert feedbacks == []
    feedback_ids = [feedback.id for feedback in feedbacks]
    screenshots = db.exec(
        select(FeedbackScreenshot).where(
            FeedbackScreenshot.feedback_id.in_(feedback_ids)
        )
    ).all()
    assert screenshots == []


def _assert_single_screenshot_public(content: dict) -> None:
    assert content["has_screenshot"] is True
    assert content["screenshot_name"] == "screen.png"
    assert content["screenshot_content_type"] == "image/png"
    assert content["screenshot_size"] == len(b"png-bytes")
    assert content["screenshot_count"] == 1
    assert len(content["screenshots"]) == 1
    screenshot = content["screenshots"][0]
    assert screenshot["file_name"] == "screen.png"
    assert screenshot["content_type"] == "image/png"
    assert screenshot["file_size"] == len(b"png-bytes")
    assert screenshot["sort_order"] == 0
    _assert_private_paths_not_exposed(content)


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
    _assert_private_paths_not_exposed(content)


def test_create_feedback_with_multiple_screenshots_and_read_them(
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
        files=[
            ("screenshots", ("first.png", b"first-image", "image/png")),
            ("screenshots", ("second.webp", b"second-image", "image/webp")),
        ],
    )

    assert response.status_code == 200
    content = response.json()
    assert content["has_screenshot"] is True
    assert content["screenshot_count"] == 2
    assert [item["file_name"] for item in content["screenshots"]] == [
        "first.png",
        "second.webp",
    ]
    assert [item["sort_order"] for item in content["screenshots"]] == [0, 1]
    _assert_private_paths_not_exposed(content)

    for screenshot, expected_body, expected_type in zip(
        content["screenshots"],
        [b"first-image", b"second-image"],
        ["image/png", "image/webp"],
    ):
        screenshot_response = client.get(
            f"{settings.API_V1_STR}/feedback/{content['id']}/screenshots/{screenshot['id']}",
            headers=normal_user_token_headers,
        )
        assert screenshot_response.status_code == 200
        assert screenshot_response.content == expected_body
        assert screenshot_response.headers["content-type"] == expected_type


def test_create_feedback_rejects_more_than_five_screenshots(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    description = "截图太多"
    files = [
        ("screenshots", (f"screen-{index}.png", b"png-bytes", "image/png"))
        for index in range(6)
    ]

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": description},
        files=files,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "最多只能上传 5 张截图"
    assert not any(tmp_path.iterdir())
    _assert_no_feedback_saved(db, description)


def test_create_feedback_cleans_files_and_db_when_later_screenshot_is_invalid(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    description = "第二张截图为空"

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": description},
        files=[
            ("screenshots", ("first.png", b"first-image", "image/png")),
            ("screenshots", ("second.png", b"", "image/png")),
        ],
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "截图不能为空"
    assert not any(tmp_path.iterdir())
    _assert_no_feedback_saved(db, description)


def test_create_feedback_rolls_back_db_and_files_when_screenshot_save_crashes(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    description = "保存截图崩溃"

    async def crash_after_writing(
        feedback_id, uploads
    ):  # type: ignore[no-untyped-def]
        screenshot_dir = tmp_path / str(feedback_id)
        screenshot_dir.mkdir(parents=True)
        (screenshot_dir / "partial.png").write_bytes(b"partial")
        raise RuntimeError("storage path leaked")

    monkeypatch.setattr(feedback_service, "save_screenshots", crash_after_writing)

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": description},
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "保存截图失败"
    assert "storage path leaked" not in response.text
    assert not any(tmp_path.iterdir())
    _assert_no_feedback_saved(db, description)


def test_create_feedback_cleans_files_and_db_when_commit_fails(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    description = "提交截图记录失败"
    original_commit = Session.commit
    commit_calls = 0

    def fail_feedback_commit(self: Session) -> None:
        nonlocal commit_calls
        pending_feedback = [
            item
            for item in self
            if isinstance(item, Feedback) and item.description == description
        ]
        if pending_feedback:
            commit_calls += 1
            raise RuntimeError("database path leaked")
        original_commit(self)

    monkeypatch.setattr(Session, "commit", fail_feedback_commit)

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": description},
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "保存截图失败"
    assert "database path leaked" not in response.text
    assert commit_calls == 1
    assert not any(tmp_path.iterdir())
    _assert_no_feedback_saved(db, description)


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
        files={"screenshots": ("notes.txt", b"text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "截图必须是 PNG、JPG 或 WEBP 图片"


def test_create_feedback_rejects_oversized_screenshot(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图太大"},
        files={
            "screenshots": (
                "large.png",
                b"x" * (5 * 1024 * 1024 + 1),
                "image/png",
            )
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "单张截图不能超过 5MB"


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
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )
    assert upload_response.status_code == 200
    other_feedback = upload_response.json()
    screenshot_id = other_feedback["screenshots"][0]["id"]

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshots/{screenshot_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_read_feedback_screenshot_returns_404_when_screenshot_belongs_to_other_feedback(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    first_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "第一条截图"},
        files={"screenshots": ("first.png", b"first-image", "image/png")},
    )
    assert first_response.status_code == 200
    first_feedback = first_response.json()
    second_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "第二条截图"},
        files={"screenshots": ("second.png", b"second-image", "image/png")},
    )
    assert second_response.status_code == 200
    second_feedback = second_response.json()
    other_screenshot_id = second_feedback["screenshots"][0]["id"]

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{first_feedback['id']}/screenshots/{other_screenshot_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Screenshot not found"


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
