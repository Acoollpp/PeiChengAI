import logging
import re
import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import col, func, select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    has_admin_privileges,
)
from app.models import (
    Department,
    FeedbackStatsRange,
    ReviewTask,
    ReviewTaskCreate,
    ReviewTaskPublic,
    ReviewTaskReportUserStatsPublic,
    ReviewTaskRequirementFile,
    ReviewTasksPublic,
    ReviewTaskStatsPublic,
    ReviewTaskStatus,
    ReviewTaskStatusUpdate,
    ReviewTaskTrendPointPublic,
    User,
    UserRole,
)
from app.services import report_service

router = APIRouter(prefix="/review-tasks", tags=["review-tasks"])
logger = logging.getLogger(__name__)
REVIEW_REPORT_FILE_NAME = "代码审查报告.md"
PDF_REPORT_FILE_NAME = "代码审查报告.pdf"
TASK_STATS_TIMEZONE = ZoneInfo("Asia/Shanghai")

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


def _task_read_scope_filters(current_user: CurrentUser) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    if current_user.role == UserRole.department_admin:
        ensure_department_admin_has_department(current_user)
        return [ReviewTask.department_id == current_user.department_id]
    return [ReviewTask.user_id == current_user.id]


def _range_bounds(
    stats_range: FeedbackStatsRange,
    now: datetime | None = None,
) -> tuple[datetime | None, datetime | None]:
    if stats_range == FeedbackStatsRange.all:
        return None, None

    current = (now or _utcnow()).astimezone(TASK_STATS_TIMEZONE)
    today_start = datetime.combine(
        current.date(),
        time.min,
        tzinfo=TASK_STATS_TIMEZONE,
    )
    if stats_range == FeedbackStatsRange.today:
        start = today_start
        end = current
    else:
        start = today_start - timedelta(days=1)
        end = today_start

    return (
        start.astimezone(timezone.utc).replace(tzinfo=None),
        end.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _range_filters(stats_range: FeedbackStatsRange) -> list[Any]:
    start, end = _range_bounds(stats_range)
    filters: list[Any] = []
    if start is not None:
        filters.append(ReviewTask.created_at >= start)
    if end is not None:
        filters.append(ReviewTask.created_at < end)
    return filters


def _unlink_file_after_commit(file_path: Path) -> None:
    if not file_path.is_file():
        return
    try:
        file_path.unlink()
    except OSError as exc:
        logger.warning(
            "Failed to remove review task file after database commit: %s",
            file_path,
            exc_info=exc,
        )


def _trend_points(
    *,
    session: SessionDep,
    filters: list[Any],
) -> list[ReviewTaskTrendPointPublic]:
    rows = session.exec(
        select(ReviewTask.created_at)
        .where(*filters)
        .order_by(col(ReviewTask.created_at))
    ).all()

    counts_by_date: dict[str, int] = {}
    for created_at in rows:
        if created_at is None:
            continue
        label = created_at.astimezone(TASK_STATS_TIMEZONE).date().isoformat()
        counts_by_date[label] = counts_by_date.get(label, 0) + 1

    return [
        ReviewTaskTrendPointPublic(label=label, count=count)
        for label, count in list(counts_by_date.items())[-30:]
    ]


def _normalize_revision(revision: str) -> str:
    match = _REVISION_RE.fullmatch(revision.strip())
    if not match:
        raise HTTPException(
            status_code=400,
            detail="Revision must be a number or start with r followed by a number",
        )
    return f"r{match.group(1)}"


def _can_write_task(current_user: CurrentUser, task: ReviewTask) -> bool:
    return has_admin_privileges(current_user) or task.user_id == current_user.id


def _get_task_for_read(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> ReviewTask:
    task = session.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Review task not found")
    if has_admin_privileges(current_user):
        return task
    if current_user.role == UserRole.department_admin:
        ensure_department_admin_has_department(current_user)
        if task.department_id == current_user.department_id:
            return task
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if task.user_id == current_user.id:
        return task
    raise HTTPException(status_code=403, detail="Not enough permissions")


def _get_task_for_write(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> ReviewTask:
    task = session.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Review task not found")
    if not _can_write_task(current_user, task):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def _read_report_path(task: ReviewTask) -> Path:
    report_path = Path(task.report_path) if task.report_path else None
    if not report_path or not report_path.is_file():
        raise HTTPException(status_code=404, detail="Report not found")
    return report_path


def _read_pdf_report_path(task: ReviewTask) -> Path:
    report_path = Path(task.pdf_report_path) if task.pdf_report_path else None
    if not report_path or not report_path.is_file():
        raise HTTPException(status_code=404, detail="PDF report not found")
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

    department = (
        session.get(Department, current_user.department_id)
        if current_user.department_id is not None
        else None
    )
    task = ReviewTask.model_validate(
        task_in,
        update={
            "user_id": current_user.id,
            "old_revision": old_revision,
            "new_revision": new_revision,
            "department_id": department.id if department else None,
            "department_name": department.name if department else None,
            "focus_direction_snapshot": task_in.focus_direction_snapshot,
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
    filters = _task_read_scope_filters(current_user)
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
    range: FeedbackStatsRange = FeedbackStatsRange.today,
) -> Any:
    filters = [
        *_task_read_scope_filters(current_user),
        *_range_filters(range),
    ]

    statement = select(ReviewTask.status, func.count()).where(*filters).group_by(
        ReviewTask.status
    )
    rows = session.exec(statement).all()
    by_status = dict.fromkeys(ReviewTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    duration_rows = session.exec(
        select(ReviewTask.started_at, ReviewTask.finished_at).where(
            *filters,
            ReviewTask.started_at.is_not(None),
            ReviewTask.finished_at.is_not(None),
        )
    ).all()
    durations = [
        int((finished_at - started_at).total_seconds())
        for started_at, finished_at in duration_rows
        if (
            started_at is not None
            and finished_at is not None
            and finished_at >= started_at
        )
    ]
    average_duration_seconds = int(sum(durations) / len(durations)) if durations else None

    reports_by_user: list[ReviewTaskReportUserStatsPublic] = []
    if (
        has_admin_privileges(current_user)
        or current_user.role == UserRole.department_admin
    ):
        report_count = func.count(ReviewTask.id)
        report_rows = session.exec(
            select(User.full_name, User.svn_username, report_count)
            .join(User, ReviewTask.user_id == User.id)
            .where(*filters, ReviewTask.report_path.is_not(None))
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
        range=range,
        total=sum(by_status.values()),
        success=by_status[ReviewTaskStatus.success],
        running=sum(by_status[status] for status in _RUNNING_STATUSES),
        failed_or_error=sum(
            by_status[status] for status in _FAILED_OR_ERROR_STATUSES
        ),
        average_duration_seconds=average_duration_seconds,
        by_status=by_status,
        reports_by_user=reports_by_user,
        trend=_trend_points(session=session, filters=filters),
    )


@router.get("/{task_id}", response_model=ReviewTaskPublic)
def read_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> Any:
    return _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )


@router.delete("/{task_id}")
def delete_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> dict[str, str]:
    task = _get_task_for_write(
        session=session, current_user=current_user, task_id=task_id
    )
    requirement_files = session.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == task.id
        )
    ).all()
    report_path = Path(task.report_path) if task.report_path else None
    pdf_report_path = Path(task.pdf_report_path) if task.pdf_report_path else None
    files_to_remove = [
        file_path
        for file_path in (
            report_path,
            pdf_report_path,
            *(Path(requirement_file.file_path) for requirement_file in requirement_files),
        )
        if file_path is not None
    ]

    for requirement_file in requirement_files:
        session.delete(requirement_file)
    session.flush()
    session.delete(task)
    session.commit()
    for file_path in files_to_remove:
        _unlink_file_after_commit(file_path)
    return {"message": "Review task deleted"}


@router.patch("/{task_id}/status", response_model=ReviewTaskPublic)
def update_review_task_status(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    status_in: ReviewTaskStatusUpdate,
) -> Any:
    task = _get_task_for_write(
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
    task = _get_task_for_write(
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


@router.post("/{task_id}/pdf-report", response_model=ReviewTaskPublic)
async def upload_review_task_pdf_report(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    upload: UploadFile = File(...),
) -> Any:
    task = _get_task_for_write(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = await report_service.save_pdf_upload(task_id, upload)
    now = _utcnow()
    task.pdf_report_path = str(report_path)
    task.pdf_report_name = upload.filename or PDF_REPORT_FILE_NAME
    task.updated_at = now

    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.post("/{task_id}/requirement-file", response_model=ReviewTaskPublic)
async def upload_review_task_requirement_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    upload: UploadFile = File(...),
) -> Any:
    task = _get_task_for_write(
        session=session, current_user=current_user, task_id=task_id
    )
    old_requirement_files = session.exec(
        select(ReviewTaskRequirementFile).where(
            ReviewTaskRequirementFile.task_id == task.id
        )
    ).all()
    old_requirement_paths = [
        Path(old_requirement_file.file_path)
        for old_requirement_file in old_requirement_files
    ]
    file_path, file_size, file_hash, safe_file_name = (
        await report_service.save_requirement_upload(task_id, upload)
    )
    requirement_file = ReviewTaskRequirementFile(
        task_id=task.id,
        file_name=safe_file_name,
        file_path=str(file_path),
        content_type=upload.content_type,
        file_size=file_size,
        sha256=file_hash,
    )
    session.add(requirement_file)
    session.flush()

    for old_requirement_file in old_requirement_files:
        session.delete(old_requirement_file)

    task.requirement_file_id = requirement_file.id
    task.requirement_file_name = safe_file_name
    task.requirement_file_size = file_size
    task.requirement_file_sha256 = file_hash
    task.updated_at = _utcnow()

    session.add(task)
    session.commit()
    session.refresh(task)
    for old_path in old_requirement_paths:
        if old_path != file_path:
            _unlink_file_after_commit(old_path)
    return task


@router.get("/{task_id}/report", response_class=PlainTextResponse)
def read_review_task_report(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> PlainTextResponse:
    task = _get_task_for_read(
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
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = _read_report_path(task)
    return FileResponse(
        report_path,
        media_type="text/markdown",
        filename=task.report_name or REVIEW_REPORT_FILE_NAME,
    )


@router.get("/{task_id}/pdf/download")
def download_review_task_pdf_report(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> FileResponse:
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = _read_pdf_report_path(task)
    return FileResponse(
        report_path,
        media_type="application/pdf",
        filename=task.pdf_report_name or PDF_REPORT_FILE_NAME,
    )
