import base64
import json
import logging
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from sqlmodel import Session, col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.core.config import settings
from app.core.db import engine
from app.models import (
    User,
    WireHarnessCompareTask,
    WireHarnessCompareTaskPublic,
    WireHarnessCompareTasksPublic,
    WireHarnessCompareTaskStatsPublic,
    WireHarnessCompareTaskStatus,
)
from app.services import wire_harness_compare_task_service as service
from app.services.wire_harness_annotation import refresh_legacy_interactive_report

router = APIRouter(prefix="/wire-harness-compare-tasks", tags=["wire-harness-compare-tasks"])
logger = logging.getLogger(__name__)

RUNNING_STATUSES = {
    WireHarnessCompareTaskStatus.queued,
    WireHarnessCompareTaskStatus.preparing,
    WireHarnessCompareTaskStatus.running,
    WireHarnessCompareTaskStatus.uploading_report,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _public(task: WireHarnessCompareTask, user: User | None = None) -> WireHarnessCompareTaskPublic:
    return WireHarnessCompareTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
        },
    )


def _filters(current_user: CurrentUser, scope: str) -> list[Any]:
    if scope == "all":
        if not has_admin_privileges(current_user):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return []
    if scope != "mine":
        raise HTTPException(status_code=400, detail="Unsupported task scope")
    return [WireHarnessCompareTask.user_id == current_user.id]


def _get_task(session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID) -> WireHarnessCompareTask:
    task = session.get(WireHarnessCompareTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="线束图对比任务不存在")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def _looks_like_html_report(content: str) -> bool:
    stripped = content.lstrip()
    prefix = stripped[:200].lower()
    return prefix.startswith("<!doctype") or prefix.startswith("<html") or "<!doctype html" in prefix


def _read_html_report(path: Path, task_id: uuid.UUID) -> str:
    raw_content = path.read_bytes()
    content = raw_content.decode("utf-8", errors="replace")
    if _looks_like_html_report(content):
        return content
    try:
        refresh_legacy_interactive_report(path)
        refreshed_content = path.read_text(encoding="utf-8", errors="replace")
        if _looks_like_html_report(refreshed_content):
            logger.warning("wire harness interactive report regenerated from task artifacts: %s", path)
            return refreshed_content
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    try:
        isolated = subprocess.check_output(
            [
                sys.executable,
                "-c",
                "from pathlib import Path; import sys; sys.stdout.buffer.write(Path(sys.argv[1]).read_bytes())",
                str(path),
            ],
            timeout=10,
        ).decode("utf-8", errors="replace")
        if _looks_like_html_report(isolated):
            return isolated
    except (OSError, subprocess.SubprocessError):
        pass
    logger.warning(
        "wire harness interactive report is not html: task_id=%s path=%s exists=%s size=%s prefix=%r",
        task_id,
        path,
        path.exists(),
        path.stat().st_size if path.exists() else None,
        raw_content[:40],
    )
    search_roots = [
        path.parent,
        Path(settings.WIRE_HARNESS_COMPARE_STORAGE_DIR) / str(task_id) / "results",
        Path(__file__).resolve().parents[3] / ".local-storage" / "wire-harness-compare-tasks" / str(task_id) / "results",
    ]
    checked: set[Path] = set()
    for root in search_roots:
        if not root.exists():
            continue
        for candidate in root.rglob("*.html"):
            resolved = candidate.resolve()
            if resolved in checked:
                continue
            checked.add(resolved)
            candidate_content = candidate.read_bytes().decode("utf-8", errors="replace")
            if _looks_like_html_report(candidate_content):
                logger.warning("wire harness interactive report recovered from %s", candidate)
                return candidate_content
    raise HTTPException(status_code=500, detail="交互差异报告内容异常，请重新生成任务结果")


def _html_content_from_result_item(report: dict[str, Any]) -> str | None:
    encoded = report.get("html_content_b64")
    if not isinstance(encoded, str) or not encoded:
        return None
    try:
        content = base64.b64decode(encoded.encode("ascii")).decode("utf-8", errors="replace")
    except (ValueError, UnicodeError):
        return None
    return content if _looks_like_html_report(content) else None


def start_task(task_id: uuid.UUID) -> None:
    Thread(target=run_task, args=(task_id,), daemon=True, name=f"wire-harness-compare-{task_id}").start()


def run_task(task_id: uuid.UUID) -> None:
    with Session(engine) as session:
        task = session.get(WireHarnessCompareTask, task_id)
        if task is None:
            return
        task.status = WireHarnessCompareTaskStatus.running
        task.started_at = task.started_at or _utcnow()
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        try:
            result = service.run_task(task.id)
            task.status = WireHarnessCompareTaskStatus.uploading_report
            task.result_files = result["result_files"]  # type: ignore[assignment]
            task.pair_count = int(result["pair_count"])
            task.image_count = int(result["image_count"])
            task.failed_count = int(result["failed_count"])
            task.semantic_diff_count = int(result.get("semantic_diff_count", 0))
            task.review_required_count = int(result.get("review_required_count", 0))
            task.ocr_page_count = int(result.get("ocr_page_count", 0))
            task.status = WireHarnessCompareTaskStatus.success
            task.error_message = None
        except Exception as exc:
            task.status = WireHarnessCompareTaskStatus.failed
            task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()


@router.post("", response_model=WireHarnessCompareTaskPublic)
async def create_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_name: str | None = Form(default=None),
    archive_upload: UploadFile = File(...),
) -> Any:
    now = _utcnow()
    task = WireHarnessCompareTask(
        user_id=current_user.id,
        task_name=(task_name or archive_upload.filename or "线束图对比").strip(),
        status=WireHarnessCompareTaskStatus.preparing,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    try:
        task.input_files = await service.save_archive_upload(task.id, archive_upload)
        task.status = WireHarnessCompareTaskStatus.queued
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
    except HTTPException as exc:
        task.status = WireHarnessCompareTaskStatus.failed
        task.error_message = exc.detail if isinstance(exc.detail, str) else "上传压缩包失败"
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        raise
    start_task(task.id)
    return _public(task, current_user)


@router.get("", response_model=WireHarnessCompareTasksPublic)
def read_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    filters = _filters(current_user, scope)
    count = session.exec(select(func.count()).select_from(WireHarnessCompareTask).where(*filters)).one()
    rows = session.exec(
        select(WireHarnessCompareTask, User)
        .join(User, WireHarnessCompareTask.user_id == User.id)
        .where(*filters)
        .order_by(col(WireHarnessCompareTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return WireHarnessCompareTasksPublic(data=[_public(task, user) for task, user in rows], count=count)


@router.get("/stats", response_model=WireHarnessCompareTaskStatsPublic)
def read_stats(session: SessionDep, current_user: CurrentUser, scope: str = "mine") -> Any:
    filters = _filters(current_user, scope)
    rows = session.exec(
        select(WireHarnessCompareTask.status, func.count())
        .where(*filters)
        .group_by(WireHarnessCompareTask.status)
    ).all()
    by_status = dict.fromkeys(WireHarnessCompareTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count
    aggregate = session.exec(
        select(
            func.coalesce(func.sum(WireHarnessCompareTask.pair_count), 0),
            func.coalesce(func.sum(WireHarnessCompareTask.image_count), 0),
            func.coalesce(func.sum(WireHarnessCompareTask.failed_count), 0),
        ).where(*filters)
    ).one()
    return WireHarnessCompareTaskStatsPublic(
        total=sum(by_status.values()),
        success=by_status[WireHarnessCompareTaskStatus.success],
        running=sum(by_status[status] for status in RUNNING_STATUSES),
        failed_or_error=by_status[WireHarnessCompareTaskStatus.failed]
        + by_status[WireHarnessCompareTaskStatus.timeout],
        by_status=by_status,
        pair_count=int(aggregate[0] or 0),
        image_count=int(aggregate[1] or 0),
        failed_count=int(aggregate[2] or 0),
    )


@router.get("/{task_id}", response_model=WireHarnessCompareTaskPublic)
def read_task(session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID) -> Any:
    return _public(_get_task(session, current_user, task_id))


@router.get("/{task_id}/report")
def download_report(session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID) -> FileResponse:
    task = _get_task(session, current_user, task_id)
    if not task.result_files:
        raise HTTPException(status_code=404, detail="并排对比图结果不存在")
    report = task.result_files[0]
    path = Path(str(report["file_path"]))
    if not path.is_file():
        raise HTTPException(status_code=404, detail="并排对比图结果不存在")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=str(report.get("file_name") or path.name),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/{task_id}/interactive-report")
def interactive_report(session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID) -> HTMLResponse:
    task = _get_task(session, current_user, task_id)
    report = next((item for item in task.result_files if item.get("content_type") == "text/html"), None)
    if not report:
        raise HTTPException(status_code=404, detail="交互差异报告不存在")
    embedded_content = _html_content_from_result_item(report)
    if embedded_content is not None:
        return HTMLResponse(content=embedded_content, headers={"Cache-Control": "no-store, max-age=0"})
    path = Path(str(report["file_path"]))
    if not path.is_file():
        raise HTTPException(status_code=404, detail="交互差异报告不存在")
    content = _read_html_report(path, task.id)
    if ".marker { position: absolute;" in content or "selectDifference(differences[0].number)" in content:
        refresh_legacy_interactive_report(path)
        content = _read_html_report(path, task.id)
    return HTMLResponse(content=content, headers={"Cache-Control": "no-store, max-age=0"})


@router.delete("/{task_id}")
def delete_task(session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID) -> dict[str, str]:
    task = _get_task(session, current_user, task_id)
    service.remove_task_files(task.id)
    session.delete(task)
    session.commit()
    return {"message": "线束图对比任务已删除"}
