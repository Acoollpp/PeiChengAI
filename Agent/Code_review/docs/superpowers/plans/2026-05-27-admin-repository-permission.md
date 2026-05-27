# Admin Repository Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add temporary platform-side SVN repository permission management with admin pages, user authorization, and usage dashboard.

**Architecture:** Keep the existing FastAPI plus static frontend architecture. Add a repository catalog module for SVN prefix recognition, extend the repository layer for admin/user permission data, enforce permissions inside task creation, and add a static `/admin` page backed by `/api/admin/*` endpoints.

**Tech Stack:** Python 3, FastAPI, Pydantic, PostgreSQL through `psycopg`, in-memory test repository, static HTML/CSS/JavaScript, pytest.

---

## File Structure

- Create `app/repositories.py`: repository catalog, URL normalization, URL-to-repository matching, visible repository filtering.
- Modify `app/config.py`: add `admin_phones`.
- Modify `app/models.py`: add admin/user/repository request and response models.
- Modify `app/database.py`: add schema columns, user repository permission methods, admin dashboard queries, repository metadata on tasks.
- Modify `app/testing.py`: mirror new repository methods for unit/API tests.
- Modify `app/main.py`: add admin guards, repository list API, admin page route, admin APIs, task permission enforcement.
- Modify `static/index.html`: add admin entry and available repository helper area.
- Modify `static/app.js`: render admin entry, load available repositories, keep full SVN URL paste input, support prefix click.
- Create `static/admin.html`: admin console shell.
- Create `static/admin.js`: dashboard, user management, repository permission management.
- Modify `static/styles.css`: styles for repository helper, admin entry, admin console, CSS bar charts.
- Modify `tests/test_api.py`: backend permission, admin, dashboard tests.
- Modify `tests/test_frontend_static.py`: static markup and JavaScript behavior marker tests.
- Modify `tests/test_config.py`: `ADMIN_PHONES` parsing test.

## Task 1: Repository Catalog And URL Matching

**Files:**
- Create: `app/repositories.py`
- Test: `tests/test_validation.py`

- [ ] **Step 1: Write failing repository catalog tests**

Append these tests to `tests/test_validation.py`:

```python
from app.repositories import (
    PRODUCT_REPOSITORY_KEYS,
    PUBLIC_REPOSITORY_KEYS,
    RepositoryAccessError,
    match_repository_for_url,
    repositories_for_user,
)


def test_match_repository_for_full_product_url():
    match = match_repository_for_url(
        " https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T "
    )

    assert match.key == "home"
    assert match.name == "户储"
    assert match.url_prefix == "https://192.168.0.233/svn/src_home"


def test_match_repository_rejects_similar_prefix():
    try:
        match_repository_for_url("https://192.168.0.233/svn/src_home_other/project")
    except RepositoryAccessError as exc:
        assert str(exc) == "SVN 地址不属于已配置仓库"
    else:
        raise AssertionError("Expected RepositoryAccessError")


def test_repositories_for_user_includes_public_and_granted_products():
    repos = repositories_for_user({"home", "power"})
    keys = [repo.key for repo in repos]

    assert keys[:2] == list(PUBLIC_REPOSITORY_KEYS)
    assert "home" in keys
    assert "power" in keys
    assert "bs" not in keys
    assert set(PRODUCT_REPOSITORY_KEYS) >= {"energy", "home", "bs", "moto", "lcd", "linux", "pace_tools", "power"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_validation.py -v
```

Expected: FAIL because `app.repositories` does not exist.

- [ ] **Step 3: Implement repository catalog**

Create `app/repositories.py`:

```python
from __future__ import annotations

from dataclasses import dataclass


class RepositoryAccessError(ValueError):
    pass


@dataclass(frozen=True)
class RepositoryDefinition:
    key: str
    name: str
    url_prefix: str
    is_public: bool


REPOSITORIES: tuple[RepositoryDefinition, ...] = (
    RepositoryDefinition("public_repository", "公共仓库", "https://192.168.0.233/svn/02_public_repository", True),
    RepositoryDefinition("documents", "文档仓库", "https://192.168.0.233/svn/documents", True),
    RepositoryDefinition("energy", "高压", "https://192.168.0.233/svn/src_energy", False),
    RepositoryDefinition("home", "户储", "https://192.168.0.233/svn/src_home", False),
    RepositoryDefinition("bs", "基站", "https://192.168.0.233/svn/src_bs", False),
    RepositoryDefinition("moto", "动力", "https://192.168.0.233/svn/src_moto", False),
    RepositoryDefinition("lcd", "显示屏", "https://192.168.0.233/svn/src_lcd", False),
    RepositoryDefinition("linux", "Linux", "https://192.168.0.233/svn/src_linux", False),
    RepositoryDefinition("pace_tools", "上位机", "https://192.168.0.233/svn/src_PaceTools", False),
    RepositoryDefinition("power", "电源", "https://192.168.0.233/svn/src_power", False),
)

REPOSITORY_BY_KEY = {repo.key: repo for repo in REPOSITORIES}
PUBLIC_REPOSITORY_KEYS = tuple(repo.key for repo in REPOSITORIES if repo.is_public)
PRODUCT_REPOSITORY_KEYS = tuple(repo.key for repo in REPOSITORIES if not repo.is_public)


def match_repository_for_url(svn_url: str) -> RepositoryDefinition:
    normalized = svn_url.strip().rstrip("/")
    if not normalized.startswith("https://"):
        raise RepositoryAccessError("SVN 地址必须使用 HTTPS")

    for repo in sorted(REPOSITORIES, key=lambda item: len(item.url_prefix), reverse=True):
        prefix = repo.url_prefix.rstrip("/")
        if normalized == prefix or normalized.startswith(f"{prefix}/"):
            return repo
    raise RepositoryAccessError("SVN 地址不属于已配置仓库")


def repositories_for_user(granted_keys: set[str]) -> list[RepositoryDefinition]:
    visible = []
    for repo in REPOSITORIES:
        if repo.is_public or repo.key in granted_keys:
            visible.append(repo)
    return visible


def validate_repository_keys(repository_keys: list[str] | set[str]) -> list[str]:
    unknown = sorted(set(repository_keys) - set(PRODUCT_REPOSITORY_KEYS))
    if unknown:
        raise RepositoryAccessError(f"未知产品仓库: {', '.join(unknown)}")
    return [key for key in PRODUCT_REPOSITORY_KEYS if key in set(repository_keys)]
```

- [ ] **Step 4: Run catalog tests**

Run:

```powershell
python -m uv run pytest tests/test_validation.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/repositories.py tests/test_validation.py
git commit -m "feat: add svn repository catalog"
```

## Task 2: Config And Session User Model

**Files:**
- Modify: `app/config.py`
- Modify: `app/models.py`
- Test: `tests/test_config.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing config and session tests**

Append to `tests/test_config.py`:

```python
def test_admin_phones_are_parsed_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("ADMIN_PHONES", " 15866582922, 13800138000 ,,")

    from app.config import load_settings

    loaded = load_settings()

    assert loaded.admin_phones == ("15866582922", "13800138000")
```

Append to `tests/test_api.py`:

```python
def test_admin_phone_login_marks_user_as_admin(api_client):
    response = login(api_client, name="admin", phone="15866582922")

    assert response.status_code == 200
    assert response.json()["user"]["is_admin"] is True
    assert response.json()["user"]["is_active"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_config.py::test_admin_phones_are_parsed_from_environment tests/test_api.py::test_admin_phone_login_marks_user_as_admin -v
```

Expected: FAIL because `admin_phones`, `is_admin`, and `is_active` are not implemented.

- [ ] **Step 3: Add config field**

In `app/config.py`, add `admin_phones` to `Settings`:

```python
    admin_phones: tuple[str, ...]
```

Add helper:

```python
def _parse_csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())
```

In `load_settings()`, add:

```python
        admin_phones=_parse_csv(os.getenv("ADMIN_PHONES", "")),
```

- [ ] **Step 4: Extend user response model**

In `app/models.py`, update `UserResponse`:

```python
class UserResponse(BaseModel):
    user_id: str
    name: str
    phone: str
    is_admin: bool = False
    is_active: bool = True
```

- [ ] **Step 5: Make in-memory users carry admin and active flags**

In `app/testing.py`, update new user dict in `get_or_create_user`:

```python
        user = {
            "id": str(uuid.uuid4()),
            "name": name,
            "phone": phone,
            "is_admin": False,
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
        }
```

When returning existing user, preserve those fields. Add method:

```python
    def set_user_admin_if_phone_matches(self, phone: str, admin_phones: tuple[str, ...]) -> None:
        for user in self.users.values():
            if user["phone"] == phone and phone in admin_phones:
                user["is_admin"] = True
                user["updated_at"] = _utc_now()
```

- [ ] **Step 6: Make PostgreSQL users carry admin and active flags**

In `app/database.py`, add columns in `init_schema()` after `users` table creation:

```python
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE")
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")
```

Add method:

```python
    def set_user_admin_if_phone_matches(self, phone: str, admin_phones: tuple[str, ...]) -> None:
        if phone not in admin_phones:
            return
        now = _utc_now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET is_admin = TRUE,
                    updated_at = %(now)s
                WHERE phone = %(phone)s
                """,
                {"phone": phone, "now": now},
            )
```

- [ ] **Step 7: Update session creation and response mapping**

In `app/main.py`, after `user = repo.get_or_create_user(...)`, add:

```python
        repo.set_user_admin_if_phone_matches(phone, app_settings.admin_phones)
        user = repo.get_user(user["id"]) or user
```

Update `_to_user_response`:

```python
def _to_user_response(user: dict[str, Any]) -> UserResponse:
    return UserResponse(
        user_id=user["id"],
        name=user["name"],
        phone=user["phone"],
        is_admin=bool(user.get("is_admin", False)),
        is_active=bool(user.get("is_active", True)),
    )
```

- [ ] **Step 8: Run focused tests**

Run:

```powershell
python -m uv run pytest tests/test_config.py::test_admin_phones_are_parsed_from_environment tests/test_api.py::test_admin_phone_login_marks_user_as_admin -v
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add app/config.py app/models.py app/database.py app/testing.py app/main.py tests/test_config.py tests/test_api.py
git commit -m "feat: add admin identity flags"
```

## Task 3: Repository Permissions In Repository Layer

**Files:**
- Modify: `app/database.py`
- Modify: `app/testing.py`
- Test: `tests/test_database.py`

- [ ] **Step 1: Write failing repository-layer tests**

Append to `tests/test_database.py`:

```python
def test_repository_stores_user_repository_permissions(repository):
    user = repository.get_or_create_user(name="alice", phone="13800138000")

    repository.set_user_repository_permissions(user["id"], ["home", "power"])

    assert repository.list_user_repository_permissions(user["id"]) == ["home", "power"]


def test_repository_replaces_user_repository_permissions(repository):
    user = repository.get_or_create_user(name="alice", phone="13800138000")
    repository.set_user_repository_permissions(user["id"], ["home", "power"])

    repository.set_user_repository_permissions(user["id"], ["bs"])

    assert repository.list_user_repository_permissions(user["id"]) == ["bs"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_database.py::test_repository_stores_user_repository_permissions tests/test_database.py::test_repository_replaces_user_repository_permissions -v
```

Expected: FAIL because permission methods do not exist.

- [ ] **Step 3: Add PostgreSQL permission table and methods**

In `app/database.py`, import:

```python
from app.repositories import validate_repository_keys
```

In `init_schema()`, add:

```python
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_repository_permissions (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    repository_key TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY (user_id, repository_key)
                )
                """
            )
```

Add methods:

```python
    def list_user_repository_permissions(self, user_id: str) -> list[str]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT repository_key
                FROM user_repository_permissions
                WHERE user_id = %(user_id)s
                ORDER BY repository_key ASC
                """,
                {"user_id": user_id},
            ).fetchall()
        return [str(row["repository_key"]) for row in rows]

    def set_user_repository_permissions(self, user_id: str, repository_keys: list[str]) -> list[str]:
        safe_keys = validate_repository_keys(repository_keys)
        now = _utc_now()
        with self.database.connect() as connection:
            connection.execute(
                "DELETE FROM user_repository_permissions WHERE user_id = %(user_id)s",
                {"user_id": user_id},
            )
            for repository_key in safe_keys:
                connection.execute(
                    """
                    INSERT INTO user_repository_permissions (user_id, repository_key, created_at)
                    VALUES (%(user_id)s, %(repository_key)s, %(now)s)
                    """,
                    {"user_id": user_id, "repository_key": repository_key, "now": now},
                )
        return self.list_user_repository_permissions(user_id)
```

- [ ] **Step 4: Add in-memory permission methods**

In `app/testing.py`, add `self.repository_permissions` in `__init__`:

```python
        self.repository_permissions: dict[str, set[str]] = {}
```

Import:

```python
from app.repositories import validate_repository_keys
```

Add methods:

```python
    def list_user_repository_permissions(self, user_id: str) -> list[str]:
        return sorted(self.repository_permissions.get(user_id, set()))

    def set_user_repository_permissions(self, user_id: str, repository_keys: list[str]) -> list[str]:
        safe_keys = validate_repository_keys(repository_keys)
        self.repository_permissions[user_id] = set(safe_keys)
        return self.list_user_repository_permissions(user_id)
```

- [ ] **Step 5: Run repository tests**

Run:

```powershell
python -m uv run pytest tests/test_database.py::test_repository_stores_user_repository_permissions tests/test_database.py::test_repository_replaces_user_repository_permissions -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/database.py app/testing.py tests/test_database.py
git commit -m "feat: store repository permissions"
```

## Task 4: Enforce Repository Permissions On Task Creation

**Files:**
- Modify: `app/models.py`
- Modify: `app/database.py`
- Modify: `app/testing.py`
- Modify: `app/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing API permission tests**

Append to `tests/test_api.py`:

```python
PUBLIC_SVN_URL = "https://192.168.0.233/svn/documents/spec.md"
HOME_SVN_URL = "https://192.168.0.233/svn/src_home/project/trunk"
POWER_SVN_URL = "https://192.168.0.233/svn/src_power/project/trunk"


def test_public_repository_task_is_allowed_for_any_logged_in_user(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = create_task(api_client, svn_url=PUBLIC_SVN_URL)

    assert response.status_code == 200


def test_product_repository_task_requires_permission(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = create_task(api_client, svn_url=HOME_SVN_URL)

    assert response.status_code == 403
    assert response.json()["detail"] == "当前用户没有该 SVN 仓库权限"


def test_product_repository_task_is_allowed_when_granted(api_client, api_repository):
    login(api_client, name="alice", phone="13800138000")
    user = next(user for user in api_repository.users.values() if user["phone"] == "13800138000")
    api_repository.set_user_repository_permissions(user["id"], ["home"])

    response = create_task(api_client, svn_url=HOME_SVN_URL)

    assert response.status_code == 200
    task = api_repository.get_task(response.json()["task_id"])
    assert task["repository_key"] == "home"
    assert task["repository_name"] == "户储"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_public_repository_task_is_allowed_for_any_logged_in_user tests/test_api.py::test_product_repository_task_requires_permission tests/test_api.py::test_product_repository_task_is_allowed_when_granted -v
```

Expected: FAIL because task creation does not enforce repository permissions.

- [ ] **Step 3: Extend task model responses**

In `app/models.py`, add optional fields to `TaskResponse`:

```python
    repository_key: str | None = None
    repository_name: str | None = None
```

- [ ] **Step 4: Add task repository metadata fields**

In `app/database.py`, add columns in `init_schema()`:

```python
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_key TEXT")
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_name TEXT")
```

Update `create_task` signature:

```python
        repository_key: str | None = None,
        repository_name: str | None = None,
```

Update INSERT column list to include `repository_key, repository_name`, and values:

```sql
                    repository_key, repository_name
```

```sql
                    %(repository_key)s, %(repository_name)s
```

Add parameters:

```python
                    "repository_key": repository_key,
                    "repository_name": repository_name,
```

- [ ] **Step 5: Add in-memory task metadata fields**

In `app/testing.py`, update `create_task` signature with:

```python
        repository_key: str | None = None,
        repository_name: str | None = None,
```

Add fields to task dict:

```python
            "repository_key": repository_key,
            "repository_name": repository_name,
```

- [ ] **Step 6: Enforce permissions in task creation**

In `app/main.py`, import:

```python
from app.repositories import RepositoryAccessError, match_repository_for_url, repositories_for_user
```

Inside `create_task`, after revision validation and before `old_revision == new_revision`:

```python
        try:
            repository = match_repository_for_url(svn_url)
        except RepositoryAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        granted_keys = set(repo.list_user_repository_permissions(user["id"]))
        if not repository.is_public and repository.key not in granted_keys:
            raise HTTPException(status_code=403, detail="当前用户没有该 SVN 仓库权限")
```

Pass metadata to `repo.create_task`:

```python
            repository_key=repository.key,
            repository_name=repository.name,
```

Update `_to_task_response`:

```python
        repository_key=task.get("repository_key"),
        repository_name=task.get("repository_name"),
```

- [ ] **Step 7: Keep old prefix validation compatible**

In `app/main.py`, replace:

```python
            svn_url = validate_svn_url(request.svn_url, app_settings.svn_allowed_prefix)
```

with:

```python
            svn_url = request.svn_url.strip()
```

Keep revision normalization in the same `try`. Remove unused `validate_svn_url` import if no longer used.

- [ ] **Step 8: Run focused API tests**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_public_repository_task_is_allowed_for_any_logged_in_user tests/test_api.py::test_product_repository_task_requires_permission tests/test_api.py::test_product_repository_task_is_allowed_when_granted -v
```

Expected: PASS.

- [ ] **Step 9: Run existing task API tests and adjust fixtures**

Run:

```powershell
python -m uv run pytest tests/test_api.py -v
```

Expected: tests using `VALID_SVN_URL` may need repository permission. Update helper `create_logged_in_task` or individual tests to grant `home` before submitting product repository tasks, or change `VALID_SVN_URL` to a public repository URL where the specific test is not about product permissions.

- [ ] **Step 10: Commit**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: enforce svn repository permissions"
```

## Task 5: Available Repository API

**Files:**
- Modify: `app/models.py`
- Modify: `app/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing API tests**

Append to `tests/test_api.py`:

```python
def test_get_repositories_returns_public_and_granted_repositories(api_client, api_repository):
    login(api_client, name="alice", phone="13800138000")
    user = next(user for user in api_repository.users.values() if user["phone"] == "13800138000")
    api_repository.set_user_repository_permissions(user["id"], ["home"])

    response = api_client.get("/api/repositories")

    assert response.status_code == 200
    body = response.json()
    keys = [repo["key"] for repo in body]
    assert "public_repository" in keys
    assert "documents" in keys
    assert "home" in keys
    assert "power" not in keys


def test_get_repositories_requires_login(api_client):
    response = api_client.get("/api/repositories")

    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_get_repositories_returns_public_and_granted_repositories tests/test_api.py::test_get_repositories_requires_login -v
```

Expected: FAIL because `/api/repositories` does not exist.

- [ ] **Step 3: Add response model**

In `app/models.py`, add:

```python
class RepositoryResponse(BaseModel):
    key: str
    name: str
    url_prefix: str
    is_public: bool
```

- [ ] **Step 4: Add API endpoint**

In `app/main.py`, import `RepositoryResponse`. Add helper:

```python
def _to_repository_response(repository) -> RepositoryResponse:
    return RepositoryResponse(
        key=repository.key,
        name=repository.name,
        url_prefix=repository.url_prefix,
        is_public=repository.is_public,
    )
```

Add endpoint:

```python
    @app.get("/api/repositories", response_model=list[RepositoryResponse])
    def list_repositories(request: Request) -> list[RepositoryResponse]:
        user = current_user(request)
        granted_keys = set(repo.list_user_repository_permissions(user["id"]))
        return [_to_repository_response(item) for item in repositories_for_user(granted_keys)]
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_get_repositories_returns_public_and_granted_repositories tests/test_api.py::test_get_repositories_requires_login -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/models.py app/main.py tests/test_api.py
git commit -m "feat: expose available repositories"
```

## Task 6: Admin User APIs

**Files:**
- Modify: `app/models.py`
- Modify: `app/database.py`
- Modify: `app/testing.py`
- Modify: `app/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing admin user API tests**

Append to `tests/test_api.py`:

```python
def login_admin(client):
    return login(client, name="admin", phone="15866582922")


def test_admin_users_requires_admin(api_client):
    login(api_client, name="alice", phone="13800138000")

    response = api_client.get("/api/admin/users")

    assert response.status_code == 403


def test_admin_can_create_and_list_users(api_client):
    login_admin(api_client)

    create_response = api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    )
    list_response = api_client.get("/api/admin/users")

    assert create_response.status_code == 200
    assert create_response.json()["phone"] == "13900139000"
    assert list_response.status_code == 200
    assert any(user["phone"] == "13900139000" for user in list_response.json())


def test_admin_create_user_rejects_duplicate_phone(api_client):
    login_admin(api_client)
    payload = {"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True}
    assert api_client.post("/api/admin/users", json=payload).status_code == 200

    response = api_client.post("/api/admin/users", json=payload)

    assert response.status_code == 409


def test_admin_can_update_user(api_client):
    login_admin(api_client)
    created = api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    ).json()

    response = api_client.patch(
        f"/api/admin/users/{created['user_id']}",
        json={"name": "Bob Updated", "is_admin": True, "is_active": False},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Bob Updated"
    assert response.json()["is_admin"] is True
    assert response.json()["is_active"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_users_requires_admin tests/test_api.py::test_admin_can_create_and_list_users tests/test_api.py::test_admin_create_user_rejects_duplicate_phone tests/test_api.py::test_admin_can_update_user -v
```

Expected: FAIL because admin APIs do not exist.

- [ ] **Step 3: Add admin request/response models**

In `app/models.py`, add:

```python
class AdminUserCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    is_admin: bool = False
    is_active: bool = True


class AdminUserUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    is_admin: bool
    is_active: bool


class AdminUserResponse(BaseModel):
    user_id: str
    name: str
    phone: str
    is_admin: bool
    is_active: bool
    task_count: int = 0
```

- [ ] **Step 4: Add repository methods for users**

In `app/database.py`, add:

```python
    def list_users_with_task_counts(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT users.*, COUNT(tasks.id) AS task_count
                FROM users
                LEFT JOIN tasks ON tasks.user_id = users.id
                GROUP BY users.id
                ORDER BY users.created_at DESC, users.id DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def create_user(self, *, name: str, phone: str, is_admin: bool, is_active: bool) -> dict[str, Any] | None:
        now = _utc_now()
        user_id = str(uuid.uuid4())
        with self.database.connect() as connection:
            row = connection.execute(
                """
                INSERT INTO users (id, name, phone, is_admin, is_active, created_at, updated_at, last_seen_at)
                VALUES (%(id)s, %(name)s, %(phone)s, %(is_admin)s, %(is_active)s, %(now)s, %(now)s, %(now)s)
                ON CONFLICT (phone) DO NOTHING
                RETURNING *
                """,
                {"id": user_id, "name": name, "phone": phone, "is_admin": is_admin, "is_active": is_active, "now": now},
            ).fetchone()
        return dict(row) if row is not None else None

    def update_user(self, user_id: str, *, name: str, is_admin: bool, is_active: bool) -> dict[str, Any] | None:
        now = _utc_now()
        with self.database.connect() as connection:
            row = connection.execute(
                """
                UPDATE users
                SET name = %(name)s,
                    is_admin = %(is_admin)s,
                    is_active = %(is_active)s,
                    updated_at = %(now)s
                WHERE id = %(id)s
                RETURNING *
                """,
                {"id": user_id, "name": name, "is_admin": is_admin, "is_active": is_active, "now": now},
            ).fetchone()
        return dict(row) if row is not None else None
```

Add equivalent methods in `app/testing.py`.

- [ ] **Step 5: Add admin guards and APIs**

In `app/main.py`, import admin models. Add guard:

```python
    def current_admin_user(request: Request) -> dict[str, Any]:
        user = current_user(request)
        if not user.get("is_admin", False):
            raise HTTPException(status_code=403, detail="Admin permission required")
        return user
```

Update `current_user` to reject inactive users:

```python
        if not user.get("is_active", True):
            raise HTTPException(status_code=403, detail="Account is disabled")
```

Add helper:

```python
def _to_admin_user_response(user: dict[str, Any]) -> AdminUserResponse:
    return AdminUserResponse(
        user_id=user["id"],
        name=user["name"],
        phone=user["phone"],
        is_admin=bool(user.get("is_admin", False)),
        is_active=bool(user.get("is_active", True)),
        task_count=int(user.get("task_count", 0)),
    )
```

Add endpoints:

```python
    @app.get("/api/admin/users", response_model=list[AdminUserResponse])
    def admin_list_users(request: Request) -> list[AdminUserResponse]:
        current_admin_user(request)
        return [_to_admin_user_response(user) for user in repo.list_users_with_task_counts()]

    @app.post("/api/admin/users", response_model=AdminUserResponse)
    def admin_create_user(request_body: AdminUserCreateRequest, request: Request) -> AdminUserResponse:
        current_admin_user(request)
        try:
            phone = normalize_phone(request_body.phone)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        user = repo.create_user(
            name=request_body.name.strip(),
            phone=phone,
            is_admin=request_body.is_admin,
            is_active=request_body.is_active,
        )
        if user is None:
            raise HTTPException(status_code=409, detail="phone already exists")
        return _to_admin_user_response(user)

    @app.patch("/api/admin/users/{user_id}", response_model=AdminUserResponse)
    def admin_update_user(user_id: str, request_body: AdminUserUpdateRequest, request: Request) -> AdminUserResponse:
        current_admin_user(request)
        user = repo.update_user(
            user_id,
            name=request_body.name.strip(),
            is_admin=request_body.is_admin,
            is_active=request_body.is_active,
        )
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        return _to_admin_user_response(user)
```

- [ ] **Step 6: Run focused admin user tests**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_users_requires_admin tests/test_api.py::test_admin_can_create_and_list_users tests/test_api.py::test_admin_create_user_rejects_duplicate_phone tests/test_api.py::test_admin_can_update_user -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: add admin user management api"
```

## Task 7: Admin Repository Permission APIs

**Files:**
- Modify: `app/models.py`
- Modify: `app/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api.py`:

```python
def test_admin_can_get_and_set_user_repository_permissions(api_client):
    login_admin(api_client)
    user = api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    ).json()

    put_response = api_client.put(
        f"/api/admin/users/{user['user_id']}/repositories",
        json={"repository_keys": ["home", "power"]},
    )
    get_response = api_client.get(f"/api/admin/users/{user['user_id']}/repositories")

    assert put_response.status_code == 200
    assert put_response.json()["repository_keys"] == ["home", "power"]
    assert get_response.status_code == 200
    assert get_response.json()["repository_keys"] == ["home", "power"]


def test_admin_repository_permissions_reject_unknown_key(api_client):
    login_admin(api_client)
    user = api_client.post(
        "/api/admin/users",
        json={"name": "bob", "phone": "13900139000", "is_admin": False, "is_active": True},
    ).json()

    response = api_client.put(
        f"/api/admin/users/{user['user_id']}/repositories",
        json={"repository_keys": ["home", "missing"]},
    )

    assert response.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_can_get_and_set_user_repository_permissions tests/test_api.py::test_admin_repository_permissions_reject_unknown_key -v
```

Expected: FAIL because endpoints do not exist.

- [ ] **Step 3: Add models**

In `app/models.py`, add:

```python
class RepositoryPermissionUpdateRequest(BaseModel):
    repository_keys: list[str]


class RepositoryPermissionResponse(BaseModel):
    user_id: str
    repository_keys: list[str]
```

- [ ] **Step 4: Add endpoints**

In `app/main.py`, import `RepositoryAccessError`, `RepositoryPermissionResponse`, and `RepositoryPermissionUpdateRequest`. Add:

```python
    @app.get("/api/admin/users/{user_id}/repositories", response_model=RepositoryPermissionResponse)
    def admin_get_user_repositories(user_id: str, request: Request) -> RepositoryPermissionResponse:
        current_admin_user(request)
        if repo.get_user(user_id) is None:
            raise HTTPException(status_code=404, detail="User not found")
        return RepositoryPermissionResponse(
            user_id=user_id,
            repository_keys=repo.list_user_repository_permissions(user_id),
        )

    @app.put("/api/admin/users/{user_id}/repositories", response_model=RepositoryPermissionResponse)
    def admin_set_user_repositories(
        user_id: str,
        request_body: RepositoryPermissionUpdateRequest,
        request: Request,
    ) -> RepositoryPermissionResponse:
        current_admin_user(request)
        if repo.get_user(user_id) is None:
            raise HTTPException(status_code=404, detail="User not found")
        try:
            repository_keys = repo.set_user_repository_permissions(user_id, request_body.repository_keys)
        except RepositoryAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return RepositoryPermissionResponse(user_id=user_id, repository_keys=repository_keys)
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_can_get_and_set_user_repository_permissions tests/test_api.py::test_admin_repository_permissions_reject_unknown_key -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/models.py app/main.py tests/test_api.py
git commit -m "feat: add admin repository permission api"
```

## Task 8: Admin Dashboard API

**Files:**
- Modify: `app/models.py`
- Modify: `app/database.py`
- Modify: `app/testing.py`
- Modify: `app/main.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write failing dashboard tests**

Append to `tests/test_api.py`:

```python
def test_admin_dashboard_contains_user_usage_chart_data(api_client, api_repository):
    login_admin(api_client)
    alice = api_client.post(
        "/api/admin/users",
        json={"name": "alice", "phone": "13800138000", "is_admin": False, "is_active": True},
    ).json()
    api_repository.set_user_repository_permissions(alice["user_id"], ["home"])
    api_client.delete("/api/session")
    login(api_client, name="alice", phone="13800138000")
    assert create_task(api_client, svn_url=HOME_SVN_URL).status_code == 200
    assert create_task(api_client, svn_url=HOME_SVN_URL, old_revision="102", new_revision="103").status_code == 200
    api_client.delete("/api/session")
    login_admin(api_client)

    response = api_client.get("/api/admin/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert body["task_total"] >= 2
    assert any(item["phone"] == "13800138000" and item["task_count"] == 2 for item in body["user_usage"])
    assert any(item["repository_key"] == "home" and item["task_count"] == 2 for item in body["repository_usage"])
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_dashboard_contains_user_usage_chart_data -v
```

Expected: FAIL because dashboard API does not exist.

- [ ] **Step 3: Add dashboard models**

In `app/models.py`, add:

```python
class UserUsageResponse(BaseModel):
    user_id: str
    name: str
    phone: str
    task_count: int


class RepositoryUsageResponse(BaseModel):
    repository_key: str | None
    repository_name: str | None
    task_count: int


class AdminDashboardResponse(BaseModel):
    user_total: int
    admin_total: int
    active_user_total: int
    task_total: int
    today_task_total: int
    status_counts: dict[str, int]
    user_usage: list[UserUsageResponse]
    repository_usage: list[RepositoryUsageResponse]
    recent_tasks: list[TaskResponse]
```

- [ ] **Step 4: Add dashboard repository method**

In `app/testing.py`, implement with in-memory loops:

```python
    def get_admin_dashboard(self) -> dict[str, Any]:
        users = list(self.users.values())
        tasks = self._ordered_tasks()
        status_counts = {status.value: 0 for status in TaskStatus}
        for task in tasks:
            status_counts[task["status"].value] += 1
        usage = []
        for user in users:
            count = sum(1 for task in tasks if task["user_id"] == user["id"])
            usage.append({"user_id": user["id"], "name": user["name"], "phone": user["phone"], "task_count": count})
        usage.sort(key=lambda item: (-item["task_count"], item["name"]))
        repo_counts: dict[tuple[str | None, str | None], int] = {}
        for task in tasks:
            key = (task.get("repository_key"), task.get("repository_name"))
            repo_counts[key] = repo_counts.get(key, 0) + 1
        repository_usage = [
            {"repository_key": key, "repository_name": name, "task_count": count}
            for (key, name), count in repo_counts.items()
        ]
        repository_usage.sort(key=lambda item: (-item["task_count"], item["repository_key"] or ""))
        today = _utc_now().date()
        return {
            "user_total": len(users),
            "admin_total": sum(1 for user in users if user.get("is_admin", False)),
            "active_user_total": sum(1 for user in users if user.get("is_active", True)),
            "task_total": len(tasks),
            "today_task_total": sum(1 for task in tasks if task["created_at"].date() == today),
            "status_counts": status_counts,
            "user_usage": usage,
            "repository_usage": repository_usage,
            "recent_tasks": tasks[:10],
        }
```

For `app/database.py`, use SQL queries with the same return keys. Use `CURRENT_DATE` for `today_task_total` and group by `repository_key, repository_name`.

```python
    def get_admin_dashboard(self) -> dict[str, Any]:
        with self.database.connect() as connection:
            summary = connection.execute(
                """
                SELECT
                    COUNT(*) AS user_total,
                    COUNT(*) FILTER (WHERE is_admin = TRUE) AS admin_total,
                    COUNT(*) FILTER (WHERE is_active = TRUE) AS active_user_total
                FROM users
                """
            ).fetchone()
            task_summary = connection.execute(
                """
                SELECT
                    COUNT(*) AS task_total,
                    COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS today_task_total
                FROM tasks
                """
            ).fetchone()
            status_rows = connection.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM tasks
                GROUP BY status
                """
            ).fetchall()
            user_usage_rows = connection.execute(
                """
                SELECT users.id AS user_id, users.name, users.phone, COUNT(tasks.id) AS task_count
                FROM users
                LEFT JOIN tasks ON tasks.user_id = users.id
                GROUP BY users.id, users.name, users.phone
                ORDER BY task_count DESC, users.name ASC
                LIMIT 20
                """
            ).fetchall()
            repository_usage_rows = connection.execute(
                """
                SELECT repository_key, repository_name, COUNT(*) AS task_count
                FROM tasks
                GROUP BY repository_key, repository_name
                ORDER BY task_count DESC, repository_key ASC
                LIMIT 20
                """
            ).fetchall()
            recent_tasks = connection.execute(
                """
                SELECT *
                FROM tasks
                ORDER BY created_at DESC, id DESC
                LIMIT 10
                """
            ).fetchall()

        status_counts = {status.value: 0 for status in TaskStatus}
        for row in status_rows:
            status_counts[str(row["status"])] = int(row["count"])

        return {
            "user_total": int(summary["user_total"]),
            "admin_total": int(summary["admin_total"]),
            "active_user_total": int(summary["active_user_total"]),
            "task_total": int(task_summary["task_total"]),
            "today_task_total": int(task_summary["today_task_total"]),
            "status_counts": status_counts,
            "user_usage": [
                {
                    "user_id": row["user_id"],
                    "name": row["name"],
                    "phone": row["phone"],
                    "task_count": int(row["task_count"]),
                }
                for row in user_usage_rows
            ],
            "repository_usage": [
                {
                    "repository_key": row["repository_key"],
                    "repository_name": row["repository_name"],
                    "task_count": int(row["task_count"]),
                }
                for row in repository_usage_rows
            ],
            "recent_tasks": [_row_to_task(row) for row in recent_tasks],
        }
```

- [ ] **Step 5: Add dashboard endpoint**

In `app/main.py`, import `AdminDashboardResponse`, `RepositoryUsageResponse`, and `UserUsageResponse`. Add:

```python
    @app.get("/api/admin/dashboard", response_model=AdminDashboardResponse)
    def admin_dashboard(request: Request) -> AdminDashboardResponse:
        current_admin_user(request)
        dashboard = repo.get_admin_dashboard()
        return AdminDashboardResponse(
            user_total=dashboard["user_total"],
            admin_total=dashboard["admin_total"],
            active_user_total=dashboard["active_user_total"],
            task_total=dashboard["task_total"],
            today_task_total=dashboard["today_task_total"],
            status_counts=dashboard["status_counts"],
            user_usage=[UserUsageResponse(**item) for item in dashboard["user_usage"]],
            repository_usage=[RepositoryUsageResponse(**item) for item in dashboard["repository_usage"]],
            recent_tasks=[_to_task_response(task, reports_dir) for task in dashboard["recent_tasks"]],
        )
```

- [ ] **Step 6: Run dashboard test**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_dashboard_contains_user_usage_chart_data -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: add admin dashboard api"
```

## Task 9: Task Console Frontend Repository Helper And Admin Entry

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/styles.css`
- Test: `tests/test_frontend_static.py`

- [ ] **Step 1: Write failing frontend static tests**

Append to `tests/test_frontend_static.py`:

```python
def test_task_console_has_admin_entry_and_repository_helper():
    html = Path("static/index.html").read_text(encoding="utf-8")
    js = Path("static/app.js").read_text(encoding="utf-8")

    assert 'id="admin-link"' in html
    assert 'id="repository-options"' in html
    assert 'loadRepositories' in js
    assert 'repository.url_prefix' in js
    assert 'session.user.is_admin' in js
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m uv run pytest tests/test_frontend_static.py::test_task_console_has_admin_entry_and_repository_helper -v
```

Expected: FAIL because admin link and repository helper do not exist.

- [ ] **Step 3: Add admin link and repository helper markup**

In `static/index.html`, inside `.user-strip`, add before logout button:

```html
          <a id="admin-link" class="admin-link is-hidden" href="/admin">管理后台</a>
```

After SVN URL input, add:

```html
          <div class="repository-helper">
            <span>可用仓库</span>
            <div id="repository-options" class="repository-options" aria-live="polite"></div>
          </div>
```

- [ ] **Step 4: Add JavaScript behavior**

In `static/app.js`, add elements:

```javascript
  adminLink: document.querySelector("#admin-link"),
  svnUrlInput: document.querySelector("#svn-url"),
  repositoryOptions: document.querySelector("#repository-options"),
```

In `initialize()`, after setting user text:

```javascript
  elements.adminLink.classList.toggle("is-hidden", !session.user.is_admin);
  await loadRepositories();
```

Add functions:

```javascript
async function loadRepositories() {
  try {
    const response = await fetch("/api/repositories");
    const repositories = await readJson(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(repositories, "可用仓库加载失败"));
    }
    renderRepositories(repositories);
  } catch (error) {
    elements.repositoryOptions.innerHTML = `<span class="repository-error">${escapeHtml(error.message)}</span>`;
  }
}

function renderRepositories(repositories) {
  if (!repositories.length) {
    elements.repositoryOptions.innerHTML = '<span class="repository-error">暂无可用仓库</span>';
    return;
  }
  elements.repositoryOptions.innerHTML = repositories.map((repository) => `
    <button class="repository-chip" type="button" data-prefix="${escapeAttribute(repository.url_prefix)}">
      ${escapeHtml(repository.name)}
    </button>
  `).join("");
  elements.repositoryOptions.querySelectorAll("[data-prefix]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.svnUrlInput.value = `${button.dataset.prefix}/`;
      elements.svnUrlInput.focus();
    });
  });
}
```

- [ ] **Step 5: Add CSS**

In `static/styles.css`, add:

```css
.admin-link {
  color: #075985;
  font-weight: 700;
  text-decoration: none;
}

.is-hidden {
  display: none !important;
}

.repository-helper {
  display: grid;
  gap: 8px;
  margin: 10px 0 18px;
}

.repository-helper > span {
  color: #52627a;
  font-size: 13px;
  font-weight: 700;
}

.repository-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.repository-chip {
  border: 1px solid #c6d3e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #1e3a5f;
  cursor: pointer;
  font-weight: 700;
  padding: 7px 10px;
}

.repository-chip:hover {
  border-color: #0f7c91;
  color: #0f7c91;
}

.repository-error {
  color: #9f1239;
  font-size: 13px;
}
```

- [ ] **Step 6: Run frontend static test**

Run:

```powershell
python -m uv run pytest tests/test_frontend_static.py::test_task_console_has_admin_entry_and_repository_helper -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add static/index.html static/app.js static/styles.css tests/test_frontend_static.py
git commit -m "feat: show repository helper on task console"
```

## Task 10: Admin Static Page

**Files:**
- Create: `static/admin.html`
- Create: `static/admin.js`
- Modify: `static/styles.css`
- Modify: `app/main.py`
- Test: `tests/test_api.py`
- Test: `tests/test_frontend_static.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_api.py`:

```python
def test_admin_page_is_served(api_client):
    response = api_client.get("/admin")

    assert response.status_code == 200
    assert "admin-app" in response.text
```

Append to `tests/test_frontend_static.py`:

```python
def test_admin_page_contains_dashboard_users_permissions_and_usage_chart():
    html = Path("static/admin.html").read_text(encoding="utf-8")
    js = Path("static/admin.js").read_text(encoding="utf-8")

    assert 'id="admin-app"' in html
    assert 'id="usage-chart"' in html
    assert 'id="admin-users"' in html
    assert 'id="permission-list"' in html
    assert 'loadDashboard' in js
    assert 'renderUsageChart' in js
    assert 'savePermissions' in js
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_page_is_served tests/test_frontend_static.py::test_admin_page_contains_dashboard_users_permissions_and_usage_chart -v
```

Expected: FAIL because admin page files and route do not exist.

- [ ] **Step 3: Add `/admin` route**

In `app/main.py`, add:

```python
    @app.get("/admin")
    def serve_admin() -> FileResponse:
        return FileResponse(static_dir / "admin.html", media_type="text/html")
```

The page itself will call `/api/session` and redirect or show denial if not admin.

- [ ] **Step 4: Create admin HTML**

Create `static/admin.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>管理后台 - Code Review Task Console</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body>
  <main id="admin-app" class="admin-shell">
    <header class="admin-topbar">
      <div>
        <p class="eyebrow">Code Review Admin</p>
        <h1>管理后台</h1>
      </div>
      <nav class="admin-actions">
        <a href="/">返回任务台</a>
        <button id="admin-logout" type="button">退出</button>
      </nav>
    </header>

    <section class="admin-grid">
      <section class="panel admin-dashboard">
        <div class="panel-heading">
          <h2>仪表盘</h2>
          <p id="dashboard-summary">正在加载平台使用情况...</p>
        </div>
        <div id="dashboard-cards" class="dashboard-cards"></div>
        <h3>用户使用次数</h3>
        <div id="usage-chart" class="usage-chart"></div>
        <h3>仓库使用分布</h3>
        <div id="repository-usage" class="usage-chart"></div>
      </section>

      <section class="panel admin-users-panel">
        <div class="panel-heading">
          <h2>账号管理</h2>
          <p>新增账号并维护管理员与启用状态。</p>
        </div>
        <form id="admin-user-form" class="admin-user-form">
          <input name="name" placeholder="姓名" required>
          <input name="phone" placeholder="手机号" required>
          <label><input name="is_admin" type="checkbox"> 管理员</label>
          <label><input name="is_active" type="checkbox" checked> 启用</label>
          <button type="submit">新增账号</button>
        </form>
        <div id="admin-message" class="form-message"></div>
        <div id="admin-users" class="admin-users"></div>
      </section>

      <section class="panel admin-permissions-panel">
        <div class="panel-heading">
          <h2>仓库权限</h2>
          <p id="permission-user">请选择用户。</p>
        </div>
        <div class="public-note">公共仓库默认开放，不需要配置。</div>
        <div id="permission-list" class="permission-list"></div>
        <button id="save-permissions" type="button">保存权限</button>
      </section>
    </section>
  </main>
  <script src="/static/admin.js" defer></script>
</body>
</html>
```

- [ ] **Step 5: Create admin JavaScript**

Create `static/admin.js` with these functions:

```javascript
const adminState = {
  users: [],
  selectedUserId: null,
  selectedPermissions: new Set(),
};

const adminElements = {
  summary: document.querySelector("#dashboard-summary"),
  cards: document.querySelector("#dashboard-cards"),
  usageChart: document.querySelector("#usage-chart"),
  repositoryUsage: document.querySelector("#repository-usage"),
  userForm: document.querySelector("#admin-user-form"),
  users: document.querySelector("#admin-users"),
  message: document.querySelector("#admin-message"),
  permissionUser: document.querySelector("#permission-user"),
  permissionList: document.querySelector("#permission-list"),
  savePermissions: document.querySelector("#save-permissions"),
  logout: document.querySelector("#admin-logout"),
};

adminElements.userForm.addEventListener("submit", createUser);
adminElements.savePermissions.addEventListener("click", savePermissions);
adminElements.logout.addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
});

initializeAdmin();

async function initializeAdmin() {
  const session = await fetchJson("/api/session");
  if (!session.authenticated) {
    window.location.href = "/login";
    return;
  }
  if (!session.user.is_admin) {
    window.location.href = "/";
    return;
  }
  await Promise.all([loadDashboard(), loadUsers()]);
}

async function loadDashboard() {
  const dashboard = await fetchJson("/api/admin/dashboard");
  adminElements.summary.textContent = `任务总数 ${dashboard.task_total}，今日 ${dashboard.today_task_total}`;
  adminElements.cards.innerHTML = [
    ["用户", dashboard.user_total],
    ["管理员", dashboard.admin_total],
    ["启用账号", dashboard.active_user_total],
    ["任务", dashboard.task_total],
  ].map(([label, value]) => `<div class="dashboard-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  renderUsageChart(adminElements.usageChart, dashboard.user_usage, "name", "task_count", "phone");
  renderUsageChart(adminElements.repositoryUsage, dashboard.repository_usage, "repository_name", "task_count", "repository_key");
}

function renderUsageChart(container, rows, labelKey, valueKey, subLabelKey) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  container.innerHTML = rows.map((row) => {
    const value = Number(row[valueKey] || 0);
    const width = Math.max(4, Math.round((value / max) * 100));
    return `
      <div class="usage-row">
        <span>${escapeHtml(row[labelKey] || "-")}<small>${escapeHtml(row[subLabelKey] || "")}</small></span>
        <div class="usage-bar"><i style="width: ${width}%"></i></div>
        <strong>${value}</strong>
      </div>
    `;
  }).join("") || '<p class="empty-state">暂无数据</p>';
}

async function loadUsers() {
  adminState.users = await fetchJson("/api/admin/users");
  renderUsers();
}

function renderUsers() {
  adminElements.users.innerHTML = adminState.users.map((user) => `
    <button class="admin-user-item" type="button" data-user-id="${escapeAttribute(user.user_id)}">
      <strong>${escapeHtml(user.name)}</strong>
      <span>${escapeHtml(user.phone)}</span>
      <small>${user.is_admin ? "管理员" : "普通用户"} · ${user.is_active ? "启用" : "停用"} · ${user.task_count} 次</small>
    </button>
  `).join("");
  adminElements.users.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => selectUser(button.dataset.userId));
  });
}

async function createUser(event) {
  event.preventDefault();
  const formData = new FormData(adminElements.userForm);
  const payload = {
    name: String(formData.get("name") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    is_admin: formData.get("is_admin") === "on",
    is_active: formData.get("is_active") === "on",
  };
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showMessage(body.detail || "新增账号失败", true);
    return;
  }
  adminElements.userForm.reset();
  adminElements.userForm.elements.is_active.checked = true;
  showMessage("账号已新增", false);
  await Promise.all([loadDashboard(), loadUsers()]);
}

async function selectUser(userId) {
  adminState.selectedUserId = userId;
  const user = adminState.users.find((item) => item.user_id === userId);
  adminElements.permissionUser.textContent = user ? `${user.name} ${user.phone}` : "请选择用户。";
  const permissions = await fetchJson(`/api/admin/users/${encodeURIComponent(userId)}/repositories`);
  adminState.selectedPermissions = new Set(permissions.repository_keys);
  renderPermissionList();
}

function renderPermissionList() {
  const products = [
    ["energy", "高压"],
    ["home", "户储"],
    ["bs", "基站"],
    ["moto", "动力"],
    ["lcd", "显示屏"],
    ["linux", "Linux"],
    ["pace_tools", "上位机"],
    ["power", "电源"],
  ];
  adminElements.permissionList.innerHTML = products.map(([key, name]) => `
    <label>
      <input type="checkbox" value="${escapeAttribute(key)}" ${adminState.selectedPermissions.has(key) ? "checked" : ""}>
      ${escapeHtml(name)}
    </label>
  `).join("");
}

async function savePermissions() {
  if (!adminState.selectedUserId) {
    showMessage("请先选择用户", true);
    return;
  }
  const repositoryKeys = Array.from(adminElements.permissionList.querySelectorAll("input:checked")).map((input) => input.value);
  const response = await fetch(`/api/admin/users/${encodeURIComponent(adminState.selectedUserId)}/repositories`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repository_keys: repositoryKeys }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showMessage(body.detail || "保存权限失败", true);
    return;
  }
  showMessage("权限已保存", false);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || "请求失败");
  }
  return body;
}

function showMessage(message, isError) {
  adminElements.message.textContent = message;
  adminElements.message.classList.toggle("is-error", isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
```

- [ ] **Step 6: Add admin CSS**

Append styles to `static/styles.css`:

```css
.admin-shell {
  margin: 0 auto;
  max-width: 1480px;
  padding: 36px;
}

.admin-topbar,
.admin-actions {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.admin-actions a,
.admin-actions button,
.admin-user-form button,
#save-permissions {
  border: 1px solid #c6d3e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #0f3b57;
  cursor: pointer;
  font-weight: 700;
  padding: 9px 12px;
  text-decoration: none;
}

.admin-grid {
  align-items: start;
  display: grid;
  gap: 22px;
  grid-template-columns: minmax(0, 1.4fr) minmax(360px, 0.8fr);
}

.admin-permissions-panel {
  grid-column: 2;
}

.dashboard-cards {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-card {
  border: 1px solid #d7e0ea;
  border-radius: 8px;
  padding: 14px;
}

.dashboard-card span,
.usage-row small {
  color: #64748b;
  display: block;
}

.dashboard-card strong {
  display: block;
  font-size: 26px;
  margin-top: 6px;
}

.usage-chart {
  display: grid;
  gap: 10px;
}

.usage-row {
  align-items: center;
  display: grid;
  gap: 12px;
  grid-template-columns: 150px minmax(0, 1fr) 48px;
}

.usage-bar {
  background: #e8eef5;
  border-radius: 6px;
  height: 12px;
  overflow: hidden;
}

.usage-bar i {
  background: #0f7c91;
  display: block;
  height: 100%;
}

.admin-user-form,
.permission-list {
  display: grid;
  gap: 10px;
}

.admin-user-form input[type="text"],
.admin-user-form input:not([type]) {
  width: 100%;
}

.admin-users {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.admin-user-item {
  border: 1px solid #d7e0ea;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  display: grid;
  gap: 4px;
  padding: 12px;
  text-align: left;
}

.public-note {
  color: #52627a;
  margin-bottom: 12px;
}

@media (max-width: 980px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }

  .admin-permissions-panel {
    grid-column: auto;
  }

  .dashboard-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 7: Run frontend/admin static tests**

Run:

```powershell
python -m uv run pytest tests/test_api.py::test_admin_page_is_served tests/test_frontend_static.py::test_admin_page_contains_dashboard_users_permissions_and_usage_chart -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/main.py static/admin.html static/admin.js static/styles.css tests/test_api.py tests/test_frontend_static.py
git commit -m "feat: add admin console page"
```

## Task 11: Full Verification And Documentation Touch-Up

**Files:**
- Modify: `README.md`
- Test: all relevant tests

- [ ] **Step 1: Add README notes**

Add a short section to `README.md`:

```markdown
## 管理员与 SVN 仓库权限

平台支持临时 SVN 仓库权限管理。普通用户仍可粘贴完整 SVN URL，后端会按仓库前缀识别公共仓库或产品仓库，并校验当前用户是否有权限。

首批管理员通过环境变量配置：

```powershell
$env:ADMIN_PHONES = "15866582922"
```

管理员登录后，任务台右上角会显示“管理后台”入口，可进入 `/admin` 维护账号、仓库权限和查看使用统计。
```

- [ ] **Step 2: Run full tests**

Run:

```powershell
python -m uv run pytest -v
```

Expected: PASS.

- [ ] **Step 3: Run static smoke check**

Run:

```powershell
python -m uv run pytest tests/test_frontend_static.py -v
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```powershell
git status --short
```

Expected: only intended files are modified or untracked.

- [ ] **Step 5: Commit verification docs**

```powershell
git add README.md
git commit -m "docs: document admin repository permissions"
```

## Self-Review

- Spec coverage: The plan covers admin identity, `ADMIN_PHONES`, active users, repository catalog, full SVN URL paste workflow, backend permission enforcement, repository helper display, admin user management, repository permission management, dashboard with user-task-count chart, and tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Repository keys use `repository_keys`; task metadata uses `repository_key` and `repository_name`; admin user responses use `user_id`, `is_admin`, `is_active`, and `task_count` consistently.
