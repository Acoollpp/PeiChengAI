import re
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings
from app.services.storage_cleanup import robust_rmtree


def task_dir(task_id: uuid.UUID) -> Path:
    return Path(settings.WHITEBOX_STORAGE_DIR) / str(task_id)


def input_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "input"


def logs_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "logs"


def reports_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "reports"


def remove_task_files(task_id: uuid.UUID) -> None:
    storage_dir = Path(settings.WHITEBOX_STORAGE_DIR).resolve()
    target_dir = (storage_dir / str(task_id)).resolve()
    if target_dir.name != str(task_id) or target_dir.parent != storage_dir:
        raise RuntimeError("Invalid whitebox task storage path")
    if target_dir.exists():
        if not target_dir.is_dir():
            raise RuntimeError("Whitebox task storage path is not a directory")
        robust_rmtree(target_dir)


def _safe_filename(filename: str | None, fallback: str) -> str:
    name = Path(filename or fallback).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
    return name or fallback


async def save_uploads(
    destination_dir: Path,
    uploads: list[UploadFile],
    *,
    required: bool,
) -> list[dict[str, str | int | None]]:
    if not uploads:
        if required:
            raise HTTPException(status_code=400, detail="At least one file is required")
        return []

    destination_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, str | int | None]] = []
    for index, upload in enumerate(uploads):
        content = await upload.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file must not be empty")
        file_name = _safe_filename(upload.filename, f"upload-{index + 1}")
        path = destination_dir / file_name
        if path.exists():
            path = destination_dir / f"{path.stem}-{index + 1}{path.suffix}"
            file_name = path.name
        path.write_bytes(content)
        saved.append(
            {
                "file_name": file_name,
                "file_path": str(path),
                "content_type": upload.content_type,
                "file_size": len(content),
            }
        )
    return saved


async def save_input_uploads(
    task_id: uuid.UUID,
    uploads: list[UploadFile],
) -> list[dict[str, str | int | None]]:
    try:
        return await save_uploads(input_dir(task_id), uploads, required=False)
    except Exception:
        remove_task_files(task_id)
        raise


async def save_report_uploads(
    task_id: uuid.UUID,
    uploads: list[UploadFile],
) -> list[dict[str, str | int | None]]:
    return await save_uploads(reports_dir(task_id), uploads, required=True)


def append_log(task_id: uuid.UUID, message: str) -> Path:
    path = logs_dir(task_id) / "agent.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(message)
        if not message.endswith("\n"):
            file.write("\n")
    return path
