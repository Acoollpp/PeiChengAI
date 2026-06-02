from datetime import timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, SQLModel, select

from app.api.deps import CurrentUser, SessionDep
from app.core import security
from app.core.config import settings
from app.models import Token, User, UserPublic
from app.services.credential_service import CredentialService

router = APIRouter(tags=["login"])


class SvnLogin(SQLModel):
    svn_username: str
    svn_password: str


class AuthToken(Token):
    refresh_token: str


def _create_auth_tokens(user_id: Any) -> AuthToken:
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=30)
    return AuthToken(
        access_token=security.create_access_token(
            user_id, expires_delta=access_token_expires
        ),
        refresh_token=security.create_access_token(
            user_id, expires_delta=refresh_token_expires
        ),
    )


def _get_svn_user(session: Session, svn_username: str) -> User | None:
    return session.exec(
        select(User).where(User.svn_username == svn_username)
    ).first()


@router.post("/auth/login", response_model=AuthToken)
def login_svn_account(session: SessionDep, body: SvnLogin) -> AuthToken:
    """
    Authenticate with stored SVN credentials.
    """
    user = _get_svn_user(session, body.svn_username)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect SVN username or password")

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    svn_password = credential_service.get_svn_password(session, user.id)
    if svn_password != body.svn_password:
        raise HTTPException(status_code=401, detail="Incorrect SVN username or password")

    return _create_auth_tokens(user.id)


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    """
    Test access token.
    """
    return current_user
