import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.core.db import engine
from app.models import (
    BomSpecCompareTask,
    BomSpecCompareTaskPublic,
    BomSpecCompareTaskStatsPublic,
    BomSpecCompareTaskStatus,
    BomSpecCompareTasksPublic,
    User,
)
from app.services import bom_spec_compare_task_service

router = APIRouter(prefix="/bom-spec-compare-tasks", tags=["bom-spec-compare-tasks"])

_RUNNING_STATUSES = {
    BomSpecCompareTaskStatus.queued,
    BomSpecCompareTaskStatus.preparing,
    BomSpecCompareTaskStatus.running,
    BomSpecCompareTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    BomSpecCompareTaskStatus.failed,
    BomSpecCompareTaskStatus.timeout,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _task_public(
    task: BomSpecCompareTask,
    user: User | None = None,
) -> BomSpecCompareTaskPublic:
    return BomSpecCompareTaskPublic.model_validate(
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
    return [BomSpecCompareTask.user_id == current_user.id]


def _get_task_for_user(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> BomSpecCompareTask:
    task = session.get(BomSpecCompareTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="BOM spec compare task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def start_bom_spec_compare_task(task_id: uuid.UUID) -> None:
    Thread(
        target=run_bom_spec_compare_task,
        args=(task_id,),
        daemon=True,
        name=f"bom-spec-compare-{task_id}",
    ).start()


def run_bom_spec_compare_task(task_id: uuid.UUID) -> None:
    with Session(engine) as session:
        task = session.get(BomSpecCompareTask, task_id)
        if task is None:
            return
        task.status = BomSpecCompareTaskStatus.running
        task.started_at = task.started_at or _utcnow()
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()

        try:
            result = bom_spec_compare_task_service.run_task_with_codex(task.id)
            task.status = BomSpecCompareTaskStatus.uploading_report
            task.updated_at = _utcnow()
            session.add(task)
            session.commit()

            task.result_files = result["result_files"]  # type: ignore[assignment]
            task.project_count = int(result.get("project_count", 0))
            task.success_count = int(result.get("success_count", 0))
            task.consistent_count = int(result.get("consistent_count", 0))
            task.different_count = int(result.get("different_count", 0))
            task.failed_count = int(result.get("failed_count", 0))
            task.status = BomSpecCompareTaskStatus.success
            task.error_message = None
        except Exception as exc:
            task.status = BomSpecCompareTaskStatus.failed
            task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()


@router.post("", response_model=BomSpecCompareTaskPublic)
async def create_bom_spec_compare_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_name: str | None = Form(default=None),
    project_upload: UploadFile = File(...),
) -> Any:
    now = _utcnow()
    task = BomSpecCompareTask(
        user_id=current_user.id,
        task_name=(task_name or project_upload.filename or "BOM配送检查任务").strip(),
        status=BomSpecCompareTaskStatus.preparing,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    try:
        task.input_files = await bom_spec_compare_task_service.save_project_upload(
            task.id,
            project_upload,
        )
        task.status = BomSpecCompareTaskStatus.queued
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
    except HTTPException as exc:
        task.status = BomSpecCompareTaskStatus.failed
        task.error_message = str(exc.detail)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise
    except Exception as exc:
        task.status = BomSpecCompareTaskStatus.failed
        task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise HTTPException(status_code=500, detail=task.error_message) from exc

    start_bom_spec_compare_task(task.id)
    return _task_public(task, current_user)


@router.get("", response_model=BomSpecCompareTasksPublic)
def read_bom_spec_compare_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    count_statement = (
        select(func.count())
        .select_from(BomSpecCompareTask)
        .join(User, BomSpecCompareTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(BomSpecCompareTask, User)
        .join(User, BomSpecCompareTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(BomSpecCompareTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return BomSpecCompareTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/stats", response_model=BomSpecCompareTaskStatsPublic)
def read_bom_spec_compare_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    rows = session.exec(
        select(BomSpecCompareTask.status, func.count())
        .where(*filters)
        .group_by(BomSpecCompareTask.status)
    ).all()
    by_status = dict.fromkeys(BomSpecCompareTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    aggregate = session.exec(
        select(
            func.coalesce(func.sum(BomSpecCompareTask.project_count), 0),
            func.coalesce(func.sum(BomSpecCompareTask.consistent_count), 0),
            func.coalesce(func.sum(BomSpecCompareTask.different_count), 0),
            func.coalesce(func.sum(BomSpecCompareTask.failed_count), 0),
        ).where(*filters)
    ).one()
    task_total_count = sum(by_status.values())
    task_success_count = by_status[BomSpecCompareTaskStatus.success]
    task_running_count = sum(by_status[status] for status in _RUNNING_STATUSES)
    task_failed_count = sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES)
    project_total_count = int(aggregate[0] or 0)
    project_consistent_count = int(aggregate[1] or 0)
    project_different_count = int(aggregate[2] or 0)
    project_failed_count = int(aggregate[3] or 0)
    return BomSpecCompareTaskStatsPublic(
        total=task_total_count,
        success=task_success_count,
        running=task_running_count,
        failed_or_error=task_failed_count,
        by_status=by_status,
        project_count=project_total_count,
        consistent_count=project_consistent_count,
        different_count=project_different_count,
        failed_count=project_failed_count,
        task_total_count=task_total_count,
        task_success_count=task_success_count,
        task_running_count=task_running_count,
        task_failed_count=task_failed_count,
        project_total_count=project_total_count,
        project_consistent_count=project_consistent_count,
        project_different_count=project_different_count,
        project_failed_count=project_failed_count,
    )


@router.get("/{task_id}", response_model=BomSpecCompareTaskPublic)
def read_bom_spec_compare_task(
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
def download_bom_spec_compare_task_report(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> FileResponse:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    if not task.result_files:
        raise HTTPException(status_code=404, detail="BOM spec compare report not found")
    report = task.result_files[0]
    report_path = Path(str(report["file_path"]))
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="BOM spec compare report not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.delete("/{task_id}")
def delete_bom_spec_compare_task(
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
        bom_spec_compare_task_service.remove_task_files(task.id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete BOM spec compare task files") from exc
    session.delete(task)
    session.commit()
    return {"message": "BOM spec compare task deleted"}
