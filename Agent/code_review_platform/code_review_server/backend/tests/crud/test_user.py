import pytest
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session, delete, select

from app import crud
from app.core.config import settings
from app.core.db import init_db
from app.models import AuthSource, User, UserApiKey, UserCreate, UserRole, UserUpdate
from app.utils import generate_password_reset_token, send_email
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import random_email, random_lower_string


def test_create_user(db: Session) -> None:
    svn_username = f"svn-{random_lower_string()}"
    user_in = UserCreate(full_name="CRUD User", svn_username=svn_username)

    user = crud.create_user(session=db, user_create=user_in)

    assert user.id
    assert user.svn_username == svn_username
    assert user.full_name == "CRUD User"
    assert user.auth_source == AuthSource.local


def test_check_if_user_is_active(db: Session) -> None:
    user_in = UserCreate(full_name="Active User")

    user = crud.create_user(session=db, user_create=user_in)

    assert user.is_active is True


def test_check_if_user_is_active_inactive(db: Session) -> None:
    user_in = UserCreate(full_name="Inactive User", is_active=False)

    user = crud.create_user(session=db, user_create=user_in)

    assert user.is_active is False


def test_check_if_user_is_superuser(db: Session) -> None:
    user_in = UserCreate(full_name="Admin User", is_superuser=True)

    user = crud.create_user(session=db, user_create=user_in)

    assert user.is_superuser is True


def test_check_if_user_is_superuser_normal_user(db: Session) -> None:
    user_in = UserCreate(full_name="Normal User")

    user = crud.create_user(session=db, user_create=user_in)

    assert user.is_superuser is False


def test_get_user(db: Session) -> None:
    user_in = UserCreate(full_name="Stored User", is_superuser=True)
    user = crud.create_user(session=db, user_create=user_in)

    user_2 = db.get(User, user.id)

    assert user_2
    assert user.full_name == user_2.full_name
    assert jsonable_encoder(user) == jsonable_encoder(user_2)


def test_update_user(db: Session) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name="Before Update", role=UserRole.user),
    )
    svn_username = f"svn-{random_lower_string()}"
    user_in_update = UserUpdate(
        full_name="After Update", svn_username=svn_username, role=UserRole.admin
    )

    updated_user = crud.update_user(session=db, db_user=user, user_in=user_in_update)

    user_2 = db.get(User, user.id)
    assert user_2
    assert updated_user.full_name == "After Update"
    assert user_2.svn_username == svn_username
    assert user_2.role == UserRole.admin


def test_create_local_user_without_email(db: Session) -> None:
    user_in = UserCreate(
        full_name="Local User",
        svn_username=f"svn-{random_lower_string()}",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
    )

    user = crud.create_user(session=db, user_create=user_in)

    assert user.id
    assert user.auth_source == AuthSource.local
    assert user.full_name == "Local User"


def test_get_user_by_svn_username(db: Session) -> None:
    svn_username = f"svn-{random_lower_string()}"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(svn_username=svn_username, full_name="SVN User"),
    )

    found = crud.get_user_by_svn_username(session=db, svn_username=svn_username)

    assert found
    assert found.id == user.id


def test_get_user_by_cch_user_id(db: Session) -> None:
    cch_user_id = int(random_lower_string()[:8], 36) % 2_000_000_000
    user = User(
        full_name="CCH User",
        auth_source=AuthSource.cch,
        cch_user_id=cch_user_id,
        role=UserRole.user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    found = crud.get_user_by_cch_user_id(session=db, cch_user_id=cch_user_id)

    assert found
    assert found.id == user.id


def test_get_active_api_key_by_plaintext_key(db: Session) -> None:
    cch_key_id = int(random_lower_string()[:8], 36) % 2_000_000_000
    key = f"sk-crud-test-{random_lower_string()}"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name="Key User", role=UserRole.user),
    )
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=cch_key_id,
        key=key,
        name="CRUD Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    found = crud.get_user_api_key_by_key(session=db, key=key)

    assert found
    assert found.user_id == user.id


def test_get_user_api_key_by_cch_key_id(db: Session) -> None:
    cch_key_id = int(random_lower_string()[:8], 36) % 2_000_000_000
    key = f"sk-crud-cch-key-{random_lower_string()}"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name="CCH Key User", role=UserRole.user),
    )
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=cch_key_id,
        key=key,
        name="CRUD CCH Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    found = crud.get_user_api_key_by_cch_key_id(session=db, cch_key_id=cch_key_id)

    assert found
    assert found.id == api_key.id


def test_inactive_api_key_is_not_returned_by_plaintext_key(db: Session) -> None:
    cch_key_id = int(random_lower_string()[:8], 36) % 2_000_000_000
    key = f"sk-crud-inactive-{random_lower_string()}"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name="Inactive Key User", role=UserRole.user),
    )
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=cch_key_id,
        key=key,
        name="Inactive CRUD Key",
        is_active=False,
    )
    db.add(api_key)
    db.commit()

    found = crud.get_user_api_key_by_key(session=db, key=key)

    assert found is None


class RaisingClient:
    def post(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("test auth helpers must not call routes")


def test_authentication_token_from_email_uses_direct_jwt(db: Session) -> None:
    headers = authentication_token_from_email(
        client=RaisingClient(), email=random_email(), db=db
    )

    assert headers["Authorization"].startswith("Bearer ")


def test_email_utils_are_disabled_after_email_settings_removed() -> None:
    with pytest.raises(RuntimeError, match="Email delivery is disabled"):
        send_email(email_to="x@example.com")

    with pytest.raises(RuntimeError, match="Password reset email support is disabled"):
        generate_password_reset_token("x@example.com")


def test_init_db_creates_local_admin_without_svn_username(db: Session) -> None:
    db.exec(delete(User).where(User.is_superuser == True))
    db.exec(delete(User).where(User.full_name == settings.FIRST_SUPERUSER))
    db.exec(delete(User).where(User.svn_username == settings.FIRST_SUPERUSER))
    db.commit()

    init_db(db)

    user = db.exec(
        select(User).where(User.full_name == settings.FIRST_SUPERUSER)
    ).first()
    assert user
    assert user.svn_username is None
    assert user.is_active is True
    assert user.is_superuser is True
    assert user.role == UserRole.admin
    assert user.auth_source == AuthSource.local


def test_init_db_reuses_legacy_superuser_without_creating_duplicate(
    db: Session,
) -> None:
    db.exec(delete(User).where(User.is_superuser == True))
    db.exec(delete(User).where(User.full_name == settings.FIRST_SUPERUSER))
    db.exec(delete(User).where(User.svn_username == settings.FIRST_SUPERUSER))
    db.commit()

    legacy_user = User(
        full_name="Initial superuser",
        svn_username=settings.FIRST_SUPERUSER,
        is_active=True,
        is_superuser=True,
        role=UserRole.admin,
        auth_source=AuthSource.local,
    )
    db.add(legacy_user)
    db.commit()
    db.refresh(legacy_user)

    init_db(db)

    superusers = db.exec(select(User).where(User.is_superuser == True)).all()
    assert len(superusers) == 1
    assert superusers[0].id == legacy_user.id
