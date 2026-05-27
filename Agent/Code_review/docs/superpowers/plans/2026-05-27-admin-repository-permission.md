# 管理员与 SVN 仓库权限管理实施计划

> **给 agentic workers：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 在现有代码审查 Web 平台中增加临时 SVN 仓库权限管理能力，包括管理员后台、用户授权、任务提交权限校验和使用情况仪表盘。

**架构：** 保持当前 FastAPI + 静态前端架构不变。新增仓库目录模块负责 SVN 前缀识别，扩展 repository 层保存管理员和仓库权限数据，在任务创建入口做后端强校验，并增加 `/admin` 静态页面与 `/api/admin/*` 管理接口。

**技术栈：** Python 3、FastAPI、Pydantic、PostgreSQL/psycopg、测试用内存 repository、静态 HTML/CSS/JavaScript、pytest。

---

## 文件结构

- 新增 `app/repositories.py`：仓库清单、SVN URL 归属识别、用户可见仓库过滤。
- 修改 `app/config.py`：增加 `ADMIN_PHONES` 配置解析。
- 修改 `app/models.py`：增加管理员、用户、仓库、仪表盘相关请求和响应模型。
- 修改 `app/database.py`：增加用户管理员字段、启用状态、用户仓库权限表、任务仓库元数据、管理员统计查询。
- 修改 `app/testing.py`：为测试用内存 repository 补齐同样的用户、权限和统计方法。
- 修改 `app/main.py`：增加管理员守卫、仓库列表 API、管理员页面路由、管理 API、任务提交权限校验。
- 修改 `static/index.html`：增加管理员入口和“可用仓库”辅助区域。
- 修改 `static/app.js`：根据 session 展示管理员入口，加载可用仓库，保留完整 SVN URL 粘贴输入，并支持点击仓库前缀填入。
- 新增 `static/admin.html`：管理员后台页面骨架。
- 新增 `static/admin.js`：仪表盘、账号管理、仓库权限管理交互。
- 修改 `static/styles.css`：增加任务台仓库辅助区、管理员入口、后台页面、CSS 图表样式。
- 修改 `tests/test_api.py`：增加管理员、权限、仪表盘、仓库列表 API 测试。
- 修改 `tests/test_frontend_static.py`：增加静态页面关键标记测试。
- 修改 `tests/test_config.py`：增加 `ADMIN_PHONES` 解析测试。

## 任务 1：新增 SVN 仓库清单与 URL 识别

**文件：**
- 新增：`app/repositories.py`
- 测试：`tests/test_validation.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_validation.py` 末尾追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_validation.py -v
```

预期：失败，原因是 `app.repositories` 尚不存在。

- [ ] **步骤 3：实现仓库清单模块**

创建 `app/repositories.py`：

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
    requested = set(repository_keys)
    unknown = sorted(requested - set(PRODUCT_REPOSITORY_KEYS))
    if unknown:
        raise RepositoryAccessError(f"未知产品仓库: {', '.join(unknown)}")
    return [key for key in PRODUCT_REPOSITORY_KEYS if key in requested]
```

- [ ] **步骤 4：运行仓库清单测试**

运行：

```powershell
python -m uv run pytest tests/test_validation.py -v
```

预期：通过。

- [ ] **步骤 5：提交**

```powershell
git add app/repositories.py tests/test_validation.py
git commit -m "feat: add svn repository catalog"
```

## 任务 2：增加管理员手机号配置与用户响应字段

**文件：**
- 修改：`app/config.py`
- 修改：`app/models.py`
- 修改：`app/database.py`
- 修改：`app/testing.py`
- 修改：`app/main.py`
- 测试：`tests/test_config.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_config.py` 追加：

```python
def test_admin_phones_are_parsed_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("ADMIN_PHONES", " 15866582922, 13800138000 ,,")

    from app.config import load_settings

    loaded = load_settings()

    assert loaded.admin_phones == ("15866582922", "13800138000")
```

在 `tests/test_api.py` 追加：

```python
def test_admin_phone_login_marks_user_as_admin(api_client):
    response = login(api_client, name="admin", phone="15866582922")

    assert response.status_code == 200
    assert response.json()["user"]["is_admin"] is True
    assert response.json()["user"]["is_active"] is True
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_config.py::test_admin_phones_are_parsed_from_environment tests/test_api.py::test_admin_phone_login_marks_user_as_admin -v
```

预期：失败，因为还没有 `admin_phones`、`is_admin`、`is_active`。

- [ ] **步骤 3：增加配置字段**

在 `app/config.py` 的 `Settings` 中增加：

```python
    admin_phones: tuple[str, ...]
```

增加解析函数：

```python
def _parse_csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())
```

在 `load_settings()` 返回 `Settings(...)` 时增加：

```python
        admin_phones=_parse_csv(os.getenv("ADMIN_PHONES", "")),
```

- [ ] **步骤 4：扩展用户响应模型**

在 `app/models.py` 中更新 `UserResponse`：

```python
class UserResponse(BaseModel):
    user_id: str
    name: str
    phone: str
    is_admin: bool = False
    is_active: bool = True
```

- [ ] **步骤 5：扩展测试用内存用户**

在 `app/testing.py` 的新用户 dict 中加入：

```python
            "is_admin": False,
            "is_active": True,
```

并增加方法：

```python
    def set_user_admin_if_phone_matches(self, phone: str, admin_phones: tuple[str, ...]) -> None:
        for user in self.users.values():
            if user["phone"] == phone and phone in admin_phones:
                user["is_admin"] = True
                user["updated_at"] = _utc_now()
```

- [ ] **步骤 6：扩展 PostgreSQL 用户表**

在 `app/database.py` 的 `init_schema()` 中创建 `users` 表后追加：

```python
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE")
            connection.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")
```

增加方法：

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

- [ ] **步骤 7：登录时自动标记管理员**

在 `app/main.py` 的 `create_session()` 中，`repo.get_or_create_user(...)` 后增加：

```python
        repo.set_user_admin_if_phone_matches(phone, app_settings.admin_phones)
        user = repo.get_user(user["id"]) or user
```

更新 `_to_user_response`：

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

- [ ] **步骤 8：运行聚焦测试**

运行：

```powershell
python -m uv run pytest tests/test_config.py::test_admin_phones_are_parsed_from_environment tests/test_api.py::test_admin_phone_login_marks_user_as_admin -v
```

预期：通过。

- [ ] **步骤 9：提交**

```powershell
git add app/config.py app/models.py app/database.py app/testing.py app/main.py tests/test_config.py tests/test_api.py
git commit -m "feat: add admin identity flags"
```

## 任务 3：增加用户仓库权限存储

**文件：**
- 修改：`app/database.py`
- 修改：`app/testing.py`
- 测试：`tests/test_database.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_database.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_database.py::test_repository_stores_user_repository_permissions tests/test_database.py::test_repository_replaces_user_repository_permissions -v
```

预期：失败，因为权限方法尚不存在。

- [ ] **步骤 3：实现 PostgreSQL 权限表与方法**

在 `app/database.py` 增加导入：

```python
from app.repositories import validate_repository_keys
```

在 `init_schema()` 中增加：

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

增加方法：

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

- [ ] **步骤 4：实现内存 repository 权限方法**

在 `app/testing.py` 的 `__init__` 中增加：

```python
        self.repository_permissions: dict[str, set[str]] = {}
```

增加导入：

```python
from app.repositories import validate_repository_keys
```

增加方法：

```python
    def list_user_repository_permissions(self, user_id: str) -> list[str]:
        return sorted(self.repository_permissions.get(user_id, set()))

    def set_user_repository_permissions(self, user_id: str, repository_keys: list[str]) -> list[str]:
        safe_keys = validate_repository_keys(repository_keys)
        self.repository_permissions[user_id] = set(safe_keys)
        return self.list_user_repository_permissions(user_id)
```

- [ ] **步骤 5：运行 repository 测试**

运行：

```powershell
python -m uv run pytest tests/test_database.py::test_repository_stores_user_repository_permissions tests/test_database.py::test_repository_replaces_user_repository_permissions -v
```

预期：通过。

- [ ] **步骤 6：提交**

```powershell
git add app/database.py app/testing.py tests/test_database.py
git commit -m "feat: store repository permissions"
```

## 任务 4：任务提交时强制校验仓库权限

**文件：**
- 修改：`app/models.py`
- 修改：`app/database.py`
- 修改：`app/testing.py`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_public_repository_task_is_allowed_for_any_logged_in_user tests/test_api.py::test_product_repository_task_requires_permission tests/test_api.py::test_product_repository_task_is_allowed_when_granted -v
```

预期：失败，因为任务创建尚未校验仓库权限。

- [ ] **步骤 3：扩展任务响应模型**

在 `app/models.py` 的 `TaskResponse` 中增加：

```python
    repository_key: str | None = None
    repository_name: str | None = None
```

- [ ] **步骤 4：任务表增加仓库元数据**

在 `app/database.py` 的 `init_schema()` 中增加：

```python
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_key TEXT")
            connection.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repository_name TEXT")
```

更新 `create_task` 签名：

```python
        repository_key: str | None = None,
        repository_name: str | None = None,
```

在 INSERT 中加入 `repository_key`、`repository_name`，并传入参数：

```python
                    "repository_key": repository_key,
                    "repository_name": repository_name,
```

- [ ] **步骤 5：内存 task 增加仓库元数据**

在 `app/testing.py` 的 `create_task` 签名中增加：

```python
        repository_key: str | None = None,
        repository_name: str | None = None,
```

在 task dict 中增加：

```python
            "repository_key": repository_key,
            "repository_name": repository_name,
```

- [ ] **步骤 6：任务创建入口增加权限校验**

在 `app/main.py` 增加导入：

```python
from app.repositories import RepositoryAccessError, match_repository_for_url, repositories_for_user
```

在 `create_task()` 中，规范化版本号后、比较新旧版本号前增加：

```python
        try:
            repository = match_repository_for_url(svn_url)
        except RepositoryAccessError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        granted_keys = set(repo.list_user_repository_permissions(user["id"]))
        if not repository.is_public and repository.key not in granted_keys:
            raise HTTPException(status_code=403, detail="当前用户没有该 SVN 仓库权限")
```

创建任务时传入：

```python
            repository_key=repository.key,
            repository_name=repository.name,
```

更新 `_to_task_response()`：

```python
        repository_key=task.get("repository_key"),
        repository_name=task.get("repository_name"),
```

- [ ] **步骤 7：兼容完整 SVN URL 输入**

在 `app/main.py` 中，把旧逻辑：

```python
            svn_url = validate_svn_url(request.svn_url, app_settings.svn_allowed_prefix)
```

替换为：

```python
            svn_url = request.svn_url.strip()
```

如果 `validate_svn_url` 不再使用，移除对应导入。

- [ ] **步骤 8：运行聚焦 API 测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_public_repository_task_is_allowed_for_any_logged_in_user tests/test_api.py::test_product_repository_task_requires_permission tests/test_api.py::test_product_repository_task_is_allowed_when_granted -v
```

预期：通过。

- [ ] **步骤 9：运行现有 API 测试并修正测试数据**

运行：

```powershell
python -m uv run pytest tests/test_api.py -v
```

预期：部分使用 `VALID_SVN_URL` 的旧测试可能因为产品仓库未授权失败。处理方式是：与产品权限无关的测试改用公共仓库 URL；需要产品仓库的测试在提交前给用户授予 `home` 权限。

- [ ] **步骤 10：提交**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: enforce svn repository permissions"
```

## 任务 5：提供当前用户可用仓库 API

**文件：**
- 修改：`app/models.py`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_get_repositories_returns_public_and_granted_repositories tests/test_api.py::test_get_repositories_requires_login -v
```

预期：失败，因为 `/api/repositories` 不存在。

- [ ] **步骤 3：增加响应模型**

在 `app/models.py` 增加：

```python
class RepositoryResponse(BaseModel):
    key: str
    name: str
    url_prefix: str
    is_public: bool
```

- [ ] **步骤 4：增加 API**

在 `app/main.py` 导入 `RepositoryResponse`，并增加 helper：

```python
def _to_repository_response(repository) -> RepositoryResponse:
    return RepositoryResponse(
        key=repository.key,
        name=repository.name,
        url_prefix=repository.url_prefix,
        is_public=repository.is_public,
    )
```

增加 endpoint：

```python
    @app.get("/api/repositories", response_model=list[RepositoryResponse])
    def list_repositories(request: Request) -> list[RepositoryResponse]:
        user = current_user(request)
        granted_keys = set(repo.list_user_repository_permissions(user["id"]))
        return [_to_repository_response(item) for item in repositories_for_user(granted_keys)]
```

- [ ] **步骤 5：运行聚焦测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_get_repositories_returns_public_and_granted_repositories tests/test_api.py::test_get_repositories_requires_login -v
```

预期：通过。

- [ ] **步骤 6：提交**

```powershell
git add app/models.py app/main.py tests/test_api.py
git commit -m "feat: expose available repositories"
```

## 任务 6：增加管理员账号管理 API

**文件：**
- 修改：`app/models.py`
- 修改：`app/database.py`
- 修改：`app/testing.py`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_users_requires_admin tests/test_api.py::test_admin_can_create_and_list_users tests/test_api.py::test_admin_create_user_rejects_duplicate_phone tests/test_api.py::test_admin_can_update_user -v
```

预期：失败，因为管理 API 不存在。

- [ ] **步骤 3：增加管理用户模型**

在 `app/models.py` 增加：

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

- [ ] **步骤 4：增加 repository 用户管理方法**

在 `app/database.py` 增加：

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

在 `app/testing.py` 增加等价方法，使用 `self.users` 和 `self.tasks` 完成同样行为。

- [ ] **步骤 5：增加管理员守卫和 API**

在 `app/main.py` 增加管理员模型导入，并在 `create_app()` 内增加：

```python
    def current_admin_user(request: Request) -> dict[str, Any]:
        user = current_user(request)
        if not user.get("is_admin", False):
            raise HTTPException(status_code=403, detail="Admin permission required")
        return user
```

在 `current_user()` 中增加停用账号检查：

```python
        if not user.get("is_active", True):
            raise HTTPException(status_code=403, detail="Account is disabled")
```

增加响应转换：

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

增加 endpoints：

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

- [ ] **步骤 6：运行聚焦测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_users_requires_admin tests/test_api.py::test_admin_can_create_and_list_users tests/test_api.py::test_admin_create_user_rejects_duplicate_phone tests/test_api.py::test_admin_can_update_user -v
```

预期：通过。

- [ ] **步骤 7：提交**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: add admin user management api"
```

## 任务 7：增加管理员仓库权限 API

**文件：**
- 修改：`app/models.py`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_can_get_and_set_user_repository_permissions tests/test_api.py::test_admin_repository_permissions_reject_unknown_key -v
```

预期：失败，因为 endpoints 不存在。

- [ ] **步骤 3：增加模型**

在 `app/models.py` 增加：

```python
class RepositoryPermissionUpdateRequest(BaseModel):
    repository_keys: list[str]


class RepositoryPermissionResponse(BaseModel):
    user_id: str
    repository_keys: list[str]
```

- [ ] **步骤 4：增加 endpoints**

在 `app/main.py` 导入 `RepositoryAccessError`、`RepositoryPermissionResponse`、`RepositoryPermissionUpdateRequest`，并增加：

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

- [ ] **步骤 5：运行聚焦测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_can_get_and_set_user_repository_permissions tests/test_api.py::test_admin_repository_permissions_reject_unknown_key -v
```

预期：通过。

- [ ] **步骤 6：提交**

```powershell
git add app/models.py app/main.py tests/test_api.py
git commit -m "feat: add admin repository permission api"
```

## 任务 8：增加管理员仪表盘 API

**文件：**
- 修改：`app/models.py`
- 修改：`app/database.py`
- 修改：`app/testing.py`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_dashboard_contains_user_usage_chart_data -v
```

预期：失败，因为仪表盘 API 不存在。

- [ ] **步骤 3：增加仪表盘模型**

在 `app/models.py` 增加：

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

- [ ] **步骤 4：增加仪表盘 repository 方法**

在 `app/testing.py` 中用内存循环实现：

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

在 `app/database.py` 中用 SQL 实现同样返回结构：

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

- [ ] **步骤 5：增加仪表盘 endpoint**

在 `app/main.py` 导入 `AdminDashboardResponse`、`RepositoryUsageResponse`、`UserUsageResponse`，并增加：

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

- [ ] **步骤 6：运行仪表盘测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_dashboard_contains_user_usage_chart_data -v
```

预期：通过。

- [ ] **步骤 7：提交**

```powershell
git add app/models.py app/database.py app/testing.py app/main.py tests/test_api.py
git commit -m "feat: add admin dashboard api"
```

## 任务 9：任务台前端增加仓库辅助区和管理员入口

**文件：**
- 修改：`static/index.html`
- 修改：`static/app.js`
- 修改：`static/styles.css`
- 测试：`tests/test_frontend_static.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_frontend_static.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_frontend_static.py::test_task_console_has_admin_entry_and_repository_helper -v
```

预期：失败，因为页面还没有管理员入口和仓库辅助区。

- [ ] **步骤 3：增加页面标记**

在 `static/index.html` 的 `.user-strip` 内、退出按钮前增加：

```html
          <a id="admin-link" class="admin-link is-hidden" href="/admin">管理后台</a>
```

在 SVN URL 输入框下方增加：

```html
          <div class="repository-helper">
            <span>可用仓库</span>
            <div id="repository-options" class="repository-options" aria-live="polite"></div>
          </div>
```

- [ ] **步骤 4：增加前端交互**

在 `static/app.js` 的 `elements` 中增加：

```javascript
  adminLink: document.querySelector("#admin-link"),
  svnUrlInput: document.querySelector("#svn-url"),
  repositoryOptions: document.querySelector("#repository-options"),
```

在 `initialize()` 设置当前用户后增加：

```javascript
  elements.adminLink.classList.toggle("is-hidden", !session.user.is_admin);
  await loadRepositories();
```

增加函数：

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

- [ ] **步骤 5：增加样式**

在 `static/styles.css` 增加：

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

- [ ] **步骤 6：运行前端静态测试**

运行：

```powershell
python -m uv run pytest tests/test_frontend_static.py::test_task_console_has_admin_entry_and_repository_helper -v
```

预期：通过。

- [ ] **步骤 7：提交**

```powershell
git add static/index.html static/app.js static/styles.css tests/test_frontend_static.py
git commit -m "feat: show repository helper on task console"
```

## 任务 10：新增管理员后台静态页面

**文件：**
- 新增：`static/admin.html`
- 新增：`static/admin.js`
- 修改：`static/styles.css`
- 修改：`app/main.py`
- 测试：`tests/test_api.py`
- 测试：`tests/test_frontend_static.py`

- [ ] **步骤 1：先写失败测试**

在 `tests/test_api.py` 追加：

```python
def test_admin_page_is_served(api_client):
    response = api_client.get("/admin")

    assert response.status_code == 200
    assert "admin-app" in response.text
```

在 `tests/test_frontend_static.py` 追加：

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

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_page_is_served tests/test_frontend_static.py::test_admin_page_contains_dashboard_users_permissions_and_usage_chart -v
```

预期：失败，因为管理员页面文件和路由不存在。

- [ ] **步骤 3：增加 `/admin` 路由**

在 `app/main.py` 增加：

```python
    @app.get("/admin")
    def serve_admin() -> FileResponse:
        return FileResponse(static_dir / "admin.html", media_type="text/html")
```

页面加载后自行调用 `/api/session` 判断是否管理员；普通用户跳回首页。

- [ ] **步骤 4：创建管理员 HTML**

创建 `static/admin.html`。页面必须包含：

```html
<main id="admin-app" class="admin-shell">
  ...
  <div id="usage-chart" class="usage-chart"></div>
  <div id="admin-users" class="admin-users"></div>
  <div id="permission-list" class="permission-list"></div>
  ...
</main>
<script src="/static/admin.js" defer></script>
```

具体结构按设计文档实现：顶部返回任务台和退出按钮，中间三块区域分别为“仪表盘”“账号管理”“仓库权限”。

- [ ] **步骤 5：创建管理员 JavaScript**

创建 `static/admin.js`。必须实现这些函数：

```javascript
async function initializeAdmin() {}
async function loadDashboard() {}
function renderUsageChart(container, rows, labelKey, valueKey, subLabelKey) {}
async function loadUsers() {}
function renderUsers() {}
async function createUser(event) {}
async function selectUser(userId) {}
function renderPermissionList() {}
async function savePermissions() {}
```

交互要求：

- `initializeAdmin()` 调用 `/api/session`，未登录跳转 `/login`，非管理员跳转 `/`。
- `loadDashboard()` 调用 `/api/admin/dashboard`。
- `renderUsageChart()` 用 CSS 横向柱状图展示用户任务数和仓库任务数。
- `loadUsers()` 调用 `/api/admin/users`。
- `createUser()` 调用 `POST /api/admin/users`。
- `selectUser()` 调用 `GET /api/admin/users/{user_id}/repositories`。
- `savePermissions()` 调用 `PUT /api/admin/users/{user_id}/repositories`。

- [ ] **步骤 6：增加后台页面样式**

在 `static/styles.css` 增加后台布局、卡片、用户列表、权限复选框、横向柱状图样式。关键选择器必须包括：

```css
.admin-shell {}
.admin-topbar {}
.admin-grid {}
.dashboard-cards {}
.usage-chart {}
.usage-row {}
.usage-bar {}
.admin-users {}
.admin-user-item {}
.permission-list {}
```

- [ ] **步骤 7：运行静态页面测试**

运行：

```powershell
python -m uv run pytest tests/test_api.py::test_admin_page_is_served tests/test_frontend_static.py::test_admin_page_contains_dashboard_users_permissions_and_usage_chart -v
```

预期：通过。

- [ ] **步骤 8：提交**

```powershell
git add app/main.py static/admin.html static/admin.js static/styles.css tests/test_api.py tests/test_frontend_static.py
git commit -m "feat: add admin console page"
```

## 任务 11：文档更新与整体验证

**文件：**
- 修改：`README.md`
- 测试：完整测试集

- [ ] **步骤 1：更新 README**

在 `README.md` 增加一节：

```markdown
## 管理员与 SVN 仓库权限

平台支持临时 SVN 仓库权限管理。普通用户仍可粘贴完整 SVN URL，后端会按仓库前缀识别公共仓库或产品仓库，并校验当前用户是否有权限。

首批管理员通过环境变量配置：

```powershell
$env:ADMIN_PHONES = "15866582922"
```

管理员登录后，任务台右上角会显示“管理后台”入口，可进入 `/admin` 维护账号、仓库权限和查看使用统计。
```

- [ ] **步骤 2：运行完整测试**

运行：

```powershell
python -m uv run pytest -v
```

预期：通过。

- [ ] **步骤 3：运行前端静态冒烟测试**

运行：

```powershell
python -m uv run pytest tests/test_frontend_static.py -v
```

预期：通过。

- [ ] **步骤 4：检查 git 状态**

运行：

```powershell
git status --short
```

预期：只存在本次实现相关改动。

- [ ] **步骤 5：提交文档更新**

```powershell
git add README.md
git commit -m "docs: document admin repository permissions"
```

## 自检

- 规格覆盖：本计划覆盖管理员身份、`ADMIN_PHONES`、启用/停用账号、仓库清单、完整 SVN URL 粘贴流程、后端权限强校验、任务台仓库辅助展示、管理员账号管理、仓库权限管理、包含“用户-任务数”图表的仪表盘，以及对应测试。
- 占位检查：没有未完成占位说明；代码片段、命令和预期结果均已给出。
- 类型一致性：仓库权限列表统一使用 `repository_keys`；任务仓库元数据统一使用 `repository_key` 和 `repository_name`；管理员用户响应统一使用 `user_id`、`is_admin`、`is_active`、`task_count`。

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-05-27-admin-repository-permission.md`。执行时有两个选择：

1. **Subagent-Driven（推荐）**：每个任务派发一个新的 subagent，任务之间做审查，迭代速度更快。
2. **Inline Execution**：在当前会话中使用 `superpowers:executing-plans` 按批次执行，并在检查点做复核。
