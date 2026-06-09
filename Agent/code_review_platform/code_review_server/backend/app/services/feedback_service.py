import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
MAX_SCREENSHOT_COUNT = 5


def path_for_feedback(
    feedback_id: uuid.UUID, filename: str, sort_order: int = 0
) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES:
        suffix = ".png"
    return (
        Path(settings.FEEDBACK_STORAGE_DIR)
        / str(feedback_id)
        / f"screenshot-{sort_order}{suffix}"
    )


def remove_feedback_files(feedback_id: uuid.UUID) -> None:
    storage_dir = Path(settings.FEEDBACK_STORAGE_DIR).resolve()
    feedback_dir = (storage_dir / str(feedback_id)).resolve()
    if feedback_dir.name != str(feedback_id) or feedback_dir.parent != storage_dir:
        raise RuntimeError("Invalid feedback storage path")
    if feedback_dir.exists():
        if not feedback_dir.is_dir():
            raise RuntimeError("Feedback storage path is not a directory")
        shutil.rmtree(feedback_dir)


async def read_valid_screenshot(upload: UploadFile) -> bytes:
    content_type = upload.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="截图必须是 PNG、JPG 或 WEBP 图片",
        )
    content = await upload.read()
    if len(content) > MAX_SCREENSHOT_SIZE:
        raise HTTPException(status_code=400, detail="单张截图不能超过 5MB")
    if not content:
        raise HTTPException(status_code=400, detail="截图不能为空")
    return content


async def save_screenshots(
    feedback_id: uuid.UUID, uploads: list[UploadFile]
) -> list[tuple[Path, UploadFile, bytes, int]]:
    if len(uploads) > MAX_SCREENSHOT_COUNT:
        raise HTTPException(status_code=400, detail="最多只能上传 5 张截图")

    saved: list[tuple[Path, UploadFile, bytes, int]] = []
    try:
        for sort_order, upload in enumerate(uploads):
            content = await read_valid_screenshot(upload)
            screenshot_path = path_for_feedback(
                feedback_id, upload.filename or "screenshot.png", sort_order
            )
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_bytes(content)
            saved.append((screenshot_path, upload, content, sort_order))
    except Exception:
        remove_feedback_files(feedback_id)
        raise
    return saved


async def save_screenshot(feedback_id: uuid.UUID, upload: UploadFile) -> tuple[Path, bytes]:
    saved = await save_screenshots(feedback_id, [upload])
    screenshot_path, _upload, content, _sort_order = saved[0]
    return screenshot_path, content
