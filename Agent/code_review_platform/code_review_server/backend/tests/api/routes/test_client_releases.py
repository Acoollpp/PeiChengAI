import asyncio
import base64
import hashlib
import uuid
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import ClientRelease, ClientUpdatePolicy
from app.services import client_release_service


def _latest_yml(version: str, filename: str, sha512: str, size: int) -> bytes:
    return (
        f"version: {version}\n"
        "files:\n"
        f"  - url: {filename}\n"
        f"    sha512: {sha512}\n"
        f"    size: {size}\n"
        f"path: {filename}\n"
        f"sha512: {sha512}\n"
        "releaseDate: '2026-06-08T08:00:00.000Z'\n"
    ).encode()


def _sha512_base64(content: bytes) -> str:
    return base64.b64encode(hashlib.sha512(content).digest()).decode()


def _upload_file(filename: str, content: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(content))


def _release(
    db: Session,
    version: str,
    *,
    is_active: bool = False,
    platform: str = "win32",
    arch: str = "x64",
) -> ClientRelease:
    release = ClientRelease(
        version=version,
        platform=platform,
        arch=arch,
        artifact_name=f"代码审查-v{version}.exe",
        artifact_path=f"/tmp/{version}/代码审查-v{version}.exe",
        artifact_size=12,
        artifact_sha512="a" * 128,
        latest_yml_name="latest.yml",
        latest_yml_path=f"/tmp/{version}/latest.yml",
        is_active=is_active,
    )
    db.add(release)
    db.commit()
    db.refresh(release)
    return release


def test_client_release_model_is_available() -> None:
    release = ClientRelease(
        version="1.0.1",
        platform="win32",
        arch="x64",
        release_notes="修复任务列表显示问题",
        artifact_name="代码审查-v1.0.1.exe",
        artifact_path="/tmp/release/代码审查-v1.0.1.exe",
        artifact_size=12,
        artifact_sha512="a" * 128,
        latest_yml_name="latest.yml",
        latest_yml_path="/tmp/release/latest.yml",
        is_active=False,
    )

    assert release.version == "1.0.1"
    assert release.platform == "win32"
    assert release.arch == "x64"


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("1.0.0", "1.0.0", 0),
        ("1.0.1", "1.0.0", 1),
        ("1.0.0-alpha.1", "1.0.0-alpha.2", -1),
        ("1.0.0-alpha", "1.0.0", -1),
        ("1.0.0+build.2", "1.0.0+build.1", 0),
    ],
)
def test_compare_versions_uses_semantic_version_rules(
    left: str, right: str, expected: int
) -> None:
    assert client_release_service.compare_versions(left, right) == expected


@pytest.mark.parametrize("version", ["1.0", " 1.0.0", "1.0.0 "])
def test_compare_versions_rejects_invalid_semantic_version(version: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        client_release_service.compare_versions(version, "1.0.0")

    assert exc_info.value.status_code == 400


def test_parse_latest_yml_requires_matching_version_and_installer() -> None:
    installer = b"installer bytes"
    sha512 = hashlib.sha512(installer).hexdigest()

    metadata = client_release_service.parse_latest_yml(
        content=_latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
        expected_version="1.0.1",
        expected_installer_name="代码审查-v1.0.1.exe",
    )

    assert metadata.version == "1.0.1"
    assert metadata.installer_name == "代码审查-v1.0.1.exe"
    assert metadata.sha512 == sha512
    assert metadata.size == len(installer)


def test_parse_latest_yml_accepts_base64_sha512() -> None:
    installer = b"installer bytes"
    sha512 = _sha512_base64(installer)

    metadata = client_release_service.parse_latest_yml(
        content=_latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
        expected_version="1.0.1",
        expected_installer_name="代码审查-v1.0.1.exe",
    )

    assert metadata.sha512 == sha512


def test_parse_latest_yml_rejects_mismatched_version() -> None:
    with pytest.raises(HTTPException) as exc_info:
        client_release_service.parse_latest_yml(
            content=_latest_yml("1.0.2", "代码审查-v1.0.1.exe", "a" * 128, 12),
            expected_version="1.0.1",
            expected_installer_name="代码审查-v1.0.1.exe",
        )

    assert exc_info.value.status_code == 400
    assert (
        exc_info.value.detail == "latest.yml version does not match submitted version"
    )


def test_parse_latest_yml_rejects_mismatched_files_url() -> None:
    with pytest.raises(HTTPException) as exc_info:
        client_release_service.parse_latest_yml(
            content=(
                "version: 1.0.1\n"
                "files:\n"
                "  - url: 代码审查-v1.0.2.exe\n"
                f"    sha512: {'a' * 128}\n"
                "    size: 12\n"
                "path: 代码审查-v1.0.1.exe\n"
                f"sha512: {'a' * 128}\n"
                "releaseDate: '2026-06-08T08:00:00.000Z'\n"
            ).encode(),
            expected_version="1.0.1",
            expected_installer_name="代码审查-v1.0.1.exe",
        )

    assert exc_info.value.status_code == 400


def test_parse_latest_yml_rejects_mismatched_files_sha512() -> None:
    with pytest.raises(HTTPException) as exc_info:
        client_release_service.parse_latest_yml(
            content=(
                "version: 1.0.1\n"
                "files:\n"
                "  - url: 代码审查-v1.0.1.exe\n"
                f"    sha512: {'b' * 128}\n"
                "    size: 12\n"
                "path: 代码审查-v1.0.1.exe\n"
                f"sha512: {'a' * 128}\n"
                "releaseDate: '2026-06-08T08:00:00.000Z'\n"
            ).encode(),
            expected_version="1.0.1",
            expected_installer_name="代码审查-v1.0.1.exe",
        )

    assert exc_info.value.status_code == 400


def test_save_upload_accepts_base64_sha512(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installer = b"installer bytes"
    sha512 = _sha512_base64(installer)
    release_id = uuid.uuid4()
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )

    saved_upload = asyncio.run(
        client_release_service.save_upload(
            release_id=release_id,
            version="1.0.1",
            installer=_upload_file("代码审查-v1.0.1.exe", installer),
            latest_yml=_upload_file(
                "latest.yml",
                _latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
            ),
            blockmap=None,
        )
    )

    assert saved_upload.release_path == tmp_path / str(release_id)
    assert saved_upload.metadata.sha512 == sha512
    assert saved_upload.installer_size == len(installer)
    assert saved_upload.blockmap_name is None
    assert saved_upload.blockmap_path is None


def test_save_upload_rejects_empty_blockmap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    installer = b"installer bytes"
    sha512 = hashlib.sha512(installer).hexdigest()
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            client_release_service.save_upload(
                release_id=uuid.uuid4(),
                version="1.0.1",
                installer=_upload_file("代码审查-v1.0.1.exe", installer),
                latest_yml=_upload_file(
                    "latest.yml",
                    _latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
                ),
                blockmap=_upload_file("代码审查-v1.0.1.exe.blockmap", b""),
            )
        )

    assert exc_info.value.status_code == 400


def test_resolve_release_file_rejects_artifact_path_outside_storage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    release_id = uuid.uuid4()
    release_path = tmp_path / str(release_id)
    release_path.mkdir()
    outside_path = tmp_path / "outside"
    outside_path.mkdir()
    outside_artifact = outside_path / "代码审查-v1.0.1.exe"
    outside_artifact.write_bytes(b"installer bytes")
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )
    release = ClientRelease(
        id=release_id,
        version="1.0.1",
        platform="win32",
        arch="x64",
        artifact_name=outside_artifact.name,
        artifact_path=str(outside_artifact),
        artifact_size=12,
        artifact_sha512="a" * 128,
        latest_yml_name="latest.yml",
        latest_yml_path=str(release_path / "latest.yml"),
        is_active=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        client_release_service.resolve_release_file(release, outside_artifact.name)

    assert exc_info.value.status_code == 404


def test_admin_can_upload_activate_and_user_can_download_client_release(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )
    installer = b"installer bytes"
    sha512 = _sha512_base64(installer)
    latest_yml = _latest_yml(
        "1.0.1",
        "代码审查-v1.0.1.exe",
        sha512,
        len(installer),
    )

    upload_response = client.post(
        f"{settings.API_V1_STR}/client-releases",
        headers=superuser_token_headers,
        data={
            "version": "1.0.1",
            "release_notes": "修复任务列表显示问题",
            "activate": "false",
        },
        files={
            "installer": (
                "代码审查-v1.0.1.exe",
                installer,
                "application/vnd.microsoft.portable-executable",
            ),
            "latest_yml": ("latest.yml", latest_yml, "application/x-yaml"),
        },
    )

    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["version"] == "1.0.1"
    assert uploaded["release_notes"] == "修复任务列表显示问题"
    assert uploaded["artifact_name"] == "代码审查-v1.0.1.exe"
    assert uploaded["artifact_size"] == len(installer)
    assert uploaded["artifact_sha512"] == sha512
    assert uploaded["latest_yml_name"] == "latest.yml"
    assert uploaded["is_active"] is False

    activate_response = client.post(
        f"{settings.API_V1_STR}/client-releases/{uploaded['id']}/activate",
        headers=superuser_token_headers,
    )

    assert activate_response.status_code == 200
    assert activate_response.json()["is_active"] is True

    latest_response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/latest.yml",
        headers=normal_user_token_headers,
    )

    assert latest_response.status_code == 200
    assert latest_response.headers["content-type"].startswith(
        "application/octet-stream"
    )
    assert latest_response.content == latest_yml

    installer_response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/代码审查-v1.0.1.exe",
        headers=normal_user_token_headers,
    )

    assert installer_response.status_code == 200
    assert installer_response.content == installer


def test_non_admin_cannot_upload_client_release(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )
    installer = b"installer bytes"
    sha512 = _sha512_base64(installer)

    response = client.post(
        f"{settings.API_V1_STR}/client-releases",
        headers=normal_user_token_headers,
        data={"version": "1.0.1"},
        files={
            "installer": (
                "代码审查-v1.0.1.exe",
                installer,
                "application/vnd.microsoft.portable-executable",
            ),
            "latest_yml": (
                "latest.yml",
                _latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
                "application/x-yaml",
            ),
        },
    )

    assert response.status_code == 403


def test_download_latest_yml_requires_login(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/client-updates/win32/x64/latest.yml")

    assert response.status_code == 401


def test_client_release_download_rejects_path_traversal(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        client_release_service.settings,
        "CLIENT_RELEASE_STORAGE_DIR",
        str(tmp_path),
    )
    db.exec(delete(ClientRelease))
    release_id = uuid.uuid4()
    release_path = tmp_path / str(release_id)
    release_path.mkdir()
    installer_path = release_path / "代码审查-v1.0.1.exe"
    latest_yml_path = release_path / "latest.yml"
    installer_path.write_bytes(b"installer bytes")
    latest_yml_path.write_bytes(b"latest")
    release = ClientRelease(
        id=release_id,
        version="1.0.1",
        platform="win32",
        arch="x64",
        artifact_name=installer_path.name,
        artifact_path=str(installer_path),
        artifact_size=15,
        artifact_sha512="a" * 128,
        latest_yml_name=latest_yml_path.name,
        latest_yml_path=str(latest_yml_path),
        is_active=True,
    )
    db.add(release)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/../latest.yml",
        headers=normal_user_token_headers,
    )

    assert response.status_code in {400, 404}


def test_admin_can_set_and_lower_minimum_supported_release(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    older_release = _release(db, "1.4.0")
    minimum_release = _release(db, "1.5.0")
    active_release = _release(db, "1.6.0", is_active=True)

    update_response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=superuser_token_headers,
        json={"minimum_supported_release_id": str(minimum_release.id)},
    )

    assert update_response.status_code == 200
    updated_policy = update_response.json()
    assert updated_policy["active_release_id"] == str(active_release.id)
    assert updated_policy["active_version"] == "1.6.0"
    assert updated_policy["minimum_supported_release_id"] == str(minimum_release.id)
    assert updated_policy["minimum_supported_version"] == "1.5.0"
    assert updated_policy["updated_by_user_id"] is not None
    assert updated_policy["updated_at"] is not None

    required_response = client.get(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64/check",
        headers=normal_user_token_headers,
        params={"current_version": "1.4.9"},
    )
    assert required_response.status_code == 200
    assert required_response.json()["update_required"] is True
    assert required_response.json()["update_available"] is True

    equal_response = client.get(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64/check",
        headers=normal_user_token_headers,
        params={"current_version": "1.5.0"},
    )
    assert equal_response.status_code == 200
    assert equal_response.json()["update_required"] is False
    assert equal_response.json()["update_available"] is True

    lower_response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=superuser_token_headers,
        json={"minimum_supported_release_id": str(older_release.id)},
    )
    assert lower_response.status_code == 200
    assert lower_response.json()["minimum_supported_version"] == "1.4.0"


def test_policy_rejects_missing_mismatched_and_higher_releases(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    _release(db, "1.5.0", is_active=True)
    higher_release = _release(db, "1.6.0")
    other_arch_release = _release(db, "1.4.0", arch="arm64")

    missing_response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=superuser_token_headers,
        json={"minimum_supported_release_id": str(uuid.uuid4())},
    )
    assert missing_response.status_code == 404

    mismatched_response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=superuser_token_headers,
        json={"minimum_supported_release_id": str(other_arch_release.id)},
    )
    assert mismatched_response.status_code == 400

    higher_response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=superuser_token_headers,
        json={"minimum_supported_release_id": str(higher_release.id)},
    )
    assert higher_response.status_code == 409


def test_non_admin_cannot_change_minimum_supported_release(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    active_release = _release(db, "1.5.0", is_active=True)

    response = client.put(
        f"{settings.API_V1_STR}/client-update-policy/win32/x64",
        headers=normal_user_token_headers,
        json={"minimum_supported_release_id": str(active_release.id)},
    )

    assert response.status_code == 403


def test_activation_below_minimum_supported_release_is_rejected(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    older_release = _release(db, "1.4.0")
    minimum_release = _release(db, "1.5.0")
    active_release = _release(db, "1.6.0", is_active=True)
    policy = client_release_service.get_update_policy(db, "win32", "x64")
    if policy is None:
        policy = ClientUpdatePolicy(platform="win32", arch="x64")
    policy.minimum_supported_release_id = minimum_release.id
    db.add(policy)
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/client-releases/{older_release.id}/activate",
        headers=superuser_token_headers,
    )

    assert response.status_code == 409
    db.refresh(active_release)
    assert active_release.is_active is True
