from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import SessionDep
from app.models import AuthSource, User, UserPublic, UserRole

router = APIRouter(tags=["private"], prefix="/private")


class PrivateUserCreate(BaseModel):
    full_name: str | None = None
    svn_username: str | None = None
    is_superuser: bool = False


@router.post("/users/", response_model=UserPublic)
def create_user(user_in: PrivateUserCreate, session: SessionDep) -> Any:
    """
    Create a new user.
    """
    user = User(
        full_name=user_in.full_name,
        svn_username=user_in.svn_username,
        is_superuser=user_in.is_superuser,
        role=UserRole.admin if user_in.is_superuser else UserRole.user,
        auth_source=AuthSource.local,
    )

    session.add(user)
    session.commit()
    session.refresh(user)

    return user
