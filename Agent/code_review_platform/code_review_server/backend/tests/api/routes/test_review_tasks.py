import hashlib
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import (
    Department,
    ReviewTask,
    ReviewTaskRequirementFile,
    ReviewTaskStatus,
    UserRole,
)
from tests.utils.user import (
    authentication_token_from_key,
    create_key_user,
)
from tests.utils.utils import random_lower_string

TASK_STATS_TIMEZONE = ZoneInfo("Asia/Shanghai")


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


def _shanghai_datetime(days_delta: int, hour: int = 12) -> datetime:
    today = datetime.now(TASK_STATS_TIMEZONE).date()
    return datetime.combine(
        today + timedelta(days=days_delta),
        time(hour=hour),
        tzinfo=TASK_STATS_TIMEZONE,
    ).astimezone(timezone.utc).replace(tzinfo=None)


def _today_elapsed_datetime(minutes_ago: int) -> datetime:
    current = datetime.now(TASK_STATS_TIMEZONE)
    today_start = datetime.combine(
        current.date(),
        time.min,
        tzinfo=TASK_STATS_TIMEZONE,
    )
    elapsed = max(1, int((current - today_start).total_seconds() // 60) - minutes_ago)
    return (today_start + timedelta(minutes=elapsed)).astimezone(timezone.utc).replace(
        tzinfo=None
    )


def _set_review_task_stats_fields(
    db: Session,
    task_id: str,
    *,
    created_at: datetime,
    status: ReviewTaskStatus,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    report_path: str | None = None,
) -> None:
    db_task = db.get(ReviewTask, UUID(task_id))
    assert db_task is not None
    db_task.created_at = created_at
    db_task.updated_at = created_at
    db_task.status = status
    db_task.started_at = started_at
    db_task.finished_at = finished_at
    db_task.report_path = report_path
    db.add(db_task)
    db.commit()


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


def test_create_review_task_stores_template_and_skill_name(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "r12",
            "new_revision": "r14",
            "template_key": "template_2",
            "skill_name": "通用-代码变更审查-模板二",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["template_key"] == "template_2"
    assert content["skill_name"] == "通用-代码变更审查-模板二"
    assert content["old_revision"] == "r12"
    assert content["new_revision"] == "r14"


def test_create_review_task_without_template_fields_remains_supported(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["template_key"] is None
    assert content["skill_name"] is None


def test_create_review_task_legacy_payload_returns_new_fields_as_empty(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] is None
    assert content["department_name"] is None
    assert content["focus_direction_id"] is None
    assert content["focus_direction_snapshot"] is None
    assert content["requirement_file_name"] is None
    assert content["requirement_file_size"] is None
    assert content["requirement_file_sha256"] is None


def test_create_review_task_stores_department_and_focus_snapshot(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"审查部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    user, api_key = create_key_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()
    db.refresh(user)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    focus_snapshot = "重点检查权限、缓存一致性和异常处理"

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=headers,
        json={
            "svn_url": "svn://repo/project",
            "old_revision": "12",
            "new_revision": "14",
            "focus_direction_snapshot": focus_snapshot,
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == department.name
    assert content["focus_direction_snapshot"] == focus_snapshot

    db_task = db.get(ReviewTask, UUID(content["id"]))
    assert db_task is not None
    assert db_task.department_id == department.id
    assert db_task.department_name == department.name
    assert db_task.focus_direction_snapshot == focus_snapshot


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


def test_download_review_task_report_uses_uploaded_report_filename(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="10")
    report_name = "r10_r2审查报告_20260610_142530.md"
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": (report_name, b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    assert upload_response.json()["report_name"] == report_name

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert report_name in unquote(response.headers["content-disposition"])
    assert response.content == b"# Review\n"


def test_download_review_task_report_falls_back_to_default_report_filename(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="10")
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": ("report.md", b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200

    db_task = db.get(ReviewTask, UUID(task["id"]))
    assert db_task is not None
    db_task.report_name = None
    db.add(db_task)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert "代码审查报告.md" in unquote(response.headers["content-disposition"])


def test_upload_and_download_review_task_pdf_report(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf-report",
        headers=normal_user_token_headers,
        files={"upload": ("代码审查报告.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )

    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["pdf_report_path"]
    assert uploaded["pdf_report_name"] == "代码审查报告.pdf"

    download_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("application/pdf")
    assert "代码审查报告.pdf" in unquote(
        download_response.headers["content-disposition"]
    )
    assert download_response.content == b"%PDF-1.4\npdf\n"


def test_download_review_task_pdf_report_returns_404_when_missing(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    task = _create_review_task(client, normal_user_token_headers)

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "PDF report not found"


def test_delete_review_task_removes_existing_pdf_report_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf-report",
        headers=normal_user_token_headers,
        files={"upload": ("report.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )
    assert upload_response.status_code == 200
    pdf_path = Path(upload_response.json()["pdf_report_path"])
    assert pdf_path.is_file()

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert not pdf_path.exists()


def test_download_review_task_pdf_report_requires_task_permission(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    other = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="Other User",
        svn_username="other",
    )
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{other['task']['id']}/pdf-report",
        headers=other["headers"],
        files={"upload": ("report.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )
    assert upload_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{other['task']['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_upload_review_task_requirement_file_stores_metadata_and_record(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    content = b"requirement rows"

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={
            "upload": (
                "产品开发需求表.xls",
                content,
                "application/vnd.ms-excel",
            )
        },
    )

    assert response.status_code == 200
    uploaded = response.json()
    expected_hash = hashlib.sha256(content).hexdigest()
    assert uploaded["requirement_file_name"] == "产品开发需求表.xls"
    assert uploaded["requirement_file_size"] == len(content)
    assert uploaded["requirement_file_sha256"] == expected_hash

    requirement_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    assert requirement_file.file_name == "产品开发需求表.xls"
    assert requirement_file.file_size == len(content)
    assert requirement_file.sha256 == expected_hash
    assert Path(requirement_file.file_path).is_file()


def test_upload_review_task_requirement_file_replaces_old_file_and_record(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    first_content = b"first requirement rows"
    second_content = b"second requirement rows"

    first_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xls", first_content, "application/vnd.ms-excel")},
    )
    assert first_response.status_code == 200
    first_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    first_file_id = first_file.id
    first_file_path = Path(first_file.file_path)
    assert first_file_path.read_bytes() == first_content

    second_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xls", second_content, "application/vnd.ms-excel")},
    )

    assert second_response.status_code == 200
    db.expire_all()
    requirement_files = db.exec(
        select(ReviewTaskRequirementFile)
        .where(ReviewTaskRequirementFile.task_id == UUID(task["id"]))
    ).all()
    assert len(requirement_files) == 1
    second_file = requirement_files[0]
    assert second_file.id != first_file_id
    assert second_file.sha256 == hashlib.sha256(second_content).hexdigest()
    assert not first_file_path.exists()
    assert Path(second_file.file_path).read_bytes() == second_content
    assert db.get(ReviewTaskRequirementFile, first_file_id) is None

    updated_task = db.get(ReviewTask, UUID(task["id"]))
    assert updated_task is not None
    assert updated_task.requirement_file_id == second_file.id
    assert updated_task.requirement_file_sha256 == hashlib.sha256(
        second_content
    ).hexdigest()
    assert updated_task.requirement_file_size == len(second_content)


def test_upload_review_task_requirement_file_replaces_duplicate_same_content(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    content = b"same requirement rows"

    first_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xls", content, "application/vnd.ms-excel")},
    )
    assert first_response.status_code == 200
    first_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    first_file_id = first_file.id
    shared_path = Path(first_file.file_path)
    assert shared_path.read_bytes() == content

    second_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xls", content, "application/vnd.ms-excel")},
    )

    assert second_response.status_code == 200
    db.expire_all()
    requirement_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    assert requirement_file.id != first_file_id
    assert Path(requirement_file.file_path) == shared_path
    assert shared_path.read_bytes() == content
    assert db.get(ReviewTaskRequirementFile, first_file_id) is None


def test_upload_review_task_requirement_file_sanitizes_unsafe_and_long_name(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    long_name = "../secret/\x00bad\nname" + ("很长" * 160) + " .xlsx"
    content = b"requirement rows"

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={
            "upload": (
                long_name,
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    requirement_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    stored_name = requirement_file.file_name
    assert "/" not in stored_name
    assert "\\" not in stored_name
    assert "\x00" not in stored_name
    assert not any(ord(char) < 32 or ord(char) == 127 for char in stored_name)
    assert len(stored_name.encode("utf-8")) <= 255
    assert stored_name.endswith(".xlsx")
    assert Path(requirement_file.file_path).is_file()


def test_upload_review_task_requirement_file_rejects_unsupported_extension(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.txt", b"rows", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "产品开发需求表仅支持 .xls 或 .xlsx 文件。"


def test_upload_review_task_requirement_file_rejects_empty_excel(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={
            "upload": (
                "产品开发需求表.xlsx",
                b"",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "产品开发需求表不能为空。"


def test_delete_review_task_removes_requirement_file_and_record(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xls", b"rows", "application/vnd.ms-excel")},
    )
    assert upload_response.status_code == 200
    requirement_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    requirement_file_id = requirement_file.id
    requirement_path = Path(requirement_file.file_path)
    assert requirement_path.is_file()

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert not requirement_path.exists()
    db.expire_all()
    assert db.get(ReviewTaskRequirementFile, requirement_file_id) is None
    assert db.get(ReviewTask, UUID(task["id"])) is None


def test_delete_review_task_removes_task_when_requirement_file_delete_fails(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/requirement-file",
        headers=normal_user_token_headers,
        files={"upload": ("需求表.xlsx", b"rows", "application/vnd.ms-excel")},
    )
    assert upload_response.status_code == 200
    requirement_file = db.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == UUID(task["id"])
        )
    ).one()
    requirement_file_id = requirement_file.id
    requirement_path = Path(requirement_file.file_path)

    original_unlink = Path.unlink

    def fail_requirement_unlink(self: Path, missing_ok: bool = False) -> None:
        if self == requirement_path:
            raise OSError("cannot delete")
        original_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", fail_requirement_unlink)

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    db.expire_all()
    assert db.get(ReviewTask, UUID(task["id"])) is None
    assert db.get(ReviewTaskRequirementFile, requirement_file_id) is None
    assert requirement_path.exists()


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


def test_delete_review_task_removes_task_when_report_file_delete_fails(
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

    assert response.status_code == 200

    read_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )
    assert read_response.status_code == 404
    assert report_path.exists()


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


def test_task_stats_support_today_yesterday_and_all_ranges(
    client: TestClient,
    db: Session,
    tmp_path: Path,
) -> None:
    user, api_key = create_key_user(db)
    user.full_name = "任务统计用户"
    db.add(user)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    today_task = _create_review_task(client, headers, old_revision="301")
    _set_review_task_stats_fields(
        db,
        today_task["id"],
        created_at=_today_elapsed_datetime(60),
        status=ReviewTaskStatus.success,
        started_at=_today_elapsed_datetime(60),
        finished_at=_today_elapsed_datetime(60) + timedelta(minutes=10),
        report_path=str(tmp_path / "today.md"),
    )
    yesterday_task = _create_review_task(client, headers, old_revision="302")
    _set_review_task_stats_fields(
        db,
        yesterday_task["id"],
        created_at=_shanghai_datetime(-1, 10),
        status=ReviewTaskStatus.failed,
        report_path=str(tmp_path / "yesterday.md"),
    )
    older_task = _create_review_task(client, headers, old_revision="303")
    _set_review_task_stats_fields(
        db,
        older_task["id"],
        created_at=_shanghai_datetime(-2, 10),
        status=ReviewTaskStatus.running_codex,
        report_path=str(tmp_path / "older.md"),
    )

    today_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=headers,
        params={"range": "today"},
    )
    yesterday_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=headers,
        params={"range": "yesterday"},
    )
    all_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=headers,
        params={"range": "all"},
    )

    assert today_response.status_code == 200
    today_content = today_response.json()
    assert today_content["range"] == "today"
    assert today_content["total"] == 1
    assert today_content["success"] == 1
    assert today_content["running"] == 0
    assert today_content["failed_or_error"] == 0
    assert today_content["reports_by_user"] == []
    assert today_content["trend"][-1]["count"] == 1

    assert yesterday_response.status_code == 200
    yesterday_content = yesterday_response.json()
    assert yesterday_content["range"] == "yesterday"
    assert yesterday_content["total"] == 1
    assert yesterday_content["success"] == 0
    assert yesterday_content["failed_or_error"] == 1
    assert yesterday_content["reports_by_user"] == []
    assert yesterday_content["trend"][-1]["count"] == 1

    assert all_response.status_code == 200
    all_content = all_response.json()
    assert all_content["range"] == "all"
    assert all_content["total"] == 3
    assert all_content["success"] == 1
    assert all_content["running"] == 1
    assert all_content["failed_or_error"] == 1
    assert all_content["reports_by_user"] == []
    today_label = datetime.now(TASK_STATS_TIMEZONE).date().isoformat()
    yesterday_label = (
        datetime.now(TASK_STATS_TIMEZONE).date() - timedelta(days=1)
    ).isoformat()
    older_label = (
        datetime.now(TASK_STATS_TIMEZONE).date() - timedelta(days=2)
    ).isoformat()
    assert all_content["trend"] == [
        {
            "label": older_label,
            "count": 1,
        },
        {
            "label": yesterday_label,
            "count": 1,
        },
        {
            "label": today_label,
            "count": 1,
        },
    ]


def test_task_stats_average_duration_uses_valid_finished_tasks(
    client: TestClient,
    db: Session,
) -> None:
    own_user, own_api_key = create_key_user(db)
    own_headers = authentication_token_from_key(
        client=client, key=own_api_key.key, db=db
    )
    other_user, other_api_key = create_key_user(db)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )

    valid_short = _create_review_task(client, own_headers, old_revision="401")
    _set_review_task_stats_fields(
        db,
        valid_short["id"],
        created_at=_today_elapsed_datetime(80),
        status=ReviewTaskStatus.success,
        started_at=_today_elapsed_datetime(80),
        finished_at=_today_elapsed_datetime(80) + timedelta(minutes=10),
    )
    valid_long = _create_review_task(client, own_headers, old_revision="402")
    _set_review_task_stats_fields(
        db,
        valid_long["id"],
        created_at=_today_elapsed_datetime(70),
        status=ReviewTaskStatus.failed,
        started_at=_today_elapsed_datetime(70),
        finished_at=_today_elapsed_datetime(70) + timedelta(minutes=20),
    )
    missing_started = _create_review_task(client, own_headers, old_revision="403")
    _set_review_task_stats_fields(
        db,
        missing_started["id"],
        created_at=_today_elapsed_datetime(60),
        status=ReviewTaskStatus.success,
        finished_at=_today_elapsed_datetime(60) + timedelta(minutes=5),
    )
    negative_duration = _create_review_task(client, own_headers, old_revision="404")
    _set_review_task_stats_fields(
        db,
        negative_duration["id"],
        created_at=_today_elapsed_datetime(50),
        status=ReviewTaskStatus.success,
        started_at=_today_elapsed_datetime(50),
        finished_at=_today_elapsed_datetime(50) - timedelta(minutes=5),
    )
    other_task = _create_review_task(client, other_headers, old_revision="405")
    _set_review_task_stats_fields(
        db,
        other_task["id"],
        created_at=_today_elapsed_datetime(40),
        status=ReviewTaskStatus.success,
        started_at=_today_elapsed_datetime(40),
        finished_at=_today_elapsed_datetime(40) + timedelta(hours=2),
    )
    yesterday_valid = _create_review_task(client, own_headers, old_revision="406")
    _set_review_task_stats_fields(
        db,
        yesterday_valid["id"],
        created_at=_shanghai_datetime(-1, 9),
        status=ReviewTaskStatus.success,
        started_at=_shanghai_datetime(-1, 9),
        finished_at=_shanghai_datetime(-1, 9) + timedelta(minutes=30),
    )

    today_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=own_headers,
        params={"range": "today"},
    )
    yesterday_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=own_headers,
        params={"range": "yesterday"},
    )
    all_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=own_headers,
        params={"range": "all"},
    )

    assert today_response.status_code == 200
    today_content = today_response.json()
    assert today_content["range"] == "today"
    assert today_content["total"] == 4
    assert today_content["average_duration_seconds"] == 900

    assert yesterday_response.status_code == 200
    yesterday_content = yesterday_response.json()
    assert yesterday_content["range"] == "yesterday"
    assert yesterday_content["total"] == 1
    assert yesterday_content["average_duration_seconds"] == 1800

    assert all_response.status_code == 200
    all_content = all_response.json()
    assert all_content["range"] == "all"
    assert all_content["total"] >= 5
    assert all_content["average_duration_seconds"] == 1200
    assert other_user.id != own_user.id


def test_admin_task_stats_include_all_nonzero_report_counts_by_user(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    report_user_prefix = f"报告用户-{random_lower_string()}"

    for index in range(21):
        user, api_key = create_key_user(db)
        user.full_name = f"{report_user_prefix} {index:02d}"
        db.add(user)
        db.commit()
        headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

        for report_index in range(index + 1):
            task = _create_review_task(
                client,
                headers,
                old_revision=f"{index + 1000}{report_index}",
            )
            upload_response = client.post(
                f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
                headers=headers,
                files={
                    "upload": (
                        "report.md",
                        b"# Review\n",
                        "text/markdown",
                    )
                },
            )
            assert upload_response.status_code == 200
            if index == 20 and report_index == 0:
                _set_review_task_stats_fields(
                    db,
                    task["id"],
                    created_at=_shanghai_datetime(-1, 10),
                    status=ReviewTaskStatus.success,
                    report_path=upload_response.json()["report_path"],
                )

    no_report_user, no_report_api_key = create_key_user(db)
    no_report_user.full_name = "没有报告用户"
    db.add(no_report_user)
    db.commit()
    no_report_headers = authentication_token_from_key(
        client=client, key=no_report_api_key.key, db=db
    )
    _create_review_task(client, no_report_headers, old_revision="9999")

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    reports_by_user = [
        user_stat
        for user_stat in response.json()["reports_by_user"]
        if user_stat["user_name"].startswith(report_user_prefix)
    ]
    assert len(reports_by_user) == 21
    report_user_20 = next(
        user_stat
        for user_stat in reports_by_user
        if user_stat["user_name"] == f"{report_user_prefix} 20"
    )
    assert report_user_20 == {
        "user_name": f"{report_user_prefix} 20",
        "svn_username": None,
        "report_count": 20,
    }
    assert reports_by_user[-1]["user_name"] == f"{report_user_prefix} 00"
    assert reports_by_user[-1]["report_count"] == 1
    assert "没有报告用户" not in {
        user_stat["user_name"] for user_stat in reports_by_user
    }

    yesterday_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=superuser_token_headers,
        params={"range": "yesterday"},
    )

    assert yesterday_response.status_code == 200
    yesterday_report_users = [
        user_stat
        for user_stat in yesterday_response.json()["reports_by_user"]
        if user_stat["user_name"] == f"{report_user_prefix} 20"
    ]
    assert yesterday_report_users == [
        {
            "user_name": f"{report_user_prefix} 20",
            "svn_username": None,
            "report_count": 1,
        }
    ]


def test_normal_user_task_stats_do_not_include_report_counts_by_user(
    client: TestClient,
    db: Session,
) -> None:
    _, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/stats",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["reports_by_user"] == []


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
