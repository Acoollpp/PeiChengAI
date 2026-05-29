import io
import hashlib
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import SkillPackage


def _skill_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "通用-代码变更审查/SKILL.md",
            "---\nname: test\n---\n\n# Code Review Skill\n![diagram](image/SKILL/diagram.png)\n",
        )
        archive.writestr("通用-代码变更审查/image/SKILL/diagram.png", b"png bytes")
        archive.writestr("__MACOSX/._SKILL.md", b"mac metadata")
        archive.writestr("通用-代码变更审查/.DS_Store", b"mac metadata")
    return buffer.getvalue()


def test_admin_can_upload_activate_and_download_skill_package(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    skill_zip = _skill_zip()

    upload_response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=superuser_token_headers,
        data={
            "name": "通用-代码变更审查",
            "version": "2026.05.28",
            "description": "默认代码审查 Skill",
            "activate": "true",
        },
        files={
            "upload": (
                "skill.zip",
                skill_zip,
                "application/zip",
            )
        },
    )

    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["name"] == "通用-代码变更审查"
    assert uploaded["version"] == "2026.05.28"
    assert uploaded["is_active"] is True
    assert uploaded["content_hash"] == hashlib.sha256(skill_zip).hexdigest()
    assert uploaded["file_size"] == len(skill_zip)

    active_response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )

    assert active_response.status_code == 200
    assert active_response.json()["id"] == uploaded["id"]
    assert active_response.json()["file_size"] == len(skill_zip)

    download_response = client.get(
        f"{settings.API_V1_STR}/skills/active/download",
        headers=normal_user_token_headers,
    )

    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("application/zip")
    assert download_response.content == skill_zip
    with zipfile.ZipFile(io.BytesIO(download_response.content)) as archive:
        assert sorted(archive.namelist()) == [
            "__MACOSX/._SKILL.md",
            "通用-代码变更审查/.DS_Store",
            "通用-代码变更审查/SKILL.md",
            "通用-代码变更审查/image/SKILL/diagram.png",
        ]
        assert (
            archive.read("通用-代码变更审查/SKILL.md").decode()
            == "---\nname: test\n---\n\n# Code Review Skill\n![diagram](image/SKILL/diagram.png)\n"
        )
        assert archive.read("通用-代码变更审查/image/SKILL/diagram.png") == b"png bytes"


def test_upload_skill_package_requires_skill_md(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("README.md", "# Not a Skill\n")

    response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=superuser_token_headers,
        data={"name": "通用-代码变更审查", "version": "1.0.0"},
        files={"upload": ("skill.zip", buffer.getvalue(), "application/zip")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Skill package must contain SKILL.md"


def test_non_admin_cannot_upload_skill(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=normal_user_token_headers,
        data={"name": "通用-代码变更审查", "version": "1.0.0"},
        files={"upload": ("skill.zip", _skill_zip(), "application/zip")},
    )

    assert response.status_code == 403


def test_activating_skill_deactivates_previous_active_skill(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    first_response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=superuser_token_headers,
        data={"name": "通用-代码变更审查", "version": "1.0.0", "activate": "true"},
        files={"upload": ("first.zip", _skill_zip(), "application/zip")},
    )
    second_response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=superuser_token_headers,
        data={"name": "通用-代码变更审查", "version": "2.0.0", "activate": "false"},
        files={"upload": ("second.zip", _skill_zip(), "application/zip")},
    )
    assert first_response.status_code == 200
    assert second_response.status_code == 200

    activate_response = client.post(
        f"{settings.API_V1_STR}/skills/{second_response.json()['id']}/activate",
        headers=superuser_token_headers,
    )

    assert activate_response.status_code == 200
    assert activate_response.json()["is_active"] is True

    list_response = client.get(
        f"{settings.API_V1_STR}/skills",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    active_skills = [
        skill for skill in list_response.json()["data"] if skill["is_active"]
    ]
    assert [skill["id"] for skill in active_skills] == [second_response.json()["id"]]


def test_active_skill_returns_404_when_no_skill_exists(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    db.exec(delete(SkillPackage))
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "No active skill is configured"
