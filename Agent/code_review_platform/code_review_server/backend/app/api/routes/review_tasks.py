import logging
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, delete, func, select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    has_admin_privileges,
)
from app.models import (
    Department,
    ReviewTask,
    ReviewTaskCreate,
    ReviewTaskPublic,
    ReviewTaskReportFeedback,
    ReviewTaskReportFeedbackCreate,
    ReviewTaskReportFeedbackPublic,
    ReviewTaskReportUserStatsPublic,
    ReviewTaskRequirementFile,
    ReviewTasksPublic,
    ReviewTaskStatsPublic,
    ReviewTaskStatsRange,
    ReviewTaskStatus,
    ReviewTaskStatusUpdate,
    ReviewTaskTrendPointPublic,
    ReviewTaskWeeklyInsightsPublic,
    User,
    UserRole,
)
from app.services import report_service
from app.services.weekly_insight_service import (
    build_weekly_insights,
    previous_complete_week_bounds,
)

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

ReportFeedbackFilter = Literal["helpful", "not_helpful", "none"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_department_admin_active_department(
    *, session: SessionDep, current_user: CurrentUser
) -> None:
    if current_user.role != UserRole.department_admin:
        return
    ensure_department_admin_has_department(current_user)
    department = session.get(Department, current_user.department_id)
    if department is None or not department.is_active:
        raise HTTPException(
            status_code=403,
            detail="当前账号未绑定部门，请联系超级管理员。",
        )


def _task_read_scope_filters(
    *, session: SessionDep, current_user: CurrentUser
) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    if current_user.role == UserRole.department_admin:
        _ensure_department_admin_active_department(
            session=session, current_user=current_user
        )
        return [ReviewTask.department_id == current_user.department_id]
    return [ReviewTask.user_id == current_user.id]


def _range_bounds(
    stats_range: ReviewTaskStatsRange,
    now: datetime | None = None,
) -> tuple[datetime | None, datetime | None]:
    if stats_range == ReviewTaskStatsRange.all:
        return None, None

    current = (now or _utcnow()).astimezone(TASK_STATS_TIMEZONE)
    today_start = datetime.combine(
        current.date(),
        time.min,
        tzinfo=TASK_STATS_TIMEZONE,
    )
    week_start = today_start - timedelta(days=current.weekday())
    if stats_range == ReviewTaskStatsRange.this_week:
        start = week_start
        end = current
    elif stats_range == ReviewTaskStatsRange.last_week:
        start = week_start - timedelta(days=7)
        end = week_start
    elif stats_range == ReviewTaskStatsRange.today:
        start = today_start
        end = current
    else:
        start = today_start - timedelta(days=1)
        end = today_start

    return (
        start.astimezone(timezone.utc).replace(tzinfo=None),
        end.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _range_filters(stats_range: ReviewTaskStatsRange) -> list[Any]:
    start, end = _range_bounds(stats_range)
    filters: list[Any] = []
    if start is not None:
        filters.append(ReviewTask.created_at >= start)
    if end is not None:
        filters.append(ReviewTask.created_at < end)
    return filters


def _parse_started_from(value: str | None) -> datetime | None:
    if not value or not value.strip():
        return None

    normalized = value.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized):
            local_start = datetime.combine(
                date.fromisoformat(normalized),
                time.min,
                tzinfo=TASK_STATS_TIMEZONE,
            )
            return local_start.astimezone(timezone.utc).replace(tzinfo=None)

        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid started_from") from None

    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


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
        _ensure_department_admin_active_department(
            session=session, current_user=current_user
        )
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


def _ensure_task_has_reports(task: ReviewTask) -> None:
    if not task.report_path:
        raise HTTPException(status_code=409, detail="no_report")
    if not task.pdf_report_path:
        raise HTTPException(status_code=409, detail="no_pdf_report")


def _normalize_useful_issues_text(
    *, helpful: bool, useful_issues_text: str | None
) -> str | None:
    normalized = useful_issues_text.strip() if useful_issues_text else ""
    if helpful and not normalized:
        raise HTTPException(
            status_code=400, detail="有帮助时请至少填写一条有用信息"
        )
    return normalized or None


def _task_public(
    task: ReviewTask,
    user: User | None = None,
    report_feedback: ReviewTaskReportFeedback | None = None,
) -> ReviewTaskPublic:
    return ReviewTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
            "report_feedback_helpful": (
                report_feedback.helpful if report_feedback else None
            ),
            "report_feedback_useful_issues_text": (
                report_feedback.useful_issues_text if report_feedback else None
            ),
        },
    )


@router.post("", response_model=ReviewTaskPublic)
def create_review_task(
    *, session: SessionDep, current_user: CurrentUser, task_in: ReviewTaskCreate
) -> Any:
    old_revision = _normalize_revision(task_in.old_revision)
    new_revision = _normalize_revision(task_in.new_revision)
    old_revision_number = int(old_revision[1:])
    new_revision_number = int(new_revision[1:])
    if new_revision_number == 0:
        raise HTTPException(status_code=400, detail="新版本号不能为 0")
    if old_revision_number != 0 and old_revision_number >= new_revision_number:
        raise HTTPException(status_code=400, detail="旧版本号必须小于新版本号")

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
    mine: bool = False,
    user_name: str | None = None,
    svn_username: str | None = None,
    status: ReviewTaskStatus | None = None,
    report_feedback: ReportFeedbackFilter | None = None,
    started_from: str | None = None,
) -> Any:
    filters = _task_read_scope_filters(session=session, current_user=current_user)
    if mine:
        filters.append(ReviewTask.user_id == current_user.id)
    if user_name and user_name.strip():
        filters.append(col(User.full_name).ilike(f"%{user_name.strip()}%"))
    if svn_username and svn_username.strip():
        filters.append(col(User.svn_username).ilike(f"%{svn_username.strip()}%"))
    if status is not None:
        filters.append(ReviewTask.status == status)
    started_from_datetime = _parse_started_from(started_from)
    if started_from_datetime is not None:
        filters.append(ReviewTask.started_at >= started_from_datetime)
    if report_feedback == "helpful":
        filters.append(ReviewTaskReportFeedback.helpful.is_(True))
    elif report_feedback == "not_helpful":
        filters.append(ReviewTaskReportFeedback.helpful.is_(False))
    elif report_feedback == "none":
        filters.append(ReviewTaskReportFeedback.id.is_(None))

    count_statement = (
        select(func.count())
        .select_from(ReviewTask)
        .join(User, ReviewTask.user_id == User.id)
        .outerjoin(
            ReviewTaskReportFeedback,
            ReviewTaskReportFeedback.task_id == ReviewTask.id,
        )
        .where(*filters)
    )
    statement = (
        select(ReviewTask, User, ReviewTaskReportFeedback)
        .join(User, ReviewTask.user_id == User.id)
        .outerjoin(
            ReviewTaskReportFeedback,
            ReviewTaskReportFeedback.task_id == ReviewTask.id,
        )
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(ReviewTask.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return ReviewTasksPublic(
        data=[
            _task_public(task, user, report_feedback)
            for task, user, report_feedback in rows
        ],
        count=count,
    )


@router.get("/stats", response_model=ReviewTaskStatsPublic)
def read_review_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    range: ReviewTaskStatsRange = ReviewTaskStatsRange.today,
) -> Any:
    filters = [
        *_task_read_scope_filters(session=session, current_user=current_user),
        *_range_filters(range),
    ]

    statement = (
        select(ReviewTask.status, func.count())
        .where(*filters)
        .group_by(ReviewTask.status)
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
    average_duration_seconds = (
        int(sum(durations) / len(durations)) if durations else None
    )

    reports_by_user: list[ReviewTaskReportUserStatsPublic] = []
    if (
        has_admin_privileges(current_user)
        or current_user.role == UserRole.department_admin
    ):
        report_count = func.count(ReviewTask.id)
        report_rows = session.exec(
            select(User.full_name, User.svn_username, report_count)
            .join(User, ReviewTask.user_id == User.id)
            .where(
                *filters,
                ReviewTask.status == ReviewTaskStatus.success,
                ReviewTask.report_path.is_not(None),
            )
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
        failed_or_error=sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES),
        average_duration_seconds=average_duration_seconds,
        by_status=by_status,
        reports_by_user=reports_by_user,
        trend=_trend_points(session=session, filters=filters),
    )


@router.get("/weekly-insights", response_model=ReviewTaskWeeklyInsightsPublic)
def read_review_task_weekly_insights(
    session: SessionDep,
    current_user: CurrentUser,
) -> ReviewTaskWeeklyInsightsPublic:
    generated_at = _utcnow()
    period_start, period_end_exclusive, start_utc, end_utc = (
        previous_complete_week_bounds(generated_at)
    )
    filters = [
        *_task_read_scope_filters(session=session, current_user=current_user),
        ReviewTask.status == ReviewTaskStatus.success,
        ReviewTask.created_at >= start_utc,
        ReviewTask.created_at < end_utc,
    ]
    rows = session.exec(
        select(ReviewTask, ReviewTaskReportFeedback)
        .outerjoin(
            ReviewTaskReportFeedback,
            ReviewTaskReportFeedback.task_id == ReviewTask.id,
        )
        .where(*filters)
        .order_by(col(ReviewTask.created_at))
    ).all()

    if has_admin_privileges(current_user):
        scope_label = "全部部门"
    elif current_user.role == UserRole.department_admin:
        department = session.get(Department, current_user.department_id)
        scope_label = department.name if department else "本部门"
    else:
        scope_label = "个人"

    return build_weekly_insights(
        rows=list(rows),
        period_start=period_start,
        period_end_exclusive=period_end_exclusive,
        generated_at=generated_at,
        scope_label=scope_label,
    )


@router.post(
    "/{task_id}/report-feedback",
    response_model=ReviewTaskReportFeedbackPublic,
)
def submit_review_task_report_feedback(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    feedback_in: ReviewTaskReportFeedbackCreate,
) -> Any:
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    _ensure_task_has_reports(task)
    useful_issues_text = _normalize_useful_issues_text(
        helpful=feedback_in.helpful,
        useful_issues_text=feedback_in.useful_issues_text,
    )
    existing_feedback = session.exec(
        select(ReviewTaskReportFeedback).where(
            ReviewTaskReportFeedback.task_id == task.id
        )
    ).first()
    if existing_feedback:
        raise HTTPException(status_code=409, detail="report_feedback_exists")

    feedback = ReviewTaskReportFeedback(
        task_id=task.id,
        user_id=current_user.id,
        helpful=feedback_in.helpful,
        useful_issues_text=useful_issues_text,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    session.add(feedback)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="report_feedback_exists") from None
    session.refresh(feedback)
    return feedback


@router.get("/{task_id}", response_model=ReviewTaskPublic)
def read_review_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> Any:
    task = _get_task_for_read(
        session=session, current_user=current_user, task_id=task_id
    )
    report_feedback = session.exec(
        select(ReviewTaskReportFeedback).where(
            ReviewTaskReportFeedback.task_id == task.id
        )
    ).first()
    return _task_public(task, session.get(User, task.user_id), report_feedback)


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
            *(
                Path(requirement_file.file_path)
                for requirement_file in requirement_files
            ),
        )
        if file_path is not None
    ]

    session.exec(
        delete(ReviewTaskReportFeedback).where(
            ReviewTaskReportFeedback.task_id == task.id
        )
    )
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
    elif task.status in _RUNNING_STATUSES:
        task.finished_at = None
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
    (
        file_path,
        file_size,
        file_hash,
        safe_file_name,
    ) = await report_service.save_requirement_upload(task_id, upload)
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
