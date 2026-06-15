import hashlib
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_REQUIREMENT_EXTENSIONS = {".xls", ".xlsx"}


def path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.md"


def pdf_path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.pdf"


def _safe_filename(file_name: str | None, fallback: str) -> str:
    safe_name = file_name or fallback
    for char in ("/", "\\", "\n", "\r", "\t"):
        safe_name = safe_name.replace(char, "_")
    safe_name = safe_name.strip()
    return safe_name or fallback


def requirement_file_path_for_task(task_id: uuid.UUID, file_name: str) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / str(task_id) / "requirements" / file_name


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
    safe_file_name = _safe_filename(upload.filename, "产品开发需求表.xlsx")
    extension = Path(safe_file_name).suffix.lower()
    if extension not in ALLOWED_REQUIREMENT_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail="产品开发需求表仅支持 .xls 或 .xlsx 文件。"
        )

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="产品开发需求表不能为空。")

    file_hash = hashlib.sha256(content).hexdigest()
    file_path = requirement_file_path_for_task(task_id, safe_file_name)
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
