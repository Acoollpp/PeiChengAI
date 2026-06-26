from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import create_engine, inspect, text
from sqlmodel import Session, select

from app.models import AuditLog, AuthSource, User, UserApiKey, UserRole

PERMANENT_ADMIN_CCH_USER_IDS = frozenset({10, 102})


@dataclass
class CchUserRow:
    cch_user_id: int
    full_name: str | None = None
    role: str | UserRole = UserRole.user
    is_superuser: bool = False
    is_active: bool = True
    is_deleted: bool = False
    expires_at: datetime | None = None


@dataclass
class CchKeyRow:
    cch_key_id: int
    cch_user_id: int
    key: str
    name: str | None = None
    is_active: bool = True
    is_deleted: bool = False
    expires_at: datetime | None = None


@dataclass
class CchSyncResult:
    created: int = 0
    updated: int = 0
    disabled: int = 0
    skipped_records: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None


class CchSyncService:
    SUB2API_CCH_ID_OFFSET = 1_000_000_000
    RELOCATED_CCH_ID_OFFSET = 1_500_000_000

    def fetch_rows(self, database_url: str) -> tuple[list[CchUserRow], list[CchKeyRow]]:
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                inspector = inspect(connection)
                table_names = set(inspector.get_table_names())
                user_table = self._first_existing_table(
                    table_names, ("cch_user", "cch_users", "users", "user")
                )
                key_table = self._first_existing_table(
                    table_names,
                    ("cch_key", "cch_keys", "user_api_key", "api_keys", "keys"),
                )
                user_columns = self._table_columns(inspector, user_table)
                key_columns = self._table_columns(inspector, key_table)

                if self._is_sub2api_schema(
                    user_table, key_table, user_columns, key_columns
                ):
                    key_rows = [
                        self._parse_sub2api_key_row(dict(row._mapping))
                        for row in connection.execute(
                            text(
                                f"SELECT id, user_id, key, name, status, deleted_at, "
                                f'expires_at FROM "{key_table}" ORDER BY id'
                            )
                        )
                    ]
                    user_rows = [
                        CchUserRow(
                            cch_user_id=key_row.cch_user_id,
                            full_name=key_row.name,
                            role=UserRole.user,
                            is_active=True,
                        )
                        for key_row in key_rows
                    ]
                    return user_rows, key_rows

                user_rows = [
                    self._parse_user_row(dict(row._mapping))
                    for row in connection.execute(text(f'SELECT * FROM "{user_table}"'))
                ]
                key_rows = [
                    self._parse_key_row(dict(row._mapping))
                    for row in connection.execute(text(f'SELECT * FROM "{key_table}"'))
                ]
                return user_rows, key_rows
        finally:
            engine.dispose()

    def sync_from_database(
        self, session: Session, database_url: str, actor_user_id: UUID | None
    ) -> CchSyncResult:
        users, keys = self.fetch_rows(database_url)
        result = self.sync_rows(session, users, keys, datetime.now(timezone.utc))
        session.add(
            AuditLog(
                actor_user_id=actor_user_id,
                action="cch_users_synced",
                metadata_json={
                    "created": result.created,
                    "updated": result.updated,
                    "disabled": result.disabled,
                    "skipped_records": result.skipped_records,
                    "errors": result.errors,
                    "started_at": result.started_at.isoformat(),
                    "finished_at": result.finished_at.isoformat()
                    if result.finished_at
                    else None,
                },
            )
        )
        session.commit()
        return result

    def sync_rows(
        self,
        session: Session,
        users: list[CchUserRow],
        keys: list[CchKeyRow],
        synced_at: datetime,
    ) -> CchSyncResult:
        result = CchSyncResult(started_at=datetime.now(timezone.utc))
        users_by_cch_id: dict[int, User] = {}
        keys_by_cch_user_id = {key.cch_user_id: key for key in keys}

        for row in users:
            user = self._user_for_sync_row(
                session, row, keys_by_cch_user_id.get(row.cch_user_id)
            )
            disabled_reason = self._user_disabled_reason(row, synced_at)
            is_active = disabled_reason is None
            role = self._final_role_for_user(user, row)

            if user is None:
                user = User(cch_user_id=row.cch_user_id, auth_source=AuthSource.cch)
                session.add(user)
                result.created += 1
            else:
                result.updated += 1
                self._assign_user_cch_id(session, user, row.cch_user_id)

            if user.is_active and not is_active:
                result.disabled += 1

            user.auth_source = AuthSource.cch
            user.full_name = row.full_name
            user.role = role
            user.is_superuser = role == UserRole.admin
            user.is_active = is_active
            user.disabled_reason = disabled_reason
            user.last_synced_at = synced_at
            users_by_cch_id[row.cch_user_id] = user

        session.flush()

        for row in keys:
            user = users_by_cch_id.get(row.cch_user_id)
            if user is None:
                user = session.exec(
                    select(User).where(User.cch_user_id == row.cch_user_id)
                ).first()
            if user is None:
                result.skipped_records += 1
                result.errors.append(
                    f"key {row.cch_key_id} references missing CCH user {row.cch_user_id}"
                )
                continue

            api_key = self._api_key_for_sync_row(session, row)
            disabled_reason = self._key_disabled_reason(row, synced_at)
            if disabled_reason is None and not user.is_active:
                disabled_reason = "user_disabled"
            is_active = disabled_reason is None

            if api_key is None:
                api_key = UserApiKey(
                    user_id=user.id, cch_key_id=row.cch_key_id, key=row.key
                )
                session.add(api_key)
                result.created += 1
            else:
                result.updated += 1
                self._assign_api_key_cch_id(session, api_key, row.cch_key_id)

            if api_key.is_active and not is_active:
                result.disabled += 1

            api_key.user_id = user.id
            api_key.key = row.key
            api_key.name = row.name
            api_key.is_active = is_active
            api_key.disabled_reason = disabled_reason
            api_key.last_synced_at = synced_at
            api_key.updated_at = synced_at

        session.commit()
        result.finished_at = datetime.now(timezone.utc)
        return result

    def _first_existing_table(
        self, table_names: set[str], candidates: tuple[str, ...]
    ) -> str:
        for candidate in candidates:
            if candidate in table_names:
                return candidate
        raise RuntimeError(
            f"CCH database is missing expected tables: {', '.join(candidates)}"
        )

    def _table_columns(self, inspector: Any, table_name: str) -> set[str]:
        return {column["name"] for column in inspector.get_columns(table_name)}

    def _is_sub2api_schema(
        self,
        user_table: str,
        key_table: str,
        user_columns: set[str],
        key_columns: set[str],
    ) -> bool:
        return (
            user_table == "users"
            and key_table == "api_keys"
            and {"id", "email", "username", "status", "deleted_at"}.issubset(
                user_columns
            )
            and {
                "id",
                "user_id",
                "key",
                "name",
                "status",
                "deleted_at",
                "expires_at",
            }.issubset(key_columns)
        )

    def _parse_sub2api_key_row(self, row: dict[str, Any]) -> CchKeyRow:
        key_id = int(self._value(row, "id"))
        name = str(self._value(row, "name")).strip()
        key = str(self._value(row, "key")).strip()
        if not name:
            raise ValueError(f"missing sub2api key name for api_keys.id={key_id}")
        if not key:
            raise ValueError(f"missing sub2api key value for api_keys.id={key_id}")
        return CchKeyRow(
            cch_key_id=key_id,
            cch_user_id=self.SUB2API_CCH_ID_OFFSET + key_id,
            key=key,
            name=name,
            is_active=self._status_is_active(
                self._value(row, "status", required=False)
            ),
            is_deleted=self._value(row, "deleted_at", required=False) is not None,
            expires_at=self._datetime(self._value(row, "expires_at", required=False)),
        )

    def _is_sub2api_user_id(self, cch_user_id: int) -> bool:
        return cch_user_id >= self.SUB2API_CCH_ID_OFFSET

    def _user_for_sync_row(
        self, session: Session, row: CchUserRow, key_row: CchKeyRow | None
    ) -> User | None:
        if self._is_sub2api_user_id(row.cch_user_id) and key_row is not None:
            existing_key = session.exec(
                select(UserApiKey).where(UserApiKey.key == key_row.key)
            ).first()
            if existing_key is not None:
                return session.get(User, existing_key.user_id)
        return session.exec(
            select(User).where(User.cch_user_id == row.cch_user_id)
        ).first()

    def _api_key_for_sync_row(
        self, session: Session, row: CchKeyRow
    ) -> UserApiKey | None:
        if self._is_sub2api_user_id(row.cch_user_id):
            api_key = session.exec(
                select(UserApiKey).where(UserApiKey.key == row.key)
            ).first()
            if api_key is not None:
                return api_key

            target_holder = session.exec(
                select(UserApiKey).where(UserApiKey.cch_key_id == row.cch_key_id)
            ).first()
            if target_holder is not None:
                self._assign_api_key_cch_id(
                    session,
                    target_holder,
                    self._next_relocated_cch_key_id(session, row.cch_key_id),
                )
                session.flush()
            return None

        return session.exec(
            select(UserApiKey).where(UserApiKey.cch_key_id == row.cch_key_id)
        ).first()

    def _assign_user_cch_id(
        self, session: Session, user: User, cch_user_id: int
    ) -> None:
        if user.cch_user_id == cch_user_id:
            return
        existing = session.exec(
            select(User).where(User.cch_user_id == cch_user_id)
        ).first()
        if existing is not None and existing.id != user.id:
            existing.cch_user_id = self._next_relocated_user_cch_id(
                session, cch_user_id
            )
            session.add(existing)
            session.flush()
        user.cch_user_id = cch_user_id

    def _assign_api_key_cch_id(
        self, session: Session, api_key: UserApiKey, cch_key_id: int
    ) -> None:
        if api_key.cch_key_id == cch_key_id:
            return
        existing = session.exec(
            select(UserApiKey).where(UserApiKey.cch_key_id == cch_key_id)
        ).first()
        if existing is not None and existing.id != api_key.id:
            existing.cch_key_id = self._next_relocated_cch_key_id(session, cch_key_id)
            session.add(existing)
            session.flush()
        api_key.cch_key_id = cch_key_id

    def _next_relocated_user_cch_id(self, session: Session, source_id: int) -> int:
        candidate = self.RELOCATED_CCH_ID_OFFSET + (
            abs(source_id) % (self.SUB2API_CCH_ID_OFFSET // 2)
        )
        while session.exec(select(User).where(User.cch_user_id == candidate)).first():
            candidate += 1
        return candidate

    def _next_relocated_cch_key_id(self, session: Session, source_id: int) -> int:
        candidate = self.RELOCATED_CCH_ID_OFFSET + (
            abs(source_id) % (self.SUB2API_CCH_ID_OFFSET // 2)
        )
        while session.exec(
            select(UserApiKey).where(UserApiKey.cch_key_id == candidate)
        ).first():
            candidate += 1
        return candidate

    def _status_is_active(self, value: Any) -> bool:
        if value is None:
            return True
        return str(value).strip().lower() == "active"

    def _parse_user_row(self, row: dict[str, Any]) -> CchUserRow:
        return CchUserRow(
            cch_user_id=int(self._value(row, "cch_user_id", "id", "user_id")),
            full_name=self._value(row, "full_name", "name", "username", required=False),
            role=self._value(row, "role", required=False) or UserRole.user,
            is_superuser=self._bool(
                self._value(row, "is_superuser", "is_admin", required=False)
            ),
            is_active=self._bool(
                self._value(row, "is_active", "active", "is_enabled", required=False),
                default=True,
            ),
            is_deleted=self._bool(
                self._value(row, "is_deleted", "deleted", required=False)
            )
            or self._value(row, "deleted_at", required=False) is not None,
            expires_at=self._datetime(
                self._value(row, "expires_at", "expired_at", required=False)
            ),
        )

    def _parse_key_row(self, row: dict[str, Any]) -> CchKeyRow:
        return CchKeyRow(
            cch_key_id=int(self._value(row, "cch_key_id", "id", "key_id")),
            cch_user_id=int(self._value(row, "cch_user_id", "user_id")),
            key=str(self._value(row, "key", "api_key", "token")),
            name=self._value(row, "name", "key_name", required=False),
            is_active=self._bool(
                self._value(row, "is_active", "active", "is_enabled", required=False),
                default=True,
            ),
            is_deleted=self._bool(
                self._value(row, "is_deleted", "deleted", required=False)
            )
            or self._value(row, "deleted_at", required=False) is not None,
            expires_at=self._datetime(
                self._value(row, "expires_at", "expired_at", required=False)
            ),
        )

    def _value(self, row: dict[str, Any], *names: str, required: bool = True) -> Any:
        for name in names:
            if name in row:
                return row[name]
        if required:
            raise KeyError(f"missing CCH column: {'/'.join(names)}")
        return None

    def _bool(self, value: Any, *, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, str):
            return value.lower() in {"1", "true", "t", "yes", "y"}
        return bool(value)

    def _datetime(self, value: Any) -> datetime | None:
        if value is None or isinstance(value, datetime):
            return value
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return None

    def _is_expired(self, expires_at: datetime | None, synced_at: datetime) -> bool:
        if expires_at is None:
            return False
        if expires_at.tzinfo is None and synced_at.tzinfo is not None:
            expires_at = expires_at.replace(tzinfo=synced_at.tzinfo)
        if synced_at.tzinfo is None and expires_at.tzinfo is not None:
            synced_at = synced_at.replace(tzinfo=expires_at.tzinfo)
        return expires_at <= synced_at

    def _user_disabled_reason(self, row: CchUserRow, synced_at: datetime) -> str | None:
        if row.is_deleted:
            return "cch_user_deleted"
        if not row.is_active:
            return "cch_user_disabled"
        if self._is_expired(row.expires_at, synced_at):
            return "cch_user_expired"
        return None

    def _key_disabled_reason(self, row: CchKeyRow, synced_at: datetime) -> str | None:
        if row.is_deleted:
            return "key_deleted"
        if not row.is_active:
            return "key_disabled"
        if self._is_expired(row.expires_at, synced_at):
            return "key_expired"
        return None

    def _normalize_role(self, role: str | UserRole) -> UserRole:
        if isinstance(role, UserRole):
            return role
        if role == UserRole.admin.value:
            return UserRole.admin
        if role == UserRole.department_admin.value:
            return UserRole.department_admin
        return UserRole.user

    def _sync_role(self, row: CchUserRow) -> UserRole:
        if row.cch_user_id in PERMANENT_ADMIN_CCH_USER_IDS:
            return UserRole.admin
        return self._normalize_role(row.role)

    def _final_role_for_user(self, user: User | None, row: CchUserRow) -> UserRole:
        if user is not None and self._is_sub2api_user_id(row.cch_user_id):
            return user.role
        synced_role = self._sync_role(row)
        if user is not None and user.role == UserRole.department_admin:
            if synced_role == UserRole.user:
                return UserRole.department_admin
        return synced_role

    def result_to_dict(self, result: CchSyncResult) -> dict[str, Any]:
        return asdict(result)
