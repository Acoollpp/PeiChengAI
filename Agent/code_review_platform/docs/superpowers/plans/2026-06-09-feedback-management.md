# 意见管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增用户意见反馈闭环：Web 意见管理页、后端意见接口与截图存储、Electron 客户端任务工作台提交意见入口。

**Architecture:** 后端新增 `feedback` 领域模型、存储服务和权限受控 API，Web 端通过通用 `/feedback` 页面展示本人/全量意见并支持管理员改状态，Electron 客户端登录后通过 IPC 调用同一提交接口。截图始终走后端鉴权接口，不暴露服务器真实路径。

**Tech Stack:** FastAPI、SQLModel、Alembic、PostgreSQL、React、TanStack Router、TanStack Query、shadcn/radix UI、Electron、Vitest、Playwright/Bun。

---

## 文件结构

后端：

- Modify: `code_review_server/backend/app/models.py`
  - 新增 `FeedbackStatus`、`Feedback`、`FeedbackPublic`、`FeedbacksPublic`、`FeedbackStatusUpdate`。
- Modify: `code_review_server/backend/app/core/config.py`
  - 新增 `FEEDBACK_STORAGE_DIR`。
- Create: `code_review_server/backend/app/services/feedback_service.py`
  - 负责截图校验、路径生成、写入磁盘。
- Create: `code_review_server/backend/app/api/routes/feedback.py`
  - 负责提交、列表、详情、截图读取、管理员状态修改。
- Modify: `code_review_server/backend/app/api/main.py`
  - 注册 `feedback.router`。
- Create: `code_review_server/backend/app/alembic/versions/3f6b2d1a9c44_add_feedback.py`
  - 新建 `feedback` 表、索引和中文表/字段注释。
- Modify: `code_review_server/backend/tests/conftest.py`
  - 测试清理时删除 `Feedback`。
- Create: `code_review_server/backend/tests/api/routes/test_feedback.py`
  - 覆盖后端权限、提交、截图和状态。

Web 前端：

- Modify generated: `code_review_server/frontend/src/client/*`
  - 通过 `bun run generate-client` 生成反馈接口类型和 SDK。
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
  - 普通用户和管理员都展示 `意见管理`，管理员放在 `用户管理` 下方。
- Create: `code_review_server/frontend/src/routes/_layout/feedback.tsx`
  - `/feedback` 路由。
- Create: `code_review_server/frontend/src/components/Feedback/FeedbackPage.tsx`
  - 页面容器、筛选、列表、提交按钮。
- Create: `code_review_server/frontend/src/components/Feedback/SubmitFeedbackDialog.tsx`
  - Web 提交弹窗。
- Create: `code_review_server/frontend/src/components/Feedback/FeedbackDetailDialog.tsx`
  - 详情和截图预览。
- Create: `code_review_server/frontend/src/components/Feedback/columns.tsx`
  - 表格列和管理员状态控件。

Electron：

- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
  - 新增 `SubmitFeedbackPayload`、`SubmitFeedbackResult` 和 `submitFeedback` API。
- Modify: `code_review_electron/src/preload/index.ts`
  - 暴露 `submitFeedback`。
- Modify: `code_review_electron/src/main/api-client.ts`
  - 新增 `submitFeedback()`，构造 multipart 请求。
- Modify: `code_review_electron/src/main/ipc.ts`
  - 注册 `feedback:submit`，读取 token 后调用 API。
- Create: `code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx`
  - Electron 提交弹窗，支持选择/粘贴一张截图。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - 登录后顶部按钮从 `联系管理员` 改为 `提交意见`。
- Modify: `code_review_electron/src/renderer/src/styles.css`
  - 弹窗、截图预览、按钮状态样式。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
  - 更新工作台入口测试。
- Create: `code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.test.tsx`
  - 弹窗交互测试。
- Modify: `code_review_electron/src/main/__tests__/api-client.test.ts`
  - multipart 提交测试。
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
  - IPC 注册、未登录、成功提交测试。

---

### Task 1: 后端模型、迁移和配置

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Modify: `code_review_server/backend/app/core/config.py`
- Create: `code_review_server/backend/app/alembic/versions/3f6b2d1a9c44_add_feedback.py`
- Modify: `code_review_server/backend/tests/conftest.py`

- [ ] **Step 1: 在模型中新增反馈状态和数据结构**

在 `code_review_server/backend/app/models.py` 的 `ReviewTaskStatus` 后新增：

```python
class FeedbackStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    resolved = "resolved"
```

在 `ClientRelease` 或 `AuditLog` 前新增表模型：

```python
class Feedback(SQLModel, table=True):
    __tablename__ = "feedback"
    __table_args__ = (
        Index("ix_feedback_user_id_status", "user_id", "status"),
        Index("ix_feedback_status_created_at", "status", "created_at"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False, index=True)
    description: str = Field(min_length=1, max_length=4096)
    screenshot_path: str | None = Field(default=None, max_length=2048)
    screenshot_name: str | None = Field(default=None, max_length=255)
    screenshot_content_type: str | None = Field(default=None, max_length=128)
    screenshot_size: int | None = Field(default=None)
    status: FeedbackStatus = Field(default=FeedbackStatus.pending, index=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

在 public schema 区域新增：

```python
class FeedbackPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    svn_username: str | None = None
    description: str
    has_screenshot: bool = False
    screenshot_name: str | None = None
    screenshot_content_type: str | None = None
    screenshot_size: int | None = None
    status: FeedbackStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FeedbacksPublic(SQLModel):
    data: list[FeedbackPublic]
    count: int


class FeedbackStatusUpdate(SQLModel):
    status: FeedbackStatus
```

- [ ] **Step 2: 新增配置项**

在 `code_review_server/backend/app/core/config.py` 的存储配置旁新增：

```python
FEEDBACK_STORAGE_DIR: str = "/app/feedback-screenshots"
```

- [ ] **Step 3: 新建 Alembic 迁移**

创建迁移文件，文件名使用新 revision，例如：

`code_review_server/backend/app/alembic/versions/3f6b2d1a9c44_add_feedback.py`

内容：

```python
"""Add feedback table

Revision ID: 3f6b2d1a9c44
Revises: 8d6f0c2b7a31
Create Date: 2026-06-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "3f6b2d1a9c44"
down_revision: str | None = "8d6f0c2b7a31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), nullable=False, comment="意见ID"),
        sa.Column("user_id", sa.Uuid(), nullable=False, comment="提交人用户ID"),
        sa.Column(
            "description",
            sqlmodel.sql.sqltypes.AutoString(length=4096),
            nullable=False,
            comment="问题描述",
        ),
        sa.Column(
            "screenshot_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=True,
            comment="问题截图服务器存储路径",
        ),
        sa.Column(
            "screenshot_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
            comment="问题截图原始文件名",
        ),
        sa.Column(
            "screenshot_content_type",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=True,
            comment="问题截图文件类型",
        ),
        sa.Column(
            "screenshot_size",
            sa.Integer(),
            nullable=True,
            comment="问题截图文件大小，单位字节",
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "processing", "resolved", name="feedbackstatus"),
            nullable=False,
            server_default="pending",
            comment="解决状态",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="上传时间",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="更新时间",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        comment="用户意见反馈表，记录用户提交的问题描述、可选截图和解决状态。",
    )
    op.create_index(op.f("ix_feedback_user_id"), "feedback", ["user_id"], unique=False)
    op.create_index(op.f("ix_feedback_status"), "feedback", ["status"], unique=False)
    op.create_index(
        op.f("ix_feedback_created_at"), "feedback", ["created_at"], unique=False
    )
    op.create_index(
        "ix_feedback_user_id_status", "feedback", ["user_id", "status"], unique=False
    )
    op.create_index(
        "ix_feedback_status_created_at",
        "feedback",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_status_created_at", table_name="feedback")
    op.drop_index("ix_feedback_user_id_status", table_name="feedback")
    op.drop_index(op.f("ix_feedback_created_at"), table_name="feedback")
    op.drop_index(op.f("ix_feedback_status"), table_name="feedback")
    op.drop_index(op.f("ix_feedback_user_id"), table_name="feedback")
    op.drop_table("feedback")
    sa.Enum(name="feedbackstatus").drop(op.get_bind(), checkfirst=True)
```

当前仓库迁移链路中 `8d6f0c2b7a31` 是最新 head。执行时如果 Alembic 报告存在更新的 head，先停止并检查新增迁移文件，避免创建分叉迁移。

- [ ] **Step 4: 更新测试清理**

在 `code_review_server/backend/tests/conftest.py` import 列表加入 `Feedback`：

```python
from app.models import (
    AuditLog,
    ClientRelease,
    Feedback,
    Item,
    ReviewTask,
    SkillPackage,
    User,
    UserApiKey,
    UserSvnCredential,
)
```

在删除 `ReviewTask` 前后加入：

```python
if inspect(engine).has_table("feedback"):
    statement = delete(Feedback)
    session.execute(statement)
```

- [ ] **Step 5: 验证迁移**

Run:

```bash
cd code_review_server
docker compose exec backend alembic upgrade head
```

Expected: 迁移成功，输出不包含 traceback。

- [ ] **Step 6: Commit**

```bash
git add code_review_server/backend/app/models.py \
  code_review_server/backend/app/core/config.py \
  code_review_server/backend/app/alembic/versions/*_add_feedback.py \
  code_review_server/backend/tests/conftest.py
git commit -m "新增意见反馈数据模型"
```

---

### Task 2: 后端截图服务和 API 测试

**Files:**
- Create: `code_review_server/backend/app/services/feedback_service.py`
- Create: `code_review_server/backend/tests/api/routes/test_feedback.py`

- [ ] **Step 1: 写后端 API 失败测试**

创建 `code_review_server/backend/tests/api/routes/test_feedback.py`：

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Feedback, FeedbackStatus, UserRole
from tests.utils.user import authentication_token_from_key, create_key_user


def _create_feedback(
    client: TestClient,
    headers: dict[str, str],
    description: str = "页面点击后没有响应",
) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=headers,
        data={"description": description},
    )
    assert response.status_code == 200
    return response.json()


def _other_user_headers(client: TestClient, db: Session) -> dict[str, str]:
    _, api_key = create_key_user(db)
    return authentication_token_from_key(client=client, key=api_key.key, db=db)


def test_create_feedback_without_screenshot(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "任务无法启动"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["description"] == "任务无法启动"
    assert content["status"] == "pending"
    assert content["has_screenshot"] is False
    assert content["screenshot_name"] is None
    assert content["user_id"]
    assert "screenshot_path" not in content


def test_create_feedback_with_screenshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图里的按钮错位"},
        files={"screenshot": ("screen.png", b"png-bytes", "image/png")},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["has_screenshot"] is True
    assert content["screenshot_name"] == "screen.png"
    assert content["screenshot_content_type"] == "image/png"
    assert content["screenshot_size"] == len(b"png-bytes")

    screenshot_response = client.get(
        f"{settings.API_V1_STR}/feedback/{content['id']}/screenshot",
        headers=normal_user_token_headers,
    )
    assert screenshot_response.status_code == 200
    assert screenshot_response.content == b"png-bytes"
    assert screenshot_response.headers["content-type"].startswith("image/png")


def test_create_feedback_rejects_blank_description(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "   "},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Feedback description must not be empty"


def test_create_feedback_rejects_non_image(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "上传了错误文件"},
        files={"screenshot": ("note.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Screenshot must be a PNG, JPG, or WEBP image"


def test_create_feedback_rejects_large_image(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "图片太大"},
        files={"screenshot": ("screen.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Screenshot must not exceed 5MB"


def test_normal_user_reads_only_own_feedback(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    own_feedback = _create_feedback(client, normal_user_token_headers, "我的意见")
    other_headers = _other_user_headers(client, db)
    _create_feedback(client, other_headers, "别人的意见")

    response = client.get(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["count"] == 1
    assert [item["id"] for item in content["data"]] == [own_feedback["id"]]


def test_admin_reads_all_feedback(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    _create_feedback(client, normal_user_token_headers, "我的意见")
    other_headers = _other_user_headers(client, db)
    _create_feedback(client, other_headers, "别人的意见")

    response = client.get(
        f"{settings.API_V1_STR}/feedback",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["count"] >= 2


def test_normal_user_cannot_read_other_feedback_detail(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
) -> None:
    other_headers = _other_user_headers(client, db)
    other_feedback = _create_feedback(client, other_headers)

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_normal_user_cannot_read_other_feedback_screenshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    other_headers = _other_user_headers(client, db)
    other_feedback = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=other_headers,
        data={"description": "别人的截图"},
        files={"screenshot": ("screen.png", b"png-bytes", "image/png")},
    ).json()

    response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshot",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_normal_user_cannot_update_status(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    feedback = _create_feedback(client, normal_user_token_headers)

    response = client.patch(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/status",
        headers=normal_user_token_headers,
        json={"status": "processing"},
    )

    assert response.status_code == 403


def test_admin_updates_status(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    feedback = _create_feedback(client, normal_user_token_headers)

    response = client.patch(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/status",
        headers=superuser_token_headers,
        json={"status": "resolved"},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["status"] == "resolved"
    assert content["updated_at"] is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_server
docker compose exec backend pytest tests/api/routes/test_feedback.py -q
```

Expected: FAIL，至少包含 `404 Not Found` 或 import `Feedback` 失败。

- [ ] **Step 3: 创建截图服务**

创建 `code_review_server/backend/app/services/feedback_service.py`：

```python
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024


def path_for_feedback(feedback_id: uuid.UUID, filename: str) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    return Path(settings.FEEDBACK_STORAGE_DIR) / str(feedback_id) / f"screenshot{suffix}"


async def save_screenshot(feedback_id: uuid.UUID, upload: UploadFile) -> tuple[Path, bytes]:
    content_type = upload.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Screenshot must be a PNG, JPG, or WEBP image",
        )

    content = await upload.read()
    if len(content) > MAX_SCREENSHOT_SIZE:
        raise HTTPException(status_code=400, detail="Screenshot must not exceed 5MB")
    if not content:
        raise HTTPException(status_code=400, detail="Screenshot must not be empty")

    screenshot_path = path_for_feedback(feedback_id, upload.filename or "screenshot.png")
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_path.write_bytes(content)
    return screenshot_path, content
```

- [ ] **Step 4: Commit 测试和服务**

```bash
git add code_review_server/backend/tests/api/routes/test_feedback.py \
  code_review_server/backend/app/services/feedback_service.py
git commit -m "新增意见反馈接口测试"
```

---

### Task 3: 后端 Feedback API 实现

**Files:**
- Create: `code_review_server/backend/app/api/routes/feedback.py`
- Modify: `code_review_server/backend/app/api/main.py`
- Test: `code_review_server/backend/tests/api/routes/test_feedback.py`

- [ ] **Step 1: 实现路由**

创建 `code_review_server/backend/app/api/routes/feedback.py`：

```python
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_current_active_admin, has_admin_privileges
from app.models import (
    Feedback,
    FeedbackPublic,
    FeedbacksPublic,
    FeedbackStatus,
    FeedbackStatusUpdate,
    User,
)
from app.services import feedback_service

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _feedback_public(feedback: Feedback, user: User | None = None) -> FeedbackPublic:
    return FeedbackPublic.model_validate(
        feedback,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
            "has_screenshot": bool(feedback.screenshot_path),
        },
    )


def _get_feedback_for_user(
    *, session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> Feedback:
    feedback = session.get(Feedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if not has_admin_privileges(current_user) and feedback.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return feedback


def _read_screenshot_path(feedback: Feedback) -> Path:
    screenshot_path = Path(feedback.screenshot_path) if feedback.screenshot_path else None
    if not screenshot_path or not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return screenshot_path


@router.post("", response_model=FeedbackPublic)
async def create_feedback(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    description: str = Form(...),
    screenshot: UploadFile | None = File(default=None),
) -> Any:
    normalized_description = description.strip()
    if not normalized_description:
        raise HTTPException(status_code=400, detail="Feedback description must not be empty")

    feedback = Feedback(
        user_id=current_user.id,
        description=normalized_description,
        status=FeedbackStatus.pending,
    )
    session.add(feedback)
    session.commit()
    session.refresh(feedback)

    if screenshot is not None:
        screenshot_path, content = await feedback_service.save_screenshot(feedback.id, screenshot)
        feedback.screenshot_path = str(screenshot_path)
        feedback.screenshot_name = screenshot.filename
        feedback.screenshot_content_type = screenshot.content_type
        feedback.screenshot_size = len(content)
        feedback.updated_at = _utcnow()
        session.add(feedback)
        session.commit()
        session.refresh(feedback)

    return _feedback_public(feedback, current_user)


@router.get("", response_model=FeedbacksPublic)
def read_feedback(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    status: FeedbackStatus | None = None,
    user_name: str | None = None,
    svn_username: str | None = None,
) -> Any:
    filters = []
    is_admin = has_admin_privileges(current_user)
    if not is_admin:
        filters.append(Feedback.user_id == current_user.id)
    if status:
        filters.append(Feedback.status == status)
    if is_admin and user_name and user_name.strip():
        filters.append(col(User.full_name).ilike(f"%{user_name.strip()}%"))
    if is_admin and svn_username and svn_username.strip():
        filters.append(col(User.svn_username).ilike(f"%{svn_username.strip()}%"))

    count_statement = (
        select(func.count())
        .select_from(Feedback)
        .join(User, Feedback.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(Feedback, User)
        .join(User, Feedback.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(Feedback.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return FeedbacksPublic(
        data=[_feedback_public(feedback, user) for feedback, user in rows],
        count=count,
    )


@router.get("/{feedback_id}", response_model=FeedbackPublic)
def read_feedback_detail(
    session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> Any:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    user = session.get(User, feedback.user_id)
    return _feedback_public(feedback, user)


@router.get("/{feedback_id}/screenshot")
def read_feedback_screenshot(
    session: SessionDep, current_user: CurrentUser, feedback_id: uuid.UUID
) -> FileResponse:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    screenshot_path = _read_screenshot_path(feedback)
    return FileResponse(
        screenshot_path,
        media_type=feedback.screenshot_content_type or "application/octet-stream",
        filename=feedback.screenshot_name or "screenshot",
    )


@router.patch(
    "/{feedback_id}/status",
    response_model=FeedbackPublic,
    dependencies=[Depends(get_current_active_admin)],
)
def update_feedback_status(
    *,
    session: SessionDep,
    feedback_id: uuid.UUID,
    status_in: FeedbackStatusUpdate,
) -> Any:
    feedback = session.get(Feedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    feedback.status = status_in.status
    feedback.updated_at = _utcnow()
    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    user = session.get(User, feedback.user_id)
    return _feedback_public(feedback, user)
```

- [ ] **Step 2: 注册路由**

修改 `code_review_server/backend/app/api/main.py`：

```python
from app.api.routes import (
    cch_sync,
    client_releases,
    credentials,
    feedback,
    items,
    login,
    private,
    review_tasks,
    skills,
    users,
    utils,
)
```

并在 `client_releases` 前后注册：

```python
api_router.include_router(feedback.router)
```

- [ ] **Step 3: 运行后端测试**

Run:

```bash
cd code_review_server
docker compose exec backend pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS。

- [ ] **Step 4: 运行相关回归测试**

Run:

```bash
cd code_review_server
docker compose exec backend pytest tests/api/routes/test_review_tasks.py tests/api/routes/test_users.py -q
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add code_review_server/backend/app/api/routes/feedback.py \
  code_review_server/backend/app/api/main.py \
  code_review_server/backend/tests/api/routes/test_feedback.py
git commit -m "新增意见反馈后端接口"
```

---

### Task 4: Web OpenAPI 客户端和菜单路由

**Files:**
- Modify generated: `code_review_server/frontend/src/client/*`
- Modify: `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
- Create: `code_review_server/frontend/src/routes/_layout/feedback.tsx`
- Create: `code_review_server/frontend/src/components/Feedback/FeedbackPage.tsx`

- [ ] **Step 1: 生成前端客户端**

确保后端可导出 OpenAPI 后运行：

```bash
cd code_review_server/frontend
bun run generate-client
```

Expected: `src/client/sdk.gen.ts` 出现 `FeedbackService` 或对应 feedback 方法，`src/client/types.gen.ts` 出现 `FeedbackPublic`、`FeedbackStatus`。

- [ ] **Step 2: 新增最小页面**

创建 `code_review_server/frontend/src/components/Feedback/FeedbackPage.tsx`：

```tsx
import { MessageSquarePlus } from "lucide-react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"

export function FeedbackPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">意见管理</h1>
          <p className="text-muted-foreground">
            查看意见处理进度，或提交新的问题反馈。
          </p>
        </div>
        <Button type="button">
          <MessageSquarePlus />
          提交意见
        </Button>
      </div>
    </div>
  )
}
```

创建 `code_review_server/frontend/src/routes/_layout/feedback.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { FeedbackPage } from "@/components/Feedback/FeedbackPage"

export const Route = createFileRoute("/_layout/feedback")({
  component: FeedbackPage,
  head: () => ({
    meta: [
      {
        title: "意见管理 - 沛城科技代码审查平台",
      },
    ],
  }),
})
```

- [ ] **Step 3: 更新侧边栏**

修改 `code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`：

```tsx
import {
  Briefcase,
  Home,
  Library,
  ListChecks,
  MessageSquareText,
  MonitorDown,
  Users,
} from "lucide-react"
```

普通用户菜单加入一级菜单：

```tsx
const userItems: Item[] = [
  { icon: Home, title: "主页", path: "/" },
  {
    icon: ListChecks,
    title: "任务管理",
    children: [
      {
        icon: ListChecks,
        title: "代码审查任务管理",
        path: "/tasks/review",
      },
    ],
  },
  { icon: MessageSquareText, title: "意见管理", path: "/feedback" },
]
```

管理员菜单中 `用户管理` 下方加入：

```tsx
{ icon: Users, title: "用户管理", path: "/admin/users" },
{ icon: MessageSquareText, title: "意见管理", path: "/feedback" },
```

- [ ] **Step 4: 运行类型检查/构建**

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add code_review_server/frontend/src/client \
  code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx \
  code_review_server/frontend/src/routes/_layout/feedback.tsx \
  code_review_server/frontend/src/components/Feedback/FeedbackPage.tsx
git commit -m "新增Web意见管理入口"
```

---

### Task 5: Web 意见列表、提交弹窗和状态管理

**Files:**
- Modify: `code_review_server/frontend/src/components/Feedback/FeedbackPage.tsx`
- Create: `code_review_server/frontend/src/components/Feedback/SubmitFeedbackDialog.tsx`
- Create: `code_review_server/frontend/src/components/Feedback/FeedbackDetailDialog.tsx`
- Create: `code_review_server/frontend/src/components/Feedback/columns.tsx`

- [ ] **Step 1: 实现提交弹窗**

创建 `SubmitFeedbackDialog.tsx`，使用现有 `Dialog`、`Button`、`Input` 或原生 `textarea`：

```tsx
import { type ClipboardEvent, type FormEvent, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ImagePlus, Loader2, MessageSquarePlus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"]

type UploadFeedbackInput = {
  description: string
  screenshot: File | null
}

async function uploadFeedback(input: UploadFeedbackInput) {
  const formData = new FormData()
  formData.set("description", input.description)
  if (input.screenshot) {
    formData.set("screenshot", input.screenshot)
  }
  const token = localStorage.getItem("access_token")
  const response = await fetch(`${OpenAPI.BASE}/api/v1/feedback`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? "意见提交失败")
  }
  return response.json()
}

function validateScreenshot(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) return "请上传 PNG、JPG 或 WEBP 图片"
  if (file.size > MAX_SCREENSHOT_SIZE) return "截图不能超过 5MB"
  return null
}

export function SubmitFeedbackDialog() {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState("")
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: uploadFeedback,
    onSuccess: async () => {
      toast.success("意见已提交")
      setDescription("")
      setScreenshot(null)
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ["feedback"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "意见提交失败")
    },
  })

  const chooseFile = (file: File | null) => {
    if (!file) return
    const error = validateScreenshot(file)
    if (error) {
      toast.error(error)
      return
    }
    setScreenshot(file)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    )
    if (image) chooseFile(image)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = description.trim()
    if (!normalized) {
      toast.error("请填写问题描述")
      return
    }
    mutation.mutate({ description: normalized, screenshot })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <MessageSquarePlus />
          提交意见
        </Button>
      </DialogTrigger>
      <DialogContent onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>提交意见</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2 text-sm font-medium">
            问题描述
            <textarea
              className="min-h-32 rounded-md border bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="请描述你遇到的问题"
            />
          </label>
          <div className="flex flex-col gap-2">
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <ImagePlus />
              选择或粘贴截图
            </Button>
            {screenshot && (
              <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span className="truncate">{screenshot.name}</span>
                <Button type="button" variant="ghost" size="icon" onClick={() => setScreenshot(null)}>
                  <X />
                </Button>
              </div>
            )}
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" />}
            提交
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

如果生成的 `FeedbackService` 支持 multipart，可用 SDK 替换 `fetch`；否则保留上述 `fetch`，和现有 `ClientReleasesPage` 的上传风格一致。

- [ ] **Step 2: 实现列表查询和页面**

在 `FeedbackPage.tsx` 中使用 `useQuery` 或 `useSuspenseQuery` 调用 `GET /api/v1/feedback`。管理员判断复用：

```tsx
import useAuth from "@/hooks/useAuth"
import { hasAdminPrivileges } from "@/lib/authz"
```

页面保留标题右侧：

```tsx
<SubmitFeedbackDialog />
```

表格至少展示：

```tsx
提交人 | 提交时间 | 问题描述 | 截图 | 解决状态 | 操作
```

管理员额外展示状态筛选、提交人筛选和状态下拉。

- [ ] **Step 3: 实现详情弹窗和截图读取**

`FeedbackDetailDialog.tsx` 通过 `GET /api/v1/feedback/{id}` 获取详情，截图 URL 使用：

```tsx
const screenshotUrl = `/api/v1/feedback/${feedback.id}/screenshot`
```

如果当前前端 fetch 需要 token，使用：

```tsx
fetch(screenshotUrl, {
  headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}` },
})
```

然后用 `URL.createObjectURL(blob)` 展示图片。

- [ ] **Step 4: 实现管理员状态更新**

管理员状态控件调用：

```tsx
PATCH /api/v1/feedback/{feedback_id}/status
body: { status: "pending" | "processing" | "resolved" }
```

成功后：

```tsx
queryClient.invalidateQueries({ queryKey: ["feedback"] })
```

- [ ] **Step 5: 运行构建**

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add code_review_server/frontend/src/components/Feedback
git commit -m "完善Web意见管理页面"
```

---

### Task 6: Electron API、IPC 和主进程测试

**Files:**
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 写 ApiClient multipart 测试**

在 `api-client.test.ts` 增加：

```ts
it('submits feedback as multipart form data with optional screenshot', async () => {
  vi.stubGlobal('File', File)
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'feedback-1' }))
  const client = new ApiClient('https://server.example', fetchMock)
  const screenshot = new File([new Uint8Array([1, 2, 3])], 'screen.png', { type: 'image/png' })

  await client.submitFeedback('token-123', {
    description: '按钮点击无响应',
    screenshot
  })

  const [, init] = fetchMock.mock.calls[0]
  expect(fetchMock.mock.calls[0][0]).toBe('https://server.example/api/v1/feedback')
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({ authorization: 'Bearer token-123' })
  expect(init.body).toBeInstanceOf(FormData)
  expect(init.body.get('description')).toBe('按钮点击无响应')
  expect(init.body.get('screenshot')).toBe(screenshot)
})
```

- [ ] **Step 2: 实现 Electron 类型**

在 `code-review-api.ts` 增加：

```ts
export interface SubmitFeedbackPayload {
  description: string
  screenshot?: File | null
}

export interface SubmitFeedbackResult {
  id: string
  status: 'pending' | 'processing' | 'resolved'
}
```

在 `CodeReviewApi` 增加：

```ts
submitFeedback(payload: SubmitFeedbackPayload): Promise<SubmitFeedbackResult>
```

- [ ] **Step 3: 实现 ApiClient.submitFeedback**

在 `api-client.ts` 增加接口：

```ts
export interface SubmitFeedbackRequest {
  description: string
  screenshot?: File | Blob | null
}
```

在 `ApiClient` 类中增加：

```ts
submitFeedback(token: string, payload: SubmitFeedbackRequest): Promise<unknown> {
  const body = new FormData()
  body.set('description', payload.description)
  if (payload.screenshot) {
    body.set('screenshot', payload.screenshot)
  }

  return this.request(
    '/api/v1/feedback',
    {
      method: 'POST',
      headers: this.authHeaders(token),
      body
    },
    { json: false }
  )
}
```

- [ ] **Step 4: 写 IPC 测试**

在 `ipc.test.ts` 的 channel 列表中加入：

```ts
'feedback:submit',
```

新增未登录测试：

```ts
it('rejects feedback submit when not authenticated', async () => {
  const authStore = { load: vi.fn(async () => null), save: vi.fn() }
  const api = { submitFeedback: vi.fn() }
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({ authStore: authStore as never, api: api as never })

  const handler = handleMock.mock.calls.find(([channel]) => channel === 'feedback:submit')?.[1]
  await expect(handler({}, { description: '问题' })).rejects.toThrow('Not authenticated')
  expect(api.submitFeedback).not.toHaveBeenCalled()
})
```

新增成功测试：

```ts
it('submits feedback through ipc using current token', async () => {
  const authStore = { load: vi.fn(async () => ({ access_token: 'token-123' })), save: vi.fn() }
  const api = { submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' })) }
  const { registerIpcHandlers } = await import('../ipc')

  registerIpcHandlers({ authStore: authStore as never, api: api as never })

  const handler = handleMock.mock.calls.find(([channel]) => channel === 'feedback:submit')?.[1]
  await expect(handler({}, { description: '问题', screenshot: null })).resolves.toEqual({
    id: 'feedback-1',
    status: 'pending'
  })
  expect(api.submitFeedback).toHaveBeenCalledWith('token-123', {
    description: '问题',
    screenshot: null
  })
})
```

- [ ] **Step 5: 实现 IPC 和 preload**

在 `ipc.ts` 注册：

```ts
ipcMain.handle('feedback:submit', async (_event, payload) => {
  const tokens = await authStore.load()

  if (!tokens) {
    throw new Error('Not authenticated')
  }

  const api = await createApiClient()
  return api.submitFeedback(tokens.access_token, payload)
})
```

在 `preload/index.ts` 暴露：

```ts
submitFeedback: (payload: SubmitFeedbackPayload): Promise<SubmitFeedbackResult> =>
  ipcRenderer.invoke('feedback:submit', payload),
```

并补充 import 类型 `SubmitFeedbackPayload`、`SubmitFeedbackResult`。

- [ ] **Step 6: 运行 Electron 主进程测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add code_review_electron/src/renderer/src/code-review-api.ts \
  code_review_electron/src/preload/index.ts \
  code_review_electron/src/main/api-client.ts \
  code_review_electron/src/main/ipc.ts \
  code_review_electron/src/main/__tests__/api-client.test.ts \
  code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "新增客户端意见提交通道"
```

---

### Task 7: Electron 提交弹窗和任务工作台入口

**Files:**
- Create: `code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx`
- Create: `code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.test.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 写弹窗测试**

创建 `SubmitFeedbackDialog.test.tsx`：

```tsx
// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'

beforeEach(() => {
  window.codeReview = {
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' }))
  } as never
})

afterEach(() => cleanup())

describe('SubmitFeedbackDialog', () => {
  it('requires description before submit', async () => {
    const user = userEvent.setup()
    render(<SubmitFeedbackDialog open onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(screen.getByText('请填写问题描述')).toBeInTheDocument()
    expect(window.codeReview.submitFeedback).not.toHaveBeenCalled()
  })

  it('submits description to client api', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SubmitFeedbackDialog open onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '任务按钮点击无响应')
    await user.click(screen.getByRole('button', { name: '提交' }))

    expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
      description: '任务按钮点击无响应',
      screenshot: null
    })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 实现弹窗**

创建 `SubmitFeedbackDialog.tsx`：

```tsx
import { type ClipboardEvent, type FormEvent, useRef, useState } from 'react'

type SubmitFeedbackDialogProps = {
  open: boolean
  onClose: () => void
}

const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function SubmitFeedbackDialog({ open, onClose }: SubmitFeedbackDialogProps): React.JSX.Element | null {
  const [description, setDescription] = useState('')
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (!open) return null

  const chooseFile = (file: File | null): void => {
    if (!file) return
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('请上传 PNG、JPG 或 WEBP 图片')
      return
    }
    if (file.size > MAX_SCREENSHOT_SIZE) {
      setError('截图不能超过 5MB')
      return
    }
    setError('')
    setScreenshot(file)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith('image/')
    )
    if (image) chooseFile(image)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const normalized = description.trim()
    if (!normalized) {
      setError('请填写问题描述')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await window.codeReview.submitFeedback({ description: normalized, screenshot })
      setSuccess('意见已提交')
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '意见提交失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onPaste={handlePaste}>
      <form className="feedback-dialog" onSubmit={(event) => void handleSubmit(event)}>
        <div className="dialog-header">
          <h2 id="feedback-title">提交意见</h2>
          <button className="dialog-close" type="button" onClick={onClose}>×</button>
        </div>
        <label className="feedback-field">
          <span>问题描述</span>
          <textarea
            aria-label="问题描述"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="请描述你遇到的问题"
          />
        </label>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
          选择或粘贴截图
        </button>
        {screenshot && (
          <div className="feedback-screenshot-preview">
            <span>{screenshot.name}</span>
            <button type="button" onClick={() => setScreenshot(null)}>移除</button>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        {success && <p className="hint">{success}</p>}
        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '提交中...' : '提交'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: 修改任务工作台入口**

在 `TaskPage.tsx`：

替换 import：

```tsx
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'
```

替换 state：

```tsx
const [showFeedbackDialog, setShowFeedbackDialog] = useState(false)
```

替换按钮：

```tsx
<button
  className="admin-contact-button"
  type="button"
  onClick={() => setShowFeedbackDialog(true)}
>
  提交意见
</button>
```

替换底部弹窗：

```tsx
{showFeedbackDialog && (
  <SubmitFeedbackDialog open={showFeedbackDialog} onClose={() => setShowFeedbackDialog(false)} />
)}
```

- [ ] **Step 4: 更新 TaskPage 测试**

把“在工作台顶部打开管理员名片”改成：

```tsx
it('在工作台顶部打开提交意见弹窗', async () => {
  const user = userEvent.setup()

  render(
    <TaskPage
      environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
      isCheckingEnvironment={false}
      isInstallingSkillDuringCheck={false}
      isInstallingCodex={false}
      isInstallingSvn={false}
      svnUsername="Key 用户"
      onRefreshEnvironment={vi.fn()}
      onInstallCodex={vi.fn()}
      onInstallSvn={vi.fn()}
      onInstallSkill={vi.fn()}
    />
  )

  await user.click(screen.getByRole('button', { name: '提交意见' }))

  expect(screen.getByRole('dialog', { name: '提交意见' })).toBeInTheDocument()
})
```

把“环境面板不再额外显示联系管理员入口”断言改为：

```tsx
expect(screen.getAllByRole('button', { name: '提交意见' })).toHaveLength(1)
expect(screen.queryByRole('button', { name: '联系管理员' })).not.toBeInTheDocument()
```

并在 `setupCodeReviewApi()` 中补：

```ts
submitFeedback: vi.fn(),
```

- [ ] **Step 5: 增加样式**

在 `styles.css` 添加：

```css
.feedback-dialog {
  width: min(560px, calc(100vw - 48px));
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  padding: 24px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.feedback-field {
  display: grid;
  gap: 8px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 700;
}

.feedback-field textarea {
  min-height: 140px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 12px;
  font: inherit;
}

.feedback-screenshot-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--muted);
}
```

- [ ] **Step 6: 运行 Electron 测试**

Run:

```bash
cd code_review_electron
npm test -- src/renderer/src/components/SubmitFeedbackDialog.test.tsx src/renderer/src/components/TaskPage.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 运行类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx \
  code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.test.tsx \
  code_review_electron/src/renderer/src/components/TaskPage.tsx \
  code_review_electron/src/renderer/src/components/TaskPage.test.tsx \
  code_review_electron/src/renderer/src/styles.css
git commit -m "新增客户端提交意见入口"
```

---

### Task 8: 整体验证和收尾

**Files:**
- Modify if needed: files changed in previous tasks only
- Update if needed: `docs/verification-log.md`

- [ ] **Step 1: 后端完整相关测试**

Run:

```bash
cd code_review_server
docker compose exec backend pytest tests/api/routes/test_feedback.py tests/api/routes/test_review_tasks.py tests/api/routes/test_users.py -q
```

Expected: PASS。

- [ ] **Step 2: Web 构建**

Run:

```bash
cd code_review_server/frontend
bun run build
```

Expected: PASS。

- [ ] **Step 3: Electron 测试和类型检查**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/renderer/src/components/SubmitFeedbackDialog.test.tsx src/renderer/src/components/TaskPage.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 手工联调**

启动后端和前端后验证：

```bash
cd code_review_server
docker compose up -d db
docker compose exec backend fastapi dev app/main.py
```

另一个终端：

```bash
cd code_review_server/frontend
bun run dev
```

验证项：

1. 普通用户打开 `/feedback` 能看到 `意见管理` 和右上角 `提交意见`。
2. 普通用户提交纯文字意见成功。
3. 普通用户提交截图意见成功。
4. 管理员打开 `/feedback` 能看到普通用户意见。
5. 管理员能把状态改为 `处理中`、`已解决`。
6. Electron 登录后任务工作台顶部显示 `提交意见`。
7. Electron 提交意见后 Web 管理页能看到该意见。

- [ ] **Step 5: 检查数据库中文注释**

连接 PostgreSQL 后运行：

```sql
select obj_description('feedback'::regclass, 'pg_class') as table_comment;
select column_name, col_description('feedback'::regclass, ordinal_position) as column_comment
from information_schema.columns
where table_name = 'feedback'
order by ordinal_position;
```

Expected:

- 表注释为 `用户意见反馈表，记录用户提交的问题描述、可选截图和解决状态。`
- 每个字段都有中文注释。

- [ ] **Step 6: 最终状态检查**

Run:

```bash
git status --short
```

Expected: 只显示用户原本无关变更，或工作区干净。不要提交无关文件。

- [ ] **Step 7: Commit 验证记录（如有修改）**

如果更新了 `docs/verification-log.md`：

```bash
git add docs/verification-log.md
git commit -m "记录意见管理验证结果"
```

---

## 自审结果

- Spec 覆盖：计划覆盖后端字段/中文注释、截图存储、权限接口、Web 意见管理页、Electron 登录后提交入口、登录页联系管理员保留、测试和验收。
- 占位扫描：没有 `TODO`、`TBD`、`待定`；迁移文件名和 revision 已固定为 `3f6b2d1a9c44_add_feedback.py`。
- 类型一致性：后端状态统一为 `pending`、`processing`、`resolved`；前端和 Electron 均复用同一状态集合；截图字段统一为 `screenshot`。
