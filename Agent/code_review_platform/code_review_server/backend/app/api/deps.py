from collections.abc import Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import TokenPayload, User, UserRole

reusable_bearer = HTTPBearer()


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[HTTPAuthorizationCredentials, Depends(reusable_bearer)]


def get_current_user(session: SessionDep, credentials: TokenDep) -> User:
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY,
            algorithms=[security.ALGORITHM],
        )
        token_data = TokenPayload(**payload)
    except (InvalidTokenError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def has_platform_admin_privileges(user: User) -> bool:
    return user.role == UserRole.admin


def has_admin_privileges(user: User) -> bool:
    return has_platform_admin_privileges(user)


def has_department_admin_privileges(user: User) -> bool:
    return user.role == UserRole.department_admin and user.department_id is not None


def has_management_role(user: User) -> bool:
    return user.role in {UserRole.admin, UserRole.department_admin}


def has_management_privileges(user: User) -> bool:
    return has_platform_admin_privileges(user) or has_department_admin_privileges(user)


def ensure_department_admin_has_department(user: User) -> None:
    if user.role == UserRole.department_admin and user.department_id is None:
        raise HTTPException(
            status_code=403,
            detail="当前账号未绑定部门，请联系超级管理员。",
        )


def get_current_active_admin(current_user: CurrentUser) -> User:
    if not has_platform_admin_privileges(current_user):
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def get_current_active_management_user(current_user: CurrentUser) -> User:
    if current_user.role == UserRole.department_admin:
        ensure_department_admin_has_department(current_user)
        return current_user
    if not has_platform_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="没有足够权限")
    return current_user


get_current_active_superuser = get_current_active_admin
