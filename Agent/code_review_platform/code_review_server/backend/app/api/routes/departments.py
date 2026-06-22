import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, exists, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    Department,
    DepartmentCreate,
    DepartmentPublic,
    DepartmentsPublic,
    DepartmentUpdate,
    Message,
    ReviewFocusDirection,
    ReviewFocusDirectionDepartment,
    ReviewTask,
    User,
)

router = APIRouter(prefix="/departments", tags=["departments"])


def _ensure_admin(current_user: CurrentUser) -> None:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")


def _get_department_or_404(
    *, session: SessionDep, department_id: uuid.UUID
) -> Department:
    department = session.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="部门不存在")
    return department


def _ensure_department_name_available(
    *,
    session: SessionDep,
    name: str | None,
    department_id: uuid.UUID | None = None,
) -> None:
    if name is None:
        return
    existing_department = session.exec(
        select(Department).where(Department.name == name)
    ).first()
    if existing_department is not None and existing_department.id != department_id:
        raise HTTPException(status_code=409, detail="部门名称已存在")


def _has_department_links(*, session: SessionDep, department_id: uuid.UUID) -> bool:
    checks = (
        exists().where(col(User.department_id) == department_id),
        exists().where(col(ReviewTask.department_id) == department_id),
        exists().where(col(ReviewFocusDirection.department_id) == department_id),
        exists().where(
            col(ReviewFocusDirectionDepartment.department_id) == department_id
        ),
    )
    return any(session.exec(select(check)).one() for check in checks)


@router.get(
    "",
    dependencies=[Depends(_ensure_admin)],
    response_model=DepartmentsPublic,
)
def read_departments(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count_statement = select(func.count()).select_from(Department)
    count = session.exec(count_statement).one()
    statement = (
        select(Department)
        .order_by(col(Department.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    departments = session.exec(statement).all()
    return DepartmentsPublic(
        data=[
            DepartmentPublic.model_validate(department)
            for department in departments
        ],
        count=count,
    )


@router.get("/available", response_model=DepartmentsPublic)
def read_available_departments(session: SessionDep) -> Any:
    statement = (
        select(Department)
        .where(Department.is_active == True)  # noqa: E712
        .order_by(col(Department.name).asc())
    )
    departments = session.exec(statement).all()
    return DepartmentsPublic(
        data=[
            DepartmentPublic.model_validate(department)
            for department in departments
        ],
        count=len(departments),
    )


@router.post(
    "",
    dependencies=[Depends(_ensure_admin)],
    response_model=DepartmentPublic,
)
def create_department(*, session: SessionDep, department_in: DepartmentCreate) -> Any:
    _ensure_department_name_available(session=session, name=department_in.name)
    department = Department.model_validate(department_in)
    session.add(department)
    session.commit()
    session.refresh(department)
    return department


@router.patch(
    "/{department_id}",
    dependencies=[Depends(_ensure_admin)],
    response_model=DepartmentPublic,
)
def update_department(
    *,
    session: SessionDep,
    department_id: uuid.UUID,
    department_in: DepartmentUpdate,
) -> Any:
    department = _get_department_or_404(
        session=session, department_id=department_id
    )
    _ensure_department_name_available(
        session=session,
        name=department_in.name,
        department_id=department_id,
    )
    department_data = department_in.model_dump(exclude_unset=True)
    if department_data:
        department_data["updated_at"] = datetime.now(timezone.utc)
        department.sqlmodel_update(department_data)
        session.add(department)
        session.commit()
        session.refresh(department)
    return department


@router.delete(
    "/{department_id}",
    dependencies=[Depends(_ensure_admin)],
    response_model=Message,
)
def delete_department(session: SessionDep, department_id: uuid.UUID) -> Message:
    department = _get_department_or_404(
        session=session, department_id=department_id
    )
    if _has_department_links(session=session, department_id=department_id):
        raise HTTPException(
            status_code=409,
            detail="该部门已关联用户、任务或重点审查方向，不能删除，请先停用。",
        )

    session.delete(department)
    session.commit()
    return Message(message="部门删除成功")
