import secrets
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.core.db import engine
from app.models import (
    BomElectronicEditTask,
    BomElectronicEditTaskPublic,
    BomElectronicEditTasksPublic,
    BomElectronicEditTaskStatsPublic,
    BomElectronicEditTaskStatus,
    User,
)
from app.services import bom_electronic_edit_task_service

router = APIRouter(prefix="/bom-electronic-edit-tasks", tags=["bom-electronic-edit-tasks"])
BOM_ELECTRONIC_EDIT_MAX_CONCURRENT_TASKS = 2
_QUEUE_LOCK = Lock()
_DOWNLOAD_TICKET_LOCK = Lock()
_DOWNLOAD_TICKET_TTL = timedelta(minutes=2)
_DOWNLOAD_TICKETS: dict[str, tuple[uuid.UUID, uuid.UUID, datetime]] = {}

_RUNNING_STATUSES = {
    BomElectronicEditTaskStatus.queued,
    BomElectronicEditTaskStatus.preparing,
    BomElectronicEditTaskStatus.running,
    BomElectronicEditTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    BomElectronicEditTaskStatus.failed,
    BomElectronicEditTaskStatus.timeout,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _issue_download_ticket(*, task_id: uuid.UUID, user_id: uuid.UUID) -> str:
    expires_at = _utcnow() + _DOWNLOAD_TICKET_TTL
    with _DOWNLOAD_TICKET_LOCK:
        expired_tickets = [
            ticket for ticket, (_, _, expiry) in _DOWNLOAD_TICKETS.items() if expiry <= _utcnow()
        ]
        for ticket in expired_tickets:
            _DOWNLOAD_TICKETS.pop(ticket, None)
        ticket = secrets.token_urlsafe(32)
        _DOWNLOAD_TICKETS[ticket] = (task_id, user_id, expires_at)
    return ticket


def _consume_download_ticket(*, ticket: str, task_id: uuid.UUID) -> uuid.UUID:
    with _DOWNLOAD_TICKET_LOCK:
        ticket_data = _DOWNLOAD_TICKETS.pop(ticket, None)
    if ticket_data is None:
        raise HTTPException(status_code=403, detail="Invalid or expired download ticket")

    ticket_task_id, user_id, expires_at = ticket_data
    if ticket_task_id != task_id or expires_at <= _utcnow():
        raise HTTPException(status_code=403, detail="Invalid or expired download ticket")
    return user_id


def _task_public(
    task: BomElectronicEditTask,
    user: User | None = None,
) -> BomElectronicEditTaskPublic:
    return BomElectronicEditTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
        },
    )


def _task_scope_filters(current_user: CurrentUser, scope: str = "mine") -> list[Any]:
    if scope == "all":
        if not has_admin_privileges(current_user):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return []
    if scope != "mine":
        raise HTTPException(status_code=400, detail="Unsupported task scope")
    return [BomElectronicEditTask.user_id == current_user.id]


def _get_task_for_user(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> BomElectronicEditTask:
    task = session.get(BomElectronicEditTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="BOM electronic edit task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def start_bom_electronic_edit_task(task_id: uuid.UUID) -> None:
    Thread(
        target=run_bom_electronic_edit_task,
        args=(task_id,),
        daemon=True,
        name=f"bom-electronic-edit-{task_id}",
    ).start()


def schedule_bom_electronic_edit_tasks(task_id: uuid.UUID | None = None) -> None:
    _ = task_id
    task_ids_to_start: list[uuid.UUID] = []
    with _QUEUE_LOCK:
        with Session(engine) as session:
            active_tasks = session.exec(
                select(BomElectronicEditTask)
                .where(
                    col(BomElectronicEditTask.status).in_(
                        [
                            BomElectronicEditTaskStatus.running,
                            BomElectronicEditTaskStatus.uploading_report,
                        ]
                    )
                )
            ).all()
            active_user_counts = Counter(task.user_id for task in active_tasks)
            capacity = BOM_ELECTRONIC_EDIT_MAX_CONCURRENT_TASKS - len(active_tasks)
            if capacity <= 0:
                return
            queued_tasks = session.exec(
                select(BomElectronicEditTask)
                .where(BomElectronicEditTask.status == BomElectronicEditTaskStatus.queued)
                .order_by(col(BomElectronicEditTask.created_at).asc())
            ).all()
            if not queued_tasks:
                return
            all_user_ids = set(active_user_counts) | {task.user_id for task in queued_tasks}
            tasks: list[BomElectronicEditTask] = []
            if len(all_user_ids) == 1:
                tasks = queued_tasks[:capacity]
            else:
                for task in queued_tasks:
                    if active_user_counts[task.user_id] > 0:
                        continue
                    tasks.append(task)
                    active_user_counts[task.user_id] += 1
                    if len(tasks) >= capacity:
                        break
            now = _utcnow()
            for task in tasks:
                task.status = BomElectronicEditTaskStatus.running
                task.started_at = task.started_at or now
                task.updated_at = now
                session.add(task)
                task_ids_to_start.append(task.id)
            if task_ids_to_start:
                session.commit()

    for queued_task_id in task_ids_to_start:
        start_bom_electronic_edit_task(queued_task_id)


def run_bom_electronic_edit_task(task_id: uuid.UUID) -> None:
    try:
        with Session(engine) as session:
            task = session.get(BomElectronicEditTask, task_id)
            if task is None:
                return
            if task.status != BomElectronicEditTaskStatus.running:
                task.status = BomElectronicEditTaskStatus.running
                task.started_at = task.started_at or _utcnow()
                task.updated_at = _utcnow()
                session.add(task)
                session.commit()

            try:
                result = bom_electronic_edit_task_service.run_task(task.id, task.input_files, task.task_name)
                task.status = BomElectronicEditTaskStatus.uploading_report
                task.updated_at = _utcnow()
                session.add(task)
                session.commit()

                task.result_files = result["result_files"]  # type: ignore[assignment]
                task.modified_count = int(result.get("modified_count", 0))
                task.abnormal_count = int(result.get("abnormal_count", 0))
                task.report_count = int(result.get("report_count", 0))
                task.processed_sheet_count = int(result.get("processed_sheet_count", 0))
                task.status = BomElectronicEditTaskStatus.success
                task.error_message = None
            except Exception as exc:
                task.status = BomElectronicEditTaskStatus.failed
                task.error_message = str(exc)
            task.finished_at = _utcnow()
            task.updated_at = task.finished_at
            session.add(task)
            session.commit()
    finally:
        schedule_bom_electronic_edit_tasks()


@router.post("", response_model=BomElectronicEditTaskPublic)
async def create_bom_electronic_edit_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_name: str | None = Form(default=None),
    project_archive_upload: UploadFile = File(...),
) -> Any:
    now = _utcnow()
    default_name = project_archive_upload.filename or "BOM电子档修改任务"
    task = BomElectronicEditTask(
        user_id=current_user.id,
        task_name=(task_name or default_name).strip(),
        status=BomElectronicEditTaskStatus.preparing,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    try:
        task.input_files = await bom_electronic_edit_task_service.save_project_archive_upload(
            task.id,
            upload=project_archive_upload,
        )
        task.status = BomElectronicEditTaskStatus.queued
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
    except HTTPException as exc:
        task.status = BomElectronicEditTaskStatus.failed
        task.error_message = str(exc.detail)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise
    except Exception as exc:
        task.status = BomElectronicEditTaskStatus.failed
        task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise HTTPException(status_code=500, detail=task.error_message) from exc

    schedule_bom_electronic_edit_tasks(task.id)
    return _task_public(task, current_user)


@router.get("", response_model=BomElectronicEditTasksPublic)
def read_bom_electronic_edit_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    count_statement = (
        select(func.count())
        .select_from(BomElectronicEditTask)
        .join(User, BomElectronicEditTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(BomElectronicEditTask, User)
        .join(User, BomElectronicEditTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(BomElectronicEditTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return BomElectronicEditTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/stats", response_model=BomElectronicEditTaskStatsPublic)
def read_bom_electronic_edit_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    rows = session.exec(
        select(BomElectronicEditTask.status, func.count())
        .where(*filters)
        .group_by(BomElectronicEditTask.status)
    ).all()
    by_status = dict.fromkeys(BomElectronicEditTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    aggregate = session.exec(
        select(
            func.coalesce(func.sum(BomElectronicEditTask.modified_count), 0),
            func.coalesce(func.sum(BomElectronicEditTask.abnormal_count), 0),
            func.coalesce(func.sum(BomElectronicEditTask.report_count), 0),
            func.coalesce(func.sum(BomElectronicEditTask.processed_sheet_count), 0),
        ).where(*filters)
    ).one()
    task_total_count = sum(by_status.values())
    task_success_count = by_status[BomElectronicEditTaskStatus.success]
    task_running_count = sum(by_status[status] for status in _RUNNING_STATUSES)
    task_failed_count = sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES)
    return BomElectronicEditTaskStatsPublic(
        total=task_total_count,
        success=task_success_count,
        running=task_running_count,
        failed_or_error=task_failed_count,
        by_status=by_status,
        modified_count=int(aggregate[0] or 0),
        abnormal_count=int(aggregate[1] or 0),
        report_count=int(aggregate[2] or 0),
        processed_sheet_count=int(aggregate[3] or 0),
    )


@router.get("/{task_id}", response_model=BomElectronicEditTaskPublic)
def read_bom_electronic_edit_task(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> Any:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    return _task_public(task)


@router.get("/{task_id}/report")
def download_bom_electronic_edit_task_report(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> FileResponse:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    report = task.result_files[0] if task.result_files else {
        "file_name": bom_electronic_edit_task_service.RESULT_ZIP_NAME,
        "file_path": str(bom_electronic_edit_task_service.reports_dir(task_id) / bom_electronic_edit_task_service.RESULT_ZIP_NAME),
        "content_type": "application/zip",
    }
    report_path = Path(str(report.get("file_path") or ""))
    if not report_path.is_file():
        fallback_name = bom_electronic_edit_task_service._safe_filename(  # noqa: SLF001
            str(report.get("file_name") or report_path.name),
            "result.zip",
        )
        fallback_path = bom_electronic_edit_task_service.reports_dir(task_id) / fallback_name
        if fallback_path.is_file():
            report_path = fallback_path
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="BOM electronic edit report not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.post("/{task_id}/download-ticket")
def create_bom_electronic_edit_download_ticket(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> dict[str, str]:
    _get_task_for_user(session=session, current_user=current_user, task_id=task_id)
    ticket = _issue_download_ticket(task_id=task_id, user_id=current_user.id)
    return {
        "url": f"/api/v1/bom-electronic-edit-tasks/{task_id}/browser-download?ticket={ticket}"
    }


@router.get("/{task_id}/browser-download")
def browser_download_bom_electronic_edit_task_report(
    session: SessionDep,
    task_id: uuid.UUID,
    ticket: str = Query(min_length=1),
) -> FileResponse:
    user_id = _consume_download_ticket(ticket=ticket, task_id=task_id)
    current_user = session.get(User, user_id)
    if current_user is None:
        raise HTTPException(status_code=403, detail="Invalid or expired download ticket")
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    report = task.result_files[0] if task.result_files else {
        "file_name": bom_electronic_edit_task_service.RESULT_ZIP_NAME,
        "file_path": str(
            bom_electronic_edit_task_service.reports_dir(task_id)
            / bom_electronic_edit_task_service.RESULT_ZIP_NAME
        ),
        "content_type": "application/zip",
    }
    report_path = Path(str(report.get("file_path") or ""))
    if not report_path.is_file():
        fallback_name = bom_electronic_edit_task_service._safe_filename(  # noqa: SLF001
            str(report.get("file_name") or report_path.name),
            "result.zip",
        )
        fallback_path = bom_electronic_edit_task_service.reports_dir(task_id) / fallback_name
        if fallback_path.is_file():
            report_path = fallback_path
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="BOM electronic edit report not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.delete("/{task_id}")
def delete_bom_electronic_edit_task(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> dict[str, str]:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    try:
        bom_electronic_edit_task_service.remove_task_files(task.id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete BOM electronic edit task files") from exc
    session.delete(task)
    session.commit()
    return {"message": "BOM electronic edit task deleted"}
