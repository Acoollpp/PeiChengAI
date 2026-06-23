import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import selectinload
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    Feedback,
    FeedbackPublic,
    FeedbackScreenshot,
    FeedbackScreenshotPublic,
    FeedbacksPublic,
    FeedbackStatsPublic,
    FeedbackStatsRange,
    FeedbackStatus,
    FeedbackStatusUpdate,
    FeedbackTrendPointPublic,
    FeedbackUserStatsPublic,
    User,
)
from app.services import feedback_service

router = APIRouter(prefix="/feedback", tags=["feedback"])
FEEDBACK_STATS_TIMEZONE = ZoneInfo("Asia/Shanghai")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _feedback_scope_filters(current_user: CurrentUser) -> list[Any]:
    if has_admin_privileges(current_user):
        return []
    return [Feedback.user_id == current_user.id]


def _range_bounds(
    stats_range: FeedbackStatsRange,
    now: datetime | None = None,
) -> tuple[datetime | None, datetime | None]:
    if stats_range == FeedbackStatsRange.all:
        return None, None

    current = (now or _utcnow()).astimezone(FEEDBACK_STATS_TIMEZONE)
    today_start = datetime.combine(
        current.date(),
        time.min,
        tzinfo=FEEDBACK_STATS_TIMEZONE,
    )
    if stats_range == FeedbackStatsRange.today:
        start = today_start
        end = current
    else:
        start = today_start - timedelta(days=1)
        end = today_start

    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _range_filters(
    stats_range: FeedbackStatsRange,
) -> list[Any]:
    start, end = _range_bounds(stats_range)
    filters: list[Any] = []
    if start is not None:
        filters.append(Feedback.created_at >= start)
    if end is not None:
        filters.append(Feedback.created_at < end)
    return filters


def _trend_points(
    *,
    session: SessionDep,
    filters: list[Any],
    stats_range: FeedbackStatsRange,
) -> list[FeedbackTrendPointPublic]:
    rows = session.exec(
        select(Feedback.created_at).where(*filters).order_by(col(Feedback.created_at))
    ).all()

    if stats_range in {FeedbackStatsRange.today, FeedbackStatsRange.yesterday}:
        counts = dict.fromkeys(range(24), 0)
        for created_at in rows:
            if created_at is None:
                continue
            hour = created_at.astimezone(FEEDBACK_STATS_TIMEZONE).hour
            counts[hour] += 1
        return [
            FeedbackTrendPointPublic(label=f"{hour:02d}:00", count=count)
            for hour, count in counts.items()
        ]

    counts_by_date: dict[str, int] = {}
    for created_at in rows:
        if created_at is None:
            continue
        label = created_at.astimezone(FEEDBACK_STATS_TIMEZONE).date().isoformat()
        counts_by_date[label] = counts_by_date.get(label, 0) + 1
    return [
        FeedbackTrendPointPublic(label=label, count=count)
        for label, count in list(counts_by_date.items())[-30:]
    ]


def _feedback_public(feedback: Feedback, user: User | None = None) -> FeedbackPublic:
    screenshots: list[FeedbackScreenshot] = sorted(
        feedback.screenshots, key=lambda item: item.sort_order
    )
    first_screenshot = screenshots[0] if screenshots else None
    return FeedbackPublic.model_validate(
        feedback,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
            "has_screenshot": bool(screenshots),
            "screenshot_count": len(screenshots),
            "screenshots": [
                FeedbackScreenshotPublic.model_validate(screenshot)
                for screenshot in screenshots
            ],
            "screenshot_name": first_screenshot.file_name if first_screenshot else None,
            "screenshot_content_type": first_screenshot.content_type
            if first_screenshot
            else None,
            "screenshot_size": first_screenshot.file_size if first_screenshot else None,
        },
    )


def _get_feedback_for_user(
    *, session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> Feedback:
    statement = (
        select(Feedback)
        .options(selectinload(Feedback.screenshots))
        .where(Feedback.id == feedback_id)
    )
    feedback = session.exec(statement).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if not has_admin_privileges(current_user) and feedback.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return feedback


@router.post("", response_model=FeedbackPublic)
async def create_feedback(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    description: Annotated[str, Form(...)],
    screenshots: Annotated[list[UploadFile] | None, File()] = None,
    screenshot: Annotated[UploadFile | None, File()] = None,
) -> Any:
    normalized_description = description.strip()
    if not normalized_description:
        raise HTTPException(
            status_code=400, detail="Feedback description must not be empty"
        )

    feedback = Feedback(
        user_id=current_user.id,
        description=normalized_description,
        status=FeedbackStatus.pending,
    )
    session.add(feedback)
    session.flush()

    uploads = screenshots or ([screenshot] if screenshot else [])
    if uploads:
        try:
            saved_screenshots = await feedback_service.save_screenshots(
                feedback.id, uploads
            )
            for screenshot_path, upload, content, sort_order in saved_screenshots:
                if sort_order == 0:
                    feedback.screenshot_path = str(screenshot_path)
                    feedback.screenshot_name = upload.filename
                    feedback.screenshot_content_type = upload.content_type
                    feedback.screenshot_size = len(content)
                session.add(
                    FeedbackScreenshot(
                        feedback_id=feedback.id,
                        file_path=str(screenshot_path),
                        file_name=upload.filename or f"screenshot-{sort_order}.png",
                        content_type=upload.content_type or "application/octet-stream",
                        file_size=len(content),
                        sort_order=sort_order,
                    )
                )
            session.add(feedback)
            session.commit()
        except HTTPException:
            feedback_service.remove_feedback_files(feedback.id)
            session.rollback()
            raise
        except Exception as exc:
            feedback_service.remove_feedback_files(feedback.id)
            session.rollback()
            raise HTTPException(status_code=500, detail="保存截图失败") from exc
    else:
        session.add(feedback)
        session.commit()
    session.refresh(feedback)
    return _feedback_public(feedback, current_user)


@router.get("", response_model=FeedbacksPublic)
def read_feedback(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: FeedbackStatus | None = None,
    user_name: str | None = None,
    svn_username: str | None = None,
) -> Any:
    filters = []
    is_admin = has_admin_privileges(current_user)
    if not is_admin:
        filters.append(Feedback.user_id == current_user.id)
    if status:
        filters.append(Feedback.status == status)
    if is_admin and user_name and user_name.strip():
        filters.append(col(User.full_name).ilike(f"%{user_name.strip()}%"))
    if is_admin and svn_username and svn_username.strip():
        filters.append(col(User.svn_username).ilike(f"%{svn_username.strip()}%"))

    count_statement = (
        select(func.count())
        .select_from(Feedback)
        .join(User, Feedback.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(Feedback, User)
        .options(selectinload(Feedback.screenshots))
        .join(User, Feedback.user_id == User.id)
        .where(*filters)
        .order_by(col(Feedback.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(statement).all()

    return FeedbacksPublic(
        data=[_feedback_public(feedback, user) for feedback, user in rows],
        count=count,
    )


@router.get("/stats", response_model=FeedbackStatsPublic)
def read_feedback_stats(
    session: SessionDep,
    current_user: CurrentUser,
    range: FeedbackStatsRange = FeedbackStatsRange.today,
) -> Any:
    filters = [
        *_feedback_scope_filters(current_user),
        *_range_filters(range),
    ]

    rows = session.exec(
        select(Feedback.status, func.count()).where(*filters).group_by(Feedback.status)
    ).all()
    by_status = dict.fromkeys(FeedbackStatus, 0)
    for status, count in rows:
        by_status[status] = count

    total = sum(by_status.values())
    resolved = by_status[FeedbackStatus.resolved]
    unresolved = (
        by_status[FeedbackStatus.pending] + by_status[FeedbackStatus.processing]
    )
    resolution_rate = resolved / total if total else 0

    resolved_rows = session.exec(
        select(Feedback.created_at, Feedback.updated_at).where(
            *filters,
            Feedback.status == FeedbackStatus.resolved,
            Feedback.created_at.is_not(None),
            Feedback.updated_at.is_not(None),
        )
    ).all()
    durations = [
        int((updated_at - created_at).total_seconds())
        for created_at, updated_at in resolved_rows
        if created_at is not None
        and updated_at is not None
        and updated_at >= created_at
    ]
    average_resolution_seconds = (
        int(sum(durations) / len(durations)) if durations else None
    )

    feedback_by_user: list[FeedbackUserStatsPublic] = []
    if has_admin_privileges(current_user):
        feedback_count = func.count(Feedback.id)
        user_rows = session.exec(
            select(User.full_name, User.svn_username, feedback_count)
            .join(User, Feedback.user_id == User.id)
            .where(*filters)
            .group_by(User.id, User.full_name, User.svn_username)
            .order_by(feedback_count.desc(), User.full_name)
            .limit(10)
        ).all()
        feedback_by_user = [
            FeedbackUserStatsPublic(
                user_name=user_name,
                svn_username=svn_username,
                feedback_count=count,
            )
            for user_name, svn_username, count in user_rows
        ]

    return FeedbackStatsPublic(
        range=range,
        total=total,
        pending=by_status[FeedbackStatus.pending],
        processing=by_status[FeedbackStatus.processing],
        resolved=resolved,
        unresolved=unresolved,
        resolution_rate=resolution_rate,
        average_resolution_seconds=average_resolution_seconds,
        by_status=by_status,
        trend=_trend_points(session=session, filters=filters, stats_range=range),
        feedback_by_user=feedback_by_user,
    )


@router.get("/{feedback_id}", response_model=FeedbackPublic)
def read_feedback_by_id(
    session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> Any:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    user = session.get(User, feedback.user_id)
    return _feedback_public(feedback, user)


@router.get("/{feedback_id}/screenshot")
def read_feedback_screenshot(
    session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> FileResponse:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    screenshots = sorted(
        feedback.screenshots,
        key=lambda item: (item.sort_order, item.created_at or datetime.min, item.id),
    )
    if screenshots:
        first = screenshots[0]
        screenshot_path = Path(first.file_path)
        if not screenshot_path.is_file():
            raise HTTPException(status_code=404, detail="Screenshot not found")
        return FileResponse(
            screenshot_path,
            media_type=first.content_type,
            filename=first.file_name,
        )

    screenshot_path = (
        Path(feedback.screenshot_path) if feedback.screenshot_path else None
    )
    if not screenshot_path or not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(
        screenshot_path,
        media_type=feedback.screenshot_content_type,
        filename=feedback.screenshot_name,
    )


@router.get("/{feedback_id}/screenshots/{screenshot_id}")
def read_feedback_screenshot_by_id(
    session: SessionDep,
    current_user: CurrentUser,
    feedback_id: uuid.UUID,
    screenshot_id: uuid.UUID,
) -> FileResponse:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    screenshot = session.get(FeedbackScreenshot, screenshot_id)
    if not screenshot or screenshot.feedback_id != feedback.id:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    screenshot_path = Path(screenshot.file_path)
    if not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(
        screenshot_path,
        media_type=screenshot.content_type,
        filename=screenshot.file_name,
    )


@router.patch("/{feedback_id}/status", response_model=FeedbackPublic)
def update_feedback_status(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    feedback_id: uuid.UUID,
    status_in: FeedbackStatusUpdate,
) -> Any:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="Not enough permissions")

    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    feedback.status = status_in.status
    feedback.updated_at = _utcnow()

    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    user = session.get(User, feedback.user_id)
    return _feedback_public(feedback, user)
