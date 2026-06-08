import asyncio
import base64
import hashlib
import uuid
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.models import ClientRelease
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
    assert exc_info.value.detail == "latest.yml version does not match submitted version"


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
