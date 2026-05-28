import secrets
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app import crud
from app.api.deps import CurrentUser, SessionDep, get_current_active_admin
from app.core import security
from app.core.config import settings
from app.core.security import get_password_hash
from app.models import (
    Message,
    NewPassword,
    Token,
    User,
    UserPublic,
    UserRole,
    UserUpdate,
)
from app.services.credential_service import CredentialService
from app.utils import (
    generate_password_reset_token,
    generate_reset_password_email,
    send_email,
    verify_password_reset_token,
)

router = APIRouter(tags=["login"])


class SvnRegister(SQLModel):
    full_name: str = Field(max_length=255)
    svn_username: str = Field(max_length=255)
    svn_password: str


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


def _svn_account_email(svn_username: str) -> str:
    return f"{svn_username}@svn-users.invalid.example.com"


@router.post("/auth/register", response_model=AuthToken)
def register_svn_account(session: SessionDep, body: SvnRegister) -> AuthToken:
    """
    Register a user with SVN credentials.
    """
    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    existing_user = _get_svn_user(session, body.svn_username)
    if existing_user:
        existing_user.full_name = body.full_name
        session.add(existing_user)
        session.commit()
        credential_service.save_svn_password(
            session, existing_user.id, body.svn_password
        )
        return _create_auth_tokens(existing_user.id)

    user = User(
        email=_svn_account_email(body.svn_username),
        full_name=body.full_name,
        svn_username=body.svn_username,
        role=UserRole.user,
        is_active=True,
        hashed_password=get_password_hash(secrets.token_urlsafe(32)),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409, detail="SVN username already registered"
        )
    session.refresh(user)

    credential_service.save_svn_password(session, user.id, body.svn_password)

    return _create_auth_tokens(user.id)


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


@router.post("/login/access-token")
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=security.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    """
    Test access token
    """
    return current_user


@router.post("/password-recovery/{email}")
def recover_password(email: str, session: SessionDep) -> Message:
    """
    Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    # Always return the same response to prevent email enumeration attacks
    # Only send email if user actually exists
    if user:
        password_reset_token = generate_password_reset_token(email=email)
        email_data = generate_reset_password_email(
            email_to=user.email, email=email, token=password_reset_token
        )
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return Message(
        message="If that email is registered, we sent a password recovery link"
    )


@router.post("/reset-password/")
def reset_password(session: SessionDep, body: NewPassword) -> Message:
    """
    Reset password
    """
    email = verify_password_reset_token(token=body.token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid token")
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        # Don't reveal that the user doesn't exist - use same error as invalid token
        raise HTTPException(status_code=400, detail="Invalid token")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    user_in_update = UserUpdate(password=body.new_password)
    crud.update_user(
        session=session,
        db_user=user,
        user_in=user_in_update,
    )
    return Message(message="Password updated successfully")


@router.post(
    "/password-recovery-html-content/{email}",
    dependencies=[Depends(get_current_active_admin)],
    response_class=HTMLResponse,
)
def recover_password_html_content(email: str, session: SessionDep) -> Any:
    """
    HTML Content for Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this username does not exist in the system.",
        )
    password_reset_token = generate_password_reset_token(email=email)
    email_data = generate_reset_password_email(
        email_to=user.email, email=email, token=password_reset_token
    )

    return HTMLResponse(
        content=email_data.html_content, headers={"subject:": email_data.subject}
    )
