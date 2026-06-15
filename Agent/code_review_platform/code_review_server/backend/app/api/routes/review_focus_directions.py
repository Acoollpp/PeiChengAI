import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    Department,
    Message,
    ReviewFocusDirection,
    ReviewFocusDirectionCreate,
    ReviewFocusDirectionPublic,
    ReviewFocusDirectionsPublic,
    ReviewFocusDirectionUpdate,
    ReviewFocusDirectionUsageStatPublic,
    ReviewFocusDirectionUsageStatsPublic,
    ReviewTask,
    get_datetime_utc,
)

router = APIRouter(
    prefix="/review-focus-directions",
    tags=["review-focus-directions"],
)


def _ensure_admin(current_user: CurrentUser) -> None:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")


def _normalize_content(content: str) -> str:
    return re.sub(r"\s+", " ", content.strip())


def _get_direction_or_404(
    *, session: SessionDep, direction_id: uuid.UUID
) -> ReviewFocusDirection:
    direction = session.get(ReviewFocusDirection, direction_id)
    if direction is None:
        raise HTTPException(status_code=404, detail="重点审查方向不存在")
    return direction


def _get_department_or_400(
    *, session: SessionDep, department_id: uuid.UUID | None
) -> Department | None:
    if department_id is None:
        return None
    department = session.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=400, detail="部门不存在")
    return department


def _direction_public(
    direction: ReviewFocusDirection,
    department: Department | None = None,
) -> ReviewFocusDirectionPublic:
    return ReviewFocusDirectionPublic.model_validate(
        direction,
        update={"department_name": department.name if department else None},
    )


def _create_direction(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_in: ReviewFocusDirectionCreate,
    normalize_content: bool = False,
) -> ReviewFocusDirectionPublic:
    department = _get_department_or_400(
        session=session,
        department_id=direction_in.department_id,
    )
    content = (
        _normalize_content(direction_in.content)
        if normalize_content
        else direction_in.content
    )
    direction = ReviewFocusDirection.model_validate(
        direction_in,
        update={
            "content": content,
            "department_id": direction_in.department_id,
            "created_by_user_id": current_user.id,
            "updated_at": get_datetime_utc(),
        },
    )
    session.add(direction)
    session.commit()
    session.refresh(direction)
    return _direction_public(direction, department)


@router.get(
    "",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionsPublic,
)
def read_review_focus_directions(
    session: SessionDep,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    count_statement = select(func.count()).select_from(ReviewFocusDirection)
    count = session.exec(count_statement).one()
    statement = (
        select(ReviewFocusDirection, Department)
        .join(
            Department,
            ReviewFocusDirection.department_id == Department.id,
            isouter=True,
        )
        .order_by(col(ReviewFocusDirection.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    rows = session.exec(statement).all()
    return ReviewFocusDirectionsPublic(
        data=[
            _direction_public(direction, department)
            for direction, department in rows
        ],
        count=count,
    )


@router.post(
    "",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionPublic,
)
def create_review_focus_direction(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_in: ReviewFocusDirectionCreate,
) -> Any:
    return _create_direction(
        session=session,
        current_user=current_user,
        direction_in=direction_in,
    )


@router.get(
    "/usage-stats",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionUsageStatsPublic,
)
def read_usage_stats(session: SessionDep) -> Any:
    rows = session.exec(
        select(
            ReviewTask.focus_direction_snapshot,
            ReviewTask.created_at,
            ReviewTask.department_name,
        ).where(ReviewTask.focus_direction_snapshot.is_not(None))
    ).all()
    stats: dict[str, dict[str, Any]] = {}
    for snapshot, created_at, department_name in rows:
        if snapshot is None:
            continue
        content = _normalize_content(snapshot)
        if not content:
            continue
        stat = stats.setdefault(
            content,
            {
                "usage_count": 0,
                "latest_used_at": None,
                "departments": set(),
            },
        )
        stat["usage_count"] += 1
        if created_at is not None and (
            stat["latest_used_at"] is None or created_at > stat["latest_used_at"]
        ):
            stat["latest_used_at"] = created_at
        if department_name:
            stat["departments"].add(department_name)

    data = [
        ReviewFocusDirectionUsageStatPublic(
            content=content,
            usage_count=stat["usage_count"],
            latest_used_at=stat["latest_used_at"],
            departments=sorted(stat["departments"]),
        )
        for content, stat in sorted(
            stats.items(),
            key=lambda item: (-item[1]["usage_count"], item[0]),
        )
    ]
    return ReviewFocusDirectionUsageStatsPublic(data=data, count=len(data))


@router.post(
    "/from-usage",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionPublic,
)
def create_review_focus_direction_from_usage(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_in: ReviewFocusDirectionCreate,
) -> Any:
    return _create_direction(
        session=session,
        current_user=current_user,
        direction_in=direction_in,
        normalize_content=True,
    )


@router.patch(
    "/{direction_id}",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionPublic,
)
def update_review_focus_direction(
    *,
    session: SessionDep,
    direction_id: uuid.UUID,
    direction_in: ReviewFocusDirectionUpdate,
) -> Any:
    direction = _get_direction_or_404(
        session=session,
        direction_id=direction_id,
    )
    direction_data = direction_in.model_dump(exclude_unset=True)
    if "department_id" in direction_data:
        department = _get_department_or_400(
            session=session,
            department_id=direction_data["department_id"],
        )
    elif direction.department_id is not None:
        department = session.get(Department, direction.department_id)
    else:
        department = None
    if direction_data:
        direction_data["updated_at"] = get_datetime_utc()
        direction.sqlmodel_update(direction_data)
        session.add(direction)
        session.commit()
        session.refresh(direction)
    return _direction_public(direction, department)


@router.delete(
    "/{direction_id}",
    dependencies=[Depends(_ensure_admin)],
    response_model=Message,
)
def delete_review_focus_direction(
    session: SessionDep,
    direction_id: uuid.UUID,
) -> Message:
    direction = _get_direction_or_404(
        session=session,
        direction_id=direction_id,
    )
    direction.is_active = False
    direction.updated_at = get_datetime_utc()
    session.add(direction)
    session.commit()
    return Message(message="重点审查方向已停用")
