import hashlib
import io
import shutil
import uuid
from pathlib import Path
from zipfile import BadZipFile, ZipFile, ZipInfo

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, col, select

from app.core.config import settings
from app.models import SkillPackage, get_datetime_utc

SKILL_FILENAME = "SKILL.md"
ORIGINAL_PACKAGE_FILENAME = ".original-skill.zip"


def path_for_skill(skill_id: uuid.UUID) -> Path:
    return Path(settings.SKILL_STORAGE_DIR) / str(skill_id)


async def save_upload(skill_id: uuid.UUID, upload: UploadFile) -> tuple[Path, str]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Skill package must not be empty")

    content_hash = hashlib.sha256(content).hexdigest()
    skill_path = path_for_skill(skill_id)
    entries = _read_package_entries(content)
    prefix = _skill_package_prefix(entries)

    if skill_path.exists():
        shutil.rmtree(skill_path)
    skill_path.mkdir(parents=True, exist_ok=True)
    (skill_path / ORIGINAL_PACKAGE_FILENAME).write_bytes(content)

    with ZipFile(io.BytesIO(content)) as archive:
        for entry in entries:
            target_name = _strip_prefix(entry.filename, prefix)
            if not target_name or _should_skip_entry(target_name):
                continue
            target_path = (skill_path / target_name).resolve()
            if not target_path.is_relative_to(skill_path.resolve()):
                raise HTTPException(status_code=400, detail="Invalid skill package path")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(archive.read(entry))

    return skill_path, content_hash


def read_skill_content(skill: SkillPackage) -> bytes:
    skill_path = Path(skill.file_path)
    if not skill_path.is_dir() or not (skill_path / SKILL_FILENAME).is_file():
        raise HTTPException(status_code=404, detail="Skill package not found")

    original_package_path = skill_path / ORIGINAL_PACKAGE_FILENAME
    if original_package_path.is_file():
        return original_package_path.read_bytes()

    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for path in sorted(p for p in skill_path.rglob("*") if p.is_file()):
            archive.write(path, path.relative_to(skill_path).as_posix())
    return buffer.getvalue()


def _read_package_entries(content: bytes) -> list[ZipInfo]:
    try:
        with ZipFile(io.BytesIO(content)) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
    except BadZipFile:
        raise HTTPException(status_code=400, detail="Skill package must be a zip file")

    for entry in entries:
        parts = Path(entry.filename).parts
        if (
            entry.filename.startswith("/")
            or "\\" in entry.filename
            or ".." in parts
            or not parts
        ):
            raise HTTPException(status_code=400, detail="Invalid skill package path")

    return entries


def _skill_package_prefix(entries: list[ZipInfo]) -> tuple[str, ...]:
    names = [
        Path(entry.filename).parts
        for entry in entries
        if not _should_skip_entry(entry.filename)
    ]
    if (SKILL_FILENAME,) in names:
        return ()

    top_level_dirs = {parts[0] for parts in names if len(parts) > 1}
    if len(top_level_dirs) == 1:
        prefix = (next(iter(top_level_dirs)),)
        if prefix + (SKILL_FILENAME,) in names:
            return prefix

    raise HTTPException(status_code=400, detail="Skill package must contain SKILL.md")


def _strip_prefix(filename: str, prefix: tuple[str, ...]) -> str:
    parts = Path(filename).parts
    if prefix:
        if parts[: len(prefix)] != prefix:
            return ""
        parts = parts[len(prefix) :]
    return Path(*parts).as_posix() if parts else ""


def _should_skip_entry(filename: str) -> bool:
    parts = Path(filename).parts
    return any(part == "__MACOSX" or part == ".DS_Store" for part in parts)


def activate_skill(session: Session, skill: SkillPackage) -> SkillPackage:
    active_skills = session.exec(
        select(SkillPackage).where(SkillPackage.is_active == True)  # noqa: E712
    ).all()
    now = get_datetime_utc()
    for active_skill in active_skills:
        if active_skill.id != skill.id:
            active_skill.is_active = False
            active_skill.updated_at = now
            session.add(active_skill)

    skill.is_active = True
    skill.updated_at = now
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return skill


def get_active_skill(session: Session) -> SkillPackage | None:
    return session.exec(
        select(SkillPackage)
        .where(SkillPackage.is_active == True)  # noqa: E712
        .order_by(col(SkillPackage.updated_at).desc())
    ).first()
