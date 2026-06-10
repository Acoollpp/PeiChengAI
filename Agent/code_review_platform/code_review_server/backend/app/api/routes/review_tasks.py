import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    ReviewTask,
    ReviewTaskCreate,
    ReviewTaskPublic,
    ReviewTaskReportUserStatsPublic,
    ReviewTasksPublic,
    ReviewTaskStatsPublic,
    ReviewTaskStatus,
    ReviewTaskStatusUpdate,
    User,
)
from app.services import report_service

router = APIRouter(prefix="/review-tasks", tags=["review-tasks"])
REVIEW_REPORT_FILE_NAME = "代码审查报告.md"

_REVISION_RE = re.compile(r"^r?(\d+)$")

_RUNNING_STATUSES = {
    ReviewTaskStatus.checking_environment,
    ReviewTaskStatus.running_codex,
    ReviewTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    ReviewTaskStatus.failed,
    ReviewTaskStatus.environment_error,
    ReviewTaskStatus.cancelled,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_revision(revision: str) -> str:
    match = _REVISION_RE.fullmatch(revision.strip())
    if not match:
        raise HTTPException(
            status_code=400,
            detail="Revision must be a number or start with r followed by a number",
        )
    return f"r{match.group(1)}"


def _get_task_for_user(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> ReviewTask:
    task = session.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Review task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def _read_report_path(task: ReviewTask) -> Path:
    report_path = Path(task.report_path) if task.report_path else None
    if not report_path or not report_path.is_file():
        raise HTTPException(status_code=404, detail="Report not found")
    return report_path


def _task_public(task: ReviewTask, user: User | None = None) -> ReviewTaskPublic:
    return ReviewTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
        },
    )


@router.post("", response_model=ReviewTaskPublic)
def create_review_task(
    *, session: SessionDep, current_user: CurrentUser, task_in: ReviewTaskCreate
) -> Any:
    old_revision = _normalize_revision(task_in.old_revision)
    new_revision = _normalize_revision(task_in.new_revision)
    if old_revision == new_revision:
        raise HTTPException(
            status_code=400, detail="Old and new revisions must differ"
        )

    task = ReviewTask.model_validate(
        task_in,
        update={
            "user_id": current_user.id,
            "old_revision": old_revision,
            "new_revision": new_revision,
        },
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("", response_model=ReviewTasksPublic)
def read_review_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    user_name: str | None = None,
    svn_username: str | None = None,
) -> Any:
    filters = []
    if not has_admin_privileges(current_user):
        filters.append(ReviewTask.user_id == current_user.id)
    if user_name and user_name.strip():
        filters.append(col(User.full_name).ilike(f"%{user_name.strip()}%"))
    if svn_username and svn_username.strip():
        filters.append(col(User.svn_username).ilike(f"%{svn_username.strip()}%"))

    count_statement = (
        select(func.count())
        .select_from(ReviewTask)
        .join(User, ReviewTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(ReviewTask, User)
        .join(User, ReviewTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(ReviewTask.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return ReviewTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/stats", response_model=ReviewTaskStatsPublic)
def read_review_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    filters = []
    if not has_admin_privileges(current_user):
        filters.append(ReviewTask.user_id == current_user.id)

    statement = select(ReviewTask.status, func.count()).where(*filters).group_by(
        ReviewTask.status
    )
    rows = session.exec(statement).all()
    by_status = dict.fromkeys(ReviewTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    reports_by_user: list[ReviewTaskReportUserStatsPublic] = []
    if has_admin_privileges(current_user):
        report_count = func.count(ReviewTask.id)
        report_rows = session.exec(
            select(User.full_name, User.svn_username, report_count)
            .join(User, ReviewTask.user_id == User.id)
            .where(ReviewTask.report_path.is_not(None))
            .group_by(User.id, User.full_name, User.svn_username)
            .order_by(report_count.desc(), User.full_name)
        ).all()
        reports_by_user = [
            ReviewTaskReportUserStatsPublic(
                user_name=user_name,
                svn_username=svn_username,
                report_count=count,
            )
            for user_name, svn_username, count in report_rows
        ]

    return ReviewTaskStatsPublic(
        total=sum(by_status.values()),
        success=by_status[ReviewTaskStatus.success],
        running=sum(by_status[status] for status in _RUNNING_STATUSES),
        failed_or_error=sum(
            by_status[status] for status in _FAILED_OR_ERROR_STATUSES
        ),
        by_status=by_status,
        reports_by_user=reports_by_user,
    )


@router.get("/{task_id}", response_model=ReviewTaskPublic)
def read_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> Any:
    return _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )


@router.delete("/{task_id}")
def delete_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> dict[str, str]:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = Path(task.report_path) if task.report_path else None
    if report_path and report_path.is_file():
        try:
            report_path.unlink()
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail="Failed to delete review task report"
            ) from exc

    session.delete(task)
    session.commit()
    return {"message": "Review task deleted"}


@router.patch("/{task_id}/status", response_model=ReviewTaskPublic)
def update_review_task_status(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    status_in: ReviewTaskStatusUpdate,
) -> Any:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    now = _utcnow()
    update_data = status_in.model_dump(exclude_unset=True)
    task.sqlmodel_update(update_data)
    if task.started_at is None and task.status != ReviewTaskStatus.created:
        task.started_at = now
    if task.status in {
        ReviewTaskStatus.success,
        ReviewTaskStatus.failed,
        ReviewTaskStatus.environment_error,
        ReviewTaskStatus.cancelled,
    }:
        task.finished_at = now
    task.updated_at = now

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.post("/{task_id}/report", response_model=ReviewTaskPublic)
async def upload_review_task_report(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    upload: UploadFile = File(...),
) -> Any:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = await report_service.save_upload(task_id, upload)
    now = _utcnow()
    task.report_path = str(report_path)
    task.report_name = upload.filename or REVIEW_REPORT_FILE_NAME
    task.status = ReviewTaskStatus.success
    if task.started_at is None:
        task.started_at = now
    task.finished_at = now
    task.updated_at = now

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("/{task_id}/report", response_class=PlainTextResponse)
def read_review_task_report(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> PlainTextResponse:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = _read_report_path(task)
    return PlainTextResponse(
        report_path.read_text(encoding="utf-8"), media_type="text/markdown"
    )


@router.get("/{task_id}/download")
def download_review_task_report(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> FileResponse:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = _read_report_path(task)
    return FileResponse(
        report_path,
        media_type="text/markdown",
        filename=task.report_name or REVIEW_REPORT_FILE_NAME,
    )
