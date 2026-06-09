import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    Feedback,
    FeedbackPublic,
    FeedbackScreenshot,
    FeedbackScreenshotPublic,
    FeedbacksPublic,
    FeedbackStatus,
    FeedbackStatusUpdate,
    User,
)
from app.services import feedback_service

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
    feedback = session.get(Feedback, feedback_id)
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

    if screenshot:
        try:
            screenshot_path, content = await feedback_service.save_screenshot(
                feedback.id, screenshot
            )
        except HTTPException:
            session.delete(feedback)
            session.commit()
            raise
        feedback.screenshot_path = str(screenshot_path)
        feedback.screenshot_name = screenshot.filename
        feedback.screenshot_content_type = screenshot.content_type
        feedback.screenshot_size = len(content)
        session.add(
            FeedbackScreenshot(
                feedback_id=feedback.id,
                file_path=str(screenshot_path),
                file_name=screenshot.filename or "screenshot.png",
                content_type=screenshot.content_type or "application/octet-stream",
                file_size=len(content),
                sort_order=0,
            )
        )

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
    screenshot_path = Path(feedback.screenshot_path) if feedback.screenshot_path else None
    if not screenshot_path or not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return FileResponse(
        screenshot_path,
        media_type=feedback.screenshot_content_type,
        filename=feedback.screenshot_name,
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
