import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings


def path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.md"


def pdf_path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.pdf"


async def save_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Report file must not be empty")

    report_path = path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path


async def save_pdf_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="PDF report file must not be empty")

    report_path = pdf_path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path
