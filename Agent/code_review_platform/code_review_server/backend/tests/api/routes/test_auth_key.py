import uuid

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models import AuthSource, User, UserApiKey, UserRole


def test_cch_user_and_plaintext_api_key_can_be_persisted(db: Session) -> None:
    user = User(
        full_name="CCH User",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.cch,
        cch_user_id=1001,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=2001,
        key="sk-cch-local-test",
        name="Desktop Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    saved = db.exec(select(UserApiKey).where(UserApiKey.key == "sk-cch-local-test")).one()

    assert saved.id
    assert saved.user_id == user.id
    assert saved.cch_key_id == 2001
    assert saved.is_active is True
    assert saved.last_synced_at is not None
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_local_svn_user_does_not_require_email_or_hashed_password(db: Session) -> None:
    user = User(
        full_name="SVN User",
        svn_username=f"svn-{uuid.uuid4()}",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.local,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.id
    assert user.auth_source == AuthSource.local
    assert user.cch_user_id is None


def test_duplicate_plaintext_api_keys_are_rejected(db: Session) -> None:
    user = User(
        full_name="Duplicate Key User",
        auth_source=AuthSource.cch,
        cch_user_id=3001,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(
        UserApiKey(
            user_id=user.id,
            cch_key_id=30001,
            key="sk-cch-duplicate-test",
        )
    )
    db.commit()

    db.add(
        UserApiKey(
            user_id=user.id,
            cch_key_id=30002,
            key="sk-cch-duplicate-test",
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    else:
        db.rollback()
        raise AssertionError("Duplicate plaintext API keys should be rejected")
