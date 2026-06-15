import hashlib
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_REQUIREMENT_EXTENSIONS = {".xls", ".xlsx"}
MAX_FILENAME_BYTES = 255


def path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.md"


def pdf_path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.pdf"


def _safe_filename(file_name: str | None, fallback: str) -> str:
    raw_name = file_name or fallback
    safe_name = Path(raw_name.replace("\\", "/")).name
    safe_name = "".join(
        "_" if _is_unsafe_filename_char(char) else char
        for char in safe_name
    ).strip()
    safe_name = safe_name.rstrip(". ")
    if not safe_name:
        safe_name = fallback

    suffix = Path(safe_name).suffix
    stem = safe_name[: -len(suffix)] if suffix else safe_name
    safe_name = _truncate_filename(stem, suffix)
    return safe_name or fallback


def _is_unsafe_filename_char(char: str) -> bool:
    return char in {"/", "\\", "\x00"} or ord(char) < 32 or ord(char) == 127


def _truncate_filename(stem: str, suffix: str) -> str:
    suffix_bytes = suffix.encode("utf-8")
    if len(suffix_bytes) > MAX_FILENAME_BYTES:
        return suffix_bytes[:MAX_FILENAME_BYTES].decode("utf-8", errors="ignore")

    available_stem_bytes = MAX_FILENAME_BYTES - len(suffix_bytes)
    stem_bytes = stem.encode("utf-8")
    if len(stem_bytes) <= available_stem_bytes:
        return stem + suffix
    truncated_stem = stem_bytes[:available_stem_bytes].decode(
        "utf-8", errors="ignore"
    )
    return truncated_stem.rstrip(". ") + suffix


def requirement_file_path_for_task(
    task_id: uuid.UUID, file_hash: str, file_name: str
) -> Path:
    return (
        Path(settings.REPORT_STORAGE_DIR)
        / str(task_id)
        / "requirements"
        / file_hash[:16]
        / file_name
    )


async def save_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Report file must not be empty")

    report_path = path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path


async def save_requirement_upload(
    task_id: uuid.UUID, upload: UploadFile
) -> tuple[Path, int, str, str]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="产品开发需求表不能为空。")

    file_hash = hashlib.sha256(content).hexdigest()
    safe_file_name = _safe_filename(upload.filename, "产品开发需求表.xlsx")
    extension = Path(safe_file_name).suffix.lower()
    if extension not in ALLOWED_REQUIREMENT_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail="产品开发需求表仅支持 .xls 或 .xlsx 文件。"
        )

    file_path = requirement_file_path_for_task(task_id, file_hash, safe_file_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content)
    return file_path, len(content), file_hash, safe_file_name


async def save_pdf_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="PDF report file must not be empty")

    report_path = pdf_path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path
