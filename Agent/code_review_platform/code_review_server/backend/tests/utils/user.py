from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import AuthSource, User, UserApiKey, UserCreate, UserRole
from tests.utils.utils import auth_headers_for_user_id, random_lower_string


def user_authentication_headers(
    *,
    client: TestClient,
    key: str | None = None,
    user: User | None = None,
    user_id: object | None = None,
    email: str | None = None,
    password: str | None = None,
) -> dict[str, str]:
    if user_id is not None:
        return auth_headers_for_user_id(user_id)
    if user is not None:
        return auth_headers_for_user_id(user.id)

    with Session(engine) as session:
        if key is not None:
            api_key = crud.get_user_api_key_by_key(session=session, key=key)
            if not api_key:
                _, api_key = create_key_user(session, key=key)
            return auth_headers_for_user_id(api_key.user_id)

        user = create_random_user(session)
        return auth_headers_for_user_id(user.id)


def create_random_user(db: Session) -> User:
    user_in = UserCreate(
        full_name=f"User {random_lower_string()}",
        svn_username=f"svn-{random_lower_string()}",
        role=UserRole.user,
    )
    return crud.create_user(session=db, user_create=user_in)


def create_key_user(
    db: Session,
    *,
    key: str | None = None,
    cch_user_id: int | None = None,
    cch_key_id: int | None = None,
    is_active: bool = True,
) -> tuple[User, UserApiKey]:
    user = User(
        full_name=f"CCH User {random_lower_string()}",
        auth_source=AuthSource.cch,
        cch_user_id=cch_user_id,
        role=UserRole.user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=cch_key_id or 1000000 + abs(hash(user.id)) % 1000000,
        key=key or f"sk-test-{random_lower_string()}",
        name="Test Key",
        is_active=is_active,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return user, api_key


def authentication_token_from_key(
    *, client: TestClient, key: str, db: Session
) -> dict[str, str]:
    api_key = crud.get_user_api_key_by_key(session=db, key=key)
    if not api_key:
        _, api_key = create_key_user(db, key=key)
    return auth_headers_for_user_id(api_key.user_id)


def authentication_token_from_email(
    *, client: TestClient, email: str, db: Session
) -> dict[str, str]:
    user = create_random_user(db)
    return auth_headers_for_user_id(user.id)
