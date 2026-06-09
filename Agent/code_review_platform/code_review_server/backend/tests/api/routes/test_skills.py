import hashlib
import io
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


@pytest.fixture(autouse=True)
def _clear_skill_packages(db: Session) -> None:
    db.exec(delete(SkillPackage))
    db.commit()


def _upload_skill(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str,
    version: str,
    activate: str = "true",
) -> dict[str, object]:
    response = client.post(
        f"{settings.API_V1_STR}/skills",
        headers=headers,
        data={"name": name, "version": version, "activate": activate},
        files={"upload": ("skill.zip", _skill_zip(), "application/zip")},
    )
    assert response.status_code == 200
    return response.json()


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
    assert active_response.json()["count"] == 1
    assert active_response.json()["data"][0]["id"] == uploaded["id"]
    assert active_response.json()["data"][0]["file_size"] == len(skill_zip)

    download_response = client.get(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/download",
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


def test_active_skills_returns_all_different_active_skill_names(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    first = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )
    second = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板二",
        version="1.0.0",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["count"] == 2
    assert {skill["id"] for skill in content["data"]} == {first["id"], second["id"]}
    assert {skill["name"] for skill in content["data"]} == {
        "通用-代码变更审查-模板一",
        "通用-代码变更审查-模板二",
    }


def test_activating_same_name_replaces_only_previous_same_name_active_skill(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))

    old_same_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )
    other_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板二",
        version="1.0.0",
    )
    new_same_name = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.1",
        activate="false",
    )

    response = client.post(
        f"{settings.API_V1_STR}/skills/{new_same_name['id']}/activate",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    active_response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )
    active_ids = {skill["id"] for skill in active_response.json()["data"]}
    assert active_ids == {new_same_name["id"], other_name["id"]}
    assert old_same_name["id"] not in active_ids


def test_admin_can_deactivate_skill_and_download_by_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    uploaded = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )

    download_response = client.get(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/download",
        headers=normal_user_token_headers,
    )
    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("application/zip")

    deactivate_response = client.post(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/deactivate",
        headers=superuser_token_headers,
    )
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["is_active"] is False

    active_response = client.get(
        f"{settings.API_V1_STR}/skills/active",
        headers=normal_user_token_headers,
    )
    assert active_response.status_code == 200
    assert active_response.json() == {"data": [], "count": 0}


def test_legacy_active_download_downloads_single_active_skill(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    uploaded = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/active/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")
    assert response.content == _skill_zip()
    assert uploaded["is_active"] is True


def test_legacy_active_download_returns_409_when_multiple_active_skills_exist(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
    )
    _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板二",
        version="1.0.0",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/active/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "Multiple active skills are configured; download by skill id instead"
    )


def test_normal_user_cannot_download_inactive_skill_by_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    uploaded = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
        activate="false",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


def test_admin_can_download_inactive_skill_by_id(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "SKILL_STORAGE_DIR", str(tmp_path))
    uploaded = _upload_skill(
        client,
        superuser_token_headers,
        name="通用-代码变更审查-模板一",
        version="1.0.0",
        activate="false",
    )

    response = client.get(
        f"{settings.API_V1_STR}/skills/{uploaded['id']}/download",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")


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


def test_active_skills_returns_empty_list_when_no_skill_exists(
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

    assert response.status_code == 200
    assert response.json() == {"data": [], "count": 0}
