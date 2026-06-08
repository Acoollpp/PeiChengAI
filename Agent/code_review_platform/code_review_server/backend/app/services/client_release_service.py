import base64
import hashlib
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException, UploadFile
from sqlmodel import Session, col, select

from app.core.config import settings
from app.models import ClientRelease, get_datetime_utc

SUPPORTED_PLATFORM = "win32"
SUPPORTED_ARCH = "x64"
LATEST_YML_NAME = "latest.yml"


@dataclass(frozen=True)
class LatestYmlMetadata:
    version: str
    installer_name: str
    sha512: str
    size: int


@dataclass(frozen=True)
class SavedReleaseUpload:
    release_path: Path
    metadata: LatestYmlMetadata
    installer_size: int
    blockmap_name: str | None = None
    blockmap_path: Path | None = None


def path_for_release(release_id: uuid.UUID) -> Path:
    return Path(settings.CLIENT_RELEASE_STORAGE_DIR) / str(release_id)


def parse_latest_yml(
    *,
    content: bytes,
    expected_version: str,
    expected_installer_name: str,
) -> LatestYmlMetadata:
    try:
        payload = yaml.safe_load(content.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=400, detail="latest.yml must be valid YAML") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="latest.yml must be a YAML object")

    version = _string_field(payload, "version")
    if version != expected_version:
        raise HTTPException(
            status_code=400,
            detail="latest.yml version does not match submitted version",
        )

    installer_name = _installer_name_from_payload(payload)
    if installer_name != expected_installer_name:
        raise HTTPException(
            status_code=400,
            detail="latest.yml installer filename does not match uploaded installer",
        )

    sha512 = _sha512_from_payload(payload)
    size = _size_from_payload(payload)
    return LatestYmlMetadata(
        version=version,
        installer_name=installer_name,
        sha512=sha512,
        size=size,
    )


async def save_upload(
    *,
    release_id: uuid.UUID,
    version: str,
    installer: UploadFile,
    latest_yml: UploadFile,
    blockmap: UploadFile | None = None,
) -> SavedReleaseUpload:
    installer_name = _safe_filename(installer.filename, required_suffix=".exe")
    latest_yml_name = _safe_filename(latest_yml.filename, required_name=LATEST_YML_NAME)

    installer_content = await installer.read()
    latest_yml_content = await latest_yml.read()
    if not installer_content:
        raise HTTPException(status_code=400, detail="Installer file must not be empty")
    if not latest_yml_content:
        raise HTTPException(status_code=400, detail="latest.yml must not be empty")

    metadata = parse_latest_yml(
        content=latest_yml_content,
        expected_version=version,
        expected_installer_name=installer_name,
    )
    actual_sha512 = hashlib.sha512(installer_content).digest()
    if _sha512_digest(metadata.sha512) != actual_sha512:
        raise HTTPException(
            status_code=400,
            detail="Installer sha512 does not match latest.yml",
        )
    if metadata.size != len(installer_content):
        raise HTTPException(
            status_code=400,
            detail="Installer size does not match latest.yml",
        )

    blockmap_name: str | None = None
    blockmap_content: bytes | None = None
    if blockmap is not None and blockmap.filename:
        blockmap_name = _safe_filename(blockmap.filename, required_suffix=".blockmap")
        blockmap_content = await blockmap.read()
        if not blockmap_content:
            raise HTTPException(status_code=400, detail="Blockmap file must not be empty")

    release_path = path_for_release(release_id)
    if release_path.exists():
        shutil.rmtree(release_path)
    release_path.mkdir(parents=True, exist_ok=True)
    (release_path / installer_name).write_bytes(installer_content)
    (release_path / latest_yml_name).write_bytes(latest_yml_content)
    blockmap_path: Path | None = None
    if blockmap_name is not None and blockmap_content:
        blockmap_path = release_path / blockmap_name
        blockmap_path.write_bytes(blockmap_content)

    return SavedReleaseUpload(
        release_path=release_path,
        metadata=metadata,
        installer_size=len(installer_content),
        blockmap_name=blockmap_name,
        blockmap_path=blockmap_path,
    )


def activate_release(session: Session, release: ClientRelease) -> ClientRelease:
    active_releases = session.exec(
        select(ClientRelease).where(
            ClientRelease.platform == release.platform,
            ClientRelease.arch == release.arch,
            ClientRelease.is_active == True,  # noqa: E712
        )
    ).all()

    now = get_datetime_utc()
    for active_release in active_releases:
        if active_release.id != release.id:
            active_release.is_active = False
            active_release.updated_at = now
            session.add(active_release)

    release.is_active = True
    release.updated_at = now
    session.add(release)
    session.commit()
    session.refresh(release)
    return release


def get_active_release(
    session: Session,
    platform: str = SUPPORTED_PLATFORM,
    arch: str = SUPPORTED_ARCH,
) -> ClientRelease | None:
    return session.exec(
        select(ClientRelease)
        .where(
            ClientRelease.platform == platform,
            ClientRelease.arch == arch,
            ClientRelease.is_active == True,  # noqa: E712
        )
        .order_by(col(ClientRelease.updated_at).desc())
    ).first()


def resolve_release_file(release: ClientRelease, filename: str) -> Path:
    safe_name = _safe_filename(filename)
    allowed_names = {
        release.artifact_name,
        release.latest_yml_name,
    }
    if release.blockmap_name:
        allowed_names.add(release.blockmap_name)
    if safe_name not in allowed_names:
        raise HTTPException(status_code=404, detail="Release file not found")

    release_path = path_for_release(release.id).resolve()
    file_path = (release_path / safe_name).resolve()
    if not file_path.is_relative_to(release_path) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Release file not found")
    return file_path


def _string_field(payload: dict[str, Any], field_name: str) -> str:
    value = payload.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail=f"latest.yml missing {field_name}")
    return value.strip()


def _installer_name_from_payload(payload: dict[str, Any]) -> str:
    installer_names: list[str] = []
    path_value = payload.get("path")
    if isinstance(path_value, str) and path_value.strip():
        installer_names.append(_safe_filename(path_value.strip(), required_suffix=".exe"))

    first_file = _first_file(payload)
    if first_file is not None:
        url = first_file.get("url")
        if isinstance(url, str) and url.strip():
            installer_names.append(_safe_filename(url.strip(), required_suffix=".exe"))

    if len(set(installer_names)) > 1:
        raise HTTPException(
            status_code=400,
            detail="latest.yml installer filename does not match uploaded installer",
        )
    if installer_names:
        return installer_names[0]
    raise HTTPException(status_code=400, detail="latest.yml missing installer filename")


def _sha512_from_payload(payload: dict[str, Any]) -> str:
    sha512_values = [_sha512_digest(_string_field(payload, "sha512"))]
    sha512 = _string_field(payload, "sha512")
    first_file = _first_file(payload)
    if first_file is not None:
        file_sha512 = first_file.get("sha512")
        if isinstance(file_sha512, str) and file_sha512.strip():
            sha512_values.append(_sha512_digest(file_sha512.strip()))

    if len(set(sha512_values)) > 1:
        raise HTTPException(status_code=400, detail="latest.yml sha512 does not match")
    return sha512


def _size_from_payload(payload: dict[str, Any]) -> int:
    first_file = _first_file(payload)
    if first_file is not None:
        size = first_file.get("size")
        if isinstance(size, int) and size >= 0:
            return size
    raise HTTPException(status_code=400, detail="latest.yml missing installer size")


def _first_file(payload: dict[str, Any]) -> dict[str, Any] | None:
    files = payload.get("files")
    if isinstance(files, list) and files and isinstance(files[0], dict):
        return files[0]
    return None


def _sha512_digest(value: str) -> bytes:
    if len(value) == 128 and all(char in "0123456789abcdefABCDEF" for char in value):
        return bytes.fromhex(value)
    try:
        digest = base64.b64decode(value, validate=True)
    except ValueError:
        raise HTTPException(status_code=400, detail="latest.yml sha512 must be valid")
    if len(digest) != hashlib.sha512().digest_size:
        raise HTTPException(status_code=400, detail="latest.yml sha512 must be valid")
    return digest


def _safe_filename(
    filename: str | None,
    *,
    required_name: str | None = None,
    required_suffix: str | None = None,
) -> str:
    if not filename:
        raise HTTPException(status_code=400, detail="Release filename is required")

    path = Path(filename)
    if path.name != filename or "\\" in filename or ".." in path.parts:
        raise HTTPException(status_code=400, detail="Invalid release filename")
    if required_name is not None and filename != required_name:
        raise HTTPException(
            status_code=400,
            detail=f"Release file must be named {required_name}",
        )
    if required_suffix is not None and not filename.lower().endswith(required_suffix):
        raise HTTPException(
            status_code=400,
            detail=f"Release file must end with {required_suffix}",
        )
    return filename
