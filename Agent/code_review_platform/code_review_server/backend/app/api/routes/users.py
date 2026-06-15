import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, delete, func, or_, select, update

from app import crud
from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_admin,
    has_admin_privileges,
)
from app.models import (
    AuditLog,
    ClientRelease,
    Department,
    Feedback,
    Item,
    Message,
    ReviewTask,
    SkillPackage,
    User,
    UserApiKey,
    UserCreate,
    UserPublic,
    UserRole,
    UserSvnCredential,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)
from app.services import feedback_service

router = APIRouter(prefix="/users", tags=["users"])
logger = logging.getLogger(__name__)


def _user_public(user: User, department_name: str | None = None) -> UserPublic:
    return UserPublic.model_validate(
        user,
        update={"department_name": department_name},
    )


def _department_name_for_user(*, session: SessionDep, user: User) -> str | None:
    if user.department_id is None:
        return None
    department = session.get(Department, user.department_id)
    return department.name if department else None


def _department_names_by_id(
    *, session: SessionDep, department_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not department_ids:
        return {}
    departments = session.exec(
        select(Department).where(col(Department.id).in_(department_ids))
    ).all()
    return {department.id: department.name for department in departments}


def _ensure_department_exists(
    *, session: SessionDep, department_id: uuid.UUID | None
) -> Department | None:
    if department_id is None:
        return None
    department = session.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=400, detail="部门不存在")
    return department


def _ensure_svn_username_available(
    *, session: SessionDep, svn_username: str | None, user_id: uuid.UUID | None = None
) -> None:
    if not svn_username:
        return
    existing_user = crud.get_user_by_svn_username(
        session=session, svn_username=svn_username
    )
    if existing_user and existing_user.id != user_id:
        raise HTTPException(
            status_code=409, detail="User with this SVN username already exists"
        )


def _delete_user_with_related_data(*, session: SessionDep, user: User) -> None:
    feedback_ids = session.exec(
        select(Feedback.id).where(col(Feedback.user_id) == user.id)
    ).all()
    audit_actor_statement = (
        update(AuditLog)
        .where(col(AuditLog.actor_user_id) == user.id)
        .values(actor_user_id=None)
    )
    session.exec(audit_actor_statement)
    audit_target_statement = (
        update(AuditLog)
        .where(col(AuditLog.target_user_id) == user.id)
        .values(target_user_id=None)
    )
    session.exec(audit_target_statement)
    skill_package_statement = (
        update(SkillPackage)
        .where(col(SkillPackage.created_by_user_id) == user.id)
        .values(created_by_user_id=None)
    )
    session.exec(skill_package_statement)
    client_release_statement = (
        update(ClientRelease)
        .where(col(ClientRelease.created_by_user_id) == user.id)
        .values(created_by_user_id=None)
    )
    session.exec(client_release_statement)
    feedback_statement = delete(Feedback).where(col(Feedback.user_id) == user.id)
    session.exec(feedback_statement)
    review_task_statement = delete(ReviewTask).where(col(ReviewTask.user_id) == user.id)
    session.exec(review_task_statement)
    credential_statement = delete(UserSvnCredential).where(
        col(UserSvnCredential.user_id) == user.id
    )
    session.exec(credential_statement)
    api_key_statement = delete(UserApiKey).where(col(UserApiKey.user_id) == user.id)
    session.exec(api_key_statement)
    item_statement = delete(Item).where(col(Item.owner_id) == user.id)
    session.exec(item_statement)
    session.delete(user)
    session.commit()
    for feedback_id in feedback_ids:
        try:
            feedback_service.remove_feedback_files(feedback_id)
        except Exception as error:
            logger.warning(
                "Failed to remove feedback files for %s",
                feedback_id,
                exc_info=error,
            )


@router.get(
    "/",
    dependencies=[Depends(get_current_active_admin)],
    response_model=UsersPublic,
)
def read_users(
    session: SessionDep, skip: int = 0, limit: int = 100, search: str | None = None
) -> Any:
    """
    Retrieve users.
    """

    search_term = search.strip() if search else ""
    filters = []
    if search_term:
        search_pattern = f"%{search_term}%"
        search_filters = [
            col(User.full_name).ilike(search_pattern),
            col(User.svn_username).ilike(search_pattern),
        ]
        if search_term.isdigit():
            search_filters.append(User.cch_user_id == int(search_term))
        filters.append(or_(*search_filters))

    count_statement = select(func.count()).select_from(User).where(*filters)
    count = session.exec(count_statement).one()

    statement = (
        select(User)
        .where(*filters)
        .order_by(col(User.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    users = session.exec(statement).all()

    department_names = _department_names_by_id(
        session=session,
        department_ids={
            user.department_id for user in users if user.department_id is not None
        },
    )
    users_public = [
        _user_public(
            user,
            department_name=(
                department_names.get(user.department_id)
                if user.department_id is not None
                else None
            ),
        )
        for user in users
    ]
    return UsersPublic(data=users_public, count=count)


@router.post(
    "/", dependencies=[Depends(get_current_active_admin)], response_model=UserPublic
)
def create_user(*, session: SessionDep, user_in: UserCreate) -> Any:
    """
    Create new user.
    """
    _ensure_svn_username_available(
        session=session, svn_username=user_in.svn_username
    )
    department = _ensure_department_exists(
        session=session, department_id=user_in.department_id
    )
    user_in.is_superuser = user_in.role == UserRole.admin
    user = crud.create_user(session=session, user_create=user_in)
    return _user_public(
        user,
        department_name=department.name if department else None,
    )


@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    """
    Update own user.
    """
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return _user_public(
        current_user,
        department_name=_department_name_for_user(session=session, user=current_user),
    )


@router.get("/me", response_model=UserPublic)
def read_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return _user_public(
        current_user,
        department_name=_department_name_for_user(session=session, user=current_user),
    )


@router.delete("/me", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Delete own user.
    """
    if has_admin_privileges(current_user):
        raise HTTPException(
            status_code=403, detail="Admins are not allowed to delete themselves"
        )
    _delete_user_with_related_data(session=session, user=current_user)
    return Message(message="User deleted successfully")


@router.get("/{user_id}", response_model=UserPublic)
def read_user_by_id(
    user_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    """
    Get a specific user by id.
    """
    user = session.get(User, user_id)
    if user == current_user:
        return _user_public(
            current_user,
            department_name=_department_name_for_user(
                session=session, user=current_user
            ),
        )
    if not has_admin_privileges(current_user):
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_public(
        user,
        department_name=_department_name_for_user(session=session, user=user),
    )


@router.patch(
    "/{user_id}",
    dependencies=[Depends(get_current_active_admin)],
    response_model=UserPublic,
)
def update_user(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    user_in: UserUpdate,
) -> Any:
    """
    Update a user.
    """

    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    _ensure_svn_username_available(
        session=session, svn_username=user_in.svn_username, user_id=user_id
    )
    department = _ensure_department_exists(
        session=session, department_id=user_in.department_id
    )
    if user_in.role is not None:
        db_user.is_superuser = user_in.role == UserRole.admin

    db_user = crud.update_user(session=session, db_user=db_user, user_in=user_in)
    department_name = (
        department.name
        if department
        else _department_name_for_user(session=session, user=db_user)
    )
    return _user_public(db_user, department_name=department_name)


@router.delete("/{user_id}", dependencies=[Depends(get_current_active_admin)])
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    """
    Delete a user.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user == current_user:
        raise HTTPException(
            status_code=403, detail="Admins are not allowed to delete themselves"
        )
    _delete_user_with_related_data(session=session, user=user)
    return Message(message="User deleted successfully")
