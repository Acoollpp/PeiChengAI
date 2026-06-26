# Sub2API Key Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the existing CCH sync service so code_review can sync login identities from sub2api `api_keys` without losing local project data.

**Architecture:** Keep the existing admin API, settings, database models, and login flow. Add a sub2api parser path inside `CchSyncService.fetch_rows()` that treats each `api_keys` row as one upstream identity, then reuse `sync_rows()` with generated `CchUserRow` and `CchKeyRow` values. Preserve old CCH parsing for existing tests and compatibility.

**Tech Stack:** Python, FastAPI service layer, SQLModel, SQLAlchemy inspector/text queries, pytest.

---

## File Structure

- Modify `code_review_server/backend/app/services/cch_sync_service.py`
  - Add `SUB2API_CCH_ID_OFFSET`.
  - Detect sub2api `users` + `api_keys` table shape.
  - Parse sub2api `api_keys` as identity rows.
  - Add status parsing helpers for `status='active'`.
  - Make sub2api rows preserve local roles for existing users.
- Modify `code_review_server/backend/tests/services/test_cch_sync_service.py`
  - Add SQLite schema tests for sub2api shape.
  - Add sync tests for multiple keys owned by one sub2api admin user.
  - Add data preservation tests for SVN username, department, credentials, and review tasks.

No Alembic migration is needed because existing `User` and `UserApiKey` fields are reused.

## Task 1: Sub2API Fetch Parsing Tests

**Files:**
- Modify: `code_review_server/backend/tests/services/test_cch_sync_service.py`
- Modify in implementation: `code_review_server/backend/app/services/cch_sync_service.py`

- [ ] **Step 1: Write failing fetch test for sub2api key-owned identities**

Append this test after `test_fetch_rows_supports_cch_users_keys_schema`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_fetch_rows_supports_sub2api_api_keys_as_user_identities -q
```

Expected: FAIL because `CchSyncService.SUB2API_CCH_ID_OFFSET` and sub2api parsing do not exist.

- [ ] **Step 3: Implement sub2api fetch parsing**

In `code_review_server/backend/app/services/cch_sync_service.py`, add the constant inside the class:

```python
class CchSyncService:
    SUB2API_CCH_ID_OFFSET = 9_000_000_000
```

Replace the body of `fetch_rows()` with table-shape detection:

```python
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

                if self._is_sub2api_schema(user_table, key_table, user_columns, key_columns):
                    key_rows = [
                        self._parse_sub2api_key_row(dict(row._mapping))
                        for row in connection.execute(
                            text(
                                f'SELECT id, user_id, key, name, status, deleted_at, expires_at '
                                f'FROM "{key_table}" ORDER BY id'
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
```

Add helpers near `_first_existing_table()`:

```python
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
            and {"id", "email", "username", "status", "deleted_at"}.issubset(user_columns)
            and {"id", "user_id", "key", "name", "status", "deleted_at", "expires_at"}.issubset(key_columns)
        )

    def _parse_sub2api_key_row(self, row: dict[str, Any]) -> CchKeyRow:
        key_id = int(self._value(row, "id"))
        name = str(self._value(row, "name")).strip()
        key = str(self._value(row, "key")).strip()
        return CchKeyRow(
            cch_key_id=key_id,
            cch_user_id=self.SUB2API_CCH_ID_OFFSET + key_id,
            key=key,
            name=name,
            is_active=self._status_is_active(self._value(row, "status", required=False)),
            is_deleted=self._value(row, "deleted_at", required=False) is not None,
            expires_at=self._datetime(self._value(row, "expires_at", required=False)),
        )

    def _status_is_active(self, value: Any) -> bool:
        if value is None:
            return True
        return str(value).strip().lower() == "active"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_fetch_rows_supports_sub2api_api_keys_as_user_identities -q
```

Expected: PASS.

- [ ] **Step 5: Run old CCH fetch compatibility test**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_fetch_rows_supports_cch_users_keys_schema -q
```

Expected: PASS.

## Task 2: Sub2API Sync Behavior Tests

**Files:**
- Modify: `code_review_server/backend/tests/services/test_cch_sync_service.py`
- Modify in implementation: `code_review_server/backend/app/services/cch_sync_service.py`

- [ ] **Step 1: Write failing sync test for multiple keys owned by one sub2api user**

Append:

```python
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
```

- [ ] **Step 2: Run test**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_sync_sub2api_key_rows_create_distinct_users -q
```

Expected: PASS after Task 1, because `sync_rows()` can reuse generated distinct `CchUserRow` values.

- [ ] **Step 3: Write failing test that sub2api sync preserves local role and department**

Append:

```python
def test_sync_sub2api_rows_preserves_local_permissions_and_department(db: Session) -> None:
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
```

- [ ] **Step 4: Run preservation test**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_sync_sub2api_rows_preserves_local_permissions_and_department -q
```

Expected: PASS with existing department-admin preservation behavior.

## Task 3: Preserve SVN Credentials and Review Tasks

**Files:**
- Modify: `code_review_server/backend/tests/services/test_cch_sync_service.py`

- [ ] **Step 1: Add imports for data preservation test**

Change imports near the top:

```python
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
```

- [ ] **Step 2: Write preservation test**

Append:

```python
def test_sync_sub2api_rows_preserves_svn_credential_and_review_tasks(db: Session) -> None:
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
```

- [ ] **Step 3: Run preservation test**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_sync_sub2api_rows_preserves_svn_credential_and_review_tasks -q
```

Expected: PASS, confirming sync does not delete or reassign local business data.

## Task 4: Skip Invalid Sub2API Key Rows Safely

**Files:**
- Modify: `code_review_server/backend/tests/services/test_cch_sync_service.py`
- Modify: `code_review_server/backend/app/services/cch_sync_service.py`

- [ ] **Step 1: Write failing tests for blank name and blank key**

Append:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_parse_sub2api_key_row_rejects_blank_name_or_key -q
```

Expected: FAIL because `_parse_sub2api_key_row()` does not validate blank strings yet.

- [ ] **Step 3: Add validation**

Update `_parse_sub2api_key_row()`:

```python
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
            is_active=self._status_is_active(self._value(row, "status", required=False)),
            is_deleted=self._value(row, "deleted_at", required=False) is not None,
            expires_at=self._datetime(self._value(row, "expires_at", required=False)),
        )
```

- [ ] **Step 4: Run validation test**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py::test_parse_sub2api_key_row_rejects_blank_name_or_key -q
```

Expected: PASS.

## Task 5: Full Service Verification

**Files:**
- Verify: `code_review_server/backend/tests/services/test_cch_sync_service.py`

- [ ] **Step 1: Run focused service tests**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py -q
```

Expected: all tests in the file PASS.

- [ ] **Step 2: Run related auth CRUD tests**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/crud/test_user.py -q
```

Expected: PASS. This verifies `UserApiKey` lookup and key login prerequisites still work.

- [ ] **Step 3: Check git diff**

Run:

```bash
git diff -- code_review_server/backend/app/services/cch_sync_service.py code_review_server/backend/tests/services/test_cch_sync_service.py
```

Expected:

- No changes outside sync service and tests.
- No complete Key values added to docs or error messages beyond synthetic test values.
- No delete logic introduced.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add code_review_server/backend/app/services/cch_sync_service.py code_review_server/backend/tests/services/test_cch_sync_service.py
git commit -m "支持同步 Sub2API Key 用户"
```

Expected: commit succeeds on `main` with only implementation files staged.

## Self-Review

- Spec coverage: Tasks cover sub2api schema detection, Key主表同步,姓名来自 `api_keys.name`, Key来自 `api_keys.key`, stable derived local users, local data preservation, status handling, and old CCH compatibility.
- Placeholder scan: no placeholder steps remain.
- Type consistency: all tests use existing `CchUserRow`, `CchKeyRow`, `CchSyncService`, `User`, `UserApiKey`, `Department`, `UserSvnCredential`, and `ReviewTask` types already present in the backend.
