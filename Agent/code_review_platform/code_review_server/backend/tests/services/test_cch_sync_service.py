from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models import AuthSource, User, UserApiKey, UserRole
from app.services.cch_sync_service import CchKeyRow, CchSyncService, CchUserRow


def test_sync_rows_creates_cch_user_and_key(db: Session) -> None:
    synced_at = datetime.now(timezone.utc)
    result = CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=101,
                full_name="CCH Admin",
                role="admin",
                is_superuser=True,
                is_active=True,
            )
        ],
        keys=[
            CchKeyRow(
                cch_key_id=201,
                cch_user_id=101,
                key="sk-cch-created",
                name="Desktop Key",
                is_active=True,
            )
        ],
        synced_at=synced_at,
    )

    user = db.exec(select(User).where(User.cch_user_id == 101)).one()
    api_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 201)).one()

    assert result.created == 2
    assert result.updated == 0
    assert result.disabled == 0
    assert user.auth_source == AuthSource.cch
    assert user.role == UserRole.admin
    assert user.is_superuser is True
    assert user.full_name == "CCH Admin"
    assert user.is_active is True
    assert user.disabled_reason is None
    assert user.last_synced_at == synced_at
    assert api_key.user_id == user.id
    assert api_key.key == "sk-cch-created"
    assert api_key.name == "Desktop Key"
    assert api_key.is_active is True
    assert api_key.disabled_reason is None
    assert api_key.last_synced_at == synced_at
    assert api_key.updated_at == synced_at


def test_sync_rows_disables_expired_key(db: Session) -> None:
    synced_at = datetime.now(timezone.utc)
    user = User(
        full_name="Existing CCH User",
        auth_source=AuthSource.cch,
        cch_user_id=102,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=202,
        key="sk-cch-expiring",
        name="Old Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    result = CchSyncService().sync_rows(
        db,
        users=[CchUserRow(cch_user_id=102, full_name="Existing CCH User")],
        keys=[
            CchKeyRow(
                cch_key_id=202,
                cch_user_id=102,
                key="sk-cch-expired",
                name="Expired Key",
                expires_at=synced_at - timedelta(seconds=1),
            )
        ],
        synced_at=synced_at,
    )

    db.refresh(api_key)
    assert result.disabled == 1
    assert api_key.key == "sk-cch-expired"
    assert api_key.name == "Expired Key"
    assert api_key.is_active is False
    assert api_key.disabled_reason == "key_expired"
    assert api_key.last_synced_at == synced_at
    assert api_key.updated_at == synced_at


def test_sync_rows_skips_key_for_missing_cch_user(db: Session) -> None:
    result = CchSyncService().sync_rows(
        db,
        users=[],
        keys=[CchKeyRow(cch_key_id=203, cch_user_id=99999, key="sk-cch-missing")],
        synced_at=datetime.now(timezone.utc),
    )

    assert result.skipped_records == 1
    assert "missing CCH user 99999" in result.errors[0]
    assert db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 203)).first() is None


def test_sync_rows_updates_existing_cch_user_and_disables_keys_for_disabled_user(
    db: Session,
) -> None:
    synced_at = datetime.now(timezone.utc)
    user = User(
        full_name="Before",
        is_active=True,
        auth_source=AuthSource.cch,
        cch_user_id=104,
        role=UserRole.user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=204,
        key="sk-cch-before",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    result = CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=104,
                full_name="After",
                role="admin",
                is_superuser=True,
                is_active=False,
            )
        ],
        keys=[
            CchKeyRow(
                cch_key_id=204,
                cch_user_id=104,
                key="sk-cch-after",
                is_active=True,
            )
        ],
        synced_at=synced_at,
    )

    db.refresh(user)
    db.refresh(api_key)
    assert result.updated == 2
    assert result.disabled == 2
    assert user.full_name == "After"
    assert user.role == UserRole.admin
    assert user.is_superuser is True
    assert user.is_active is False
    assert user.disabled_reason == "cch_user_disabled"
    assert api_key.is_active is False
    assert api_key.disabled_reason == "user_disabled"
