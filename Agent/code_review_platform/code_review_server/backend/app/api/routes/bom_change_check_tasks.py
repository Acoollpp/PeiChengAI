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
    BomChangeCheckTask,
    BomChangeCheckTaskPublic,
    BomChangeCheckTaskStatsPublic,
    BomChangeCheckTaskStatus,
    BomChangeCheckTasksPublic,
    User,
)
from app.services import bom_change_check_task_service

router = APIRouter(prefix="/bom-change-check-tasks", tags=["bom-change-check-tasks"])

_RUNNING_STATUSES = {
    BomChangeCheckTaskStatus.queued,
    BomChangeCheckTaskStatus.preparing,
    BomChangeCheckTaskStatus.running,
    BomChangeCheckTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    BomChangeCheckTaskStatus.failed,
    BomChangeCheckTaskStatus.timeout,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _task_public(
    task: BomChangeCheckTask,
    user: User | None = None,
) -> BomChangeCheckTaskPublic:
    return BomChangeCheckTaskPublic.model_validate(
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
    return [BomChangeCheckTask.user_id == current_user.id]


def _get_task_for_user(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> BomChangeCheckTask:
    task = session.get(BomChangeCheckTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="BOM change check task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def start_bom_change_check_task(task_id: uuid.UUID) -> None:
    Thread(
        target=run_bom_change_check_task,
        args=(task_id,),
        daemon=True,
        name=f"bom-change-check-{task_id}",
    ).start()


def run_bom_change_check_task(task_id: uuid.UUID) -> None:
    with Session(engine) as session:
        task = session.get(BomChangeCheckTask, task_id)
        if task is None:
            return
        task.status = BomChangeCheckTaskStatus.running
        task.started_at = task.started_at or _utcnow()
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()

        try:
            result = bom_change_check_task_service.run_task(task.id, task.input_files)
            task.status = BomChangeCheckTaskStatus.uploading_report
            task.updated_at = _utcnow()
            session.add(task)
            session.commit()

            task.result_files = result["result_files"]  # type: ignore[assignment]
            task.change_order_abnormal_count = int(result.get("change_order_abnormal_count", 0))
            task.bom_diff_abnormal_count = int(result.get("bom_diff_abnormal_count", 0))
            task.replacement_abnormal_count = int(result.get("replacement_abnormal_count", 0))
            task.customer_restriction_abnormal_count = int(
                result.get("customer_restriction_abnormal_count", 0)
            )
            task.manual_review_count = int(result.get("manual_review_count", 0))
            task.skipped_count = int(result.get("skipped_count", 0))
            task.status = BomChangeCheckTaskStatus.success
            task.error_message = None
        except bom_change_check_task_service.BomChangeCheckTaskTimeout as exc:
            task.status = BomChangeCheckTaskStatus.failed
            task.error_message = str(exc)
            if exc.result:
                result = exc.result
                task.result_files = result.get("result_files", [])  # type: ignore[assignment]
                task.change_order_abnormal_count = int(result.get("change_order_abnormal_count", 0))
                task.bom_diff_abnormal_count = int(result.get("bom_diff_abnormal_count", 0))
                task.replacement_abnormal_count = int(result.get("replacement_abnormal_count", 0))
                task.customer_restriction_abnormal_count = int(
                    result.get("customer_restriction_abnormal_count", 0)
                )
                task.manual_review_count = int(result.get("manual_review_count", 0))
                task.skipped_count = int(result.get("skipped_count", 0))
        except Exception as exc:
            task.status = BomChangeCheckTaskStatus.failed
            task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()


@router.post("", response_model=BomChangeCheckTaskPublic)
async def create_bom_change_check_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_name: str | None = Form(default=None),
    project_upload: UploadFile = File(...),
    key_replacement_table_upload: UploadFile | None = File(default=None),
    no_key_replacement_table_upload: UploadFile | None = File(default=None),
) -> Any:
    now = _utcnow()
    default_name = project_upload.filename or "BOM改制检查任务"
    task = BomChangeCheckTask(
        user_id=current_user.id,
        task_name=(task_name or default_name).strip(),
        status=BomChangeCheckTaskStatus.preparing,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    try:
        input_files = await bom_change_check_task_service.save_project_upload(
            task.id,
            upload=project_upload,
        )
        replacement_tables: dict[str, object] = {}
        if key_replacement_table_upload is not None and key_replacement_table_upload.filename:
            replacement_tables["key"] = await bom_change_check_task_service.save_global_replacement_table_upload(
                key_replacement_table_upload,
                uploaded_by=current_user.full_name or current_user.email,
                role="key",
            )
        if no_key_replacement_table_upload is not None and no_key_replacement_table_upload.filename:
            replacement_tables["no_key"] = await bom_change_check_task_service.save_global_replacement_table_upload(
                no_key_replacement_table_upload,
                uploaded_by=current_user.full_name or current_user.email,
                role="no_key",
            )
        replacement_metadata = {"tables": replacement_tables} if replacement_tables else None
        input_files.append(
            bom_change_check_task_service.apply_replacement_table_to_task_input(
                task.id,
                metadata=replacement_metadata,
            )
        )
        task.input_files = input_files
        task.status = BomChangeCheckTaskStatus.queued
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
    except HTTPException as exc:
        task.status = BomChangeCheckTaskStatus.failed
        task.error_message = str(exc.detail)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise
    except Exception as exc:
        task.status = BomChangeCheckTaskStatus.failed
        task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise HTTPException(status_code=500, detail=task.error_message) from exc

    start_bom_change_check_task(task.id)
    return _task_public(task, current_user)


@router.get("/replacement-table")
def read_bom_change_check_replacement_table(
    current_user: CurrentUser,
) -> dict[str, Any]:
    _ = current_user
    return bom_change_check_task_service._replacement_table_public()


@router.get("", response_model=BomChangeCheckTasksPublic)
def read_bom_change_check_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    count_statement = (
        select(func.count())
        .select_from(BomChangeCheckTask)
        .join(User, BomChangeCheckTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(BomChangeCheckTask, User)
        .join(User, BomChangeCheckTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(BomChangeCheckTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return BomChangeCheckTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/stats", response_model=BomChangeCheckTaskStatsPublic)
def read_bom_change_check_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    rows = session.exec(
        select(BomChangeCheckTask.status, func.count())
        .where(*filters)
        .group_by(BomChangeCheckTask.status)
    ).all()
    by_status = dict.fromkeys(BomChangeCheckTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    aggregate = session.exec(
        select(
            func.coalesce(func.sum(BomChangeCheckTask.change_order_abnormal_count), 0),
            func.coalesce(func.sum(BomChangeCheckTask.bom_diff_abnormal_count), 0),
            func.coalesce(func.sum(BomChangeCheckTask.replacement_abnormal_count), 0),
            func.coalesce(func.sum(BomChangeCheckTask.customer_restriction_abnormal_count), 0),
            func.coalesce(func.sum(BomChangeCheckTask.manual_review_count), 0),
            func.coalesce(func.sum(BomChangeCheckTask.skipped_count), 0),
        ).where(*filters)
    ).one()
    task_total_count = sum(by_status.values())
    task_success_count = by_status[BomChangeCheckTaskStatus.success]
    task_running_count = sum(by_status[status] for status in _RUNNING_STATUSES)
    task_failed_count = sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES)
    return BomChangeCheckTaskStatsPublic(
        total=task_total_count,
        success=task_success_count,
        running=task_running_count,
        failed_or_error=task_failed_count,
        by_status=by_status,
        change_order_abnormal_count=int(aggregate[0] or 0),
        bom_diff_abnormal_count=int(aggregate[1] or 0),
        replacement_abnormal_count=int(aggregate[2] or 0),
        customer_restriction_abnormal_count=int(aggregate[3] or 0),
        manual_review_count=int(aggregate[4] or 0),
        skipped_count=int(aggregate[5] or 0),
    )


@router.get("/{task_id}", response_model=BomChangeCheckTaskPublic)
def read_bom_change_check_task(
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
def download_bom_change_check_task_report(
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
        raise HTTPException(status_code=404, detail="BOM change check report not found")
    report = task.result_files[0]
    report_path = Path(str(report["file_path"]))
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="BOM change check report not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.get("/{task_id}/result-files/{file_index}")
def download_bom_change_check_task_result_file(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    file_index: int,
) -> FileResponse:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    if file_index < 0 or file_index >= len(task.result_files):
        raise HTTPException(status_code=404, detail="BOM change check result file not found")
    report = task.result_files[file_index]
    report_path = Path(str(report["file_path"]))
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="BOM change check result file not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.delete("/{task_id}")
def delete_bom_change_check_task(
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
        bom_change_check_task_service.remove_task_files(task.id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete BOM change check task files") from exc
    session.delete(task)
    session.commit()
    return {"message": "BOM change check task deleted"}
