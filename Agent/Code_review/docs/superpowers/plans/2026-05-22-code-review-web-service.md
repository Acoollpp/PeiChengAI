# Codex 代码审查 Web 服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地可运行的 FastAPI Web 服务，让用户提交 SVN 版本范围，后台调用 Codex CLI 和 `skills/通用-代码变更审查` 生成 Markdown 报告，并支持预览、下载和 90 天清理。

**Architecture:** 使用 FastAPI 提供 API 和静态前端，SQLite 保存任务元数据，单后台 Worker 轮询 `pending` 任务并调用 Codex。前端通过轮询任务状态展示执行进度，报告文件保存到 `data/reports/<task_id>.md`。

**Tech Stack:** Python 3.11+、FastAPI、Uvicorn、SQLite、pytest、httpx、原生 HTML/CSS/JavaScript。

---

## File Structure

- Create: `requirements.txt` - Python runtime and test dependencies.
- Create: `README.md` - 本地运行、测试、配置和真实 Codex 联调说明。
- Create: `.gitignore` - 忽略虚拟环境、缓存、数据库和生成报告。
- Create: `config/prompt_template.md` - Codex Prompt 模板。
- Create: `app/__init__.py` - Python package marker.
- Create: `app/config.py` - 环境变量配置、路径配置、默认值。
- Create: `app/validation.py` - SVN URL 和版本号校验。
- Create: `app/database.py` - SQLite 连接、表结构初始化、任务 CRUD。
- Create: `app/models.py` - Pydantic 请求/响应模型和任务状态常量。
- Create: `app/codex_runner.py` - Codex 命令构造和 subprocess 执行封装。
- Create: `app/worker.py` - 后台 Worker、任务领取、Prompt 渲染、状态更新。
- Create: `app/cleanup.py` - 90 天任务、报告、工作目录清理。
- Create: `app/main.py` - FastAPI app、生命周期、API、静态文件挂载。
- Create: `static/index.html` - 单页 Web 工具。
- Create: `static/styles.css` - 前端样式。
- Create: `static/app.js` - 表单提交、轮询、Markdown 加载、下载。
- Create: `tests/test_validation.py` - 输入校验测试。
- Create: `tests/test_database.py` - SQLite 任务存储测试。
- Create: `tests/test_worker.py` - fake Codex Worker 测试。
- Create: `tests/test_api.py` - API 测试。
- Create: `tests/conftest.py` - pytest 临时 app 配置。

## Task 1: Project Scaffold And Configuration

**Files:**
- Create: `requirements.txt`
- Create: `.gitignore`
- Create: `README.md`
- Create: `config/prompt_template.md`
- Create: `app/__init__.py`
- Create: `app/config.py`

- [ ] **Step 1: Write dependency file**

Create `requirements.txt`:

```text
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.10.4
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 2: Add git ignore rules**

Create `.gitignore`:

```gitignore
.venv/
__pycache__/
.pytest_cache/
*.pyc
data/
*.db
*.sqlite3
```

- [ ] **Step 3: Add README with local commands**

Create `README.md`:

````markdown
# Codex 代码审查 Web 服务

## 本地启动

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

打开 `http://127.0.0.1:8000`。

## 测试

```powershell
pytest
```

## 关键配置

- `APP_BASE_DIR`：应用数据目录，默认当前工作目录。
- `DATABASE_PATH`：SQLite 数据库路径，默认 `data/app.db`。
- `SVN_ALLOWED_PREFIX`：允许提交的 SVN URL 前缀，默认 `https://192.168.0.233/svn/src_home/`。
- `CODEX_COMMAND`：Codex 命令，默认 `codex`。
- `CODEX_ARGS`：Codex 参数，默认 `exec --dangerously-bypass-approvals-and-sandbox`。
- `CODEX_TIMEOUT_SECONDS`：Codex 超时时间，默认 1800。
- `WORKER_POLL_SECONDS`：Worker 轮询间隔，默认 2。

## 真实 Codex 联调

服务器系统账号需要提前配置好 SVN 凭据。Web 服务不会收集 SVN 用户名或密码。
````

- [ ] **Step 4: Add prompt template**

Create `config/prompt_template.md`:

```markdown
请使用当前工作区中的 skill：skills/通用-代码变更审查

用这个更新后的代码审查：
- 项目路径：{svn_url}
- 旧版本号：{old_revision}
- 新版本号：{new_revision}
- 报告输出路径：{report_path}

要求：
1. 按该 skill 的输入模块、SVN 获取策略、规则模块和输出模块执行。
2. 最终必须生成 Markdown 报告文件到指定报告输出路径。
3. 只需要输出最终完成状态和报告路径，不需要在终端输出完整报告正文。
```

- [ ] **Step 5: Add app package marker**

Create `app/__init__.py`:

```python
"""Codex code review web service."""
```

- [ ] **Step 6: Add settings module**

Create `app/config.py`:

```python
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    base_dir: Path
    database_path: Path
    reports_dir: Path
    workspaces_dir: Path
    prompt_template_path: Path
    svn_allowed_prefix: str
    codex_command: str
    codex_args: tuple[str, ...]
    codex_timeout_seconds: int
    worker_poll_seconds: float
    retention_days: int


def load_settings() -> Settings:
    base_dir = Path(os.getenv("APP_BASE_DIR", Path.cwd())).resolve()
    data_dir = base_dir / "data"
    codex_args = tuple(
        arg for arg in os.getenv(
            "CODEX_ARGS",
            "exec --dangerously-bypass-approvals-and-sandbox",
        ).split(" ") if arg
    )
    return Settings(
        base_dir=base_dir,
        database_path=Path(os.getenv("DATABASE_PATH", data_dir / "app.db")).resolve(),
        reports_dir=Path(os.getenv("REPORTS_DIR", data_dir / "reports")).resolve(),
        workspaces_dir=Path(os.getenv("WORKSPACES_DIR", data_dir / "workspaces")).resolve(),
        prompt_template_path=Path(
            os.getenv("PROMPT_TEMPLATE_PATH", base_dir / "config" / "prompt_template.md")
        ).resolve(),
        svn_allowed_prefix=os.getenv(
            "SVN_ALLOWED_PREFIX",
            "https://192.168.0.233/svn/src_home/",
        ),
        codex_command=os.getenv("CODEX_COMMAND", "codex"),
        codex_args=codex_args,
        codex_timeout_seconds=int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800")),
        worker_poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "2")),
        retention_days=int(os.getenv("RETENTION_DAYS", "90")),
    )


settings = load_settings()
```

- [ ] **Step 7: Verify imports**

Run: `python -m compileall app`

Expected: command exits with code 0.

- [ ] **Step 8: Commit scaffold**

```bash
git add requirements.txt .gitignore README.md config/prompt_template.md app/__init__.py app/config.py
git commit -m "chore: scaffold code review web service"
```

## Task 2: Validation And API Models

**Files:**
- Create: `app/validation.py`
- Create: `app/models.py`
- Create: `tests/test_validation.py`

- [ ] **Step 1: Write failing validation tests**

Create `tests/test_validation.py`:

```python
import pytest

from app.validation import normalize_revision, validate_svn_url


def test_normalize_revision_adds_r_prefix():
    assert normalize_revision("25576") == "r25576"


def test_normalize_revision_keeps_r_prefix():
    assert normalize_revision("r29303") == "r29303"


def test_normalize_revision_rejects_invalid_value():
    with pytest.raises(ValueError, match="版本号"):
        normalize_revision("r25x")


def test_validate_svn_url_accepts_allowed_prefix():
    url = "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T"
    assert validate_svn_url(url, "https://192.168.0.233/svn/src_home/") == url


def test_validate_svn_url_rejects_other_hosts():
    with pytest.raises(ValueError, match="SVN"):
        validate_svn_url("https://example.com/repo", "https://192.168.0.233/svn/src_home/")
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pytest tests/test_validation.py -v`

Expected: FAIL because `app.validation` does not exist yet.

- [ ] **Step 3: Implement validation module**

Create `app/validation.py`:

```python
from __future__ import annotations

import re

REVISION_RE = re.compile(r"^r?\d+$", re.IGNORECASE)


def normalize_revision(value: str) -> str:
    cleaned = value.strip()
    if not REVISION_RE.match(cleaned):
        raise ValueError("版本号只允许 r数字 或 数字 格式")
    digits = cleaned[1:] if cleaned.lower().startswith("r") else cleaned
    return f"r{digits}"


def validate_svn_url(value: str, allowed_prefix: str) -> str:
    cleaned = value.strip()
    if not cleaned.startswith(allowed_prefix):
        raise ValueError(f"SVN 项目路径必须以 {allowed_prefix} 开头")
    return cleaned
```

- [ ] **Step 4: Add models**

Create `app/models.py`:

```python
from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class TaskStatus(StrEnum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"


class TaskCreateRequest(BaseModel):
    svn_url: str = Field(min_length=1)
    old_revision: str = Field(min_length=1)
    new_revision: str = Field(min_length=1)
    requester: str | None = None


class TaskCreateResponse(BaseModel):
    task_id: str
    status: TaskStatus


class TaskResponse(BaseModel):
    task_id: str
    svn_url: str
    old_revision: str
    new_revision: str
    requester: str
    status: TaskStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None
    report_available: bool
```

- [ ] **Step 5: Run validation tests**

Run: `pytest tests/test_validation.py -v`

Expected: PASS.

- [ ] **Step 6: Commit validation and models**

```bash
git add app/validation.py app/models.py tests/test_validation.py
git commit -m "feat: add task input validation"
```

## Task 3: SQLite Task Repository

**Files:**
- Create: `app/database.py`
- Create: `tests/test_database.py`

- [ ] **Step 1: Write failing database tests**

Create `tests/test_database.py`:

```python
from pathlib import Path

from app.database import TaskRepository
from app.models import TaskStatus


def test_create_and_get_task(tmp_path: Path):
    repo = TaskRepository(tmp_path / "app.db")
    repo.init_schema()

    task = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="alice",
        report_path=str(tmp_path / "report.md"),
    )

    saved = repo.get_task(task["id"])
    assert saved is not None
    assert saved["status"] == TaskStatus.pending
    assert saved["requester"] == "alice"


def test_claim_next_pending_task(tmp_path: Path):
    repo = TaskRepository(tmp_path / "app.db")
    repo.init_schema()
    created = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="anonymous",
        report_path=str(tmp_path / "report.md"),
    )

    claimed = repo.claim_next_task()

    assert claimed is not None
    assert claimed["id"] == created["id"]
    assert repo.get_task(created["id"])["status"] == TaskStatus.running


def test_mark_success_sets_finished_at(tmp_path: Path):
    repo = TaskRepository(tmp_path / "app.db")
    repo.init_schema()
    task = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="anonymous",
        report_path=str(tmp_path / "report.md"),
    )

    repo.mark_success(task["id"])
    saved = repo.get_task(task["id"])

    assert saved["status"] == TaskStatus.success
    assert saved["finished_at"] is not None
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pytest tests/test_database.py -v`

Expected: FAIL because `app.database` does not exist yet.

- [ ] **Step 3: Implement repository**

Create `app/database.py`:

```python
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.models import TaskStatus


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskRepository:
    def __init__(self, database_path: Path):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    svn_url TEXT NOT NULL,
                    old_revision TEXT NOT NULL,
                    new_revision TEXT NOT NULL,
                    requester TEXT NOT NULL,
                    status TEXT NOT NULL,
                    report_path TEXT NOT NULL,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at)")

    def create_task(
        self,
        *,
        svn_url: str,
        old_revision: str,
        new_revision: str,
        requester: str,
        report_path: str,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        task_id = task_id or str(uuid.uuid4())
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    id, svn_url, old_revision, new_revision, requester, status,
                    report_path, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    svn_url,
                    old_revision,
                    new_revision,
                    requester or "anonymous",
                    TaskStatus.pending.value,
                    report_path,
                    now,
                    now,
                ),
            )
        return self.get_task(task_id)

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return self._row_to_task(row)

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def claim_next_task(self) -> dict[str, Any] | None:
        now = utc_now()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC LIMIT 1",
                (TaskStatus.pending.value,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                """
                UPDATE tasks
                SET status = ?, started_at = ?, updated_at = ?
                WHERE id = ? AND status = ?
                """,
                (
                    TaskStatus.running.value,
                    now,
                    now,
                    row["id"],
                    TaskStatus.pending.value,
                ),
            )
        return self.get_task(row["id"])

    def mark_success(self, task_id: str) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                "UPDATE tasks SET status = ?, finished_at = ?, updated_at = ?, error_message = NULL WHERE id = ?",
                (TaskStatus.success.value, now, now, task_id),
            )

    def mark_failed(self, task_id: str, error_message: str) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                "UPDATE tasks SET status = ?, finished_at = ?, updated_at = ?, error_message = ? WHERE id = ?",
                (TaskStatus.failed.value, now, now, error_message[:1000], task_id),
            )

    def delete_older_than(self, cutoff_iso: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE created_at < ?",
                (cutoff_iso,),
            ).fetchall()
            task_ids = [row["id"] for row in rows]
            conn.executemany("DELETE FROM tasks WHERE id = ?", [(task_id,) for task_id in task_ids])
        return [self._row_to_task(row) for row in rows]

    def _row_to_task(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        task = dict(row)
        task["status"] = TaskStatus(task["status"])
        return task
```

- [ ] **Step 4: Run database tests**

Run: `pytest tests/test_database.py -v`

Expected: PASS.

- [ ] **Step 5: Commit repository**

```bash
git add app/database.py tests/test_database.py
git commit -m "feat: add sqlite task repository"
```

## Task 4: Codex Runner And Worker

**Files:**
- Create: `app/codex_runner.py`
- Create: `app/worker.py`
- Create: `tests/test_worker.py`

- [ ] **Step 1: Write failing worker tests**

Create `tests/test_worker.py`:

```python
from pathlib import Path

from app.database import TaskRepository
from app.models import TaskStatus
from app.worker import Worker


class FakeRunner:
    def __init__(self, should_write_report=True, return_code=0):
        self.should_write_report = should_write_report
        self.return_code = return_code
        self.calls = []

    def run(self, *, prompt: str, cwd: Path, timeout_seconds: int):
        self.calls.append((prompt, cwd, timeout_seconds))
        if self.should_write_report:
            marker = "- 报告输出路径："
            report_path = Path(prompt.split(marker)[1].splitlines()[0].strip())
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text("# 审查报告\n", encoding="utf-8")
        return self.return_code, "ok", ""


def create_repo_with_task(tmp_path: Path) -> tuple[TaskRepository, dict]:
    repo = TaskRepository(tmp_path / "app.db")
    repo.init_schema()
    task = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="anonymous",
        report_path=str(tmp_path / "reports" / "task.md"),
    )
    return repo, task


def test_worker_marks_success_when_report_exists(tmp_path: Path):
    repo, task = create_repo_with_task(tmp_path)
    template = "项目路径：{svn_url}\n- 报告输出路径：{report_path}\n"
    worker = Worker(
        repo=repo,
        runner=FakeRunner(),
        prompt_template=template,
        workspaces_dir=tmp_path / "workspaces",
        timeout_seconds=10,
    )

    assert worker.process_one() is True

    saved = repo.get_task(task["id"])
    assert saved["status"] == TaskStatus.success


def test_worker_marks_failed_when_report_missing(tmp_path: Path):
    repo, task = create_repo_with_task(tmp_path)
    template = "项目路径：{svn_url}\n- 报告输出路径：{report_path}\n"
    worker = Worker(
        repo=repo,
        runner=FakeRunner(should_write_report=False),
        prompt_template=template,
        workspaces_dir=tmp_path / "workspaces",
        timeout_seconds=10,
    )

    worker.process_one()

    saved = repo.get_task(task["id"])
    assert saved["status"] == TaskStatus.failed
    assert "报告" in saved["error_message"]
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pytest tests/test_worker.py -v`

Expected: FAIL because worker and runner modules do not exist yet.

- [ ] **Step 3: Implement Codex runner**

Create `app/codex_runner.py`:

```python
from __future__ import annotations

import subprocess
from pathlib import Path


class CodexRunner:
    def __init__(self, command: str, args: tuple[str, ...]):
        self.command = command
        self.args = args

    def run(self, *, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        completed = subprocess.run(
            [self.command, *self.args, prompt],
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        return completed.returncode, completed.stdout, completed.stderr
```

- [ ] **Step 4: Implement Worker**

Create `app/worker.py`:

```python
from __future__ import annotations

import logging
import subprocess
import threading
import time
from pathlib import Path
from typing import Protocol

from app.database import TaskRepository

logger = logging.getLogger(__name__)


class Runner(Protocol):
    def run(self, *, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        ...


class Worker:
    def __init__(
        self,
        *,
        repo: TaskRepository,
        runner: Runner,
        prompt_template: str,
        workspaces_dir: Path,
        timeout_seconds: int,
    ):
        self.repo = repo
        self.runner = runner
        self.prompt_template = prompt_template
        self.workspaces_dir = Path(workspaces_dir)
        self.timeout_seconds = timeout_seconds

    def process_one(self) -> bool:
        task = self.repo.claim_next_task()
        if task is None:
            return False

        task_id = task["id"]
        workspace = self.workspaces_dir / task_id
        workspace.mkdir(parents=True, exist_ok=True)
        report_path = Path(task["report_path"]).resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        prompt = self.prompt_template.format(
            svn_url=task["svn_url"],
            old_revision=task["old_revision"],
            new_revision=task["new_revision"],
            report_path=str(report_path),
        )

        try:
            return_code, stdout, stderr = self.runner.run(
                prompt=prompt,
                cwd=workspace,
                timeout_seconds=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            self.repo.mark_failed(task_id, "Codex 执行超时")
            return True
        except Exception as exc:
            logger.exception("Codex execution failed")
            self.repo.mark_failed(task_id, f"Codex 执行失败：{exc}")
            return True

        if return_code != 0:
            message = (stderr or stdout or "Codex 执行失败").strip()
            self.repo.mark_failed(task_id, message[:1000])
            return True

        if not report_path.exists() or report_path.stat().st_size == 0:
            self.repo.mark_failed(task_id, "Codex 未生成有效 Markdown 报告")
            return True

        self.repo.mark_success(task_id)
        return True


class WorkerThread:
    def __init__(self, worker: Worker, poll_seconds: float):
        self.worker = worker
        self.poll_seconds = poll_seconds
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            processed = self.worker.process_one()
            if not processed:
                time.sleep(self.poll_seconds)
```

- [ ] **Step 5: Run worker tests**

Run: `pytest tests/test_worker.py -v`

Expected: PASS.

- [ ] **Step 6: Commit worker**

```bash
git add app/codex_runner.py app/worker.py tests/test_worker.py
git commit -m "feat: add codex worker"
```

## Task 5: Cleanup Logic

**Files:**
- Create: `app/cleanup.py`
- Modify: `tests/test_database.py`

- [ ] **Step 1: Add cleanup test**

Append to `tests/test_database.py`:

```python
from datetime import datetime, timedelta, timezone

from app.cleanup import cleanup_old_tasks


def test_cleanup_deletes_old_task_files(tmp_path: Path):
    repo = TaskRepository(tmp_path / "app.db")
    repo.init_schema()
    report = tmp_path / "reports" / "old.md"
    report.parent.mkdir(parents=True)
    report.write_text("# old\n", encoding="utf-8")
    workspace = tmp_path / "workspaces" / "old-task"
    workspace.mkdir(parents=True)

    task = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="anonymous",
        report_path=str(report),
    )
    with repo.connect() as conn:
        old_time = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        conn.execute("UPDATE tasks SET id = ?, created_at = ? WHERE id = ?", ("old-task", old_time, task["id"]))

    deleted = cleanup_old_tasks(repo, tmp_path / "workspaces", retention_days=90)

    assert deleted == 1
    assert not report.exists()
    assert not workspace.exists()
```

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_database.py::test_cleanup_deletes_old_task_files -v`

Expected: FAIL because `app.cleanup` does not exist yet.

- [ ] **Step 3: Implement cleanup module**

Create `app/cleanup.py`:

```python
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database import TaskRepository

logger = logging.getLogger(__name__)


def cleanup_old_tasks(repo: TaskRepository, workspaces_dir: Path, retention_days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    old_tasks = repo.delete_older_than(cutoff.isoformat())

    for task in old_tasks:
        _remove_file(Path(task["report_path"]))
        _remove_dir(Path(workspaces_dir) / task["id"])

    return len(old_tasks)


def _remove_file(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        logger.exception("Failed to delete report file %s", path)


def _remove_dir(path: Path) -> None:
    try:
        if path.exists():
            shutil.rmtree(path)
    except OSError:
        logger.exception("Failed to delete workspace %s", path)
```

- [ ] **Step 4: Run cleanup test**

Run: `pytest tests/test_database.py::test_cleanup_deletes_old_task_files -v`

Expected: PASS.

- [ ] **Step 5: Commit cleanup**

```bash
git add app/cleanup.py tests/test_database.py
git commit -m "feat: add task retention cleanup"
```

## Task 6: FastAPI API

**Files:**
- Create: `app/main.py`
- Create: `tests/conftest.py`
- Create: `tests/test_api.py`

- [ ] **Step 1: Write API tests**

Create `tests/conftest.py`:

```python
from pathlib import Path

import pytest

from app.main import create_app


@pytest.fixture
def test_app(tmp_path: Path):
    return create_app(
        database_path=tmp_path / "app.db",
        reports_dir=tmp_path / "reports",
        workspaces_dir=tmp_path / "workspaces",
        start_worker=False,
    )
```

Create `tests/test_api.py`:

```python
from pathlib import Path

from fastapi.testclient import TestClient

from app.database import TaskRepository


def test_create_task(test_app):
    client = TestClient(test_app)

    response = client.post(
        "/api/tasks",
        json={
            "svn_url": "https://192.168.0.233/svn/src_home/demo",
            "old_revision": "1",
            "new_revision": "r2",
            "requester": "alice",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending"
    assert body["task_id"]


def test_create_task_rejects_invalid_url(test_app):
    client = TestClient(test_app)

    response = client.post(
        "/api/tasks",
        json={
            "svn_url": "https://example.com/demo",
            "old_revision": "1",
            "new_revision": "2",
        },
    )

    assert response.status_code == 400


def test_get_report_after_success(test_app, tmp_path: Path):
    client = TestClient(test_app)
    repo = TaskRepository(tmp_path / "app.db")
    report = tmp_path / "reports" / "report.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("# 报告\n", encoding="utf-8")
    task = repo.create_task(
        svn_url="https://192.168.0.233/svn/src_home/demo",
        old_revision="r1",
        new_revision="r2",
        requester="anonymous",
        report_path=str(report),
    )
    repo.mark_success(task["id"])

    response = client.get(f"/api/tasks/{task['id']}/report")

    assert response.status_code == 200
    assert "# 报告" in response.text
```

- [ ] **Step 2: Run API tests to verify failure**

Run: `pytest tests/test_api.py -v`

Expected: FAIL because `app.main` does not exist yet.

- [ ] **Step 3: Implement FastAPI app**

Create `app/main.py`:

```python
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.cleanup import cleanup_old_tasks
from app.codex_runner import CodexRunner
from app.config import settings
from app.database import TaskRepository
from app.models import TaskCreateRequest, TaskCreateResponse, TaskResponse, TaskStatus
from app.validation import normalize_revision, validate_svn_url
from app.worker import Worker, WorkerThread


def create_app(
    *,
    database_path: Path = settings.database_path,
    reports_dir: Path = settings.reports_dir,
    workspaces_dir: Path = settings.workspaces_dir,
    start_worker: bool = True,
) -> FastAPI:
    repo = TaskRepository(database_path)
    repo.init_schema()
    reports_dir.mkdir(parents=True, exist_ok=True)
    workspaces_dir.mkdir(parents=True, exist_ok=True)
    prompt_template = settings.prompt_template_path.read_text(encoding="utf-8")
    worker_thread: WorkerThread | None = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal worker_thread
        cleanup_old_tasks(repo, workspaces_dir, settings.retention_days)
        if start_worker:
            runner = CodexRunner(settings.codex_command, settings.codex_args)
            worker = Worker(
                repo=repo,
                runner=runner,
                prompt_template=prompt_template,
                workspaces_dir=workspaces_dir,
                timeout_seconds=settings.codex_timeout_seconds,
            )
            worker_thread = WorkerThread(worker, settings.worker_poll_seconds)
            worker_thread.start()
        yield
        if worker_thread is not None:
            worker_thread.stop()

    app = FastAPI(title="Codex 代码审查 Web 服务", lifespan=lifespan)

    @app.post("/api/tasks", response_model=TaskCreateResponse)
    def create_task(payload: TaskCreateRequest):
        try:
            svn_url = validate_svn_url(payload.svn_url, settings.svn_allowed_prefix)
            old_revision = normalize_revision(payload.old_revision)
            new_revision = normalize_revision(payload.new_revision)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if old_revision == new_revision:
            raise HTTPException(status_code=400, detail="旧版本号和新版本号不能相同")

        task_id = str(uuid.uuid4())
        report_path = reports_dir / f"{task_id}.md"
        task = repo.create_task(
            svn_url=svn_url,
            old_revision=old_revision,
            new_revision=new_revision,
            requester=(payload.requester or "anonymous").strip() or "anonymous",
            report_path=str(report_path),
            task_id=task_id,
        )
        return TaskCreateResponse(task_id=task["id"], status=TaskStatus.pending)

    @app.get("/api/tasks", response_model=list[TaskResponse])
    def list_tasks():
        return [_to_response(task) for task in repo.list_tasks()]

    @app.get("/api/tasks/{task_id}", response_model=TaskResponse)
    def get_task(task_id: str):
        task = repo.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        return _to_response(task)

    @app.get("/api/tasks/{task_id}/report", response_class=PlainTextResponse)
    def get_report(task_id: str):
        task = _require_success_task(repo, task_id)
        path = Path(task["report_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="报告不存在")
        return path.read_text(encoding="utf-8")

    @app.get("/api/tasks/{task_id}/download")
    def download_report(task_id: str):
        task = _require_success_task(repo, task_id)
        path = Path(task["report_path"])
        if not path.exists():
            raise HTTPException(status_code=404, detail="报告不存在")
        filename = f"code-review-{task_id}.md"
        return FileResponse(path, media_type="text/markdown; charset=utf-8", filename=filename)

    static_dir = Path(settings.base_dir) / "static"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


def _require_success_task(repo: TaskRepository, task_id: str):
    task = repo.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task["status"] != TaskStatus.success:
        raise HTTPException(status_code=409, detail="任务尚未成功完成")
    return task


def _to_response(task: dict) -> TaskResponse:
    report_path = Path(task["report_path"])
    return TaskResponse(
        task_id=task["id"],
        svn_url=task["svn_url"],
        old_revision=task["old_revision"],
        new_revision=task["new_revision"],
        requester=task["requester"],
        status=task["status"],
        created_at=task["created_at"],
        started_at=task["started_at"],
        finished_at=task["finished_at"],
        error_message=task["error_message"],
        report_available=task["status"] == TaskStatus.success and report_path.exists(),
    )


app = create_app()
```

- [ ] **Step 4: Run API tests**

Run: `pytest tests/test_api.py -v`

Expected: PASS.

- [ ] **Step 5: Run full backend tests**

Run: `pytest tests/test_validation.py tests/test_database.py tests/test_worker.py tests/test_api.py -v`

Expected: PASS.

- [ ] **Step 6: Commit API**

```bash
git add app/main.py tests/conftest.py tests/test_api.py
git commit -m "feat: add code review task api"
```

## Task 7: Static Frontend

**Files:**
- Create: `static/index.html`
- Create: `static/styles.css`
- Create: `static/app.js`
- Modify: `README.md`

- [ ] **Step 1: Add HTML**

Create `static/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Codex 代码审查</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="panel form-panel">
        <div class="panel-header">
          <h1>Codex 代码审查</h1>
          <span id="serviceState" class="badge">就绪</span>
        </div>
        <form id="taskForm">
          <label>SVN 项目路径<input id="svnUrl" name="svn_url" required /></label>
          <div class="grid">
            <label>旧版本号<input id="oldRevision" name="old_revision" required placeholder="r25576" /></label>
            <label>新版本号<input id="newRevision" name="new_revision" required placeholder="r29303" /></label>
          </div>
          <label>提交人<input id="requester" name="requester" placeholder="姓名或工号" /></label>
          <button id="submitButton" type="submit">提交审查</button>
        </form>
      </section>

      <section class="panel">
        <h2>当前任务</h2>
        <dl id="taskDetails" class="details"></dl>
        <a id="downloadLink" class="download hidden" href="#">下载 Markdown</a>
      </section>

      <section class="panel report-panel">
        <h2>报告预览</h2>
        <article id="report" class="markdown empty">任务成功后显示 Markdown 报告。</article>
      </section>

      <section class="panel">
        <h2>最近任务</h2>
        <div id="taskList" class="task-list"></div>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Add CSS**

Create `static/styles.css`:

```css
:root {
  color-scheme: light;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  background: #f5f7fb;
  color: #172033;
}

body {
  margin: 0;
}

.shell {
  width: min(1180px, calc(100% - 32px));
  margin: 24px auto;
  display: grid;
  grid-template-columns: minmax(320px, 420px) 1fr;
  gap: 16px;
}

.panel {
  background: #fff;
  border: 1px solid #d9e0ec;
  border-radius: 8px;
  padding: 18px;
  box-shadow: 0 8px 24px rgba(31, 45, 71, 0.06);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

h1, h2 {
  margin: 0 0 14px;
  letter-spacing: 0;
}

h1 {
  font-size: 24px;
}

h2 {
  font-size: 18px;
}

form, label {
  display: grid;
  gap: 8px;
}

form {
  gap: 14px;
}

label {
  font-size: 14px;
  color: #47536a;
}

input {
  height: 38px;
  border: 1px solid #c8d2e0;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 14px;
}

button, .download {
  height: 40px;
  border: 0;
  border-radius: 6px;
  background: #2364d2;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
}

button:disabled {
  background: #8794aa;
  cursor: wait;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.badge {
  background: #e8f5ee;
  color: #247348;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 13px;
}

.details {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 12px;
  margin: 0 0 14px;
  font-size: 14px;
}

.details dt {
  color: #66728a;
}

.details dd {
  margin: 0;
  word-break: break-all;
}

.report-panel {
  grid-row: span 2;
}

.markdown {
  min-height: 360px;
  line-height: 1.65;
  overflow: auto;
}

.markdown.empty {
  color: #7d8799;
}

.task-list {
  display: grid;
  gap: 8px;
}

.task-item {
  border: 1px solid #d9e0ec;
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
}

.task-item:hover {
  border-color: #2364d2;
}

.hidden {
  display: none;
}

@media (max-width: 860px) {
  .shell {
    grid-template-columns: 1fr;
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Add JavaScript**

Create `static/app.js`:

```javascript
const form = document.querySelector("#taskForm");
const submitButton = document.querySelector("#submitButton");
const serviceState = document.querySelector("#serviceState");
const details = document.querySelector("#taskDetails");
const report = document.querySelector("#report");
const downloadLink = document.querySelector("#downloadLink");
const taskList = document.querySelector("#taskList");

let currentTaskId = null;
let pollTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  serviceState.textContent = "提交中";
  const payload = {
    svn_url: form.svn_url.value.trim(),
    old_revision: form.old_revision.value.trim(),
    new_revision: form.new_revision.value.trim(),
    requester: form.requester.value.trim() || "anonymous",
  };

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "提交失败");
    }
    const body = await response.json();
    currentTaskId = body.task_id;
    report.textContent = "任务已提交，等待 Codex 生成报告。";
    report.classList.add("empty");
    await loadTask(currentTaskId);
    startPolling();
    await loadTaskList();
  } catch (error) {
    serviceState.textContent = "失败";
    alert(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    if (currentTaskId) await loadTask(currentTaskId);
  }, 2500);
}

async function loadTask(taskId) {
  const response = await fetch(`/api/tasks/${taskId}`);
  if (!response.ok) return;
  const task = await response.json();
  renderTask(task);
  if (task.status === "success") {
    window.clearInterval(pollTimer);
    await loadReport(task.task_id);
  }
  if (task.status === "failed") {
    window.clearInterval(pollTimer);
  }
}

function renderTask(task) {
  serviceState.textContent = task.status;
  details.innerHTML = [
    ["任务 ID", task.task_id],
    ["项目路径", task.svn_url],
    ["版本范围", `${task.old_revision} -> ${task.new_revision}`],
    ["提交人", task.requester],
    ["状态", task.status],
    ["创建时间", formatTime(task.created_at)],
    ["开始时间", formatTime(task.started_at)],
    ["完成时间", formatTime(task.finished_at)],
    ["错误", task.error_message || "-"],
  ].map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value || "-")}</dd>`).join("");

  if (task.report_available) {
    downloadLink.href = `/api/tasks/${task.task_id}/download`;
    downloadLink.classList.remove("hidden");
  } else {
    downloadLink.classList.add("hidden");
  }
}

async function loadReport(taskId) {
  const response = await fetch(`/api/tasks/${taskId}/report`);
  if (!response.ok) return;
  const markdown = await response.text();
  report.classList.remove("empty");
  report.innerHTML = renderMarkdown(markdown);
}

async function loadTaskList() {
  const response = await fetch("/api/tasks");
  if (!response.ok) return;
  const tasks = await response.json();
  taskList.innerHTML = tasks.map((task) => `
    <div class="task-item" data-task-id="${task.task_id}">
      <strong>${escapeHtml(task.status)}</strong>
      <div>${escapeHtml(task.old_revision)} -> ${escapeHtml(task.new_revision)}</div>
      <div>${escapeHtml(task.svn_url)}</div>
    </div>
  `).join("");
  taskList.querySelectorAll(".task-item").forEach((item) => {
    item.addEventListener("click", async () => {
      currentTaskId = item.dataset.taskId;
      await loadTask(currentTaskId);
    });
  });
}

function renderMarkdown(markdown) {
  return escapeHtml(markdown)
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

loadTaskList();
```

- [ ] **Step 4: Update README with UI note**

Add to `README.md`:

```markdown
## 页面功能

- 提交 SVN 项目路径、旧版本号、新版本号和提交人。
- 页面会轮询任务状态。
- 任务成功后显示 Markdown 预览和下载按钮。
- 最近任务列表显示仍在 90 天保留期内的任务。
```

- [ ] **Step 5: Run backend tests**

Run: `pytest -v`

Expected: PASS.

- [ ] **Step 6: Commit frontend**

```bash
git add static/index.html static/styles.css static/app.js README.md
git commit -m "feat: add task submission frontend"
```

## Task 8: Manual Verification And Final Polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run all tests**

Run: `pytest -v`

Expected: all tests PASS.

- [ ] **Step 2: Start local server**

Run: `uvicorn app.main:app --host 127.0.0.1 --port 8000`

Expected: server logs show Uvicorn running on `http://127.0.0.1:8000`.

- [ ] **Step 3: Verify API with invalid URL**

Run in another PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/tasks -ContentType 'application/json' -Body '{"svn_url":"https://example.com/repo","old_revision":"1","new_revision":"2"}'
```

Expected: HTTP 400 with message that SVN path must start with the configured prefix.

- [ ] **Step 4: Verify UI loads**

Open `http://127.0.0.1:8000`.

Expected:

- Form fields render without overlap.
- Recent tasks section appears.
- Submitting invalid SVN URL shows an error.

- [ ] **Step 5: Optional fake Codex smoke test**

Create `tools/fake_codex.py` if real Codex is not ready:

```python
from __future__ import annotations

import sys
from pathlib import Path

prompt = sys.argv[-1]
marker = "- 报告输出路径："
report_path = Path(prompt.split(marker)[1].splitlines()[0].strip())
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text("# fake report\n\n用于本地联调。\n", encoding="utf-8")
print(f"report written: {report_path}")
```

Run server with:

```powershell
$env:CODEX_COMMAND='python'
$env:CODEX_ARGS='tools/fake_codex.py'
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Expected: submitting a valid task eventually reaches `success`, renders `fake report`, and download returns a `.md` file.

- [ ] **Step 6: Commit final polish**

```bash
git add README.md
git commit -m "docs: add verification notes"
```

## Self-Review

- Spec coverage: task submission, validation, SQLite metadata, Worker, Codex prompt, Markdown preview/download, polling, 90-day cleanup, requester field, and Redis/login future notes are covered.
- Placeholder scan: no `TBD`, `TODO`, `待定`, `待补充`, or vague implementation-only placeholders should remain.
- Type consistency: task IDs use `id` internally and `task_id` in API responses; statuses use `TaskStatus`; revisions are normalized before persistence.
- Known implementation watchpoint: `POST /api/tasks` generates the UUID before inserting the task so the final report path is known at creation time.
