# 意见反馈多图支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将意见反馈从单张截图扩展为最多 5 张截图，覆盖后端、Web 意见管理和 Electron 客户端，并保持旧单图接口兼容一版。

**Architecture:** 后端新增 `FeedbackScreenshot` 附件表，`Feedback` 继续保存意见主体和状态，旧单图字段暂时保留但新代码不再写入。创建接口使用重复 multipart 字段 `screenshots` 接收多文件，列表/详情返回截图元数据，图片正文通过鉴权下载接口读取。Web 与 Electron 都统一为 `File[]` 状态，支持选择多图、粘贴追加、逐张移除和本地校验。

**Tech Stack:** FastAPI、SQLModel、Alembic、PostgreSQL、pytest、React、TanStack Query、Playwright、Electron、Vitest、TypeScript。

---

## 文件结构

- 修改 `Agent/code_review_platform/code_review_server/backend/app/models.py`：新增 `FeedbackScreenshot`、`FeedbackScreenshotPublic`，调整 `FeedbackPublic` 和关系字段。
- 新增 `Agent/code_review_platform/code_review_server/backend/app/alembic/versions/4e9c1d7b2a65_add_feedback_screenshots.py`：创建截图附件表、中文字段注释、旧单图数据迁移。
- 修改 `Agent/code_review_platform/code_review_server/backend/app/services/feedback_service.py`：多图校验、保存、失败清理、兼容旧单图路径读取。
- 修改 `Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py`：创建接口接收 `screenshots`，列表/详情返回多图元数据，新增多图下载接口，保留旧下载接口。
- 修改 `Agent/code_review_platform/code_review_server/backend/app/api/routes/users.py`：确认删除用户时截图附件记录随意见清理；如果数据库级联不完整则补充删除逻辑。
- 修改 `Agent/code_review_platform/code_review_server/backend/tests/conftest.py`：清理测试数据时先删 `FeedbackScreenshot` 再删 `Feedback`。
- 修改 `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py`：覆盖多图创建、顺序、数量限制、类型/大小限制、权限和兼容旧接口。
- 修改 `Agent/code_review_platform/code_review_server/frontend/src/client/types.gen.ts`、`schemas.gen.ts`、`sdk.gen.ts`：同步 OpenAPI 类型；若本地后端可启动，优先使用 `npm run generate-client`，否则手工保持与后端一致。
- 修改 `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/SubmitFeedbackDialog.tsx`：Web 提交弹窗改为多图。
- 修改 `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/FeedbackDetailDialog.tsx`：详情弹窗加载和展示多张截图。
- 修改 `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/columns.tsx`：截图列显示 `N 张`。
- 修改 `Agent/code_review_platform/code_review_server/frontend/tests/feedback.spec.ts`：Web 多图提交、详情加载多图、状态修改回归。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts`：Electron 公开 API 类型改为 `screenshots`。
- 修改 `Agent/code_review_platform/code_review_electron/src/preload/index.ts` 和 `index.test.ts`：序列化多张截图。
- 修改 `Agent/code_review_platform/code_review_electron/src/main/ipc.ts` 和 `src/main/__tests__/ipc.test.ts`：IPC 还原多张截图并调用 ApiClient。
- 修改 `Agent/code_review_platform/code_review_electron/src/main/api-client.ts` 和 `src/main/__tests__/api-client.test.ts`：multipart 重复追加 `screenshots`。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx` 和 `.test.tsx`：Electron 提交弹窗多图 UI 和行为。
- 修改 `Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`：多图预览网格样式。

## Task 1: 后端模型、迁移和基础响应结构

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/backend/app/models.py`
- Create: `Agent/code_review_platform/code_review_server/backend/app/alembic/versions/4e9c1d7b2a65_add_feedback_screenshots.py`
- Modify: `Agent/code_review_platform/code_review_server/backend/tests/conftest.py`
- Test: `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py`

- [ ] **Step 1: 写失败测试，确认新响应字段存在且文本意见截图数量为 0**

在 `test_create_feedback_text_only` 中把旧断言替换为：

```python
assert content["description"] == description
assert content["status"] == "pending"
assert content["screenshot_count"] == 0
assert content["screenshots"] == []
assert "screenshot_path" not in content
assert "file_path" not in str(content)
```

- [ ] **Step 2: 运行后端单测，确认当前实现失败**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py::test_create_feedback_text_only -q
```

Expected: FAIL，错误包含缺少 `screenshot_count` 或 `screenshots`。

- [ ] **Step 3: 新增模型和公开结构**

在 `models.py` 的 `Feedback` 后新增：

```python
class FeedbackScreenshot(SQLModel, table=True):
    __tablename__ = "feedback_screenshot"
    __table_args__ = (
        Index("ix_feedback_screenshot_feedback_order", "feedback_id", "sort_order"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    feedback_id: uuid.UUID = Field(
        foreign_key="feedback.id", nullable=False, index=True, ondelete="CASCADE"
    )
    file_path: str = Field(max_length=2048)
    file_name: str = Field(max_length=255)
    content_type: str = Field(max_length=128)
    file_size: int
    sort_order: int = Field(default=0)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )

    feedback: "Feedback" = Relationship(back_populates="screenshots")
```

在 `Feedback` 内追加关系：

```python
screenshots: list["FeedbackScreenshot"] = Relationship(
    back_populates="feedback",
    cascade_delete=True,
)
```

在 `FeedbackPublic` 前新增：

```python
class FeedbackScreenshotPublic(SQLModel):
    id: uuid.UUID
    file_name: str
    content_type: str
    file_size: int
    sort_order: int
    created_at: datetime | None = None
```

调整 `FeedbackPublic`：

```python
class FeedbackPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    svn_username: str | None = None
    description: str
    has_screenshot: bool = False
    screenshot_count: int = 0
    screenshots: list[FeedbackScreenshotPublic] = Field(default_factory=list)
    screenshot_name: str | None = None
    screenshot_content_type: str | None = None
    screenshot_size: int | None = None
    status: FeedbackStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
```

- [ ] **Step 4: 新增 Alembic 迁移，带中文注释和旧数据转换**

创建 `4e9c1d7b2a65_add_feedback_screenshots.py`：

```python
"""add feedback screenshots

Revision ID: 4e9c1d7b2a65
Revises: 3f6b2d1a9c44
Create Date: 2026-06-09 00:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "4e9c1d7b2a65"
down_revision = "3f6b2d1a9c44"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "feedback_screenshot",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, comment="截图ID"),
        sa.Column("feedback_id", postgresql.UUID(as_uuid=True), nullable=False, comment="所属意见ID"),
        sa.Column(
            "file_path",
            sqlmodel.sql.sqltypes.AutoString(length=2048),
            nullable=False,
            comment="截图服务器存储路径",
        ),
        sa.Column(
            "file_name",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
            comment="截图原始文件名",
        ),
        sa.Column(
            "content_type",
            sqlmodel.sql.sqltypes.AutoString(length=128),
            nullable=False,
            comment="截图文件类型",
        ),
        sa.Column("file_size", sa.Integer(), nullable=False, comment="截图文件大小，单位字节"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0", comment="截图顺序，从0开始"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, comment="上传时间"),
        sa.ForeignKeyConstraint(["feedback_id"], ["feedback.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        comment="意见反馈截图附件表，记录每条意见上传的多张问题截图。",
    )
    op.alter_column("feedback_screenshot", "sort_order", server_default=None)
    op.create_index(
        op.f("ix_feedback_screenshot_feedback_id"),
        "feedback_screenshot",
        ["feedback_id"],
        unique=False,
    )
    op.create_index(
        "ix_feedback_screenshot_feedback_order",
        "feedback_screenshot",
        ["feedback_id", "sort_order"],
        unique=False,
    )
    op.execute(
        """
        insert into feedback_screenshot
            (id, feedback_id, file_path, file_name, content_type, file_size, sort_order, created_at)
        select
            gen_random_uuid(),
            id,
            screenshot_path,
            coalesce(screenshot_name, 'screenshot.png'),
            coalesce(screenshot_content_type, 'image/png'),
            coalesce(screenshot_size, 0),
            0,
            created_at
        from feedback
        where screenshot_path is not null
        """
    )


def downgrade():
    op.drop_index("ix_feedback_screenshot_feedback_order", table_name="feedback_screenshot")
    op.drop_index(op.f("ix_feedback_screenshot_feedback_id"), table_name="feedback_screenshot")
    op.drop_table("feedback_screenshot")
```

- [ ] **Step 5: 调整测试清理顺序**

在 `tests/conftest.py` 导入 `FeedbackScreenshot`，并在删除 `Feedback` 前增加：

```python
if inspect(engine).has_table("feedback_screenshot"):
    statement = delete(FeedbackScreenshot)
    session.execute(statement)
```

- [ ] **Step 6: 修改 `_feedback_public` 让文本意见测试通过**

在 `feedback.py` 导入 `FeedbackScreenshot` 和 `FeedbackScreenshotPublic`，将 `_feedback_public` 改为：

```python
def _feedback_public(feedback: Feedback, user: User | None = None) -> FeedbackPublic:
    screenshots = sorted(feedback.screenshots, key=lambda item: item.sort_order)
    first_screenshot = screenshots[0] if screenshots else None
    return FeedbackPublic.model_validate(
        feedback,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
            "has_screenshot": bool(screenshots),
            "screenshot_count": len(screenshots),
            "screenshots": [
                FeedbackScreenshotPublic.model_validate(screenshot)
                for screenshot in screenshots
            ],
            "screenshot_name": first_screenshot.file_name if first_screenshot else None,
            "screenshot_content_type": first_screenshot.content_type if first_screenshot else None,
            "screenshot_size": first_screenshot.file_size if first_screenshot else None,
        },
    )
```

- [ ] **Step 7: 运行测试并提交**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py::test_create_feedback_text_only -q
```

Expected: PASS。

Commit:

```bash
git add Agent/code_review_platform/code_review_server/backend/app/models.py \
  Agent/code_review_platform/code_review_server/backend/app/alembic/versions/4e9c1d7b2a65_add_feedback_screenshots.py \
  Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py \
  Agent/code_review_platform/code_review_server/backend/tests/conftest.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py
git commit -m "新增意见反馈截图附件模型"
```

## Task 2: 后端多图保存服务和创建接口

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/backend/app/services/feedback_service.py`
- Modify: `Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py`
- Test: `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py`

- [ ] **Step 1: 写多图创建和顺序测试**

将旧 `test_create_feedback_with_screenshot_and_read_it` 替换为：

```python
def test_create_feedback_with_multiple_screenshots_and_read_them(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图里按钮遮挡了文字"},
        files=[
            ("screenshots", ("first.png", b"first-image", "image/png")),
            ("screenshots", ("second.webp", b"second-image", "image/webp")),
        ],
    )

    assert response.status_code == 200
    content = response.json()
    assert content["has_screenshot"] is True
    assert content["screenshot_count"] == 2
    assert [item["file_name"] for item in content["screenshots"]] == ["first.png", "second.webp"]
    assert [item["sort_order"] for item in content["screenshots"]] == [0, 1]
    assert "file_path" not in str(content)

    for screenshot, expected_body, expected_type in zip(
        content["screenshots"],
        [b"first-image", b"second-image"],
        ["image/png", "image/webp"],
    ):
        screenshot_response = client.get(
            f"{settings.API_V1_STR}/feedback/{content['id']}/screenshots/{screenshot['id']}",
            headers=normal_user_token_headers,
        )
        assert screenshot_response.status_code == 200
        assert screenshot_response.content == expected_body
        assert screenshot_response.headers["content-type"] == expected_type
```

- [ ] **Step 2: 写数量限制和回滚测试**

新增：

```python
def test_create_feedback_rejects_more_than_five_screenshots(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    files = [
        ("screenshots", (f"screen-{index}.png", b"png-bytes", "image/png"))
        for index in range(6)
    ]

    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "截图太多"},
        files=files,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "最多只能上传 5 张截图"
    assert not any(tmp_path.iterdir())
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py::test_create_feedback_with_multiple_screenshots_and_read_them \
  tests/api/routes/test_feedback.py::test_create_feedback_rejects_more_than_five_screenshots -q
```

Expected: FAIL，当前接口不识别 `screenshots` 或缺少多图下载路由。

- [ ] **Step 4: 实现多图服务函数**

将 `feedback_service.py` 调整为：

```python
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings

ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024
MAX_SCREENSHOT_COUNT = 5


def path_for_feedback(feedback_id: uuid.UUID, filename: str, sort_order: int = 0) -> Path:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES:
        suffix = ".png"
    return (
        Path(settings.FEEDBACK_STORAGE_DIR)
        / str(feedback_id)
        / f"screenshot-{sort_order}{suffix}"
    )


def remove_feedback_files(feedback_id: uuid.UUID) -> None:
    feedback_dir = Path(settings.FEEDBACK_STORAGE_DIR) / str(feedback_id)
    if feedback_dir.exists():
        shutil.rmtree(feedback_dir)


async def read_valid_screenshot(upload: UploadFile) -> bytes:
    content_type = upload.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="截图必须是 PNG、JPG 或 WEBP 图片")
    content = await upload.read()
    if len(content) > MAX_SCREENSHOT_SIZE:
        raise HTTPException(status_code=400, detail="单张截图不能超过 5MB")
    if not content:
        raise HTTPException(status_code=400, detail="截图不能为空")
    return content


async def save_screenshots(
    feedback_id: uuid.UUID, uploads: list[UploadFile]
) -> list[tuple[Path, UploadFile, bytes, int]]:
    if len(uploads) > MAX_SCREENSHOT_COUNT:
        raise HTTPException(status_code=400, detail="最多只能上传 5 张截图")

    saved: list[tuple[Path, UploadFile, bytes, int]] = []
    try:
        for sort_order, upload in enumerate(uploads):
            content = await read_valid_screenshot(upload)
            screenshot_path = path_for_feedback(
                feedback_id, upload.filename or "screenshot.png", sort_order
            )
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_bytes(content)
            saved.append((screenshot_path, upload, content, sort_order))
    except HTTPException:
        remove_feedback_files(feedback_id)
        raise
    return saved


async def save_screenshot(feedback_id: uuid.UUID, upload: UploadFile) -> tuple[Path, bytes]:
    saved = await save_screenshots(feedback_id, [upload])
    screenshot_path, _upload, content, _sort_order = saved[0]
    return screenshot_path, content
```

- [ ] **Step 5: 调整创建接口和新增多图下载接口**

在 `feedback.py` 中：

```python
from app.models import FeedbackScreenshot
```

将创建函数参数改为：

```python
screenshots: Annotated[list[UploadFile], File()] = [],
```

保存截图逻辑改为：

```python
if screenshots:
    try:
        saved_screenshots = await feedback_service.save_screenshots(feedback.id, screenshots)
    except HTTPException:
        feedback_service.remove_feedback_files(feedback.id)
        session.delete(feedback)
        session.commit()
        raise
    for screenshot_path, upload, content, sort_order in saved_screenshots:
        session.add(
            FeedbackScreenshot(
                feedback_id=feedback.id,
                file_path=str(screenshot_path),
                file_name=upload.filename or f"screenshot-{sort_order}.png",
                content_type=upload.content_type or "application/octet-stream",
                file_size=len(content),
                sort_order=sort_order,
            )
        )
```

新增下载接口：

```python
@router.get("/{feedback_id}/screenshots/{screenshot_id}")
def read_feedback_screenshot_by_id(
    session: SessionDep,
    current_user: CurrentUser,
    feedback_id: uuid.UUID,
    screenshot_id: uuid.UUID,
) -> FileResponse:
    feedback = _get_feedback_for_user(
        session=session, current_user=current_user, feedback_id=feedback_id
    )
    screenshot = session.get(FeedbackScreenshot, screenshot_id)
    if not screenshot or screenshot.feedback_id != feedback.id:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    screenshot_path = Path(screenshot.file_path)
    if not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(
        screenshot_path,
        media_type=screenshot.content_type,
        filename=screenshot.file_name,
    )
```

- [ ] **Step 6: 运行多图创建测试**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py::test_create_feedback_with_multiple_screenshots_and_read_them \
  tests/api/routes/test_feedback.py::test_create_feedback_rejects_more_than_five_screenshots -q
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add Agent/code_review_platform/code_review_server/backend/app/services/feedback_service.py \
  Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py
git commit -m "支持后端提交多张意见截图"
```

## Task 3: 后端校验、权限、旧接口兼容和删除清理

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py`
- Modify: `Agent/code_review_platform/code_review_server/backend/app/api/routes/users.py`
- Test: `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py`

- [ ] **Step 1: 更新类型和大小限制测试**

将旧单图字段名改为 `screenshots`：

```python
files={"screenshots": ("notes.txt", b"text", "text/plain")}
```

期望错误：

```python
assert response.json()["detail"] == "截图必须是 PNG、JPG 或 WEBP 图片"
```

超大文件测试改为：

```python
files={"screenshots": ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")}
assert response.json()["detail"] == "单张截图不能超过 5MB"
```

- [ ] **Step 2: 写普通用户不能读他人多图、管理员可读他人多图测试**

新增：

```python
def test_feedback_screenshot_permissions_for_multiple_screenshots(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    other_headers = _headers_for_new_user(client, db)
    upload_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=other_headers,
        data={"description": "其他人的截图"},
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )
    assert upload_response.status_code == 200
    other_feedback = upload_response.json()
    screenshot_id = other_feedback["screenshots"][0]["id"]

    forbidden_response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshots/{screenshot_id}",
        headers=normal_user_token_headers,
    )
    assert forbidden_response.status_code == 403

    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(client=client, key=admin_api_key.key, db=db)

    admin_response = client.get(
        f"{settings.API_V1_STR}/feedback/{other_feedback['id']}/screenshots/{screenshot_id}",
        headers=admin_headers,
    )
    assert admin_response.status_code == 200
    assert admin_response.content == b"png-bytes"
```

- [ ] **Step 3: 写旧 `/screenshot` 接口兼容测试**

新增：

```python
def test_legacy_feedback_screenshot_endpoint_returns_first_screenshot(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=normal_user_token_headers,
        data={"description": "兼容旧接口"},
        files=[
            ("screenshots", ("first.png", b"first-image", "image/png")),
            ("screenshots", ("second.png", b"second-image", "image/png")),
        ],
    )
    assert response.status_code == 200
    feedback = response.json()

    legacy_response = client.get(
        f"{settings.API_V1_STR}/feedback/{feedback['id']}/screenshot",
        headers=normal_user_token_headers,
    )

    assert legacy_response.status_code == 200
    assert legacy_response.content == b"first-image"
```

- [ ] **Step 4: 运行测试确认当前兼容和权限缺口**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py -q
```

Expected: FAIL，旧接口仍读旧字段，部分错误消息仍是英文。

- [ ] **Step 5: 完成旧接口兼容**

将 `read_feedback_screenshot` 改为先读 `feedback.screenshots` 的第一张，若没有再回退旧字段：

```python
screenshots = sorted(feedback.screenshots, key=lambda item: item.sort_order)
if screenshots:
    first = screenshots[0]
    screenshot_path = Path(first.file_path)
    if not screenshot_path.is_file():
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(
        screenshot_path,
        media_type=first.content_type,
        filename=first.file_name,
    )
```

保留旧字段回退：

```python
screenshot_path = Path(feedback.screenshot_path) if feedback.screenshot_path else None
```

- [ ] **Step 6: 检查删除用户清理逻辑**

如果 `users.py` 删除用户前手动删除反馈，确保先删除截图附件；如果依赖级联，确认 `FeedbackScreenshot.feedback_id` 设置了 `ondelete="CASCADE"`。测试清理和迁移已经覆盖数据库表顺序。

- [ ] **Step 7: 全量后端反馈测试并提交**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS。

Commit:

```bash
git add Agent/code_review_platform/code_review_server/backend/app/api/routes/feedback.py \
  Agent/code_review_platform/code_review_server/backend/app/api/routes/users.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_feedback.py
git commit -m "完善意见截图权限和兼容接口"
```

## Task 4: Web 类型、提交弹窗、列表和详情多图

**Files:**
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/client/types.gen.ts`
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/client/schemas.gen.ts`
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/client/sdk.gen.ts`
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/SubmitFeedbackDialog.tsx`
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/FeedbackDetailDialog.tsx`
- Modify: `Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/columns.tsx`
- Test: `Agent/code_review_platform/code_review_server/frontend/tests/feedback.spec.ts`

- [ ] **Step 1: 写 Web Playwright 多图期望**

在 `feedbackList.data[0]` 中替换截图字段：

```ts
has_screenshot: true,
screenshot_count: 2,
screenshots: [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    file_name: "first.png",
    content_type: "image/png",
    file_size: 128,
    sort_order: 0,
    created_at: "2026-06-09T04:00:00Z",
  },
  {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    file_name: "second.webp",
    content_type: "image/webp",
    file_size: 256,
    sort_order: 1,
    created_at: "2026-06-09T04:00:00Z",
  },
],
```

提交测试中拦截 POST 并断言 multipart 包含多个 `screenshots`：

```ts
let submittedScreenshotCount = 0
await page.route("**/api/v1/feedback", async (route) => {
  if (route.request().method() === "POST") {
    const formData = await route.request().postDataBuffer()
    submittedScreenshotCount = formData.toString().match(/name="screenshots"/g)?.length ?? 0
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "33333333-3333-3333-3333-333333333333",
        user_id: "22222222-2222-2222-2222-222222222222",
        description: "页面提交意见",
        has_screenshot: true,
        screenshot_count: 2,
        screenshots: [],
        status: "pending",
        created_at: "2026-06-09T04:00:00Z",
        updated_at: "2026-06-09T04:00:00Z",
      },
    })
    return
  }
})
```

- [ ] **Step 2: 运行 Web 测试确认失败**

Run:

```bash
cd Agent/code_review_platform/code_review_server/frontend
bunx playwright test tests/feedback.spec.ts
```

Expected: FAIL，当前 UI 只支持单图，详情仍请求 `/screenshot`。

- [ ] **Step 3: 更新前端类型**

优先运行：

```bash
cd Agent/code_review_platform/code_review_server/frontend
npm run generate-client
```

如果本地缺少可用后端 OpenAPI，手工更新 `types.gen.ts`：

```ts
export type Body_feedback_create_feedback = {
    description: string;
    screenshots?: Array<(Blob | File)> | null;
};

export type FeedbackScreenshotPublic = {
    id: string;
    file_name: string;
    content_type: string;
    file_size: number;
    sort_order: number;
    created_at?: (string | null);
};

export type FeedbackPublic = {
    id: string;
    user_id: string;
    user_name?: (string | null);
    svn_username?: (string | null);
    description: string;
    has_screenshot?: boolean;
    screenshot_count?: number;
    screenshots?: Array<FeedbackScreenshotPublic>;
    screenshot_name?: (string | null);
    screenshot_content_type?: (string | null);
    screenshot_size?: (number | null);
    status: FeedbackStatus;
    created_at?: (string | null);
    updated_at?: (string | null);
};
```

`sdk.gen.ts` 增加新下载接口方法：

```ts
export const feedbackReadFeedbackScreenshotById = <ThrowOnError extends boolean = false>(options: Options<FeedbackReadFeedbackScreenshotByIdData, ThrowOnError>) => {
    return (options?.client ?? client).get<unknown, unknown, ThrowOnError>({
        ...options,
        url: '/api/v1/feedback/{feedback_id}/screenshots/{screenshot_id}',
        path: {
            feedback_id: options.path.feedbackId,
            screenshot_id: options.path.screenshotId
        }
    });
};
```

- [ ] **Step 4: Web 提交弹窗改为 `File[]`**

核心状态改为：

```ts
const MAX_SCREENSHOT_COUNT = 5
const [screenshots, setScreenshots] = useState<File[]>([])
```

提交时：

```ts
async function createFeedback(input: { description: string; screenshots: File[] }) {
  const formData = new FormData()
  formData.append("description", input.description)
  for (const screenshot of input.screenshots) {
    formData.append("screenshots", screenshot)
  }
  ...
}
```

追加文件函数：

```ts
const appendScreenshots = (files: File[]) => {
  const next = [...screenshots]
  for (const file of files) {
    if (next.length >= MAX_SCREENSHOT_COUNT) {
      showErrorToast("最多只能上传 5 张截图")
      break
    }
    const error = validateScreenshot(file)
    if (error) {
      showErrorToast(error)
      continue
    }
    next.push(file)
  }
  setScreenshots(next)
}
```

`Input` 增加 `multiple`，粘贴从 `clipboardData.items` 取所有图片，预览列表 `screenshots.map(...)`，移除时按 index 删除。

- [ ] **Step 5: 列表列和详情弹窗改为多图**

`columns.tsx` 截图列改为：

```tsx
const screenshotCount = row.original.screenshot_count ?? row.original.screenshots?.length ?? 0
return screenshotCount > 0 ? (
  <Button type="button" variant="ghost" size="sm" onClick={() => onOpenDetail(row.original)}>
    <ImageIcon />
    {screenshotCount} 张
  </Button>
) : (
  <span className="text-muted-foreground">-</span>
)
```

`FeedbackDetailDialog.tsx` 用 `feedback.screenshots` 排序后逐张 fetch：

```ts
async function fetchScreenshot(feedbackId: string, screenshotId: string) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/feedback/${feedbackId}/screenshots/${screenshotId}`,
    { headers: authHeaders() },
  )
  if (!response.ok) {
    throw new Error("加载截图失败")
  }
  return response.blob()
}
```

状态使用：

```ts
const [screenshotUrls, setScreenshotUrls] = useState<Array<{ id: string; url: string }>>([])
```

关闭或切换意见时释放所有 object URL。

- [ ] **Step 6: 运行 Web 构建和 Playwright 测试**

Run:

```bash
cd Agent/code_review_platform/code_review_server/frontend
npm run build
bunx playwright test tests/feedback.spec.ts
```

Expected: PASS。如果本机没有 `bun`，记录实际错误并至少完成 `npm run build`。

- [ ] **Step 7: 提交**

```bash
git add Agent/code_review_platform/code_review_server/frontend/src/client/types.gen.ts \
  Agent/code_review_platform/code_review_server/frontend/src/client/schemas.gen.ts \
  Agent/code_review_platform/code_review_server/frontend/src/client/sdk.gen.ts \
  Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/SubmitFeedbackDialog.tsx \
  Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/FeedbackDetailDialog.tsx \
  Agent/code_review_platform/code_review_server/frontend/src/components/Feedback/columns.tsx \
  Agent/code_review_platform/code_review_server/frontend/tests/feedback.spec.ts
git commit -m "支持网页意见管理多图"
```

## Task 5: Electron API、preload、IPC 和 ApiClient 多图

**Files:**
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/preload/index.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/preload/index.test.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/main/ipc.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/main/__tests__/ipc.test.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/main/api-client.ts`
- Modify: `Agent/code_review_platform/code_review_electron/src/main/__tests__/api-client.test.ts`

- [ ] **Step 1: 写 preload 多图序列化测试**

把 `serializes screenshot files` 测试改为：

```ts
it('serializes screenshot files before invoking feedback IPC', async () => {
  const api = exposedApi()
  const screenshots = [
    { name: 'first.png', type: 'image/png', arrayBuffer: vi.fn(async () => new TextEncoder().encode('first').buffer) },
    { name: 'second.webp', type: 'image/webp', arrayBuffer: vi.fn(async () => new TextEncoder().encode('second').buffer) }
  ] as unknown as File[]

  await api.submitFeedback({ description: '无法下载报告', screenshots })

  expect(invokeMock).toHaveBeenCalledWith(
    'feedback:submit',
    expect.objectContaining({
      description: '无法下载报告',
      screenshots: [
        expect.objectContaining({ name: 'first.png', type: 'image/png' }),
        expect.objectContaining({ name: 'second.webp', type: 'image/webp' })
      ]
    })
  )
})
```

- [ ] **Step 2: 写 ApiClient multipart 多图测试**

在 `api-client.test.ts` 对 `submitFeedback` 的断言改为：

```ts
const screenshots = [
  new File(['first'], 'first.png', { type: 'image/png' }),
  new File(['second'], 'second.webp', { type: 'image/webp' })
]
await client.submitFeedback('token-123', { description: '按钮无响应', screenshots })
const uploadedScreenshots = init.body.getAll('screenshots')
expect(uploadedScreenshots).toHaveLength(2)
expect(uploadedScreenshots[0]).toBe(screenshots[0])
expect(uploadedScreenshots[1]).toBe(screenshots[1])
expect(init.body.get('screenshot')).toBeNull()
```

- [ ] **Step 3: 写 IPC 多图还原测试**

在 `ipc.test.ts` 的提交测试 payload 改为：

```ts
const payload = {
  description: '按钮点击后没有响应',
  screenshots: [
    { name: 'first.png', type: 'image/png', bytes: new TextEncoder().encode('first').buffer },
    { name: 'second.webp', type: 'image/webp', bytes: new TextEncoder().encode('second').buffer }
  ]
}
```

断言：

```ts
expect(api.submitFeedback).toHaveBeenCalledWith('token-123', {
  description: '按钮点击后没有响应',
  screenshots: [
    expect.any(Blob),
    expect.any(Blob),
  ],
  screenshotNames: ['first.png', 'second.webp'],
})
```

- [ ] **Step 4: 运行 Electron 相关测试确认失败**

Run:

```bash
cd Agent/code_review_platform/code_review_electron
npm test -- src/preload/index.test.ts src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts
```

Expected: FAIL，类型仍为单图。

- [ ] **Step 5: 改 Electron 类型**

`code-review-api.ts`：

```ts
export interface SubmitFeedbackPayload {
  description: string
  screenshots?: File[]
}

export interface SubmitFeedbackIpcPayload {
  description: string
  screenshots?: SerializedFeedbackScreenshot[]
}
```

`api-client.ts`：

```ts
export interface SubmitFeedbackRequest {
  description: string
  screenshots?: Array<File | Blob>
  screenshotNames?: string[]
}
```

- [ ] **Step 6: 实现多图序列化、IPC 还原和 multipart**

`preload/index.ts`：

```ts
const serializeFeedbackPayload = async (
  payload: SubmitFeedbackPayload
): Promise<SubmitFeedbackIpcPayload> => ({
  description: payload.description,
  screenshots: await Promise.all(
    (payload.screenshots ?? []).map(async (screenshot) => ({
      name: screenshot.name,
      type: screenshot.type,
      bytes: await screenshot.arrayBuffer()
    }))
  )
})
```

`ipc.ts`：

```ts
const toSubmitFeedbackRequest = (payload: SubmitFeedbackIpcPayload): SubmitFeedbackRequest => ({
  description: payload.description,
  screenshots: (payload.screenshots ?? []).map(
    (screenshot) => new Blob([screenshot.bytes], { type: screenshot.type })
  ),
  screenshotNames: (payload.screenshots ?? []).map((screenshot) => screenshot.name)
})
```

`api-client.ts`：

```ts
for (const [index, screenshot] of (payload.screenshots ?? []).entries()) {
  const screenshotName = payload.screenshotNames?.[index]
  if (screenshotName) {
    body.append('screenshots', screenshot, screenshotName)
  } else {
    body.append('screenshots', screenshot)
  }
}
```

- [ ] **Step 7: 运行测试并提交**

Run:

```bash
cd Agent/code_review_platform/code_review_electron
npm test -- src/preload/index.test.ts src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts
npm run typecheck
```

Expected: PASS。

Commit:

```bash
git add Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts \
  Agent/code_review_platform/code_review_electron/src/preload/index.ts \
  Agent/code_review_platform/code_review_electron/src/preload/index.test.ts \
  Agent/code_review_platform/code_review_electron/src/main/ipc.ts \
  Agent/code_review_platform/code_review_electron/src/main/__tests__/ipc.test.ts \
  Agent/code_review_platform/code_review_electron/src/main/api-client.ts \
  Agent/code_review_platform/code_review_electron/src/main/__tests__/api-client.test.ts
git commit -m "支持客户端多图提交传输"
```

## Task 6: Electron Renderer 多图提交 UI

**Files:**
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx`
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.test.tsx`
- Modify: `Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 写 Renderer 多图行为测试**

在 `SubmitFeedbackDialog.test.tsx` 中新增：

```ts
it('submits multiple selected screenshots', async () => {
  render(<SubmitFeedbackDialog open onClose={onClose} />)
  await userEvent.type(screen.getByLabelText('问题描述'), '多个页面都异常')
  const files = [
    new File(['first'], 'first.png', { type: 'image/png' }),
    new File(['second'], 'second.webp', { type: 'image/webp' })
  ]

  await userEvent.upload(screen.getByLabelText('选择截图'), files)
  await userEvent.click(screen.getByRole('button', { name: '提交意见' }))

  await waitFor(() => {
    expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
      description: '多个页面都异常',
      screenshots: files
    })
  })
})
```

新增超过 5 张限制测试：

```ts
it('rejects more than five screenshots', async () => {
  render(<SubmitFeedbackDialog open onClose={onClose} />)
  const files = Array.from(
    { length: 6 },
    (_, index) => new File(['image'], `screen-${index}.png`, { type: 'image/png' })
  )

  await userEvent.upload(screen.getByLabelText('选择截图'), files)

  expect(screen.getByText('最多只能上传 5 张截图')).toBeInTheDocument()
  expect(screen.queryByText('screen-5.png')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行 Renderer 测试确认失败**

Run:

```bash
cd Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/SubmitFeedbackDialog.test.tsx
```

Expected: FAIL，当前状态只保存单张截图。

- [ ] **Step 3: Renderer 状态改为多图**

核心改动：

```tsx
const MAX_SCREENSHOT_COUNT = 5
const [screenshots, setScreenshots] = useState<File[]>([])
const [previewUrls, setPreviewUrls] = useState<Array<{ file: File; url: string }>>([])
```

追加函数：

```tsx
const appendScreenshots = (files: File[]): void => {
  const accepted: File[] = []
  for (const file of files) {
    if (screenshots.length + accepted.length >= MAX_SCREENSHOT_COUNT) {
      setError('最多只能上传 5 张截图')
      break
    }
    const validationError = validateScreenshot(file)
    if (validationError) {
      setError(validationError)
      continue
    }
    accepted.push(file)
  }
  if (accepted.length > 0) {
    setScreenshots((current) => [...current, ...accepted])
    setError('')
  }
}
```

提交：

```tsx
await window.codeReview.submitFeedback({
  description: normalizedDescription,
  screenshots
})
```

文件输入加 `multiple`，粘贴处理 `Array.from(event.clipboardData.files).filter(...)`，移除按钮按 index 删除。

- [ ] **Step 4: 样式调整**

`styles.css` 将单图预览改为网格：

```css
.feedback-screenshot-list {
  display: grid;
  gap: 10px;
}

.feedback-screenshot-preview {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  align-items: center;
}
```

- [ ] **Step 5: 运行 Electron Renderer 测试和 typecheck**

Run:

```bash
cd Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/SubmitFeedbackDialog.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/components/SubmitFeedbackDialog.test.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css
git commit -m "支持客户端意见弹窗多图选择"
```

## Task 7: 整体验证、文档位置修正和收尾

**Files:**
- Modify: `Agent/code_review_platform/docs/superpowers/specs/2026-06-09-feedback-multi-screenshot-design.md`
- Modify: `Agent/code_review_platform/docs/superpowers/plans/2026-06-09-feedback-multi-screenshot.md`

- [ ] **Step 1: 运行后端反馈测试**

Run:

```bash
cd Agent/code_review_platform/code_review_server/backend
pytest tests/api/routes/test_feedback.py -q
```

Expected: PASS。如果 PostgreSQL 测试库不可用，记录完整错误，例如连接失败或 Docker 未启动。

- [ ] **Step 2: 运行 Web 验证**

Run:

```bash
cd Agent/code_review_platform/code_review_server/frontend
npm run build
bunx playwright test tests/feedback.spec.ts
```

Expected: PASS。如果 `bun` 不存在，记录 `command not found: bunx`，但 `npm run build` 仍必须尝试。

- [ ] **Step 3: 运行 Electron 验证**

Run:

```bash
cd Agent/code_review_platform/code_review_electron
npm test -- src/preload/index.test.ts src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/renderer/src/components/SubmitFeedbackDialog.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 检查 spec 和 plan 都在项目目录**

Run:

```bash
find Agent/code_review_platform/docs/superpowers -maxdepth 3 -type f | sort | grep feedback-multi-screenshot
```

Expected:

```text
Agent/code_review_platform/docs/superpowers/plans/2026-06-09-feedback-multi-screenshot.md
Agent/code_review_platform/docs/superpowers/specs/2026-06-09-feedback-multi-screenshot-design.md
```

- [ ] **Step 5: 运行 git 状态检查**

Run:

```bash
git status --short --branch
```

Expected: 只显示本任务相关文件，且分支为 `codex/feedback-multi-screenshot`。

- [ ] **Step 6: 提交收尾文档或验证修正**

如果 Task 7 中仅有文档位置修正或计划勾选更新：

```bash
git add Agent/code_review_platform/docs/superpowers/specs/2026-06-09-feedback-multi-screenshot-design.md \
  Agent/code_review_platform/docs/superpowers/plans/2026-06-09-feedback-multi-screenshot.md
git commit -m "整理意见反馈多图文档"
```

如果没有文件变更，不创建空提交。

## 自检

- Spec 覆盖：后端 0-5 张截图、单张 5MB、PNG/JPEG/WebP、多图元数据、鉴权下载、旧接口兼容、普通用户/管理员可见范围、管理员改状态、Web 和 Electron 多图选择/粘贴/移除均有任务覆盖。
- 占位扫描：计划不包含空白实现项，所有测试、接口、文件路径和命令都给出明确内容。
- 类型一致性：统一使用 `screenshots` 作为新 multipart 字段和前后端多图属性；旧字段 `screenshot` 仅用于兼容旧下载接口和旧响应字段。
- 风险记录：Web 生成客户端依赖后端 OpenAPI 可用性；如果本地缺 `bun`，Playwright 验证需记录环境限制。后端测试依赖 PostgreSQL 测试库，如果数据库不可用，必须记录实际失败原因。
