import re
import uuid
from io import BytesIO
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import delete, or_
from sqlmodel import col, exists, func, select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    ensure_department_admin_has_department,
    has_admin_privileges,
)
from app.models import (
    Department,
    DepartmentPublic,
    Message,
    ReviewFocusDirection,
    ReviewFocusDirectionCreate,
    ReviewFocusDirectionDepartment,
    ReviewFocusDirectionPublic,
    ReviewFocusDirectionsPublic,
    ReviewFocusDirectionUpdate,
    ReviewFocusDirectionUsageState,
    ReviewFocusDirectionUsageStateUpdate,
    ReviewFocusDirectionUsageStatPublic,
    ReviewFocusDirectionUsageStatsPublic,
    ReviewTask,
    UserRole,
    get_datetime_utc,
)

router = APIRouter(
    prefix="/review-focus-directions",
    tags=["review-focus-directions"],
)


def _ensure_admin(current_user: CurrentUser) -> None:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")


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


def _ensure_management_user(*, session: SessionDep, current_user: CurrentUser) -> None:
    if current_user.role == UserRole.department_admin:
        _ensure_department_admin_active_department(
            session=session,
            current_user=current_user,
        )
        return
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")


def _ensure_department_admin_direction_input(
    *, current_user: CurrentUser, department_ids: list[uuid.UUID]
) -> None:
    if current_user.role != UserRole.department_admin:
        return
    ensure_department_admin_has_department(current_user)
    unique_department_ids = list(dict.fromkeys(department_ids))
    if unique_department_ids != [current_user.department_id]:
        raise HTTPException(status_code=403, detail="只能维护本部门审查方向。")


def _is_single_department_direction_for_current_user(
    *, current_user: CurrentUser, departments: list[Department]
) -> bool:
    return (
        current_user.role == UserRole.department_admin
        and len(departments) == 1
        and departments[0].id == current_user.department_id
    )


def _ensure_department_admin_can_maintain_direction(
    *, current_user: CurrentUser, departments: list[Department]
) -> None:
    if current_user.role != UserRole.department_admin:
        return
    if not _is_single_department_direction_for_current_user(
        current_user=current_user,
        departments=departments,
    ):
        raise HTTPException(
            status_code=403,
            detail="共享方向只能由超级管理员维护。",
        )


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


def _department_ids_from_input(
    direction_in: ReviewFocusDirectionCreate | ReviewFocusDirectionUpdate,
) -> list[uuid.UUID] | None:
    if direction_in.department_ids is not None:
        return direction_in.department_ids
    if direction_in.department_id is not None:
        return [direction_in.department_id]
    return None


def _get_departments_or_400(
    *, session: SessionDep, department_ids: list[uuid.UUID]
) -> list[Department]:
    unique_department_ids = list(dict.fromkeys(department_ids))
    if not unique_department_ids:
        return []
    departments = session.exec(
        select(Department).where(col(Department.id).in_(unique_department_ids))
    ).all()
    if len({department.id for department in departments}) != len(unique_department_ids):
        raise HTTPException(status_code=400, detail="部门不存在")
    department_map = {department.id: department for department in departments}
    return [department_map[department_id] for department_id in unique_department_ids]


def _replace_direction_departments(
    *,
    session: SessionDep,
    direction: ReviewFocusDirection,
    departments: list[Department],
) -> None:
    session.exec(
        delete(ReviewFocusDirectionDepartment).where(
            ReviewFocusDirectionDepartment.direction_id == direction.id
        )
    )
    for department in departments:
        session.add(
            ReviewFocusDirectionDepartment(
                direction_id=direction.id,
                department_id=department.id,
            )
        )
    direction.department_id = departments[0].id if len(departments) == 1 else None


def _departments_by_direction(
    *, session: SessionDep, direction_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Department]]:
    if not direction_ids:
        return {}
    rows = session.exec(
        select(ReviewFocusDirectionDepartment.direction_id, Department)
        .join(
            Department,
            ReviewFocusDirectionDepartment.department_id == Department.id,
        )
        .where(col(ReviewFocusDirectionDepartment.direction_id).in_(direction_ids))
        .order_by(col(Department.name).asc())
    ).all()
    result: dict[uuid.UUID, list[Department]] = {}
    for direction_id, department in rows:
        result.setdefault(direction_id, []).append(department)
    return result


def _direction_public(
    direction: ReviewFocusDirection,
    departments: list[Department] | None = None,
    usage_count: int | None = None,
) -> ReviewFocusDirectionPublic:
    departments = departments or []
    legacy_department = departments[0] if len(departments) == 1 else None
    update: dict[str, Any] = {
        "department_id": legacy_department.id if legacy_department else None,
        "department_name": legacy_department.name if legacy_department else None,
        "departments": [
            DepartmentPublic.model_validate(department) for department in departments
        ],
    }
    if usage_count is not None:
        update["usage_count"] = usage_count
    return ReviewFocusDirectionPublic.model_validate(
        direction,
        update=update,
    )


def _usage_count_by_content(
    *,
    session: SessionDep,
    contents: list[str],
    department_id: uuid.UUID | None = None,
) -> dict[str, int]:
    normalized_contents = {
        normalized_content
        for content in contents
        if (normalized_content := _normalize_content(content))
    }
    if not normalized_contents:
        return {}

    statement = select(ReviewTask.focus_direction_snapshot).where(
        ReviewTask.focus_direction_snapshot.is_not(None)
    )
    if department_id is not None:
        statement = statement.where(ReviewTask.department_id == department_id)
    rows = session.exec(statement).all()
    usage_counts = dict.fromkeys(normalized_contents, 0)
    for snapshot in rows:
        if snapshot is None:
            continue
        normalized_snapshot = _normalize_content(snapshot)
        if normalized_snapshot in usage_counts:
            usage_counts[normalized_snapshot] += 1
    return usage_counts


def _create_direction(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_in: ReviewFocusDirectionCreate,
    normalize_content: bool = False,
) -> ReviewFocusDirectionPublic:
    department_ids = _department_ids_from_input(direction_in) or []
    _ensure_department_admin_direction_input(
        current_user=current_user,
        department_ids=department_ids,
    )
    departments = _get_departments_or_400(
        session=session, department_ids=department_ids
    )
    content = (
        _normalize_content(direction_in.content)
        if normalize_content
        else direction_in.content
    )
    direction_data = direction_in.model_dump(
        exclude={"department_ids"},
    )
    direction = ReviewFocusDirection.model_validate(
        direction_data,
        update={
            "content": content,
            "department_id": departments[0].id if len(departments) == 1 else None,
            "created_by_user_id": current_user.id,
            "updated_at": get_datetime_utc(),
        },
    )
    session.add(direction)
    session.flush()
    _replace_direction_departments(
        session=session,
        direction=direction,
        departments=departments,
    )
    session.commit()
    session.refresh(direction)
    return _direction_public(direction, departments)


def _normalize_search(search: str | None) -> str:
    return search.strip() if search else ""


@router.get(
    "",
    response_model=ReviewFocusDirectionsPublic,
)
def read_review_focus_directions(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_active: bool | None = None,
) -> Any:
    _ensure_management_user(session=session, current_user=current_user)
    if department_scope not in {"all", "global", "department"}:
        raise HTTPException(status_code=400, detail="部门范围参数不正确。")
    conditions = []
    normalized_search = _normalize_search(search)
    if normalized_search:
        pattern = f"%{normalized_search}%"
        conditions.append(
            or_(
                col(ReviewFocusDirection.title).ilike(pattern),
                col(ReviewFocusDirection.content).ilike(pattern),
            )
        )
    if is_active is not None:
        conditions.append(ReviewFocusDirection.is_active == is_active)
    if current_user.role == UserRole.department_admin:
        conditions.append(
            exists().where(
                (ReviewFocusDirectionDepartment.direction_id == ReviewFocusDirection.id)
                & (
                    ReviewFocusDirectionDepartment.department_id
                    == current_user.department_id
                )
            )
        )
    elif department_scope == "global":
        conditions.append(
            ~exists().where(
                ReviewFocusDirectionDepartment.direction_id == ReviewFocusDirection.id
            )
        )
    elif department_scope == "department":
        if department_id is None:
            raise HTTPException(status_code=400, detail="部门筛选必须选择部门。")
        conditions.append(
            exists().where(
                (ReviewFocusDirectionDepartment.direction_id == ReviewFocusDirection.id)
                & (ReviewFocusDirectionDepartment.department_id == department_id)
            )
        )

    count_statement = select(func.count()).select_from(ReviewFocusDirection)
    if conditions:
        count_statement = count_statement.where(*conditions)
    count = session.exec(count_statement).one()
    statement = (
        select(ReviewFocusDirection)
        .order_by(col(ReviewFocusDirection.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    if conditions:
        statement = statement.where(*conditions)
    directions = session.exec(statement).all()
    departments = _departments_by_direction(
        session=session,
        direction_ids=[direction.id for direction in directions],
    )
    usage_counts = _usage_count_by_content(
        session=session,
        contents=[direction.content for direction in directions],
        department_id=(
            current_user.department_id
            if current_user.role == UserRole.department_admin
            else None
        ),
    )
    return ReviewFocusDirectionsPublic(
        data=[
            _direction_public(
                direction,
                departments.get(direction.id, []),
                usage_count=usage_counts.get(_normalize_content(direction.content), 0),
            )
            for direction in directions
        ],
        count=count,
    )


@router.post(
    "",
    response_model=ReviewFocusDirectionPublic,
)
def create_review_focus_direction(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_in: ReviewFocusDirectionCreate,
) -> Any:
    _ensure_management_user(session=session, current_user=current_user)
    return _create_direction(
        session=session,
        current_user=current_user,
        direction_in=direction_in,
    )


def _build_usage_stats(
    *,
    session: SessionDep,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_used: bool | None = None,
) -> list[ReviewFocusDirectionUsageStatPublic]:
    if department_scope == "department" and department_id is None:
        raise HTTPException(status_code=400, detail="部门筛选必须选择部门。")
    if department_scope not in {"all", "global", "department"}:
        raise HTTPException(status_code=400, detail="部门范围参数不正确。")

    normalized_search = _normalize_search(search).lower()
    rows = session.exec(
        select(
            ReviewTask.focus_direction_snapshot,
            ReviewTask.created_at,
            ReviewTask.department_id,
            ReviewTask.department_name,
        ).where(ReviewTask.focus_direction_snapshot.is_not(None))
    ).all()
    stats: dict[str, dict[str, Any]] = {}
    for snapshot, created_at, row_department_id, department_name in rows:
        if snapshot is None:
            continue
        content = _normalize_content(snapshot)
        if not content:
            continue
        if normalized_search and normalized_search not in content.lower():
            continue
        if department_scope == "global" and row_department_id is not None:
            continue
        if (
            department_scope == "department"
            and department_id is not None
            and row_department_id != department_id
        ):
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

    states: dict[str, ReviewFocusDirectionUsageState] = {}
    if stats:
        state_rows = session.exec(
            select(ReviewFocusDirectionUsageState).where(
                col(ReviewFocusDirectionUsageState.normalized_content).in_(stats.keys())
            )
        ).all()
        states = {state.normalized_content: state for state in state_rows}

    data = []
    for content, stat in stats.items():
        state = states.get(content)
        used = state.is_used if state is not None else False
        if is_used is not None and used != is_used:
            continue
        data.append(
            ReviewFocusDirectionUsageStatPublic(
                content=content,
                usage_count=stat["usage_count"],
                latest_used_at=stat["latest_used_at"],
                departments=sorted(stat["departments"]),
                is_used=used,
            )
        )
    return sorted(data, key=lambda item: (-item.usage_count, item.content))


@router.get(
    "/usage-stats",
    dependencies=[Depends(_ensure_admin)],
    response_model=ReviewFocusDirectionUsageStatsPublic,
)
def read_usage_stats(
    session: SessionDep,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_used: bool | None = None,
) -> Any:
    data = _build_usage_stats(
        session=session,
        search=search,
        department_scope=department_scope,
        department_id=department_id,
        is_used=is_used,
    )
    return ReviewFocusDirectionUsageStatsPublic(data=data, count=len(data))


@router.patch(
    "/usage-stats/state",
    dependencies=[Depends(_ensure_admin)],
    response_model=Message,
)
def update_usage_state(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    state_in: ReviewFocusDirectionUsageStateUpdate,
) -> Message:
    content = _normalize_content(state_in.content)
    if not content:
        raise HTTPException(status_code=400, detail="用户输入内容不能为空。")
    state = session.exec(
        select(ReviewFocusDirectionUsageState).where(
            ReviewFocusDirectionUsageState.normalized_content == content
        )
    ).first()
    now = get_datetime_utc()
    if state is None:
        state = ReviewFocusDirectionUsageState(
            normalized_content=content,
            is_used=state_in.is_used,
            updated_by_user_id=current_user.id,
            created_at=now,
            updated_at=now,
        )
    else:
        state.is_used = state_in.is_used
        state.updated_by_user_id = current_user.id
        state.updated_at = now
    session.add(state)
    session.commit()
    return Message(message="使用状态更新成功")


@router.get(
    "/usage-stats/export",
    dependencies=[Depends(_ensure_admin)],
)
def export_usage_stats(
    session: SessionDep,
    search: str | None = None,
    department_scope: str = "all",
    department_id: uuid.UUID | None = None,
    is_used: bool | None = None,
) -> StreamingResponse:
    stats = _build_usage_stats(
        session=session,
        search=search,
        department_scope=department_scope,
        department_id=department_id,
        is_used=is_used,
    )
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "用户输入统计"
    sheet.append(["内容", "使用次数", "涉及部门", "最新使用时间", "是否已使用"])
    for stat in stats:
        sheet.append(
            [
                stat.content,
                stat.usage_count,
                "、".join(stat.departments) if stat.departments else "全局",
                stat.latest_used_at.isoformat() if stat.latest_used_at else "",
                "已使用" if stat.is_used else "未使用",
            ]
        )
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    file_name = (
        f"重点审查方向用户输入统计_{get_datetime_utc().strftime('%Y%m%d_%H%M%S')}.xlsx"
    )
    return StreamingResponse(
        output,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(file_name)}"
        },
    )


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
    response_model=ReviewFocusDirectionPublic,
)
def update_review_focus_direction(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    direction_id: uuid.UUID,
    direction_in: ReviewFocusDirectionUpdate,
) -> Any:
    _ensure_management_user(session=session, current_user=current_user)
    direction = _get_direction_or_404(
        session=session,
        direction_id=direction_id,
    )
    current_departments = _departments_by_direction(
        session=session,
        direction_ids=[direction.id],
    ).get(direction.id, [])
    _ensure_department_admin_can_maintain_direction(
        current_user=current_user,
        departments=current_departments,
    )
    direction_data = direction_in.model_dump(exclude_unset=True)
    department_input_was_set = (
        "department_ids" in direction_data or "department_id" in direction_data
    )
    if department_input_was_set:
        department_ids = _department_ids_from_input(direction_in) or []
        _ensure_department_admin_direction_input(
            current_user=current_user,
            department_ids=department_ids,
        )
        departments = _get_departments_or_400(
            session=session,
            department_ids=department_ids,
        )
    else:
        departments = current_departments
    if direction_data:
        direction_data.pop("department_ids", None)
        if department_input_was_set:
            direction_data["department_id"] = (
                departments[0].id if len(departments) == 1 else None
            )
        direction_data["updated_at"] = get_datetime_utc()
        direction.sqlmodel_update(direction_data)
        session.add(direction)
        if department_input_was_set:
            _replace_direction_departments(
                session=session,
                direction=direction,
                departments=departments,
            )
        session.commit()
        session.refresh(direction)
    return _direction_public(direction, departments)


@router.delete(
    "/{direction_id}",
    response_model=Message,
)
def delete_review_focus_direction(
    session: SessionDep,
    current_user: CurrentUser,
    direction_id: uuid.UUID,
) -> Message:
    _ensure_management_user(session=session, current_user=current_user)
    direction = _get_direction_or_404(
        session=session,
        direction_id=direction_id,
    )
    departments = _departments_by_direction(
        session=session,
        direction_ids=[direction.id],
    ).get(direction.id, [])
    _ensure_department_admin_can_maintain_direction(
        current_user=current_user,
        departments=departments,
    )
    direction.is_active = False
    direction.updated_at = get_datetime_utc()
    session.add(direction)
    session.commit()
    return Message(message="重点审查方向已停用")
