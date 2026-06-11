from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from sqlmodel import delete
from sqlmodel import select

from app.core.config import settings
from app.models import Feedback, FeedbackScreenshot, FeedbackStatus, User, UserRole
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


def _admin_headers(client: TestClient, db: Session) -> dict[str, str]:
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    return authentication_token_from_key(client=client, key=admin_api_key.key, db=db)


def _create_feedback_row(
    db: Session,
    *,
    user_id,
    description: str,
    status: FeedbackStatus = FeedbackStatus.pending,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> Feedback:
    feedback = Feedback(
        user_id=user_id,
        description=description,
        status=status,
        created_at=created_at or datetime.now(timezone.utc),
        updated_at=updated_at or created_at or datetime.now(timezone.utc),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def _clear_feedback_rows(db: Session) -> None:
    db.exec(delete(FeedbackScreenshot))
    db.exec(delete(Feedback))
    db.commit()


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


def test_create_feedback_accepts_legacy_screenshot_field(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "旧客户端单图字段"},
        files={"screenshot": ("screen.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 200
    content = response.json()
    _assert_single_screenshot_public(content)


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


def test_normal_user_feedback_stats_only_count_own_feedback(
    client: TestClient,
    db: Session,
) -> None:
    _clear_feedback_rows(db)
    own_user, own_api_key = create_key_user(db)
    own_headers = authentication_token_from_key(
        client=client, key=own_api_key.key, db=db
    )
    other_user, _ = create_key_user(db)
    now = datetime.now(timezone.utc)
    _create_feedback_row(
        db,
        user_id=own_user.id,
        description="自己的待处理意见",
        status=FeedbackStatus.pending,
        created_at=now - timedelta(minutes=30),
    )
    _create_feedback_row(
        db,
        user_id=own_user.id,
        description="自己的已解决意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(hours=2),
        updated_at=now - timedelta(hours=1),
    )
    _create_feedback_row(
        db,
        user_id=other_user.id,
        description="其他人的处理中意见",
        status=FeedbackStatus.processing,
        created_at=now - timedelta(minutes=20),
    )

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=own_headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["range"] == "today"
    assert content["total"] == 2
    assert content["pending"] == 1
    assert content["processing"] == 0
    assert content["resolved"] == 1
    assert content["unresolved"] == 1
    assert content["resolution_rate"] == 0.5
    assert content["average_resolution_seconds"] == 3600
    assert content["by_status"] == {
        "pending": 1,
        "processing": 0,
        "resolved": 1,
    }
    assert content["feedback_by_user"] == []


def test_admin_feedback_stats_count_all_feedback_and_user_ranking(
    client: TestClient,
    db: Session,
) -> None:
    _clear_feedback_rows(db)
    first_user, _ = create_key_user(db)
    first_user.full_name = "意见用户 A"
    first_user.svn_username = "feedback-a"
    second_user, _ = create_key_user(db)
    second_user.full_name = "意见用户 B"
    second_user.svn_username = "feedback-b"
    db.add(first_user)
    db.add(second_user)
    db.commit()
    now = datetime.now(timezone.utc)
    for index in range(3):
        _create_feedback_row(
            db,
            user_id=first_user.id,
            description=f"A 用户意见 {index}",
            status=FeedbackStatus.pending,
            created_at=now - timedelta(minutes=index + 1),
        )
    _create_feedback_row(
        db,
        user_id=second_user.id,
        description="B 用户已解决意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(hours=3),
        updated_at=now - timedelta(hours=1),
    )
    admin_headers = _admin_headers(client, db)

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=admin_headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 4
    assert content["pending"] == 3
    assert content["processing"] == 0
    assert content["resolved"] == 1
    assert content["feedback_by_user"][:2] == [
        {
            "user_name": "意见用户 A",
            "svn_username": "feedback-a",
            "feedback_count": 3,
        },
        {
            "user_name": "意见用户 B",
            "svn_username": "feedback-b",
            "feedback_count": 1,
        },
    ]


def test_feedback_stats_support_yesterday_and_all_ranges(
    client: TestClient,
    db: Session,
) -> None:
    _clear_feedback_rows(db)
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    now = datetime.now(timezone.utc)
    _create_feedback_row(
        db,
        user_id=user.id,
        description="今天的意见",
        status=FeedbackStatus.pending,
        created_at=now - timedelta(hours=1),
    )
    _create_feedback_row(
        db,
        user_id=user.id,
        description="昨天的意见",
        status=FeedbackStatus.processing,
        created_at=now - timedelta(days=1, hours=1),
    )
    _create_feedback_row(
        db,
        user_id=user.id,
        description="历史意见",
        status=FeedbackStatus.resolved,
        created_at=now - timedelta(days=10),
        updated_at=now - timedelta(days=9),
    )

    yesterday_response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "yesterday"},
    )
    all_response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "all"},
    )

    assert yesterday_response.status_code == 200
    yesterday = yesterday_response.json()
    assert yesterday["range"] == "yesterday"
    assert yesterday["total"] == 1
    assert yesterday["processing"] == 1

    assert all_response.status_code == 200
    all_stats = all_response.json()
    assert all_stats["range"] == "all"
    assert all_stats["total"] == 3
    assert all_stats["pending"] == 1
    assert all_stats["processing"] == 1
    assert all_stats["resolved"] == 1


def test_feedback_stats_include_zero_statuses_and_trend_points(
    client: TestClient,
    db: Session,
) -> None:
    _clear_feedback_rows(db)
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/feedback/stats",
        headers=headers,
        params={"range": "today"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 0
    assert content["pending"] == 0
    assert content["processing"] == 0
    assert content["resolved"] == 0
    assert content["unresolved"] == 0
    assert content["resolution_rate"] == 0
    assert content["average_resolution_seconds"] is None
    assert content["by_status"] == {
        "pending": 0,
        "processing": 0,
        "resolved": 0,
    }
    assert len(content["trend"]) == 24
    assert all(point["count"] == 0 for point in content["trend"])


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


def test_feedback_screenshot_permissions_for_multiple_screenshots(
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

    forbidden_response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshots/{screenshot_id}",
        headers=normal_user_token_headers,
    )

    assert forbidden_response.status_code == 403
    assert forbidden_response.json()["detail"] == "Not enough permissions"

    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    admin_response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshots/{screenshot_id}",
        headers=admin_headers,
    )
    assert admin_response.status_code == 200
    assert admin_response.content == b"png-bytes"


def test_legacy_feedback_screenshot_endpoint_returns_first_screenshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "兼容旧接口"},
        files=[
            ("screenshots", ("first.png", b"first-image", "image/png")),
            ("screenshots", ("second.png", b"second-image", "image/png")),
        ],
    )
    assert response.status_code == 200
    feedback = response.json()

    legacy_response = client.get(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/screenshot",
        headers=normal_user_token_headers,
    )

    assert legacy_response.status_code == 200
    assert legacy_response.content == b"first-image"


def test_legacy_feedback_screenshot_endpoint_returns_lowest_sort_order(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    feedback_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "旧接口按排序返回"},
    )
    assert feedback_response.status_code == 200
    feedback_id = feedback_response.json()["id"]
    screenshot_dir = tmp_path / feedback_id
    screenshot_dir.mkdir(parents=True)
    later_path = screenshot_dir / "later.png"
    first_path = screenshot_dir / "first.png"
    later_path.write_bytes(b"later-image")
    first_path.write_bytes(b"first-by-sort")
    db.add(
        FeedbackScreenshot(
            feedback_id=feedback_id,
            file_path=str(later_path),
            file_name="later.png",
            content_type="image/png",
            file_size=len(b"later-image"),
            sort_order=10,
        )
    )
    db.add(
        FeedbackScreenshot(
            feedback_id=feedback_id,
            file_path=str(first_path),
            file_name="first.png",
            content_type="image/png",
            file_size=len(b"first-by-sort"),
            sort_order=1,
        )
    )
    db.commit()

    legacy_response = client.get(
        f"{settings.API_V1_STR}/feedback/{feedback_id}/screenshot",
        headers=normal_user_token_headers,
    )

    assert legacy_response.status_code == 200
    assert legacy_response.content == b"first-by-sort"


def test_legacy_feedback_screenshot_endpoint_falls_back_to_legacy_fields(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    screenshot_path = tmp_path / "legacy.png"
    screenshot_path.write_bytes(b"legacy-image")
    feedback = Feedback(
        user_id=user.id,
        description="只有旧字段的截图",
        screenshot_path=str(screenshot_path),
        screenshot_name="legacy.png",
        screenshot_content_type="image/png",
        screenshot_size=len(b"legacy-image"),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    legacy_response = client.get(
        f"{settings.API_V1_STR}/feedback/{feedback.id}/screenshot",
        headers=headers,
    )

    assert legacy_response.status_code == 200
    assert legacy_response.content == b"legacy-image"
    assert legacy_response.headers["content-type"] == "image/png"


def test_delete_user_removes_feedback_screenshot_files(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    user, api_key = create_key_user(db)
    user_id = user.id
    user_headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    upload_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=user_headers,
        data={"description": "删除用户时清理截图"},
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )
    assert upload_response.status_code == 200
    feedback_id = upload_response.json()["id"]
    assert (tmp_path / feedback_id).is_dir()

    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    response = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=admin_headers,
    )

    assert response.status_code == 200
    assert not (tmp_path / feedback_id).exists()
    db.expire_all()
    assert db.get(User, user_id) is None
    assert db.get(Feedback, feedback_id) is None


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
