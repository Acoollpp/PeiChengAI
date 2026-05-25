# 登录、PostgreSQL、Redis 与 SSE 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加姓名+手机号登录、PostgreSQL 持久化、Redis 按用户单任务调度，以及 SSE 驱动的任务台动态更新。

**Architecture:** PostgreSQL 是用户和任务状态的事实源；Redis 只保存调度队列、用户运行锁和事件通知，可从 PostgreSQL 重建。FastAPI 通过 session cookie 识别用户，worker 通过 Redis 调度器领取任务，前端新增独立登录页并保留现有任务台布局。

**Tech Stack:** FastAPI、Pydantic、psycopg、redis-py、Server-Sent Events、原生 HTML/CSS/JavaScript、pytest。

---

## 文件结构

- 修改 `pyproject.toml`：新增 PostgreSQL、Redis、session 签名依赖。
- 修改 `app/config.py`：新增 `DATABASE_URL`、`REDIS_URL`、`SESSION_SECRET_KEY`、`WORKER_ID`、Redis 锁 TTL 等配置；保留旧路径配置用于报告和工作目录。
- 修改 `app/models.py`：新增用户、session、统计响应模型；扩展任务状态。
- 新增 `app/postgres.py`：PostgreSQL 连接与 schema 初始化。
- 重写 `app/database.py`：把 `TaskRepository` 改为 PostgreSQL repository，同时增加 `UserRepository`；保留清晰的小方法，不把调度逻辑塞进 repository。
- 新增 `app/session.py`：手机号规范化、session cookie 签名、当前用户依赖。
- 新增 `app/scheduler.py`：Redis 调度器、Lua 原子领取、完成后释放锁、Redis 状态重建。
- 新增 `app/events.py`：用户事件发布和 SSE 事件流。
- 修改 `app/worker.py`：worker 从 scheduler 领取任务，写心跳，完成后释放用户锁并发布事件。
- 修改 `app/main.py`：接入 session、PostgreSQL repository、Redis scheduler、SSE、登录页和用户权限过滤。
- 新增 `static/login.html`：独立登录页。
- 修改 `static/index.html`：保持任务台布局，增加当前用户与退出入口，移除或禁用 requester 输入。
- 修改 `static/app.js`：增加 session 初始化、SSE 订阅、自动刷新和退出登录。
- 修改 `static/styles.css`：只补充登录页和当前用户区域样式，不重做任务台布局。
- 修改 `tests/conftest.py`：测试夹具切换为可注入 repository/scheduler/event bus，避免单元测试依赖真实 PostgreSQL/Redis。
- 新增或修改测试文件：`tests/test_session.py`、`tests/test_scheduler.py`、`tests/test_events.py`、`tests/test_database.py`、`tests/test_api.py`、`tests/test_worker.py`、`tests/test_frontend_static.py`。

## 执行前置

实现时优先使用仓库现有测试命令：

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

如果需要安装新依赖，先修改 `pyproject.toml`，再运行：

```powershell
uv sync
```

如当前 shell 没有 `uv`，使用：

```powershell
python -m uv sync
```

本计划中的单元测试不要求真实 PostgreSQL/Redis 常驻服务。真实服务连通性可以在最后作为手动集成验证。

---

### Task 1: 配置、模型与依赖边界

**Files:**
- Modify: `pyproject.toml`
- Modify: `app/config.py`
- Modify: `app/models.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: 写失败测试，覆盖新配置默认值和环境变量**

在 `tests/test_config.py` 增加：

```python
from pathlib import Path

from app.config import load_settings
from app.models import SessionCreateRequest, TaskStatus


def test_load_settings_includes_postgres_redis_session_and_worker_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("SESSION_SECRET_KEY", raising=False)
    monkeypatch.delenv("WORKER_ID", raising=False)

    settings = load_settings()

    assert settings.database_url == "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
    assert settings.redis_url == "redis://127.0.0.1:6379/0"
    assert settings.session_secret_key
    assert settings.worker_id
    assert settings.redis_lock_ttl_seconds == 3600
    assert settings.reports_dir == (Path(tmp_path) / "data" / "reports").resolve()


def test_load_settings_reads_postgres_redis_and_session_env(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db:5432/app")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/3")
    monkeypatch.setenv("SESSION_SECRET_KEY", "test-secret")
    monkeypatch.setenv("WORKER_ID", "worker-a")
    monkeypatch.setenv("REDIS_LOCK_TTL_SECONDS", "120")

    settings = load_settings()

    assert settings.database_url == "postgresql://user:pass@db:5432/app"
    assert settings.redis_url == "redis://redis:6379/3"
    assert settings.session_secret_key == "test-secret"
    assert settings.worker_id == "worker-a"
    assert settings.redis_lock_ttl_seconds == 120


def test_models_include_session_request_and_enqueue_failed_status():
    request = SessionCreateRequest(name=" 张三 ", phone=" 13800138000 ")

    assert request.name == " 张三 "
    assert request.phone == " 13800138000 "
    assert TaskStatus.enqueue_failed.value == "enqueue_failed"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_config.py -v
```

Expected: FAIL，提示 `Settings` 没有 `database_url` 等字段，或 `SessionCreateRequest` / `enqueue_failed` 不存在。

- [ ] **Step 3: 修改依赖**

在 `pyproject.toml` 的 `dependencies` 增加：

```toml
    "psycopg[binary]==3.2.9",
    "redis==5.2.1",
    "itsdangerous==2.2.0",
```

- [ ] **Step 4: 修改 `app/config.py`**

将 `Settings` 扩展为：

```python
@dataclass(frozen=True)
class Settings:
    base_dir: Path
    database_path: Path
    database_url: str
    redis_url: str
    reports_dir: Path
    workspaces_dir: Path
    prompt_template_path: Path
    svn_allowed_prefix: str
    codex_command: str
    codex_args: tuple[str, ...]
    codex_timeout_seconds: int
    worker_poll_seconds: float
    retention_days: int
    session_secret_key: str
    worker_id: str
    redis_lock_ttl_seconds: int
    heartbeat_seconds: int
```

在 `load_settings()` 的 return 中新增：

```python
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@127.0.0.1:5432/code_review",
        ),
        redis_url=os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
        session_secret_key=os.getenv("SESSION_SECRET_KEY", "dev-session-secret-change-me"),
        worker_id=os.getenv("WORKER_ID", f"worker-{os.getpid()}"),
        redis_lock_ttl_seconds=int(os.getenv("REDIS_LOCK_TTL_SECONDS", "3600")),
        heartbeat_seconds=int(os.getenv("HEARTBEAT_SECONDS", "30")),
```

- [ ] **Step 5: 修改 `app/models.py`**

扩展状态并增加模型：

```python
class TaskStatus(StrEnum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"
    enqueue_failed = "enqueue_failed"


class SessionCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)


class UserResponse(BaseModel):
    user_id: str
    name: str
    phone: str


class SessionResponse(BaseModel):
    authenticated: bool
    user: UserResponse | None = None


class UserStatsResponse(BaseModel):
    total: int
    pending: int
    running: int
    success: int
    failed: int
    enqueue_failed: int
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_config.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add pyproject.toml app/config.py app/models.py tests/test_config.py
git commit -m "Add auth postgres redis configuration"
```

---

### Task 2: 用户身份与 session

**Files:**
- Create: `app/session.py`
- Modify: `app/main.py`
- Modify: `static/login.html`
- Test: `tests/test_session.py`
- Test: `tests/test_frontend_static.py`

- [ ] **Step 1: 写手机号和 session 单元测试**

创建 `tests/test_session.py`：

```python
from datetime import UTC, datetime

from fastapi import HTTPException

from app.session import (
    SESSION_COOKIE_NAME,
    SessionManager,
    normalize_phone,
)


def test_normalize_phone_removes_spaces_dashes_and_country_prefix():
    assert normalize_phone(" +86 138-0013-8000 ") == "13800138000"


def test_normalize_phone_rejects_too_short_value():
    try:
        normalize_phone("123")
    except ValueError as exc:
        assert "phone" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_session_manager_round_trips_user_id():
    manager = SessionManager("secret")
    cookie = manager.create_cookie_value("user-1")

    assert manager.read_user_id(cookie) == "user-1"


def test_session_manager_rejects_tampered_cookie():
    manager = SessionManager("secret")

    assert manager.read_user_id("invalid") is None


def test_session_cookie_name_is_stable():
    assert SESSION_COOKIE_NAME == "code_review_session"
```

- [ ] **Step 2: 写登录页静态测试**

在 `tests/test_frontend_static.py` 增加：

```python
from pathlib import Path


def test_login_page_contains_name_phone_and_submit_controls():
    html = Path("static/login.html").read_text(encoding="utf-8")

    assert 'name="name"' in html
    assert 'name="phone"' in html
    assert 'id="login-form"' in html
    assert "/api/session" in html
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_session.py tests/test_frontend_static.py -v
```

Expected: FAIL，提示 `app.session` 或 `static/login.html` 不存在。

- [ ] **Step 4: 创建 `app/session.py`**

```python
from __future__ import annotations

import re

from itsdangerous import BadSignature, URLSafeSerializer

SESSION_COOKIE_NAME = "code_review_session"
SESSION_SALT = "code-review-session-v1"


def normalize_phone(phone: str) -> str:
    value = re.sub(r"[\s\-()]", "", phone or "")
    if value.startswith("+86"):
        value = value[3:]
    if not re.fullmatch(r"\d{7,20}", value):
        raise ValueError("phone must contain 7 to 20 digits")
    return value


class SessionManager:
    def __init__(self, secret_key: str):
        self.serializer = URLSafeSerializer(secret_key, salt=SESSION_SALT)

    def create_cookie_value(self, user_id: str) -> str:
        return self.serializer.dumps({"user_id": user_id})

    def read_user_id(self, cookie_value: str | None) -> str | None:
        if not cookie_value:
            return None
        try:
            payload = self.serializer.loads(cookie_value)
        except BadSignature:
            return None
        user_id = payload.get("user_id") if isinstance(payload, dict) else None
        return str(user_id) if user_id else None
```

- [ ] **Step 5: 创建 `static/login.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>登录 - Code Review Task Console</title>
  <link rel="stylesheet" href="/static/styles.css">
</head>
<body class="login-page">
  <main class="login-shell">
    <form id="login-form" class="login-panel">
      <h1>代码审查任务台</h1>
      <label>
        姓名
        <input name="name" autocomplete="name" required>
      </label>
      <label>
        手机号
        <input name="phone" inputmode="tel" autocomplete="tel" required>
      </label>
      <button type="submit">登录</button>
      <p id="login-message" class="form-message"></p>
    </form>
  </main>
  <script>
    const form = document.querySelector("#login-form");
    const message = document.querySelector("#login-message");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          phone: String(formData.get("phone") || "").trim(),
        }),
      });
      if (response.ok) {
        window.location.href = "/";
        return;
      }
      const body = await response.json().catch(() => ({}));
      message.textContent = body.detail || "登录失败";
      message.classList.add("is-error");
    });
  </script>
</body>
</html>
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_session.py tests/test_frontend_static.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add app/session.py static/login.html tests/test_session.py tests/test_frontend_static.py
git commit -m "Add identity session helpers and login page"
```

---

### Task 3: PostgreSQL Repository 与用户/任务事实源

**Files:**
- Create: `app/postgres.py`
- Modify: `app/database.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_database.py`

- [ ] **Step 1: 写 repository 行为测试**

将 `tests/test_database.py` 调整为不直接依赖 SQLite path，而是使用 fixture `repository`。新增用户相关断言：

```python
def test_get_or_create_user_creates_and_updates_by_phone(repository):
    created = repository.get_or_create_user(name="张三", phone="13800138000")
    updated = repository.get_or_create_user(name="张三丰", phone="13800138000")

    assert created["id"] == updated["id"]
    assert updated["name"] == "张三丰"
    assert updated["phone"] == "13800138000"
    assert updated["last_seen_at"] >= created["last_seen_at"]


def test_create_task_stores_user_id_and_requester(repository):
    user = repository.get_or_create_user(name="李四", phone="13900139000")

    task = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/task.md",
        user_id=user["id"],
        task_id="task-1",
    )

    assert task["user_id"] == user["id"]
    assert task["requester"] == "李四"
    assert repository.get_task_for_user("task-1", user["id"])["id"] == "task-1"
    assert repository.get_task_for_user("task-1", "other-user") is None


def test_user_stats_counts_statuses(repository):
    user = repository.get_or_create_user(name="王五", phone="13700137000")
    first = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/first.md",
        user_id=user["id"],
        task_id="first",
    )
    second = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r2",
        new_revision="r3",
        requester=user["name"],
        report_path="reports/second.md",
        user_id=user["id"],
        task_id="second",
    )
    repository.mark_success(first["id"])
    repository.mark_enqueue_failed(second["id"], "redis unavailable")

    stats = repository.get_user_stats(user["id"])

    assert stats["total"] == 2
    assert stats["success"] == 1
    assert stats["enqueue_failed"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_database.py -v
```

Expected: FAIL，提示 repository 缺少用户方法或 `user_id` 参数。

- [ ] **Step 3: 创建 `app/postgres.py`**

```python
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


class PostgresDatabase:
    def __init__(self, database_url: str):
        self.database_url = database_url

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection
```

- [ ] **Step 4: 重写 `app/database.py` 的接口**

实现时保留类名 `TaskRepository` 以减少调用方改动，但构造函数改为接收 database 对象；测试可以用内存 fake database。核心方法签名如下：

```python
class TaskRepository:
    def __init__(self, database):
        self.database = database

    def init_schema(self) -> None:
        pass

    def get_or_create_user(self, *, name: str, phone: str) -> dict[str, Any]:
        pass

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        pass
    def create_task(
        self,
        *,
        svn_url: str,
        old_revision: str,
        new_revision: str,
        report_path: str,
        user_id: str,
        requester: str,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        pass

    def get_task_for_user(self, task_id: str, user_id: str) -> dict[str, Any] | None:
        pass

    def list_tasks_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        pass

    def mark_running(self, task_id: str, *, worker_id: str) -> dict[str, Any]:
        pass

    def refresh_heartbeat(self, task_id: str) -> None:
        pass

    def mark_success(self, task_id: str) -> dict[str, Any]:
        pass

    def mark_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        pass

    def mark_enqueue_failed(self, task_id: str, error_message: str) -> dict[str, Any]:
        pass

    def get_user_stats(self, user_id: str) -> dict[str, int]:
        pass
```

`init_schema()` 创建 `users` 和 `tasks`，SQL 使用 PostgreSQL 语法：

```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    svn_url TEXT NOT NULL,
    old_revision TEXT NOT NULL,
    new_revision TEXT NOT NULL,
    requester TEXT,
    status TEXT NOT NULL,
    report_path TEXT,
    error_message TEXT,
    claimed_by TEXT,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 5: 更新测试夹具**

在 `tests/conftest.py` 增加一个内存 repository fixture，供纯业务测试使用：

```python
@pytest.fixture
def repository(tmp_path):
    from app.testing import InMemoryTaskRepository

    repo = InMemoryTaskRepository()
    repo.init_schema()
    return repo
```

同时创建 `app/testing.py`，实现和 `TaskRepository` 同名方法的内存版本，仅测试使用。实现要复用 `TaskStatus`，并保持返回 dict 字段与 PostgreSQL repository 一致。

- [ ] **Step 6: 运行 database 测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_database.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add app/postgres.py app/database.py app/testing.py tests/conftest.py tests/test_database.py
git commit -m "Add postgres-backed task repository contract"
```

---

### Task 4: Redis 调度器

**Files:**
- Create: `app/scheduler.py`
- Modify: `app/testing.py`
- Test: `tests/test_scheduler.py`

- [ ] **Step 1: 写调度器测试**

创建 `tests/test_scheduler.py`：

```python
from app.scheduler import InMemoryScheduler


def test_scheduler_claims_only_one_running_task_per_user():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-1", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert first == {"user_id": "user-1", "task_id": "task-1"}
    assert second is None


def test_scheduler_releases_user_and_claims_next_task():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-1", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    scheduler.complete_task(first["user_id"], first["task_id"])
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert second == {"user_id": "user-1", "task_id": "task-2"}


def test_scheduler_rotates_between_users():
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task("user-1", "task-1")
    scheduler.enqueue_task("user-2", "task-2")

    first = scheduler.claim_next_task(lock_ttl_seconds=60)
    second = scheduler.claim_next_task(lock_ttl_seconds=60)

    assert {first["user_id"], second["user_id"]} == {"user-1", "user-2"}


def test_scheduler_can_rebuild_from_pending_tasks():
    scheduler = InMemoryScheduler()
    scheduler.rebuild_from_tasks(
        [
            {"id": "task-1", "user_id": "user-1", "status": "pending"},
            {"id": "task-2", "user_id": "user-1", "status": "success"},
        ]
    )

    assert scheduler.claim_next_task(lock_ttl_seconds=60) == {
        "user_id": "user-1",
        "task_id": "task-1",
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_scheduler.py -v
```

Expected: FAIL，提示 `app.scheduler` 不存在。

- [ ] **Step 3: 创建 `app/scheduler.py`**

定义调度器协议和 Redis 实现：

```python
from __future__ import annotations

from collections import OrderedDict, deque
from typing import Protocol

from redis import Redis


class Scheduler(Protocol):
    def enqueue_task(self, user_id: str, task_id: str) -> None:
        pass

    def claim_next_task(self, *, lock_ttl_seconds: int) -> dict[str, str] | None:
        pass

    def complete_task(self, user_id: str, task_id: str) -> None:
        pass

    def refresh_lock(self, user_id: str, task_id: str, *, lock_ttl_seconds: int) -> None:
        pass

    def rebuild_from_tasks(self, tasks: list[dict]) -> None:
        pass


class RedisScheduler:
    CLAIM_SCRIPT = """
    local ready = redis.call('SPOP', KEYS[1])
    if not ready then return nil end
    local lock_key = ARGV[1] .. ready
    if redis.call('EXISTS', lock_key) == 1 then
      return nil
    end
    local queue_key = ARGV[2] .. ready
    local task_id = redis.call('LPOP', queue_key)
    if not task_id then
      return nil
    end
    redis.call('SET', lock_key, task_id, 'EX', ARGV[3])
    if redis.call('LLEN', queue_key) > 0 then
      redis.call('SADD', KEYS[1], ready)
    end
    return {ready, task_id}
    """

    def __init__(self, redis: Redis):
        self.redis = redis

    def enqueue_task(self, user_id: str, task_id: str) -> None:
        self.redis.rpush(f"queue:user:{user_id}", task_id)
        if not self.redis.exists(f"running:user:{user_id}"):
            self.redis.sadd("users:ready", user_id)
        self.redis.set(f"task:user:{task_id}", user_id)

    def claim_next_task(self, *, lock_ttl_seconds: int) -> dict[str, str] | None:
        result = self.redis.eval(
            self.CLAIM_SCRIPT,
            1,
            "users:ready",
            "running:user:",
            "queue:user:",
            str(lock_ttl_seconds),
        )
        if not result:
            return None
        user_id, task_id = [part.decode() if isinstance(part, bytes) else part for part in result]
        return {"user_id": user_id, "task_id": task_id}

    def complete_task(self, user_id: str, task_id: str) -> None:
        lock_key = f"running:user:{user_id}"
        current = self.redis.get(lock_key)
        if current is None or current.decode() == task_id:
            self.redis.delete(lock_key)
        if self.redis.llen(f"queue:user:{user_id}") > 0:
            self.redis.sadd("users:ready", user_id)

    def refresh_lock(self, user_id: str, task_id: str, *, lock_ttl_seconds: int) -> None:
        lock_key = f"running:user:{user_id}"
        current = self.redis.get(lock_key)
        if current is not None and current.decode() == task_id:
            self.redis.expire(lock_key, lock_ttl_seconds)

    def rebuild_from_tasks(self, tasks: list[dict]) -> None:
        for task in tasks:
            if str(task["status"]) == "pending":
                self.enqueue_task(task["user_id"], task["id"])
```

同文件增加 `InMemoryScheduler`，用 `OrderedDict[str, deque[str]]`、`dict[str, str]` 实现同样接口，供测试使用。

- [ ] **Step 4: 运行调度器测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_scheduler.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add app/scheduler.py tests/test_scheduler.py
git commit -m "Add redis user task scheduler"
```

---

### Task 5: 用户事件与 SSE

**Files:**
- Create: `app/events.py`
- Test: `tests/test_events.py`

- [ ] **Step 1: 写事件总线测试**

创建 `tests/test_events.py`：

```python
import json

import pytest

from app.events import InMemoryEventBus, format_sse


def test_format_sse_outputs_named_event_and_json_data():
    text = format_sse("task_updated", {"task_id": "task-1", "status": "running"})

    assert text.startswith("event: task_updated\n")
    assert 'data: {"task_id":"task-1","status":"running"}\n\n' in text


@pytest.mark.asyncio
async def test_in_memory_event_bus_publishes_to_user_stream():
    bus = InMemoryEventBus()
    stream = bus.subscribe("user-1")

    await bus.publish("user-1", "task_updated", {"task_id": "task-1"})
    event = await stream.__anext__()

    assert event["event"] == "task_updated"
    assert event["data"] == {"task_id": "task-1"}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_events.py -v
```

Expected: FAIL，提示 `app.events` 不存在。

- [ ] **Step 3: 创建 `app/events.py`**

```python
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator

from redis import Redis


def format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class InMemoryEventBus:
    def __init__(self):
        self.queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def publish(self, user_id: str, event: str, data: dict) -> None:
        for queue in list(self.queues[user_id]):
            await queue.put({"event": event, "data": data})

    async def subscribe(self, user_id: str) -> AsyncIterator[dict]:
        queue: asyncio.Queue = asyncio.Queue()
        self.queues[user_id].append(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self.queues[user_id].remove(queue)


class RedisEventBus:
    def __init__(self, redis: Redis):
        self.redis = redis

    async def publish(self, user_id: str, event: str, data: dict) -> None:
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        self.redis.publish(f"events:user:{user_id}", payload)
```

Redis 订阅在 Task 8 中实现为 `RedisEventBus.subscribe(user_id)`，返回与 `InMemoryEventBus.subscribe(user_id)` 相同结构的异步迭代器；本任务先交付事件格式和 in-memory 行为。

- [ ] **Step 4: 运行事件测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_events.py -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add app/events.py tests/test_events.py
git commit -m "Add user event bus and sse formatting"
```

---

### Task 6: API 登录、用户隔离与任务创建入队

**Files:**
- Modify: `app/main.py`
- Modify: `tests/conftest.py`
- Modify: `tests/test_api.py`

- [ ] **Step 1: 写 API 测试**

在 `tests/test_api.py` 增加：

```python
def login(client, name="张三", phone="13800138000"):
    return client.post("/api/session", json={"name": name, "phone": phone})


def test_login_creates_session_and_get_session_returns_user(api_client):
    login_response = login(api_client)

    assert login_response.status_code == 200
    assert "code_review_session" in login_response.headers["set-cookie"]

    session_response = api_client.get("/api/session")

    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True
    assert session_response.json()["user"]["name"] == "张三"


def test_post_tasks_requires_login(api_client):
    response = create_task(api_client)

    assert response.status_code == 401


def test_post_tasks_uses_session_user_and_enqueues_task(api_client, api_repository, api_scheduler):
    login(api_client, name="李四", phone="13900139000")

    response = create_task(api_client, requester="mallory")

    assert response.status_code == 200
    task_id = response.json()["task_id"]
    task = api_repository.get_task(task_id)
    assert task["requester"] == "李四"
    assert api_scheduler.claim_next_task(lock_ttl_seconds=60)["task_id"] == task_id


def test_user_cannot_read_other_users_task(api_client):
    login(api_client, name="用户一", phone="13100131000")
    task_id = create_task(api_client).json()["task_id"]
    api_client.delete("/api/session")
    login(api_client, name="用户二", phone="13200132000")

    response = api_client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -v
```

Expected: FAIL，当前 API 不要求登录，也没有 session 接口。

- [ ] **Step 3: 更新 `tests/conftest.py` 的 app 注入**

让 `create_app()` 支持传入 `repo`、`scheduler`、`event_bus`、`session_manager`。测试夹具：

```python
@pytest.fixture
def api_scheduler():
    from app.scheduler import InMemoryScheduler

    return InMemoryScheduler()


@pytest.fixture
def api_event_bus():
    from app.events import InMemoryEventBus

    return InMemoryEventBus()


@pytest.fixture
def api_repository(repository):
    return repository


@pytest.fixture
def api_client(api_paths, api_repository, api_scheduler, api_event_bus):
    from app.main import create_app

    app = create_app(
        **api_paths,
        start_worker=False,
        repo=api_repository,
        scheduler=api_scheduler,
        event_bus=api_event_bus,
    )
    with TestClient(app) as client:
        yield client
```

- [ ] **Step 4: 修改 `app/main.py` 的 `create_app()` 签名**

增加可注入依赖：

```python
def create_app(
    *,
    database_path: Path | str | None = None,
    reports_dir: Path | str | None = None,
    workspaces_dir: Path | str | None = None,
    start_worker: bool = True,
    prompt_template_path: Path | str | None = None,
    app_settings: Settings = settings,
    repo: TaskRepository | None = None,
    scheduler: Scheduler | None = None,
    event_bus: InMemoryEventBus | RedisEventBus | None = None,
) -> FastAPI:
```

如果未传入 repo，则用 `PostgresDatabase(app_settings.database_url)` 创建 `TaskRepository`。如果未传入 scheduler，则用 `Redis.from_url(app_settings.redis_url)` 创建 `RedisScheduler`。

- [ ] **Step 5: 在 `app/main.py` 增加 session API**

核心逻辑：

```python
session_manager = SessionManager(app_settings.session_secret_key)


def current_user(request: Request) -> dict[str, Any]:
    user_id = session_manager.read_user_id(request.cookies.get(SESSION_COOKIE_NAME))
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    user = repo.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


@app.post("/api/session", response_model=SessionResponse)
def create_session(request: SessionCreateRequest, response: Response) -> SessionResponse:
    try:
        phone = normalize_phone(request.phone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = repo.get_or_create_user(name=request.name.strip(), phone=phone)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_manager.create_cookie_value(user["id"]),
        httponly=True,
        samesite="lax",
    )
    return SessionResponse(authenticated=True, user=_to_user_response(user))
```

同时增加 `GET /api/session` 和 `DELETE /api/session`。

- [ ] **Step 6: 调整任务 API**

`POST /api/tasks` 调用 `current_user()`，创建任务时传：

```python
task = repo.create_task(
    svn_url=svn_url,
    old_revision=old_revision,
    new_revision=new_revision,
    requester=user["name"],
    user_id=user["id"],
    report_path=str(report_path),
    task_id=task_id,
)
scheduler.enqueue_task(user["id"], task_id)
await_or_run_publish(event_bus, user["id"], "task_created", {"task_id": task_id, "status": "pending"})
```

Redis 入队失败时：

```python
repo.mark_enqueue_failed(task_id, "Redis enqueue failed")
raise HTTPException(status_code=503, detail="Task scheduler is unavailable")
```

`GET /api/tasks` 改为 `repo.list_tasks_for_user(user["id"])`，单任务、报告和下载接口改用 `repo.get_task_for_user(task_id, user["id"])`。

- [ ] **Step 7: 运行 API 测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -v
```

Expected: PASS。

- [ ] **Step 8: 提交**

```powershell
git add app/main.py tests/conftest.py tests/test_api.py
git commit -m "Add session-aware task api"
```

---

### Task 7: Worker 接入调度器、心跳和事件

**Files:**
- Modify: `app/worker.py`
- Modify: `app/main.py`
- Modify: `tests/test_worker.py`

- [ ] **Step 1: 写 worker 调度测试**

在 `tests/test_worker.py` 增加：

```python
def test_process_one_claims_from_scheduler_and_releases_user_lock(tmp_path, repository):
    user = repository.get_or_create_user(name="张三", phone="13800138000")
    task = create_task(repository, user_id=user["id"], requester=user["name"])
    scheduler = InMemoryScheduler()
    scheduler.enqueue_task(user["id"], task["id"])
    event_bus = RecordingEventBus()
    worker = make_worker(tmp_path, repository, FakeRunner(), scheduler=scheduler, event_bus=event_bus)

    processed = worker.process_one()

    assert processed is True
    assert repository.get_task(task["id"])["status"] == TaskStatus.success
    assert scheduler.claim_next_task(lock_ttl_seconds=60) is None
    assert event_bus.events[-1]["event"] == "task_updated"


class RecordingEventBus:
    def __init__(self):
        self.events = []

    async def publish(self, user_id, event, data):
        self.events.append({"user_id": user_id, "event": event, "data": data})
```

调整测试 helper `create_task()`，增加默认用户：

```python
def create_task(repository, *, task_id="task-1", report_path=None, user_id=None, requester="alice"):
    if user_id is None:
        user = repository.get_or_create_user(name=requester, phone="13800138000")
        user_id = user["id"]
    if report_path is None:
        report_path = repository.base_dir / "reports" / f"{task_id}.md"
    return repository.create_task(
        svn_url="https://example.test/svn/project",
        old_revision="100",
        new_revision="101",
        requester=requester,
        report_path=str(report_path),
        user_id=user_id,
        task_id=task_id,
    )
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_worker.py -v
```

Expected: FAIL，当前 worker 仍从 repo 直接 claim。

- [ ] **Step 3: 修改 `Worker.__init__`**

新增参数：

```python
        scheduler,
        event_bus,
        worker_id: str,
        lock_ttl_seconds: int,
```

保存到实例字段。

- [ ] **Step 4: 修改 `Worker.process_one()`**

领取任务：

```python
claim = self.scheduler.claim_next_task(lock_ttl_seconds=self.lock_ttl_seconds)
if claim is None:
    return False
task = self.repo.mark_running(claim["task_id"], worker_id=self.worker_id)
```

成功或失败后调用：

```python
self.scheduler.complete_task(task["user_id"], task_id)
self._publish_event(task["user_id"], "task_updated", {"task_id": task_id, "status": "success"})
```

增加同步 worker 调用 async 事件的 helper：

```python
def _publish_event(self, user_id: str, event: str, data: dict) -> None:
    result = self.event_bus.publish(user_id, event, data)
    if inspect.isawaitable(result):
        asyncio.run(result)
```

异常路径也必须释放用户锁并发布 `failed`。

- [ ] **Step 5: 修改 `app/main.py` worker 构造**

传入：

```python
worker = Worker(
    repo=repo,
    scheduler=scheduler,
    event_bus=event_bus,
    runner=runner,
    prompt_template=prompt_template,
    workspaces_dir=workspaces_dir,
    timeout_seconds=app_settings.codex_timeout_seconds,
    worker_id=app_settings.worker_id,
    lock_ttl_seconds=app_settings.redis_lock_ttl_seconds,
)
```

- [ ] **Step 6: 运行 worker 测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_worker.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add app/worker.py app/main.py tests/test_worker.py
git commit -m "Run worker tasks through redis scheduler"
```

---

### Task 8: SSE API 与前端动态刷新

**Files:**
- Modify: `app/main.py`
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `static/styles.css`
- Modify: `tests/test_api.py`
- Modify: `tests/test_frontend_static.py`

- [ ] **Step 1: 写 API 和静态测试**

在 `tests/test_api.py` 增加：

```python
def test_events_requires_login(api_client):
    response = api_client.get("/api/events")

    assert response.status_code == 401


def test_login_page_is_served(api_client):
    response = api_client.get("/login")

    assert response.status_code == 200
    assert "login-form" in response.text
```

在 `tests/test_frontend_static.py` 增加：

```python
def test_task_console_uses_eventsource_and_keeps_layout_markers():
    html = Path("static/index.html").read_text(encoding="utf-8")
    js = Path("static/app.js").read_text(encoding="utf-8")

    assert 'class="workspace-grid review-workbench"' in html
    assert 'class="left-rail"' in html
    assert 'class="right-stage"' in html
    assert 'id="current-user"' in html
    assert "new EventSource(\"/api/events\")" in js
    assert "loadRecentTasks" in js
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py tests/test_frontend_static.py -v
```

Expected: FAIL，当前无 `/login` API、`/api/events` 和 `EventSource`。

- [ ] **Step 3: 在 `app/main.py` 服务登录页**

新增：

```python
@app.get("/login")
def serve_login() -> FileResponse:
    return FileResponse(static_dir / "login.html", media_type="text/html")
```

- [ ] **Step 4: 在 `app/main.py` 增加 `/api/events`**

实现：

```python
@app.get("/api/events")
async def stream_events(request: Request):
    user = current_user(request)

    async def generate():
        async for event in event_bus.subscribe(user["id"]):
            if await request.is_disconnected():
                break
            yield format_sse(event["event"], event["data"])

    return StreamingResponse(generate(), media_type="text/event-stream")
```

在本步骤中实现 `RedisEventBus.subscribe(user_id)`：使用 Redis pubsub 订阅 `events:user:{user_id}`，解析 JSON 后 yield `{"event": "task_updated", "data": {"task_id": "task-1", "status": "running"}}` 这种结构；API 测试仍使用 `InMemoryEventBus`。

- [ ] **Step 5: 修改 `static/index.html`**

保留布局 marker，只在 header/status 区增加：

```html
<div class="user-strip">
  <span id="current-user">未登录</span>
  <button id="logout-button" type="button">退出</button>
</div>
```

将 requester 输入改为隐藏或移除。如果保留 DOM 兼容测试，设置为：

```html
<input type="hidden" name="requester" value="">
```

- [ ] **Step 6: 修改 `static/app.js`**

在顶部 state 增加：

```javascript
  eventSource: null,
  currentUser: null,
```

启动流程改为：

```javascript
initialize();

async function initialize() {
  const session = await loadSession();
  if (!session.authenticated) {
    window.location.href = "/login";
    return;
  }
  state.currentUser = session.user;
  elements.currentUser.textContent = `${session.user.name} ${session.user.phone}`;
  connectEvents();
  await loadRecentTasks();
}
```

增加：

```javascript
async function loadSession() {
  const response = await fetch("/api/session");
  if (response.status === 401) {
    return { authenticated: false };
  }
  return readJson(response);
}

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource("/api/events");
  state.eventSource.addEventListener("task_created", refreshFromEvent);
  state.eventSource.addEventListener("task_updated", refreshFromEvent);
  state.eventSource.addEventListener("open", () => loadRecentTasks());
}

async function refreshFromEvent(event) {
  const data = JSON.parse(event.data || "{}");
  await loadRecentTasks();
  if (data.task_id && (!state.currentTaskId || state.currentTaskId === data.task_id)) {
    await loadTask(data.task_id);
  }
}
```

退出：

```javascript
elements.logoutButton.addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  window.location.href = "/login";
});
```

- [ ] **Step 7: 补充 CSS**

在 `static/styles.css` 增加登录页和用户条样式，保持现有任务台布局不变：

```css
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
}

.login-panel {
  width: min(360px, calc(100vw - 32px));
}

.user-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
}
```

- [ ] **Step 8: 运行 API 和前端静态测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py tests/test_frontend_static.py -v
```

Expected: PASS。

- [ ] **Step 9: 提交**

```powershell
git add app/main.py static/index.html static/app.js static/styles.css tests/test_api.py tests/test_frontend_static.py
git commit -m "Add sse updates to task console"
```

---

### Task 9: 清理、恢复与全量验证

**Files:**
- Modify: `app/cleanup.py`
- Modify: `README.md`
- Modify: `tests/test_cleanup.py`

- [ ] **Step 1: 写陈旧 running 任务恢复测试**

在 `tests/test_database.py` 或 `tests/test_cleanup.py` 增加：

```python
def test_fail_stale_running_tasks_marks_failed_and_keeps_user_queue_recoverable(repository):
    user = repository.get_or_create_user(name="张三", phone="13800138000")
    task = repository.create_task(
        svn_url="https://example.test/svn/repo",
        old_revision="r1",
        new_revision="r2",
        requester=user["name"],
        report_path="reports/task.md",
        user_id=user["id"],
        task_id="task-1",
    )
    repository.mark_running(task["id"], worker_id="worker-a")

    failed = repository.fail_stale_running_tasks("2999-01-01T00:00:00+00:00", "stale worker task")

    assert failed[0]["id"] == "task-1"
    assert repository.get_task("task-1")["status"] == TaskStatus.failed
```

- [ ] **Step 2: 运行相关测试确认失败或缺口**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_database.py tests/test_cleanup.py -v
```

Expected: 如果方法已迁移完整则 PASS；否则 FAIL 并指出缺失方法。

- [ ] **Step 3: 实现 repository 恢复方法**

确保 `TaskRepository.fail_stale_running_tasks()` 使用 `heartbeat_at` 判断：

```sql
UPDATE tasks
SET status = 'failed',
    finished_at = %(now)s,
    updated_at = %(now)s,
    error_message = %(error_message)s
WHERE status = 'running'
  AND heartbeat_at < %(cutoff)s
RETURNING *
```

- [ ] **Step 4: 更新 README**

将关键配置写入 README：

```markdown
- `DATABASE_URL`：PostgreSQL 连接串，默认 `postgresql://postgres:postgres@127.0.0.1:5432/code_review`。
- `REDIS_URL`：Redis 连接串，默认 `redis://127.0.0.1:6379/0`。
- `SESSION_SECRET_KEY`：session cookie 签名密钥，生产环境必须显式设置。
- `WORKER_ID`：worker 标识，用于任务 claim 诊断。
- `REDIS_LOCK_TTL_SECONDS`：用户运行锁 TTL。
```

增加手动集成验证步骤：

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
$env:REDIS_URL = "redis://127.0.0.1:6379/0"
.\.venv\Scripts\python.exe -m uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

- [ ] **Step 5: 运行全量测试**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add app/cleanup.py app/database.py README.md tests/test_database.py tests/test_cleanup.py
git commit -m "Document postgres redis deployment and recovery"
```

---

## 自检

- Spec 覆盖：登录页、姓名手机号 session、PostgreSQL 用户与任务模型、Redis 用户队列、每用户单 running、SSE 动态刷新、任务归属隔离、Redis 故障、陈旧 running 失败处理、测试策略均有任务覆盖。
- 范围控制：不实现密码、管理员、SSO、完整 SPA，也不强制旧 SQLite 在线迁移。
- 类型一致性：计划中统一使用 `user_id`、`task_id`、`SessionCreateRequest`、`SessionResponse`、`UserStatsResponse`、`enqueue_failed`。
- 执行风险：Task 3 的 PostgreSQL repository 与测试内存 repository 必须保持同一方法集合；每新增 repository 方法，同一个任务内必须同步实现测试 fake，避免 API/worker 测试被真实数据库阻塞。
