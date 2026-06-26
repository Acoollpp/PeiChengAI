from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlmodel import Session, col, delete, select

from app.models import (
    AuthSource,
    Department,
    ReviewTask,
    ReviewTaskStatus,
    User,
    UserApiKey,
    UserRole,
    UserSvnCredential,
)
from app.services.cch_sync_service import CchKeyRow, CchSyncService, CchUserRow
from tests.utils.utils import random_lower_string


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


def test_sync_rows_keeps_permanent_cch_admins_as_admin(db: Session) -> None:
    synced_at = datetime.now(timezone.utc)
    permanent_admin_user_ids = select(User.id).where(
        col(User.cch_user_id).in_([10, 102])
    )
    db.exec(delete(UserApiKey).where(col(UserApiKey.user_id).in_(permanent_admin_user_ids)))
    db.exec(delete(User).where(col(User.cch_user_id).in_([10, 102])))
    db.commit()

    CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(cch_user_id=10, full_name="张胜科", role="user"),
            CchUserRow(cch_user_id=102, full_name="杨慧城", role="user"),
        ],
        keys=[],
        synced_at=synced_at,
    )

    zhang = db.exec(select(User).where(User.cch_user_id == 10)).one()
    yang = db.exec(select(User).where(User.cch_user_id == 102)).one()

    assert zhang.role == UserRole.admin
    assert yang.role == UserRole.admin


def test_fetch_rows_supports_cch_users_keys_schema(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'cch.db'}"
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    role TEXT,
                    is_enabled BOOLEAN NOT NULL,
                    deleted_at TEXT,
                    expires_at TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE keys (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    name TEXT,
                    is_enabled BOOLEAN NOT NULL,
                    deleted_at TEXT,
                    expires_at TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO users (id, name, role, is_enabled, deleted_at, expires_at)
                VALUES (1, 'CCH User', 'admin', 0, '2026-06-01T00:00:00+00:00', NULL)
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO keys (id, user_id, key, name, is_enabled, deleted_at, expires_at)
                VALUES (10, 1, 'sk-real-cch', 'Default', 0, '2026-06-01T00:00:00+00:00', NULL)
                """
            )
        )

    try:
        users, keys = CchSyncService().fetch_rows(database_url)
    finally:
        engine.dispose()

    assert users[0].cch_user_id == 1
    assert users[0].full_name == "CCH User"
    assert users[0].role == "admin"
    assert users[0].is_active is False
    assert users[0].is_deleted is True
    assert keys[0].cch_key_id == 10
    assert keys[0].cch_user_id == 1
    assert keys[0].key == "sk-real-cch"
    assert keys[0].name == "Default"
    assert keys[0].is_active is False
    assert keys[0].is_deleted is True


def test_fetch_rows_supports_sub2api_api_keys_as_user_identities(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'sub2api.db'}"
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email TEXT NOT NULL,
                    username TEXT NOT NULL,
                    role TEXT NOT NULL,
                    status TEXT NOT NULL,
                    deleted_at TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE api_keys (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    deleted_at TEXT,
                    expires_at TEXT
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO users (id, email, username, role, status, deleted_at)
                VALUES
                    (1, 'admin@sub2api.local', '', 'admin', 'active', NULL),
                    (2, 'cch-10@import.cch.local', '张胜科', 'user', 'disabled', '2026-06-26T09:30:11+08:00')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO api_keys (id, user_id, key, name, status, deleted_at, expires_at)
                VALUES
                    (2, 1, 'sk-zhang', '张胜科', 'active', NULL, NULL),
                    (3, 1, 'sk-yang', '杨慧城', 'disabled', NULL, NULL),
                    (4, 1, 'sk-expired', '过期用户', 'active', NULL, '2026-06-01T00:00:00+00:00')
                """
            )
        )

    try:
        users, keys = CchSyncService().fetch_rows(database_url)
    finally:
        engine.dispose()

    offset = CchSyncService.SUB2API_CCH_ID_OFFSET
    assert [user.cch_user_id for user in users] == [offset + 2, offset + 3, offset + 4]
    assert [user.full_name for user in users] == ["张胜科", "杨慧城", "过期用户"]
    assert all(user.role == UserRole.user for user in users)
    assert all(user.is_active for user in users)
    assert [key.cch_key_id for key in keys] == [2, 3, 4]
    assert [key.cch_user_id for key in keys] == [offset + 2, offset + 3, offset + 4]
    assert [key.key for key in keys] == ["sk-zhang", "sk-yang", "sk-expired"]
    assert [key.name for key in keys] == ["张胜科", "杨慧城", "过期用户"]
    assert keys[0].is_active is True
    assert keys[1].is_active is False
    assert keys[2].expires_at == datetime(2026, 6, 1, tzinfo=timezone.utc)


def test_cch_sync_preserves_existing_department_admin_role_and_department(
    db: Session,
) -> None:
    department = Department(name=f"CCH部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    user = User(
        full_name="部门管理员",
        auth_source=AuthSource.cch,
        cch_user_id=9001,
        role=UserRole.department_admin,
        department_id=department.id,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    result = CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9001,
                full_name="同步后的姓名",
                role=UserRole.user,
                is_superuser=False,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert result.updated == 1
    assert user.role == UserRole.department_admin
    assert user.department_id == department.id
    assert user.is_superuser is False


def test_sync_sub2api_key_rows_create_distinct_users(db: Session) -> None:
    service = CchSyncService()
    synced_at = datetime.now(timezone.utc)
    users = [
        CchUserRow(
            cch_user_id=service.SUB2API_CCH_ID_OFFSET + 2,
            full_name="张胜科",
            role=UserRole.user,
        ),
        CchUserRow(
            cch_user_id=service.SUB2API_CCH_ID_OFFSET + 3,
            full_name="杨慧城",
            role=UserRole.user,
        ),
    ]
    keys = [
        CchKeyRow(
            cch_key_id=2,
            cch_user_id=service.SUB2API_CCH_ID_OFFSET + 2,
            key="sk-zhang",
            name="张胜科",
        ),
        CchKeyRow(
            cch_key_id=3,
            cch_user_id=service.SUB2API_CCH_ID_OFFSET + 3,
            key="sk-yang",
            name="杨慧城",
        ),
    ]

    result = service.sync_rows(db, users=users, keys=keys, synced_at=synced_at)

    zhang = db.exec(
        select(User).where(User.cch_user_id == service.SUB2API_CCH_ID_OFFSET + 2)
    ).one()
    yang = db.exec(
        select(User).where(User.cch_user_id == service.SUB2API_CCH_ID_OFFSET + 3)
    ).one()
    zhang_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 2)).one()
    yang_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 3)).one()

    assert result.created == 4
    assert zhang.id != yang.id
    assert zhang.full_name == "张胜科"
    assert yang.full_name == "杨慧城"
    assert zhang.role == UserRole.user
    assert yang.role == UserRole.user
    assert zhang_key.user_id == zhang.id
    assert yang_key.user_id == yang.id


def test_sync_sub2api_rows_preserves_local_permissions_and_department(
    db: Session,
) -> None:
    service = CchSyncService()
    department = Department(name=f"sub2api部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    user = User(
        full_name="旧姓名",
        auth_source=AuthSource.cch,
        cch_user_id=service.SUB2API_CCH_ID_OFFSET + 10,
        role=UserRole.department_admin,
        department_id=department.id,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    service.sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=service.SUB2API_CCH_ID_OFFSET + 10,
                full_name="新姓名",
                role=UserRole.user,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert user.full_name == "新姓名"
    assert user.role == UserRole.department_admin
    assert user.department_id == department.id
    assert user.is_superuser is False


def test_sync_sub2api_rows_preserves_svn_credential_and_review_tasks(
    db: Session,
) -> None:
    service = CchSyncService()
    synced_at = datetime.now(timezone.utc)
    user = User(
        full_name="旧姓名",
        auth_source=AuthSource.cch,
        cch_user_id=service.SUB2API_CCH_ID_OFFSET + 20,
        svn_username="svn-user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    credential = UserSvnCredential(
        user_id=user.id,
        encrypted_password="encrypted",
        encryption_version="v1",
    )
    task = ReviewTask(
        user_id=user.id,
        svn_url="svn://repo/project",
        old_revision="1",
        new_revision="2",
        status=ReviewTaskStatus.success,
    )
    db.add(credential)
    db.add(task)
    db.commit()
    db.refresh(task)

    service.sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=service.SUB2API_CCH_ID_OFFSET + 20,
                full_name="新姓名",
                role=UserRole.user,
            )
        ],
        keys=[
            CchKeyRow(
                cch_key_id=20,
                cch_user_id=service.SUB2API_CCH_ID_OFFSET + 20,
                key="sk-new",
                name="新姓名",
            )
        ],
        synced_at=synced_at,
    )

    db.refresh(user)
    db.refresh(credential)
    db.refresh(task)
    api_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 20)).one()

    assert user.full_name == "新姓名"
    assert user.svn_username == "svn-user"
    assert credential.user_id == user.id
    assert task.user_id == user.id
    assert api_key.user_id == user.id


def test_parse_sub2api_key_row_rejects_blank_name_or_key() -> None:
    service = CchSyncService()

    try:
        service._parse_sub2api_key_row(
            {
                "id": 1,
                "user_id": 1,
                "key": "sk-valid",
                "name": " ",
                "status": "active",
                "deleted_at": None,
                "expires_at": None,
            }
        )
    except ValueError as exc:
        assert "missing sub2api key name" in str(exc)
    else:
        raise AssertionError("blank sub2api key name should fail")

    try:
        service._parse_sub2api_key_row(
            {
                "id": 2,
                "user_id": 1,
                "key": " ",
                "name": "张胜科",
                "status": "active",
                "deleted_at": None,
                "expires_at": None,
            }
        )
    except ValueError as exc:
        assert "missing sub2api key value" in str(exc)
    else:
        raise AssertionError("blank sub2api key value should fail")


def test_cch_sync_normalizes_department_admin_when_source_provides_it() -> None:
    assert CchSyncService()._normalize_role("department_admin") == UserRole.department_admin


def test_cch_sync_aligns_is_superuser_with_final_role(db: Session) -> None:
    user = User(
        full_name="普通用户",
        auth_source=AuthSource.cch,
        cch_user_id=9002,
        role=UserRole.user,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9002,
                full_name="普通用户",
                role=UserRole.user,
                is_superuser=True,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert user.role == UserRole.user
    assert user.is_superuser is False


def test_cch_sync_creates_department_admin_from_source_role(db: Session) -> None:
    result = CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9003,
                full_name="新部门管理员",
                role="department_admin",
                is_superuser=True,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    user = db.exec(select(User).where(User.cch_user_id == 9003)).one()
    assert result.created == 1
    assert user.role == UserRole.department_admin
    assert user.is_superuser is False


def test_cch_sync_promotes_existing_department_admin_when_source_role_is_admin(
    db: Session,
) -> None:
    user = User(
        full_name="待升级部门管理员",
        auth_source=AuthSource.cch,
        cch_user_id=9004,
        role=UserRole.department_admin,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    CchSyncService().sync_rows(
        db,
        users=[
            CchUserRow(
                cch_user_id=9004,
                full_name="已升级管理员",
                role="admin",
                is_superuser=False,
            )
        ],
        keys=[],
        synced_at=datetime.now(timezone.utc),
    )

    db.refresh(user)
    assert user.role == UserRole.admin
    assert user.is_superuser is True
