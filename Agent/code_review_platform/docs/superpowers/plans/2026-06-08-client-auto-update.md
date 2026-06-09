# Windows 客户端自动更新实现计划

> **给执行代理的要求：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行。每个步骤使用复选框跟踪进度。

**目标：** 在 `Test` 分支实现 Windows Electron 客户端可选自动更新，管理员在 Web 后台发布版本，客户端登录后检查、提示、下载并安装更新。

**架构：** 后端新增 `ClientRelease` 发布包模型、上传/激活 API 和登录用户可访问的更新文件下载 API。Web 管理后台新增“客户端版本”页面复用 Skill 库的上传和列表风格。Electron 主进程集成 `electron-updater` 的 `NsisUpdater`，Renderer 展示更新提示、下载进度和安装确认。

**技术栈：** FastAPI、SQLModel、Alembic、pytest、React、TanStack Router、TanStack Query、Electron、electron-builder、electron-updater、Vitest。

---

## 执行前约束

- 所有开发都在 `/home/gpt/PeiChengAI/.worktrees/Test` 的 `Test` 分支进行。
- 修改代码前先同步远程 `main`：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git fetch origin
git rebase origin/main
git status --short --branch
```

期望：`git rebase origin/main` 成功，`git status` 显示 `## Test` 且没有未提交文件。

- 不修改主工作区 `/home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/.env`。
- 文档和提交信息使用中文。
- 开发完成后留在 `Test` 分支，由用户在测试分支验证，通过后再合并主分支。

## 文件结构

后端文件：

- 新增：`Agent/code_review_platform/code_review_server/backend/app/services/client_release_service.py`
  - 负责保存安装包、解析 `latest.yml`、校验文件名和版本、激活版本、读取当前启用版本文件。
- 新增：`Agent/code_review_platform/code_review_server/backend/app/api/routes/client_releases.py`
  - 管理员发布 API 和客户端更新下载 API。
- 修改：`Agent/code_review_platform/code_review_server/backend/app/models.py`
  - 新增 `ClientRelease`、`ClientReleasePublic`、`ClientReleasesPublic`。
- 修改：`Agent/code_review_platform/code_review_server/backend/app/core/config.py`
  - 新增 `CLIENT_RELEASE_STORAGE_DIR`。
- 修改：`Agent/code_review_platform/code_review_server/backend/app/api/main.py`
  - 注册 `client_releases.router`。
- 新增：`Agent/code_review_platform/code_review_server/backend/app/alembic/versions/<revision>_add_client_releases.py`
  - 新建 `client_release` 表。
- 修改：`Agent/code_review_platform/code_review_server/backend/tests/conftest.py`
  - 测试清理 `ClientRelease`。
- 新增：`Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py`
  - 覆盖上传、激活、下载、权限和路径安全。

Web 前端文件：

- 新增：`Agent/code_review_platform/code_review_server/frontend/src/components/Admin/ClientReleasesPage.tsx`
  - 管理员上传客户端版本和查看版本列表。
- 新增：`Agent/code_review_platform/code_review_server/frontend/src/routes/_layout/admin.client-releases.tsx`
  - 管理后台路由。
- 修改：`Agent/code_review_platform/code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
  - 增加“客户端版本”入口。
- 生成或修改：`Agent/code_review_platform/code_review_server/frontend/src/routeTree.gen.ts`
  - 如果项目脚本自动生成路由树，运行对应生成命令；如果本地生成命令不可用，按现有生成文件格式手动补齐。

Electron 文件：

- 修改：`Agent/code_review_platform/code_review_electron/package.json`
  - 新增 `electron-updater` 和 `electron-log` 依赖。
- 新增：`Agent/code_review_platform/code_review_electron/src/main/app-updater.ts`
  - 封装更新检查、下载、安装和事件转发。
- 修改：`Agent/code_review_platform/code_review_electron/src/main/ipc.ts`
  - 注册更新相关 IPC。
- 修改：`Agent/code_review_platform/code_review_electron/src/preload/index.ts`
  - 暴露更新 API 和事件监听。
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts`
  - 定义更新状态、事件和 API 类型。
- 新增：`Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.tsx`
  - 展示更新提示、下载进度、完成和错误状态。
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/App.tsx`
  - 登录成功后检查更新并挂载弹窗。
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`
  - 增加更新弹窗样式。
- 新增：`Agent/code_review_platform/code_review_electron/src/main/__tests__/app-updater.test.ts`
  - 测试更新服务。
- 修改：`Agent/code_review_platform/code_review_electron/src/main/__tests__/ipc.test.ts`
  - 测试 IPC 注册和未登录保护。
- 新增：`Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.test.tsx`
  - 测试 Renderer 更新弹窗。

测试环境文件：

- 已修改：`Agent/code_review_platform/code_review_server/.env.test`
  - 已包含 `CLIENT_RELEASE_STORAGE_DIR=/app/client-releases`。
- 已修改：`Agent/code_review_platform/code_review_server/compose.test.yml`
  - 已挂载 `code_review_server_test_client-release-data`。

---

## 任务 1：后端模型、配置和迁移

**文件：**

- 修改：`Agent/code_review_platform/code_review_server/backend/app/models.py`
- 修改：`Agent/code_review_platform/code_review_server/backend/app/core/config.py`
- 新增：`Agent/code_review_platform/code_review_server/backend/app/alembic/versions/8d6f0c2b7a31_add_client_releases.py`
- 修改：`Agent/code_review_platform/code_review_server/backend/tests/conftest.py`

- [ ] **步骤 1：写失败测试，证明测试夹具需要清理客户端发布表**

在 `Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py` 新建最小测试：

```python
from app.models import ClientRelease


def test_client_release_model_is_available() -> None:
    release = ClientRelease(
        version="1.0.1",
        platform="win32",
        arch="x64",
        release_notes="修复任务列表显示问题",
        artifact_name="代码审查-v1.0.1.exe",
        artifact_path="/tmp/release/代码审查-v1.0.1.exe",
        artifact_size=12,
        artifact_sha512="a" * 128,
        latest_yml_name="latest.yml",
        latest_yml_path="/tmp/release/latest.yml",
        is_active=False,
    )

    assert release.version == "1.0.1"
    assert release.platform == "win32"
    assert release.arch == "x64"
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py::test_client_release_model_is_available -q
```

期望：失败，错误包含 `ImportError` 或 `cannot import name 'ClientRelease'`。

- [ ] **步骤 3：实现模型和配置**

在 `models.py` 的 `SkillPackagesPublic` 后加入：

```python
class ClientRelease(SQLModel, table=True):
    __tablename__ = "client_release"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version: str = Field(max_length=128, index=True)
    platform: str = Field(default="win32", max_length=32, index=True)
    arch: str = Field(default="x64", max_length=32, index=True)
    release_notes: str | None = Field(default=None, max_length=4096)
    artifact_name: str = Field(max_length=255)
    artifact_path: str = Field(max_length=2048)
    artifact_size: int = Field(default=0)
    artifact_sha512: str = Field(max_length=128, index=True)
    latest_yml_name: str = Field(max_length=255)
    latest_yml_path: str = Field(max_length=2048)
    blockmap_name: str | None = Field(default=None, max_length=255)
    blockmap_path: str | None = Field(default=None, max_length=2048)
    is_active: bool = Field(default=False, index=True)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ClientReleasePublic(SQLModel):
    id: uuid.UUID
    version: str
    platform: str
    arch: str
    release_notes: str | None = None
    artifact_name: str
    artifact_size: int
    artifact_sha512: str
    latest_yml_name: str
    blockmap_name: str | None = None
    is_active: bool
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ClientReleasesPublic(SQLModel):
    data: list[ClientReleasePublic]
    count: int
```

在 `config.py` 的存储配置处加入：

```python
    CLIENT_RELEASE_STORAGE_DIR: str = "/app/client-releases"
```

- [ ] **步骤 4：新增 Alembic 迁移**

新增 `backend/app/alembic/versions/8d6f0c2b7a31_add_client_releases.py`：

```python
"""add client releases

Revision ID: 8d6f0c2b7a31
Revises: a7c9e2f1b304
Create Date: 2026-06-08 16:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel.sql.sqltypes


revision = "8d6f0c2b7a31"
down_revision = "a7c9e2f1b304"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client_release",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column("platform", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column("arch", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column("release_notes", sqlmodel.sql.sqltypes.AutoString(length=4096), nullable=True),
        sa.Column("artifact_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("artifact_path", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("artifact_size", sa.Integer(), nullable=False),
        sa.Column("artifact_sha512", sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column("latest_yml_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("latest_yml_path", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("blockmap_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("blockmap_path", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_client_release_version"), "client_release", ["version"], unique=False)
    op.create_index(op.f("ix_client_release_platform"), "client_release", ["platform"], unique=False)
    op.create_index(op.f("ix_client_release_arch"), "client_release", ["arch"], unique=False)
    op.create_index(op.f("ix_client_release_artifact_sha512"), "client_release", ["artifact_sha512"], unique=False)
    op.create_index(op.f("ix_client_release_is_active"), "client_release", ["is_active"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_client_release_is_active"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_artifact_sha512"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_arch"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_platform"), table_name="client_release")
    op.drop_index(op.f("ix_client_release_version"), table_name="client_release")
    op.drop_table("client_release")
```

执行前检查当前 Alembic head：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run alembic heads
```

如果 head 不是 `a7c9e2f1b304`，把 `down_revision` 改成当前 head，再继续。

- [ ] **步骤 5：更新测试夹具清理**

在 `backend/tests/conftest.py` 导入列表加入：

```python
    ClientRelease,
```

在清理 `SkillPackage` 前加入：

```python
        if inspect(engine).has_table("client_release"):
            statement = delete(ClientRelease)
            session.execute(statement)
```

- [ ] **步骤 6：运行模型测试**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py::test_client_release_model_is_available -q
```

期望：通过。

- [ ] **步骤 7：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_server/backend/app/models.py \
  Agent/code_review_platform/code_review_server/backend/app/core/config.py \
  Agent/code_review_platform/code_review_server/backend/app/alembic/versions/8d6f0c2b7a31_add_client_releases.py \
  Agent/code_review_platform/code_review_server/backend/tests/conftest.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py
git commit -m "新增客户端版本发布数据模型"
```

---

## 任务 2：后端发布包保存服务

**文件：**

- 新增：`Agent/code_review_platform/code_review_server/backend/app/services/client_release_service.py`
- 修改：`Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py`

- [ ] **步骤 1：写失败测试，覆盖 `latest.yml` 校验**

在 `test_client_releases.py` 加入：

```python
import hashlib
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.services import client_release_service


def _latest_yml(version: str, filename: str, sha512: str, size: int) -> bytes:
    return (
        f"version: {version}\n"
        "files:\n"
        f"  - url: {filename}\n"
        f"    sha512: {sha512}\n"
        f"    size: {size}\n"
        f"path: {filename}\n"
        f"sha512: {sha512}\n"
        "releaseDate: '2026-06-08T08:00:00.000Z'\n"
    ).encode()


def test_parse_latest_yml_requires_matching_version_and_installer() -> None:
    installer = b"installer bytes"
    sha512 = hashlib.sha512(installer).hexdigest()

    metadata = client_release_service.parse_latest_yml(
        content=_latest_yml("1.0.1", "代码审查-v1.0.1.exe", sha512, len(installer)),
        expected_version="1.0.1",
        expected_installer_name="代码审查-v1.0.1.exe",
    )

    assert metadata.version == "1.0.1"
    assert metadata.installer_name == "代码审查-v1.0.1.exe"
    assert metadata.sha512 == sha512
    assert metadata.size == len(installer)


def test_parse_latest_yml_rejects_mismatched_version() -> None:
    with pytest.raises(HTTPException) as exc_info:
        client_release_service.parse_latest_yml(
            content=_latest_yml("1.0.2", "代码审查-v1.0.1.exe", "a" * 128, 12),
            expected_version="1.0.1",
            expected_installer_name="代码审查-v1.0.1.exe",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "latest.yml version does not match submitted version"
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py::test_parse_latest_yml_requires_matching_version_and_installer tests/api/routes/test_client_releases.py::test_parse_latest_yml_rejects_mismatched_version -q
```

期望：失败，错误包含 `cannot import name 'client_release_service'`。

- [ ] **步骤 3：实现服务**

新增 `backend/app/services/client_release_service.py`：

```python
import hashlib
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException, UploadFile
from sqlmodel import Session, col, select

from app.core.config import settings
from app.models import ClientRelease, get_datetime_utc

SUPPORTED_PLATFORM = "win32"
SUPPORTED_ARCH = "x64"
LATEST_YML_NAME = "latest.yml"


@dataclass(frozen=True)
class LatestYmlMetadata:
    version: str
    installer_name: str
    sha512: str
    size: int


def path_for_release(release_id: uuid.UUID) -> Path:
    return Path(settings.CLIENT_RELEASE_STORAGE_DIR) / str(release_id)


def parse_latest_yml(
    *,
    content: bytes,
    expected_version: str,
    expected_installer_name: str,
) -> LatestYmlMetadata:
    try:
        payload = yaml.safe_load(content.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError):
        raise HTTPException(status_code=400, detail="latest.yml must be valid YAML")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="latest.yml must be a YAML object")

    version = _string_field(payload, "version")
    if version != expected_version:
        raise HTTPException(
            status_code=400,
            detail="latest.yml version does not match submitted version",
        )

    installer_name = _installer_name_from_payload(payload)
    if installer_name != expected_installer_name:
        raise HTTPException(
            status_code=400,
            detail="latest.yml installer filename does not match uploaded installer",
        )

    sha512 = _string_field(payload, "sha512")
    size = _size_from_payload(payload)
    return LatestYmlMetadata(
        version=version,
        installer_name=installer_name,
        sha512=sha512,
        size=size,
    )


async def save_upload(
    *,
    release_id: uuid.UUID,
    version: str,
    installer: UploadFile,
    latest_yml: UploadFile,
    blockmap: UploadFile | None,
) -> tuple[Path, LatestYmlMetadata, int]:
    installer_name = _safe_filename(installer.filename, required_suffix=".exe")
    latest_yml_name = _safe_filename(latest_yml.filename, required_name=LATEST_YML_NAME)
    installer_content = await installer.read()
    latest_yml_content = await latest_yml.read()

    if not installer_content:
        raise HTTPException(status_code=400, detail="Installer file must not be empty")
    if not latest_yml_content:
        raise HTTPException(status_code=400, detail="latest.yml must not be empty")

    metadata = parse_latest_yml(
        content=latest_yml_content,
        expected_version=version,
        expected_installer_name=installer_name,
    )
    actual_sha512 = hashlib.sha512(installer_content).hexdigest()
    if metadata.sha512 != actual_sha512:
        raise HTTPException(status_code=400, detail="Installer sha512 does not match latest.yml")

    release_path = path_for_release(release_id)
    if release_path.exists():
        shutil.rmtree(release_path)
    release_path.mkdir(parents=True, exist_ok=True)
    (release_path / installer_name).write_bytes(installer_content)
    (release_path / latest_yml_name).write_bytes(latest_yml_content)

    if blockmap is not None and blockmap.filename:
        blockmap_name = _safe_filename(blockmap.filename, required_suffix=".blockmap")
        blockmap_content = await blockmap.read()
        if blockmap_content:
            (release_path / blockmap_name).write_bytes(blockmap_content)

    return release_path, metadata, len(installer_content)


def activate_release(session: Session, release: ClientRelease) -> ClientRelease:
    active_releases = session.exec(
        select(ClientRelease).where(
            ClientRelease.platform == release.platform,
            ClientRelease.arch == release.arch,
            ClientRelease.is_active == True,  # noqa: E712
        )
    ).all()
    now = get_datetime_utc()
    for active_release in active_releases:
        if active_release.id != release.id:
            active_release.is_active = False
            active_release.updated_at = now
            session.add(active_release)

    release.is_active = True
    release.updated_at = now
    session.add(release)
    session.commit()
    session.refresh(release)
    return release


def get_active_release(
    session: Session,
    platform: str = SUPPORTED_PLATFORM,
    arch: str = SUPPORTED_ARCH,
) -> ClientRelease | None:
    return session.exec(
        select(ClientRelease)
        .where(
            ClientRelease.platform == platform,
            ClientRelease.arch == arch,
            ClientRelease.is_active == True,  # noqa: E712
        )
        .order_by(col(ClientRelease.updated_at).desc())
    ).first()


def resolve_release_file(release: ClientRelease, filename: str) -> Path:
    safe_name = _safe_filename(filename)
    allowed_names = {
        release.artifact_name,
        release.latest_yml_name,
    }
    if release.blockmap_name:
        allowed_names.add(release.blockmap_name)
    if safe_name not in allowed_names:
        raise HTTPException(status_code=404, detail="Release file not found")

    release_path = Path(release.artifact_path).parent.resolve()
    file_path = (release_path / safe_name).resolve()
    if not file_path.is_relative_to(release_path) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Release file not found")
    return file_path


def _string_field(payload: dict[str, Any], field_name: str) -> str:
    value = payload.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail=f"latest.yml missing {field_name}")
    return value.strip()


def _installer_name_from_payload(payload: dict[str, Any]) -> str:
    path_value = payload.get("path")
    if isinstance(path_value, str) and path_value.strip():
        return _safe_filename(path_value)

    files = payload.get("files")
    if isinstance(files, list) and files:
        first = files[0]
        if isinstance(first, dict):
            url = first.get("url")
            if isinstance(url, str) and url.strip():
                return _safe_filename(url)

    raise HTTPException(status_code=400, detail="latest.yml missing installer filename")


def _size_from_payload(payload: dict[str, Any]) -> int:
    files = payload.get("files")
    if isinstance(files, list) and files:
        first = files[0]
        if isinstance(first, dict):
            size = first.get("size")
            if isinstance(size, int) and size >= 0:
                return size
    raise HTTPException(status_code=400, detail="latest.yml missing installer size")


def _safe_filename(
    filename: str | None,
    *,
    required_name: str | None = None,
    required_suffix: str | None = None,
) -> str:
    if not filename:
        raise HTTPException(status_code=400, detail="Release filename is required")
    path = Path(filename)
    if path.name != filename or "\\" in filename or ".." in path.parts:
        raise HTTPException(status_code=400, detail="Invalid release filename")
    if required_name is not None and filename != required_name:
        raise HTTPException(status_code=400, detail=f"Release file must be named {required_name}")
    if required_suffix is not None and not filename.lower().endswith(required_suffix):
        raise HTTPException(status_code=400, detail=f"Release file must end with {required_suffix}")
    return filename
```

- [ ] **步骤 4：运行服务测试**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py::test_parse_latest_yml_requires_matching_version_and_installer tests/api/routes/test_client_releases.py::test_parse_latest_yml_rejects_mismatched_version -q
```

期望：通过。

- [ ] **步骤 5：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_server/backend/app/services/client_release_service.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py
git commit -m "新增客户端发布包校验服务"
```

---

## 任务 3：后端客户端版本 API

**文件：**

- 新增：`Agent/code_review_platform/code_review_server/backend/app/api/routes/client_releases.py`
- 修改：`Agent/code_review_platform/code_review_server/backend/app/api/main.py`
- 修改：`Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py`

- [ ] **步骤 1：写失败测试，覆盖上传、激活、下载和权限**

在 `test_client_releases.py` 加入：

```python
import io

from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import ClientRelease


def _installer_bytes(version: str) -> bytes:
    return f"installer bytes {version}".encode()


def _release_files(version: str, filename: str = "代码审查-v1.0.1.exe") -> dict[str, tuple[str, bytes, str]]:
    installer = _installer_bytes(version)
    sha512 = hashlib.sha512(installer).hexdigest()
    latest = _latest_yml(version, filename, sha512, len(installer))
    return {
        "installer": (filename, installer, "application/vnd.microsoft.portable-executable"),
        "latest_yml": ("latest.yml", latest, "application/yaml"),
        "blockmap": (f"{filename}.blockmap", b"blockmap bytes", "application/octet-stream"),
    }


def test_admin_can_upload_activate_and_user_can_download_client_release(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "CLIENT_RELEASE_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/client-releases",
        headers=superuser_token_headers,
        data={
            "version": "1.0.1",
            "release_notes": "修复任务列表显示问题",
            "activate": "true",
        },
        files=_release_files("1.0.1"),
    )

    assert response.status_code == 200
    release = response.json()
    assert release["version"] == "1.0.1"
    assert release["platform"] == "win32"
    assert release["arch"] == "x64"
    assert release["is_active"] is True
    assert release["artifact_name"] == "代码审查-v1.0.1.exe"

    latest_response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/latest.yml",
        headers=normal_user_token_headers,
    )
    assert latest_response.status_code == 200
    assert latest_response.content.startswith(b"version: 1.0.1")

    installer_response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/%E4%BB%A3%E7%A0%81%E5%AE%A1%E6%9F%A5-v1.0.1.exe",
        headers=normal_user_token_headers,
    )
    assert installer_response.status_code == 200
    assert installer_response.content == _installer_bytes("1.0.1")


def test_non_admin_cannot_upload_client_release(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "CLIENT_RELEASE_STORAGE_DIR", str(tmp_path))

    response = client.post(
        f"{settings.API_V1_STR}/client-releases",
        headers=normal_user_token_headers,
        data={"version": "1.0.1", "release_notes": "普通用户上传", "activate": "true"},
        files=_release_files("1.0.1"),
    )

    assert response.status_code == 403


def test_client_release_download_requires_login(
    client: TestClient,
) -> None:
    response = client.get(f"{settings.API_V1_STR}/client-updates/win32/x64/latest.yml")

    assert response.status_code == 401


def test_client_release_rejects_path_traversal(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "CLIENT_RELEASE_STORAGE_DIR", str(tmp_path))
    upload_response = client.post(
        f"{settings.API_V1_STR}/client-releases",
        headers=superuser_token_headers,
        data={"version": "1.0.1", "activate": "true"},
        files=_release_files("1.0.1"),
    )
    assert upload_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/client-updates/win32/x64/..%2Fsecret.txt",
        headers=normal_user_token_headers,
    )

    assert response.status_code in {400, 404}
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py -q
```

期望：至少路由相关测试失败，状态码为 404。

- [ ] **步骤 3：实现路由**

新增 `backend/app/api/routes/client_releases.py`：

```python
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_current_active_admin
from app.models import ClientRelease, ClientReleasePublic, ClientReleasesPublic
from app.services import client_release_service

router = APIRouter(tags=["client-releases"])


def _get_release_or_404(session: SessionDep, release_id: uuid.UUID) -> ClientRelease:
    release = session.get(ClientRelease, release_id)
    if release is None:
        raise HTTPException(status_code=404, detail="Client release not found")
    return release


@router.get(
    "/client-releases",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ClientReleasesPublic,
)
def read_client_releases(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count_statement = select(func.count()).select_from(ClientRelease)
    count = session.exec(count_statement).one()
    statement = (
        select(ClientRelease)
        .order_by(col(ClientRelease.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    releases = session.exec(statement).all()
    return ClientReleasesPublic(
        data=[ClientReleasePublic.model_validate(release) for release in releases],
        count=count,
    )


@router.post(
    "/client-releases",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ClientReleasePublic,
)
async def upload_client_release(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    version: str = Form(..., min_length=1, max_length=128),
    release_notes: str | None = Form(default=None, max_length=4096),
    activate: bool = Form(default=True),
    installer: UploadFile = File(...),
    latest_yml: UploadFile = File(...),
    blockmap: UploadFile | None = File(default=None),
) -> Any:
    release = ClientRelease(
        version=version,
        platform=client_release_service.SUPPORTED_PLATFORM,
        arch=client_release_service.SUPPORTED_ARCH,
        release_notes=release_notes,
        artifact_name="",
        artifact_path="",
        artifact_size=0,
        artifact_sha512="",
        latest_yml_name=client_release_service.LATEST_YML_NAME,
        latest_yml_path="",
        blockmap_name=None,
        blockmap_path=None,
        is_active=False,
        created_by_user_id=current_user.id,
    )
    release_path, metadata, installer_size = await client_release_service.save_upload(
        release_id=release.id,
        version=version,
        installer=installer,
        latest_yml=latest_yml,
        blockmap=blockmap,
    )
    release.artifact_name = metadata.installer_name
    release.artifact_path = str(release_path / metadata.installer_name)
    release.artifact_size = installer_size
    release.artifact_sha512 = metadata.sha512
    release.latest_yml_path = str(release_path / client_release_service.LATEST_YML_NAME)
    if blockmap is not None and blockmap.filename:
        release.blockmap_name = Path(blockmap.filename).name
        release.blockmap_path = str(release_path / release.blockmap_name)

    session.add(release)
    session.commit()
    session.refresh(release)
    if activate:
        release = client_release_service.activate_release(session, release)
    return release


@router.post(
    "/client-releases/{release_id}/activate",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ClientReleasePublic,
)
def activate_client_release(session: SessionDep, release_id: uuid.UUID) -> Any:
    release = _get_release_or_404(session, release_id)
    return client_release_service.activate_release(session, release)


@router.get("/client-updates/{platform}/{arch}/latest.yml")
def download_latest_yml(
    *,
    session: SessionDep,
    _current_user: CurrentUser,
    platform: str,
    arch: str,
) -> FileResponse:
    release = client_release_service.get_active_release(session, platform, arch)
    if release is None:
        raise HTTPException(status_code=404, detail="No active client release is configured")
    file_path = client_release_service.resolve_release_file(release, release.latest_yml_name)
    return FileResponse(file_path, media_type="application/yaml", filename=release.latest_yml_name)


@router.get("/client-updates/{platform}/{arch}/{filename}")
def download_release_file(
    *,
    session: SessionDep,
    _current_user: CurrentUser,
    platform: str,
    arch: str,
    filename: str,
) -> FileResponse:
    release = client_release_service.get_active_release(session, platform, arch)
    if release is None:
        raise HTTPException(status_code=404, detail="No active client release is configured")
    file_path = client_release_service.resolve_release_file(release, filename)
    media_type = "application/octet-stream"
    if filename.endswith(".exe"):
        media_type = "application/vnd.microsoft.portable-executable"
    return FileResponse(file_path, media_type=media_type, filename=filename)
```

在 `backend/app/api/main.py` 加入导入和注册：

```python
    client_releases,
```

```python
api_router.include_router(client_releases.router)
```

- [ ] **步骤 4：运行后端测试**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py -q
uv run pytest tests/api/routes/test_skills.py -q
```

期望：全部通过。

- [ ] **步骤 5：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_server/backend/app/api/routes/client_releases.py \
  Agent/code_review_platform/code_review_server/backend/app/api/main.py \
  Agent/code_review_platform/code_review_server/backend/tests/api/routes/test_client_releases.py
git commit -m "新增客户端版本发布接口"
```

---

## 任务 4：Web 管理后台客户端版本页面

**文件：**

- 新增：`Agent/code_review_platform/code_review_server/frontend/src/components/Admin/ClientReleasesPage.tsx`
- 新增：`Agent/code_review_platform/code_review_server/frontend/src/routes/_layout/admin.client-releases.tsx`
- 修改：`Agent/code_review_platform/code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx`
- 修改或生成：`Agent/code_review_platform/code_review_server/frontend/src/routeTree.gen.ts`

- [ ] **步骤 1：新增页面组件**

新增 `ClientReleasesPage.tsx`，结构复用 `SkillsPage.tsx`，完整组件如下：

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleOff, Upload } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ClientRelease = {
  id: string
  version: string
  platform: string
  arch: string
  release_notes?: string | null
  artifact_name: string
  artifact_size: number
  artifact_sha512: string
  latest_yml_name: string
  blockmap_name?: string | null
  is_active: boolean
  created_by_user_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type ClientReleasesResponse = {
  data?: ClientRelease[]
  count?: number
}

type ClientReleaseUploadInput = {
  version: string
  releaseNotes: string
  isActive: boolean
  installer: File
  latestYml: File
  blockmap: File | null
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("access_token")
  const headers = new Headers()

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  return headers
}

async function readClientReleases(): Promise<ClientRelease[]> {
  const response = await fetch(`${OpenAPI.BASE}/api/v1/client-releases`, {
    headers: authHeaders(),
  })

  if (!response.ok) {
    throw new Error("Failed to load client releases")
  }

  const payload = (await response.json()) as ClientRelease[] | ClientReleasesResponse
  return Array.isArray(payload) ? payload : payload.data || []
}

async function uploadClientRelease(input: ClientReleaseUploadInput) {
  const formData = new FormData()
  formData.append("version", input.version)
  formData.append("release_notes", input.releaseNotes)
  formData.append("activate", String(input.isActive))
  formData.append("installer", input.installer)
  formData.append("latest_yml", input.latestYml)
  if (input.blockmap) {
    formData.append("blockmap", input.blockmap)
  }

  const response = await fetch(`${OpenAPI.BASE}/api/v1/client-releases`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  })

  if (!response.ok) {
    throw new Error("Failed to upload client release")
  }

  return response.json()
}

async function activateClientRelease(releaseId: string) {
  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/client-releases/${releaseId}/activate`,
    {
      method: "POST",
      headers: authHeaders(),
    },
  )

  if (!response.ok) {
    throw new Error("Failed to activate client release")
  }

  return response.json()
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function ClientReleaseUploadForm() {
  const queryClient = useQueryClient()
  const [version, setVersion] = useState("")
  const [releaseNotes, setReleaseNotes] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [installer, setInstaller] = useState<File | null>(null)
  const [latestYml, setLatestYml] = useState<File | null>(null)
  const [blockmap, setBlockmap] = useState<File | null>(null)

  const uploadMutation = useMutation({
    mutationFn: uploadClientRelease,
    onSuccess: async () => {
      toast.success("客户端版本已上传")
      setVersion("")
      setReleaseNotes("")
      setIsActive(true)
      setInstaller(null)
      setLatestYml(null)
      setBlockmap(null)
      await queryClient.invalidateQueries({ queryKey: ["admin", "client-releases"] })
    },
    onError: () => {
      toast.error("上传失败，请检查版本号和构建产物")
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!version.trim()) {
      toast.error("请填写版本号")
      return
    }
    if (!installer) {
      toast.error("请选择安装包")
      return
    }
    if (!latestYml) {
      toast.error("请选择latest.yml")
      return
    }
    uploadMutation.mutate({
      version: version.trim(),
      releaseNotes,
      isActive,
      installer,
      latestYml,
      blockmap,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>上传客户端版本</CardTitle>
        <CardDescription>上传同一次构建生成的安装包、latest.yml和可选blockmap。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-6" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-version">版本号</Label>
            <Input id="client-version" value={version} placeholder="1.0.1" onChange={(event) => setVersion(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="client-notes">更新说明</Label>
            <Input id="client-notes" value={releaseNotes} placeholder="修复任务列表显示问题" onChange={(event) => setReleaseNotes(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-active">启用状态</Label>
            <Select value={isActive ? "active" : "inactive"} onValueChange={(value) => setIsActive(value === "active")}>
              <SelectTrigger id="client-active" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inactive">暂不启用</SelectItem>
                <SelectItem value="active">上传后启用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-installer">安装包</Label>
            <Input id="client-installer" type="file" accept=".exe" onChange={(event) => setInstaller(event.target.files?.[0] ?? null)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-latest-yml">latest.yml</Label>
            <Input id="client-latest-yml" type="file" accept=".yml,.yaml" onChange={(event) => setLatestYml(event.target.files?.[0] ?? null)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-blockmap">blockmap</Label>
            <Input id="client-blockmap" type="file" accept=".blockmap" onChange={(event) => setBlockmap(event.target.files?.[0] ?? null)} />
          </div>
          <div className="flex md:col-span-6">
            <Button type="submit" disabled={uploadMutation.isPending}>
              <Upload />
              {uploadMutation.isPending ? "上传中..." : "上传"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ClientReleasesTable() {
  const queryClient = useQueryClient()
  const { data: releases = [], isError, isLoading } = useQuery({
    queryFn: readClientReleases,
    queryKey: ["admin", "client-releases"],
  })
  const activateMutation = useMutation({
    mutationFn: activateClientRelease,
    onSuccess: async () => {
      toast.success("客户端版本已启用")
      await queryClient.invalidateQueries({ queryKey: ["admin", "client-releases"] })
    },
    onError: () => {
      toast.error("启用失败，请稍后重试")
    },
  })

  if (isLoading) {
    return <Card><CardContent className="py-8 text-sm text-muted-foreground">正在加载客户端版本...</CardContent></Card>
  }
  if (isError) {
    return <Card><CardContent className="py-8 text-sm text-destructive">暂时无法加载客户端版本，请确认后端API已启用。</CardContent></Card>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>客户端版本</CardTitle>
        <CardDescription>管理Windows客户端安装包和启用状态。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>版本</TableHead>
              <TableHead>平台</TableHead>
              <TableHead>安装包</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>发布时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {releases.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无客户端版本</TableCell></TableRow>
            ) : (
              releases.map((release) => (
                <TableRow key={release.id}>
                  <TableCell className="font-medium">{release.version}</TableCell>
                  <TableCell>{release.platform}/{release.arch}</TableCell>
                  <TableCell>{release.artifact_name}</TableCell>
                  <TableCell>{formatFileSize(release.artifact_size)}</TableCell>
                  <TableCell>
                    {release.is_active ? (
                      <Badge className="gap-1"><CheckCircle2 className="size-3" />当前启用</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1"><CircleOff className="size-3" />未启用</Badge>
                    )}
                  </TableCell>
                  <TableCell>{release.created_at ? new Date(release.created_at).toLocaleString() : "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={release.is_active || activateMutation.isPending} onClick={() => activateMutation.mutate(release.id)}>
                      启用
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function AdminClientReleasesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">客户端版本</h1>
        <p className="text-muted-foreground">管理Windows客户端发布包和自动更新启用状态。</p>
      </div>
      <ClientReleaseUploadForm />
      <ClientReleasesTable />
    </div>
  )
}
```

- [ ] **步骤 2：新增路由**

新增 `frontend/src/routes/_layout/admin.client-releases.tsx`：

```tsx
import { createFileRoute } from "@tanstack/react-router"

import { AdminClientReleasesPage } from "@/components/Admin/ClientReleasesPage"
import { requireAdminUser } from "@/lib/admin-route"

export const Route = createFileRoute("/_layout/admin/client-releases")({
  component: AdminClientReleasesPage,
  beforeLoad: async () => {
    await requireAdminUser()
  },
  head: () => ({
    meta: [
      {
        title: "客户端版本 - 沛城科技代码审查平台",
      },
    ],
  }),
})
```

- [ ] **步骤 3：修改侧边栏**

在 `AppSidebar.tsx` 引入 `MonitorDown`：

```tsx
import { Briefcase, Home, Library, ListChecks, MonitorDown, Users } from "lucide-react"
```

在 `adminItems` 中 `Skill库` 前加入：

```tsx
  { icon: MonitorDown, title: "客户端版本", path: "/admin/client-releases" },
```

- [ ] **步骤 4：更新路由树并构建**

优先运行：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/frontend
npm run build
```

如果构建提示 `routeTree.gen.ts` 缺少新路由，运行：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/frontend
npx @tanstack/router-generator
npm run build
```

期望：`npm run build` 通过。

- [ ] **步骤 5：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_server/frontend/src/components/Admin/ClientReleasesPage.tsx \
  Agent/code_review_platform/code_review_server/frontend/src/routes/_layout/admin.client-releases.tsx \
  Agent/code_review_platform/code_review_server/frontend/src/components/Sidebar/AppSidebar.tsx \
  Agent/code_review_platform/code_review_server/frontend/src/routeTree.gen.ts
git commit -m "新增客户端版本管理页面"
```

---

## 任务 5：Electron 更新服务和 IPC

**文件：**

- 修改：`Agent/code_review_platform/code_review_electron/package.json`
- 修改：`Agent/code_review_platform/code_review_electron/package-lock.json`
- 新增：`Agent/code_review_platform/code_review_electron/src/main/app-updater.ts`
- 修改：`Agent/code_review_platform/code_review_electron/src/main/ipc.ts`
- 修改：`Agent/code_review_platform/code_review_electron/src/preload/index.ts`
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts`
- 新增：`Agent/code_review_platform/code_review_electron/src/main/__tests__/app-updater.test.ts`

- [ ] **步骤 1：安装依赖**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm install electron-updater electron-log
```

期望：`package.json` 和 `package-lock.json` 更新。

- [ ] **步骤 2：写更新服务测试**

新增 `src/main/__tests__/app-updater.test.ts`：

```ts
import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppUpdateService } from '../app-updater'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  setFeedURL = vi.fn()
  addAuthHeader = vi.fn()
  checkForUpdates = vi.fn(async () => undefined)
  downloadUpdate = vi.fn(async () => [])
  quitAndInstall = vi.fn()
}

describe('AppUpdateService', () => {
  let updater: FakeUpdater
  const sender = { send: vi.fn() }

  beforeEach(() => {
    updater = new FakeUpdater()
    sender.send.mockClear()
  })

  it('checks updates with server URL and bearer token', async () => {
    const service = new AppUpdateService({
      createUpdater: () => updater as never,
      loadServerConfig: async () => ({ server_url: 'http://127.0.0.1:18000' }),
      loadToken: async () => 'token-123',
    })

    await service.check(sender as never)

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:18000/api/v1/client-updates/win32/x64',
    })
    expect(updater.addAuthHeader).toHaveBeenCalledWith('Bearer token-123')
    expect(updater.checkForUpdates).toHaveBeenCalled()
  })

  it('skips update check when token is missing', async () => {
    const service = new AppUpdateService({
      createUpdater: () => updater as never,
      loadServerConfig: async () => ({ server_url: 'http://127.0.0.1:18000' }),
      loadToken: async () => null,
    })

    await service.check(sender as never)

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('forwards update events to renderer', async () => {
    const service = new AppUpdateService({
      createUpdater: () => updater as never,
      loadServerConfig: async () => ({ server_url: 'http://127.0.0.1:18000' }),
      loadToken: async () => 'token-123',
    })
    await service.check(sender as never)

    updater.emit('update-available', {
      version: '1.0.1',
      releaseNotes: '修复任务列表显示问题',
    })
    updater.emit('download-progress', {
      percent: 45,
      transferred: 45,
      total: 100,
      bytesPerSecond: 10,
    })

    expect(sender.send).toHaveBeenCalledWith('app-update:available', {
      version: '1.0.1',
      releaseNotes: '修复任务列表显示问题',
    })
    expect(sender.send).toHaveBeenCalledWith('app-update:download-progress', {
      percent: 45,
      transferred: 45,
      total: 100,
      bytesPerSecond: 10,
    })
  })
})
```

- [ ] **步骤 3：运行测试，确认失败**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/app-updater.test.ts
```

期望：失败，错误包含 `Cannot find module '../app-updater'`。

- [ ] **步骤 4：实现 `app-updater.ts`**

新增 `src/main/app-updater.ts`：

```ts
import type { WebContents } from 'electron'
import log from 'electron-log'
import { NsisUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'

import type { TokenPair } from './api-client'
import type { AuthStore } from './auth-store'
import type { ServerConfig, ServerConfigStore } from './server-config-store'

type UpdaterLike = NsisUpdater

export interface AppUpdateServiceOptions {
  createUpdater?: () => UpdaterLike
  loadServerConfig: () => Promise<ServerConfig>
  loadToken: () => Promise<string | null>
}

export class AppUpdateService {
  private updater: UpdaterLike | null = null
  private sender: WebContents | null = null

  constructor(private readonly options: AppUpdateServiceOptions) {}

  async check(sender: WebContents): Promise<void> {
    this.sender = sender
    const token = await this.options.loadToken()
    if (!token) {
      return
    }
    const config = await this.options.loadServerConfig()
    const updater = this.createConfiguredUpdater(config.server_url, token)
    await updater.checkForUpdates()
  }

  async download(): Promise<void> {
    if (!this.updater) {
      throw new Error('No update check has been started')
    }
    await this.updater.downloadUpdate()
  }

  install(): void {
    if (!this.updater) {
      throw new Error('No update has been downloaded')
    }
    this.updater.quitAndInstall(false, true)
  }

  private createConfiguredUpdater(serverUrl: string, token: string): UpdaterLike {
    const updater = this.options.createUpdater?.() ?? new NsisUpdater()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.logger = log
    updater.setFeedURL({
      provider: 'generic',
      url: `${serverUrl.replace(/\/+$/, '')}/api/v1/client-updates/win32/x64`,
    })
    updater.addAuthHeader(`Bearer ${token}`)
    this.bindEvents(updater)
    this.updater = updater
    return updater
  }

  private bindEvents(updater: UpdaterLike): void {
    updater.on('update-available', (info: UpdateInfo) => {
      this.send('app-update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      })
    })
    updater.on('update-not-available', () => {
      this.send('app-update:not-available', true)
    })
    updater.on('download-progress', (progress) => {
      this.send('app-update:download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      })
    })
    updater.on('update-downloaded', (info: UpdateInfo) => {
      this.send('app-update:downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      })
    })
    updater.on('error', (error: Error) => {
      log.error('App update failed', error)
      this.send('app-update:error', {
        message: error.message || '更新失败',
      })
    })
  }

  private send(channel: string, payload: unknown): void {
    if (!this.sender || this.sender.isDestroyed()) {
      return
    }
    this.sender.send(channel, payload)
  }
}

export function createAppUpdateService(
  authStore: AuthStore,
  serverConfigStore: ServerConfigStore,
): AppUpdateService {
  return new AppUpdateService({
    loadServerConfig: () => serverConfigStore.load(),
    loadToken: async () => {
      const tokens: TokenPair | null = await authStore.load()
      return tokens?.access_token ?? null
    },
  })
}
```

- [ ] **步骤 5：修改 IPC 和 preload 类型**

在 `ipc.ts`：

```ts
import { createAppUpdateService, type AppUpdateService } from './app-updater'
```

`IpcHandlerDependencies` 增加：

```ts
  appUpdateService?: AppUpdateService
```

初始化：

```ts
  const appUpdateService =
    dependencies.appUpdateService ?? createAppUpdateService(authStore, serverConfigStore)
```

注册 IPC：

```ts
  ipcMain.handle('app-update:check', async (event): Promise<true> => {
    await appUpdateService.check(event.sender)
    return true
  })

  ipcMain.handle('app-update:download', async (): Promise<true> => {
    await appUpdateService.download()
    return true
  })

  ipcMain.handle('app-update:install', (): true => {
    appUpdateService.install()
    return true
  })
```

在 `code-review-api.ts` 增加：

```ts
export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateInfo {
  version: string
  releaseNotes?: unknown
}

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateError {
  message: string
}
```

`CodeReviewApi` 增加：

```ts
  checkForAppUpdate(): Promise<true>
  downloadAppUpdate(): Promise<true>
  installAppUpdate(): Promise<true>
  onAppUpdateAvailable(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateNotAvailable(callback: () => void): () => void
  onAppUpdateProgress(callback: (progress: AppUpdateProgress) => void): () => void
  onAppUpdateDownloaded(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateError(callback: (error: AppUpdateError) => void): () => void
```

在 `preload/index.ts` 暴露：

```ts
  checkForAppUpdate: (): Promise<true> => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: (): Promise<true> => ipcRenderer.invoke('app-update:download'),
  installAppUpdate: (): Promise<true> => ipcRenderer.invoke('app-update:install'),
  onAppUpdateAvailable: (callback: (info: AppUpdateInfo) => void): (() => void) =>
    listen('app-update:available', callback),
  onAppUpdateNotAvailable: (callback: () => void): (() => void) =>
    listen('app-update:not-available', callback),
  onAppUpdateProgress: (callback: (progress: AppUpdateProgress) => void): (() => void) =>
    listen('app-update:download-progress', callback),
  onAppUpdateDownloaded: (callback: (info: AppUpdateInfo) => void): (() => void) =>
    listen('app-update:downloaded', callback),
  onAppUpdateError: (callback: (error: AppUpdateError) => void): (() => void) =>
    listen('app-update:error', callback),
```

并在文件内增加通用监听函数：

```ts
const listen = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
```

- [ ] **步骤 6：运行 Electron 主进程测试**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/app-updater.test.ts src/main/__tests__/ipc.test.ts
```

期望：通过。

- [ ] **步骤 7：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_electron/package.json \
  Agent/code_review_platform/code_review_electron/package-lock.json \
  Agent/code_review_platform/code_review_electron/src/main/app-updater.ts \
  Agent/code_review_platform/code_review_electron/src/main/ipc.ts \
  Agent/code_review_platform/code_review_electron/src/preload/index.ts \
  Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts \
  Agent/code_review_platform/code_review_electron/src/main/__tests__/app-updater.test.ts
git commit -m "接入客户端自动更新主进程服务"
```

---

## 任务 6：Electron 更新弹窗和登录后检查

**文件：**

- 新增：`Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.tsx`
- 新增：`Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.test.tsx`
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/App.tsx`
- 修改：`Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css`

- [ ] **步骤 1：写弹窗测试**

新增 `UpdateDialog.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UpdateDialog } from './UpdateDialog'

describe('UpdateDialog', () => {
  it('shows available update and starts download', async () => {
    const onDownload = vi.fn()
    const onDismiss = vi.fn()

    render(
      <UpdateDialog
        state="available"
        info={{ version: '1.0.1', releaseNotes: '修复任务列表显示问题' }}
        progress={null}
        error=""
        onDownload={onDownload}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    expect(screen.getByText('发现新版本 1.0.1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '现在更新' }))
    expect(onDownload).toHaveBeenCalled()
  })

  it('shows download progress', () => {
    render(
      <UpdateDialog
        state="downloading"
        info={{ version: '1.0.1' }}
        progress={{ percent: 43, transferred: 43, total: 100, bytesPerSecond: 10 }}
        error=""
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByText('43%')).toBeInTheDocument()
  })

  it('installs downloaded update', async () => {
    const onInstall = vi.fn()

    render(
      <UpdateDialog
        state="downloaded"
        info={{ version: '1.0.1' }}
        progress={null}
        error=""
        onDownload={vi.fn()}
        onInstall={onInstall}
        onDismiss={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '立即重启' }))
    expect(onInstall).toHaveBeenCalled()
  })
})
```

- [ ] **步骤 2：运行测试，确认失败**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/UpdateDialog.test.tsx
```

期望：失败，错误包含 `Cannot find module './UpdateDialog'`。

- [ ] **步骤 3：实现弹窗组件**

新增 `UpdateDialog.tsx`：

```tsx
import type { AppUpdateError, AppUpdateInfo, AppUpdateProgress, AppUpdateStatus } from '../code-review-api'

interface UpdateDialogProps {
  state: Exclude<AppUpdateStatus, 'idle'>
  info: AppUpdateInfo | null
  progress: AppUpdateProgress | null
  error: string
  onDownload: () => void
  onInstall: () => void
  onDismiss: () => void
}

export function UpdateDialog({
  state,
  info,
  progress,
  error,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateDialogProps): React.JSX.Element {
  const version = info?.version ?? ''
  const notes =
    typeof info?.releaseNotes === 'string' && info.releaseNotes.trim()
      ? info.releaseNotes
      : '此版本包含稳定性修复和体验优化。'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        {state === 'available' && (
          <>
            <header>
              <h2 id="update-title">发现新版本 {version}</h2>
              <p>当前版本仍可继续使用，你可以现在更新或稍后处理。</p>
            </header>
            <div className="update-notes">{notes}</div>
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={onDismiss}>稍后</button>
              <button className="primary-button" type="button" onClick={onDownload}>现在更新</button>
            </footer>
          </>
        )}
        {state === 'downloading' && (
          <>
            <header>
              <h2 id="update-title">正在下载新版本</h2>
              <p>下载期间可以继续使用客户端。</p>
            </header>
            <div className="update-progress">
              <strong>{Math.round(progress?.percent ?? 0)}%</strong>
              <div className="update-progress-track">
                <span style={{ width: `${Math.max(0, Math.min(100, progress?.percent ?? 0))}%` }} />
              </div>
            </div>
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={onDismiss}>后台下载</button>
            </footer>
          </>
        )}
        {state === 'downloaded' && (
          <>
            <header>
              <h2 id="update-title">新版本已准备好</h2>
              <p>重启客户端后将完成安装。</p>
            </header>
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={onDismiss}>稍后重启</button>
              <button className="primary-button" type="button" onClick={onInstall}>立即重启</button>
            </footer>
          </>
        )}
        {state === 'error' && (
          <>
            <header>
              <h2 id="update-title">更新失败</h2>
              <p>{error || '当前版本仍可继续使用。'}</p>
            </header>
            <footer className="dialog-actions">
              <button className="primary-button" type="button" onClick={onDismiss}>知道了</button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
```

- [ ] **步骤 4：集成 App 登录后检查**

在 `App.tsx` 增加状态和事件监听：

```tsx
  const [updateState, setUpdateState] = useState<AppUpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(null)
  const [updateError, setUpdateError] = useState('')
```

新增回调：

```tsx
  const checkForUpdate = useCallback(async (): Promise<void> => {
    try {
      await window.codeReview.checkForAppUpdate()
    } catch {
      setUpdateError('更新检查失败，当前版本仍可继续使用。')
      setUpdateState('error')
    }
  }, [])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    setUpdateState('downloading')
    try {
      await window.codeReview.downloadAppUpdate()
    } catch {
      setUpdateError('更新下载失败，当前版本仍可继续使用。')
      setUpdateState('error')
    }
  }, [])

  const installUpdate = useCallback(async (): Promise<void> => {
    await window.codeReview.installAppUpdate()
  }, [])
```

在登录成功后调用：

```tsx
        await checkEnvironment()
        void checkForUpdate()
```

挂载事件监听：

```tsx
  useEffect(() => {
    const disposers = [
      window.codeReview.onAppUpdateAvailable((info) => {
        setUpdateInfo(info)
        setUpdateState('available')
      }),
      window.codeReview.onAppUpdateNotAvailable(() => {
        setUpdateState('idle')
      }),
      window.codeReview.onAppUpdateProgress((progress) => {
        setUpdateProgress(progress)
        setUpdateState('downloading')
      }),
      window.codeReview.onAppUpdateDownloaded((info) => {
        setUpdateInfo(info)
        setUpdateState('downloaded')
      }),
      window.codeReview.onAppUpdateError((error) => {
        setUpdateError(error.message)
        setUpdateState('error')
      }),
    ]
    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [])
```

需要把 React import 改成：

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
```

在 JSX 末尾渲染：

```tsx
      {updateState !== 'idle' && (
        <UpdateDialog
          state={updateState}
          info={updateInfo}
          progress={updateProgress}
          error={updateError}
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onDismiss={() => setUpdateState('idle')}
        />
      )}
```

- [ ] **步骤 5：增加样式**

在 `styles.css` 加入：

```css
.update-dialog {
  width: min(440px, calc(100vw - 32px));
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
  padding: 24px;
}

.update-dialog header {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}

.update-dialog h2 {
  margin: 0;
  font-size: 20px;
}

.update-dialog p {
  margin: 0;
  color: var(--muted);
}

.update-notes {
  white-space: pre-wrap;
  border-radius: 8px;
  background: var(--surface-muted);
  padding: 12px;
  color: var(--text);
  margin-bottom: 18px;
}

.update-progress {
  display: grid;
  gap: 10px;
  margin-bottom: 18px;
}

.update-progress strong {
  font-size: 24px;
}

.update-progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-muted);
}

.update-progress-track span {
  display: block;
  height: 100%;
  background: var(--accent);
}
```

- [ ] **步骤 6：运行 Electron 测试和类型检查**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/UpdateDialog.test.tsx
npm run typecheck
```

期望：全部通过。

- [ ] **步骤 7：提交**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/components/UpdateDialog.test.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/App.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/styles.css
git commit -m "新增客户端更新提示弹窗"
```

---

## 任务 7：端到端验证和测试分支交付

**文件：**

- 修改：`Agent/code_review_platform/docs/superpowers/specs/2026-06-08-client-auto-update-design.md`
  - 如实现中出现与设计不同的细节，补充“实现备注”。

- [ ] **步骤 1：运行后端测试**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_client_releases.py tests/api/routes/test_skills.py -q
```

期望：全部通过。

- [ ] **步骤 2：运行服务端前端构建**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server/frontend
npm run build
```

期望：构建通过。

- [ ] **步骤 3：运行 Electron 测试和类型检查**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm test
npm run typecheck
```

期望：全部通过。

- [ ] **步骤 4：重启测试栈**

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server
docker compose --env-file .env.test -p code-review-test -f compose.yml -f compose.test.yml up -d --build
curl -fsS http://127.0.0.1:18000/api/v1/utils/health-check/
```

期望：`curl` 输出 `true`。

- [ ] **步骤 5：手工发布测试版本**

在 Electron 项目构建测试包：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_electron
npm run dist:win
```

如果当前运行环境无法构建 Windows NSIS 包，记录失败原因，并用后端 API 测试上传伪造但 hash 正确的 `.exe` 字节和 `latest.yml`，只验证服务端和 UI 上传链路。

- [ ] **步骤 6：提交验收备注**

如果补充了设计备注：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test
git add Agent/code_review_platform/docs/superpowers/specs/2026-06-08-client-auto-update-design.md
git commit -m "补充客户端自动更新验收备注"
```

如果没有文档变更，不创建空提交。

- [ ] **步骤 7：交付给用户测试**

最终回复中说明：

```text
已在 Test 分支完成开发。
测试服务地址：
- 后端：http://127.0.0.1:18000
- 前端：http://127.0.0.1:15174
- Adminer：http://127.0.0.1:18083

请先在 Test 分支验证。确认没有问题后，我再协助合并到 main。
```

---

## 自查清单

- 设计中的 Windows x64、服务端本地存储、可选更新、登录后检查、管理员后台上传均有对应任务。
- 设计中的无额外加密、保留 hash 校验、HTTP 内网风险说明已在后端校验和文档中覆盖。
- 测试环境独立端口和独立 volume 已建立，并在任务 7 中要求验证。
- 每个任务都有中文提交信息。
- 计划没有要求直接合并主分支，最终交付停在 `Test` 分支等待用户验证。
