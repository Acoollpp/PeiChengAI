import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024


def path_for_feedback(feedback_id: uuid.UUID, filename: str) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    return Path(settings.FEEDBACK_STORAGE_DIR) / str(feedback_id) / f"screenshot{suffix}"


async def save_screenshot(feedback_id: uuid.UUID, upload: UploadFile) -> tuple[Path, bytes]:
    content_type = upload.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Screenshot must be a PNG, JPG, or WEBP image",
        )
    content = await upload.read()
    if len(content) > MAX_SCREENSHOT_SIZE:
        raise HTTPException(status_code=400, detail="Screenshot must not exceed 5MB")
    if not content:
        raise HTTPException(status_code=400, detail="Screenshot must not be empty")
    screenshot_path = path_for_feedback(feedback_id, upload.filename or "screenshot.png")
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_path.write_bytes(content)
    return screenshot_path, content
