# CCH Key 与 SVN 双登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 code_review 的服务端 Web 和 Electron 客户端登录体系改为仅支持 CCH Key 登录与 SVN 账号密码登录，并提供管理员手动同步 CCH 用户和 Key 的能力。

**Architecture:** 后端先完成数据模型、迁移、CCH 同步服务、Key 登录、SVN 凭据绑定与旧用户合并；Web 前端通过重新生成 OpenAPI 客户端接入 Key/SVN 双登录和管理员同步按钮；Electron 客户端移除注册流程，接入 Key/SVN 双登录。CCH 只作为同步数据源，code_review 登录时只校验本地同步后的 `user_api_key`。

**Tech Stack:** FastAPI、SQLModel、Alembic、pytest、React、TanStack Router、React Query、Playwright、Electron、Vitest、TypeScript。

---

## 文件结构与职责

后端：

- 修改 `code_review_server/backend/app/models.py`：删除邮箱/密码身份字段，新增 `AuthSource`、`UserApiKey`、CCH 同步字段和相关 schema。
- 修改 `code_review_server/backend/app/alembic/versions/*.py`：新增迁移，删除 `user.email` 和 `user.hashed_password`，新增 `user_api_key` 表及用户同步字段。
- 修改 `code_review_server/backend/app/core/config.py`：删除邮件/邮箱登录配置，新增 `CCH_DATABASE_URL`。
- 修改 `code_review_server/backend/app/core/db.py`：初始化第一个管理员时不再依赖邮箱/密码，改为本地管理员用户名配置或保留已有管理员。
- 修改 `code_review_server/backend/app/crud.py`：删除邮箱密码 CRUD，新增按 SVN、按本地 Key、按 CCH id 查询。
- 修改 `code_review_server/backend/app/api/routes/login.py`：保留 SVN 登录，新增 Key 登录，移除邮箱密码、找回密码和重置密码接口。
- 修改 `code_review_server/backend/app/api/routes/users.py`：删除邮箱/密码创建、注册、修改邮箱、修改密码逻辑。
- 修改 `code_review_server/backend/app/api/routes/private.py`：移除或改成创建本地 SVN 测试用户，不能再使用 email/password。
- 修改 `code_review_server/backend/app/api/routes/credentials.py`：新增 `PUT /me/svn-credential`，调用旧用户合并服务。
- 创建 `code_review_server/backend/app/api/routes/cch_sync.py`：管理员同步入口。
- 修改 `code_review_server/backend/app/api/main.py`：注册 `cch_sync` 路由，移除不再需要的邮箱相关路由暴露。
- 创建 `code_review_server/backend/app/services/cch_sync_service.py`：读取 CCH 数据库并同步用户和 Key。
- 创建 `code_review_server/backend/app/services/user_api_key_service.py`：本地 Key 登录校验。
- 创建 `code_review_server/backend/app/services/user_merge_service.py`：SVN 绑定时合并旧用户。
- 修改 `code_review_server/backend/tests/**/*.py`：将邮箱登录测试改为 Key/SVN 测试，新增同步和合并测试。

Web 前端：

- 修改 `code_review_server/frontend/src/hooks/useAuth.ts`：移除 signup，新增 keyLogin 和 svnLogin。
- 修改 `code_review_server/frontend/src/routes/login.tsx`：改为 Key 登录和 SVN 登录两个 tab。
- 删除或停用 `code_review_server/frontend/src/routes/signup.tsx`、`recover-password.tsx`、`reset-password.tsx`，并更新路由树。
- 修改 `code_review_server/frontend/src/components/Admin/UsersPage.tsx`：增加同步 CCH 用户按钮和结果展示。
- 修改 `code_review_server/frontend/src/components/Admin/columns.tsx`：展示来源、CCH 用户 ID、最近同步时间和状态。
- 修改 `code_review_server/frontend/src/components/UserSettings/*.tsx` 与 `code_review_server/frontend/src/routes/_layout/settings.tsx`：移除邮箱/密码页签，新增或保留 SVN 凭据设置。
- 重新生成 `code_review_server/frontend/src/client/*`：使用新的 OpenAPI schema。
- 修改 `code_review_server/frontend/tests/*.spec.ts`：覆盖新登录页、同步按钮、设置页入口。

Electron：

- 修改 `code_review_electron/src/main/api-client.ts`：新增 `keyLogin`，保留 `svnLogin`，删除 `register`。
- 修改 `code_review_electron/src/main/ipc.ts`：新增 `auth:key-login`，将 `auth:login` 语义明确为 SVN 登录，删除 `auth:register`。
- 修改 `code_review_electron/src/preload/index.ts`：暴露 key/SVN 登录，删除 register。
- 修改 `code_review_electron/src/renderer/src/code-review-api.ts`：更新类型。
- 修改 `code_review_electron/src/renderer/src/components/LoginPage.tsx`：改为 Key/SVN 两个 tab。
- 修改 `code_review_electron/src/renderer/src/App.tsx`：根据登录方式设置会话展示。
- 修改 `code_review_electron/src/main/__tests__/*.test.ts`：覆盖新 API 与 IPC。

---

### Task 1: 后端模型与迁移

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Create: `code_review_server/backend/app/alembic/versions/c4f8a9d2e101_replace_email_auth_with_key_auth.py`
- Modify: `code_review_server/backend/tests/conftest.py`
- Test: `code_review_server/backend/tests/api/routes/test_auth_key.py`
- Test: `code_review_server/backend/tests/api/routes/test_auth_svn.py`

- [ ] **Step 1: 写失败测试，证明 User 不再依赖 email/password 且 UserApiKey 可建模**

在 `code_review_server/backend/tests/api/routes/test_auth_key.py` 创建测试文件：

```python
import uuid

from sqlmodel import Session, select

from app.models import AuthSource, User, UserApiKey, UserRole


def test_cch_user_and_plaintext_api_key_can_be_persisted(db: Session) -> None:
    user = User(
        full_name="CCH User",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.cch,
        cch_user_id=1001,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=2001,
        key="sk-cch-local-test",
        name="Desktop Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    saved = db.exec(select(UserApiKey).where(UserApiKey.key == "sk-cch-local-test")).one()

    assert saved.id
    assert saved.user_id == user.id
    assert saved.cch_key_id == 2001
    assert saved.is_active is True


def test_local_svn_user_does_not_require_email_or_hashed_password(db: Session) -> None:
    user = User(
        full_name="SVN User",
        svn_username=f"svn-{uuid.uuid4()}",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.local,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.id
    assert user.auth_source == AuthSource.local
    assert user.cch_user_id is None
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_key.py -v
```

Expected: FAIL，原因是 `AuthSource` 和 `UserApiKey` 尚未定义，或 `User` 仍要求 `email` / `hashed_password`。

- [ ] **Step 3: 修改 `app/models.py`**

在 `UserRole` 后新增：

```python
class AuthSource(str, Enum):
    local = "local"
    cch = "cch"
```

将 `UserBase` 改为：

```python
class UserBase(SQLModel):
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)
```

将 `UserCreate` 改为只服务本地创建：

```python
class UserCreate(UserBase):
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole = UserRole.user
```

删除 `UserRegister`。如果删除后有导入失败，说明还有邮箱注册路径残留；在 Task 3 中移除对应导入和 route。

将 `UserUpdate` 改为：

```python
class UserUpdate(UserBase):
    full_name: str | None = Field(default=None, max_length=255)
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole | None = None
```

将 `UserUpdateMe` 改为：

```python
class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
```

删除 `UpdatePassword` 和 `NewPassword` 的实际使用；如果其他文件仍导入，先保留 class 但在后续任务移除导入。

将 `User` 改为：

```python
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    svn_username: str | None = Field(
        default=None, unique=True, index=True, max_length=255
    )
    role: UserRole = Field(default=UserRole.user, index=True)
    auth_source: AuthSource = Field(default=AuthSource.local, index=True)
    cch_user_id: int | None = Field(default=None, unique=True, index=True)
    disabled_reason: str | None = Field(default=None, max_length=255)
    last_synced_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)
```

在 `UserSvnCredential` 后新增：

```python
class UserApiKey(SQLModel, table=True):
    __tablename__ = "user_api_key"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False, index=True)
    cch_key_id: int = Field(unique=True, index=True)
    key: str = Field(index=True, max_length=2048)
    name: str | None = Field(default=None, max_length=255)
    is_active: bool = Field(default=True, index=True)
    disabled_reason: str | None = Field(default=None, max_length=255)
    last_synced_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
```

将 `UserPublic` 改为：

```python
class UserPublic(UserBase):
    id: uuid.UUID
    svn_username: str | None = None
    role: UserRole = UserRole.user
    auth_source: AuthSource = AuthSource.local
    cch_user_id: int | None = None
    disabled_reason: str | None = None
    last_synced_at: datetime | None = None
    created_at: datetime | None = None
```

- [ ] **Step 4: 新增 Alembic 迁移**

创建 `code_review_server/backend/app/alembic/versions/c4f8a9d2e101_replace_email_auth_with_key_auth.py`：

```python
"""replace email auth with key auth

Revision ID: c4f8a9d2e101
Revises: b4d3f2c8a901
Create Date: 2026-06-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from sqlalchemy.dialects import postgresql


revision = "c4f8a9d2e101"
down_revision = "b4d3f2c8a901"
branch_labels = None
depends_on = None


auth_source = postgresql.ENUM("local", "cch", name="authsource", create_type=False)


def upgrade():
    bind = op.get_bind()
    auth_source.create(bind, checkfirst=True)

    op.add_column(
        "user",
        sa.Column("auth_source", auth_source, server_default="local", nullable=False),
    )
    op.add_column("user", sa.Column("cch_user_id", sa.Integer(), nullable=True))
    op.add_column(
        "user",
        sa.Column("disabled_reason", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("user", "auth_source", server_default=None)
    op.create_index(op.f("ix_user_auth_source"), "user", ["auth_source"], unique=False)
    op.create_index(op.f("ix_user_cch_user_id"), "user", ["cch_user_id"], unique=True)

    op.create_table(
        "user_api_key",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cch_key_id", sa.Integer(), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=2048), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "disabled_reason",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_api_key_user_id"), "user_api_key", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_api_key_cch_key_id"), "user_api_key", ["cch_key_id"], unique=True)
    op.create_index(op.f("ix_user_api_key_key"), "user_api_key", ["key"], unique=False)
    op.create_index(op.f("ix_user_api_key_is_active"), "user_api_key", ["is_active"], unique=False)

    op.drop_index(op.f("ix_user_email"), table_name="user")
    op.drop_column("user", "email")
    op.drop_column("user", "hashed_password")


def downgrade():
    op.add_column(
        "user",
        sa.Column("hashed_password", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column("email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
    )
    op.execute("UPDATE \"user\" SET email = concat(id::text, '@restored.invalid')")
    op.execute("UPDATE \"user\" SET hashed_password = 'disabled'")
    op.alter_column("user", "email", nullable=False)
    op.alter_column("user", "hashed_password", nullable=False)
    op.create_index(op.f("ix_user_email"), "user", ["email"], unique=True)

    op.drop_index(op.f("ix_user_api_key_is_active"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_key"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_cch_key_id"), table_name="user_api_key")
    op.drop_index(op.f("ix_user_api_key_user_id"), table_name="user_api_key")
    op.drop_table("user_api_key")
    op.drop_index(op.f("ix_user_cch_user_id"), table_name="user")
    op.drop_index(op.f("ix_user_auth_source"), table_name="user")
    op.drop_column("user", "last_synced_at")
    op.drop_column("user", "disabled_reason")
    op.drop_column("user", "cch_user_id")
    op.drop_column("user", "auth_source")

    bind = op.get_bind()
    auth_source.drop(bind, checkfirst=True)
```

- [ ] **Step 5: 更新测试清理 fixture**

修改 `code_review_server/backend/tests/conftest.py`，导入 `UserApiKey`：

```python
from app.models import (
    AuditLog,
    Item,
    ReviewTask,
    SkillPackage,
    User,
    UserApiKey,
    UserSvnCredential,
)
```

在删除 `UserSvnCredential` 之前增加：

```python
        statement = delete(UserApiKey)
        session.execute(statement)
```

- [ ] **Step 6: 运行模型测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_key.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/models.py code_review_server/backend/app/alembic/versions/c4f8a9d2e101_replace_email_auth_with_key_auth.py code_review_server/backend/tests/conftest.py code_review_server/backend/tests/api/routes/test_auth_key.py
git commit -m "feat: add local key auth models"
```

---

### Task 2: 后端认证 CRUD 与数据库初始化

**Files:**
- Modify: `code_review_server/backend/app/crud.py`
- Modify: `code_review_server/backend/app/core/config.py`
- Modify: `code_review_server/backend/app/core/db.py`
- Modify: `code_review_server/backend/tests/utils/user.py`
- Test: `code_review_server/backend/tests/crud/test_user.py`

- [ ] **Step 1: 写失败测试，覆盖 SVN 用户创建和本地 Key 查询**

在 `code_review_server/backend/tests/crud/test_user.py` 追加：

```python
from app.models import AuthSource, UserApiKey, UserRole


def test_create_local_user_without_email(db: Session) -> None:
    user_in = UserCreate(
        full_name="Local User",
        svn_username=f"svn-{random_lower_string()}",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
    )

    user = crud.create_user(session=db, user_create=user_in)

    assert user.id
    assert user.auth_source == AuthSource.local
    assert user.full_name == "Local User"


def test_get_user_by_svn_username(db: Session) -> None:
    svn_username = f"svn-{random_lower_string()}"
    user = crud.create_user(
        session=db,
        user_create=UserCreate(svn_username=svn_username, full_name="SVN User"),
    )

    found = crud.get_user_by_svn_username(session=db, svn_username=svn_username)

    assert found
    assert found.id == user.id


def test_get_active_api_key_by_plaintext_key(db: Session) -> None:
    user = crud.create_user(
        session=db,
        user_create=UserCreate(full_name="Key User", role=UserRole.user),
    )
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=9001,
        key="sk-crud-test",
        name="CRUD Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    found = crud.get_user_api_key_by_key(session=db, key="sk-crud-test")

    assert found
    assert found.user_id == user.id
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/crud/test_user.py -v
```

Expected: FAIL，原因是 CRUD 仍依赖 email/password，且新查询函数不存在。

- [ ] **Step 3: 修改 `app/crud.py`**

将用户相关函数改为：

```python
import uuid
from typing import Any

from sqlmodel import Session, select

from app.models import Item, ItemCreate, User, UserApiKey, UserCreate, UserUpdate


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(user_create)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    db_user.sqlmodel_update(user_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_svn_username(*, session: Session, svn_username: str) -> User | None:
    statement = select(User).where(User.svn_username == svn_username)
    return session.exec(statement).first()


def get_user_by_cch_user_id(*, session: Session, cch_user_id: int) -> User | None:
    statement = select(User).where(User.cch_user_id == cch_user_id)
    return session.exec(statement).first()


def get_user_api_key_by_key(*, session: Session, key: str) -> UserApiKey | None:
    statement = select(UserApiKey).where(UserApiKey.key == key)
    return session.exec(statement).first()


def get_user_api_key_by_cch_key_id(
    *, session: Session, cch_key_id: int
) -> UserApiKey | None:
    statement = select(UserApiKey).where(UserApiKey.cch_key_id == cch_key_id)
    return session.exec(statement).first()


def create_item(*, session: Session, item_in: ItemCreate, owner_id: uuid.UUID) -> Item:
    db_item = Item.model_validate(item_in, update={"owner_id": owner_id})
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item
```

- [ ] **Step 4: 修改 `app/core/config.py`**

删除未使用的邮箱配置导入和字段。保留 `PROJECT_NAME`、数据库配置、`FIRST_SUPERUSER`，将 `FIRST_SUPERUSER` 类型从 `EmailStr` 改为 `str`，新增：

```python
    CCH_DATABASE_URL: PostgresDsn | None = None
```

保留 `SMTP_*` 字段会让邮箱功能继续出现在配置里。删除这些字段：

```python
    SMTP_TLS
    SMTP_SSL
    SMTP_PORT
    SMTP_HOST
    SMTP_USER
    SMTP_PASSWORD
    EMAILS_FROM_EMAIL
    EMAILS_FROM_NAME
    EMAIL_RESET_TOKEN_EXPIRE_HOURS
    EMAIL_TEST_USER
    emails_enabled
    _set_default_emails_from
```

同时删除 `EmailStr`、`model_validator` 中与邮件默认名相关的逻辑；`_enforce_non_default_secrets` 不再检查 `FIRST_SUPERUSER_PASSWORD`，因为密码登录会被移除。

- [ ] **Step 5: 修改 `app/core/db.py`**

改为按 `FIRST_SUPERUSER` 创建本地管理员名称，不再查 email：

```python
from sqlmodel import Session, select

from app.core.config import settings
from app.models import AuthSource, User, UserRole


def init_db(session: Session) -> None:
    user = session.exec(
        select(User).where(User.full_name == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user = User(
            full_name=settings.FIRST_SUPERUSER,
            is_active=True,
            is_superuser=True,
            role=UserRole.admin,
            auth_source=AuthSource.local,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
```

注意：这个本地管理员没有登录凭据。实施 Task 4 后，管理员需要通过同步后的 CCH admin key 或 SVN 凭据登录。若本地开发测试需要管理员 token，测试工具会直接创建带 Key 的管理员。

- [ ] **Step 6: 修改测试工具 `tests/utils/user.py`**

替换为 Key/SVN 工具：

```python
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import AuthSource, User, UserApiKey, UserCreate, UserRole
from tests.utils.utils import random_lower_string


def user_authentication_headers_by_key(*, client: TestClient, key: str) -> dict[str, str]:
    r = client.post(f"{settings.API_V1_STR}/auth/key-login", json={"key": key})
    response = r.json()
    auth_token = response["access_token"]
    return {"Authorization": f"Bearer {auth_token}"}


def user_authentication_headers_by_svn(
    *, client: TestClient, svn_username: str, svn_password: str
) -> dict[str, str]:
    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={"svn_username": svn_username, "svn_password": svn_password},
    )
    response = r.json()
    auth_token = response["access_token"]
    return {"Authorization": f"Bearer {auth_token}"}


def create_random_user(db: Session) -> User:
    user_in = UserCreate(
        full_name=f"User {random_lower_string()}",
        svn_username=f"svn-{random_lower_string()}",
    )
    return crud.create_user(session=db, user_create=user_in)


def create_key_user(
    *, db: Session, key: str | None = None, is_superuser: bool = False
) -> tuple[User, str]:
    plain_key = key or f"sk-test-{random_lower_string()}"
    user = User(
        full_name=f"Key User {random_lower_string()}",
        is_active=True,
        is_superuser=is_superuser,
        role=UserRole.admin if is_superuser else UserRole.user,
        auth_source=AuthSource.cch,
        cch_user_id=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=abs(hash(plain_key)) % 100000000,
        key=plain_key,
        name="Test Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()
    return user, plain_key
```

- [ ] **Step 7: 运行 CRUD 测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/crud/test_user.py -v
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/crud.py code_review_server/backend/app/core/config.py code_review_server/backend/app/core/db.py code_review_server/backend/tests/utils/user.py code_review_server/backend/tests/crud/test_user.py
git commit -m "refactor: remove email password user crud"
```

---

### Task 3: SVN 登录保留与邮箱登录删除

**Files:**
- Modify: `code_review_server/backend/app/api/routes/login.py`
- Modify: `code_review_server/backend/app/api/routes/users.py`
- Modify: `code_review_server/backend/app/api/routes/private.py`
- Modify: `code_review_server/backend/app/api/main.py`
- Test: `code_review_server/backend/tests/api/routes/test_auth_svn.py`
- Test: `code_review_server/backend/tests/api/routes/test_login.py`
- Test: `code_review_server/backend/tests/api/routes/test_users.py`

- [ ] **Step 1: 改写 SVN 登录测试，删除 SVN 注册依赖**

修改 `tests/api/routes/test_auth_svn.py` 为：

```python
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import User, UserRole
from app.services.credential_service import CredentialService
from tests.utils.utils import random_lower_string


def _create_svn_user(db: Session, svn_password: str) -> User:
    svn_username = f"svn-{random_lower_string()}"
    user = User(
        full_name="SVN User",
        svn_username=svn_username,
        role=UserRole.user,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).save_svn_password(
        db, user.id, svn_password
    )
    return user


def test_svn_login_returns_access_token(client: TestClient, db: Session) -> None:
    password = "correct-password"
    user = _create_svn_user(db, password)

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={"svn_username": user.svn_username, "svn_password": password},
    )

    assert r.status_code == 200
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_svn_login_with_wrong_password_returns_401(
    client: TestClient, db: Session
) -> None:
    user = _create_svn_user(db, "correct-password")

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={"svn_username": user.svn_username, "svn_password": "wrong-password"},
    )

    assert r.status_code == 401
```

- [ ] **Step 2: 改写邮箱登录删除测试**

将 `tests/api/routes/test_login.py` 替换为：

```python
from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.user import create_key_user, user_authentication_headers_by_key


def test_removed_email_password_routes_return_404_or_410(client: TestClient) -> None:
    removed_requests = [
        ("post", f"{settings.API_V1_STR}/login/access-token", {"data": {"username": "a", "password": "b"}}),
        ("post", f"{settings.API_V1_STR}/password-recovery/test@example.com", {}),
        ("post", f"{settings.API_V1_STR}/reset-password/", {"json": {"token": "x", "new_password": "secret123"}}),
    ]

    for method, url, kwargs in removed_requests:
        response = getattr(client, method)(url, **kwargs)
        assert response.status_code in {404, 410}


def test_test_token_still_returns_current_user(client: TestClient, db) -> None:
    user, key = create_key_user(db=db)
    headers = user_authentication_headers_by_key(client=client, key=key)

    r = client.post(f"{settings.API_V1_STR}/login/test-token", headers=headers)

    assert r.status_code == 200
    assert r.json()["id"] == str(user.id)
```

- [ ] **Step 3: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_svn.py tests/api/routes/test_login.py -v
```

Expected: FAIL，因为 routes 仍有邮箱登录和 SVN 注册逻辑。

- [ ] **Step 4: 修改 `app/api/routes/login.py`**

保留 `_create_auth_tokens`、`SvnLogin`、`AuthToken`。删除 `SvnRegister`、`register_svn_account`、`login_access_token`、`recover_password`、`reset_password`、`recover_password_html_content` 及相关邮件导入。

文件核心内容应包含：

```python
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, SQLModel, select

from app.api.deps import CurrentUser, SessionDep
from app.core import security
from app.core.config import settings
from app.models import Token, User, UserPublic
from app.services.credential_service import CredentialService

router = APIRouter(tags=["login"])


class SvnLogin(SQLModel):
    svn_username: str
    svn_password: str


class KeyLogin(SQLModel):
    key: str


class AuthToken(Token):
    refresh_token: str


def _create_auth_tokens(user_id: Any) -> AuthToken:
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=30)
    return AuthToken(
        access_token=security.create_access_token(user_id, expires_delta=access_token_expires),
        refresh_token=security.create_access_token(user_id, expires_delta=refresh_token_expires),
    )


def _get_svn_user(session: Session, svn_username: str) -> User | None:
    return session.exec(select(User).where(User.svn_username == svn_username)).first()


@router.post("/auth/login", response_model=AuthToken)
def login_svn_account(session: SessionDep, body: SvnLogin) -> AuthToken:
    user = _get_svn_user(session, body.svn_username)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Incorrect SVN username or password")

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    svn_password = credential_service.get_svn_password(session, user.id)
    if svn_password != body.svn_password:
        raise HTTPException(status_code=401, detail="Incorrect SVN username or password")

    return _create_auth_tokens(user.id)


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    return current_user
```

Task 4 会在同一文件新增 Key 登录。此任务只清掉邮箱登录并保住 SVN。

- [ ] **Step 5: 修改 `app/api/routes/users.py`**

删除：

- `update_password_me`
- `register_user`
- 所有 `email` 冲突检查
- 邮件发送逻辑

`create_user` 改为只允许管理员创建本地用户：

```python
@router.post(
    "/", dependencies=[Depends(get_current_active_admin)], response_model=UserPublic
)
def create_user(*, session: SessionDep, user_in: UserCreate) -> Any:
    if user_in.svn_username:
        existing_user = crud.get_user_by_svn_username(
            session=session, svn_username=user_in.svn_username
        )
        if existing_user:
            raise HTTPException(status_code=409, detail="SVN username already exists")
    return crud.create_user(session=session, user_create=user_in)
```

`update_user_me` 改为只更新 `full_name`：

```python
@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user
```

`update_user` 中只检查 `svn_username` 唯一：

```python
    if user_in.svn_username:
        existing_user = crud.get_user_by_svn_username(
            session=session, svn_username=user_in.svn_username
        )
        if existing_user and existing_user.id != user_id:
            raise HTTPException(status_code=409, detail="SVN username already exists")
```

- [ ] **Step 6: 修改 `app/api/routes/private.py`**

将 `PrivateUserCreate` 改为：

```python
class PrivateUserCreate(BaseModel):
    full_name: str
    svn_username: str | None = None
    is_superuser: bool = False
```

`create_user` 改为：

```python
    user = User(
        full_name=user_in.full_name,
        svn_username=user_in.svn_username,
        is_superuser=user_in.is_superuser,
        role=UserRole.admin if user_in.is_superuser else UserRole.user,
    )
```

并导入 `UserRole`，删除 `get_password_hash`。

- [ ] **Step 7: 运行后端路由测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_svn.py tests/api/routes/test_login.py tests/api/routes/test_users.py -v
```

Expected: PASS 或仅 `test_users.py` 中邮箱相关旧断言失败；如果旧断言失败，按新行为更新为 `full_name`、`svn_username`、`role`、`is_active`。

- [ ] **Step 8: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/api/routes/login.py code_review_server/backend/app/api/routes/users.py code_review_server/backend/app/api/routes/private.py code_review_server/backend/tests/api/routes/test_auth_svn.py code_review_server/backend/tests/api/routes/test_login.py code_review_server/backend/tests/api/routes/test_users.py
git commit -m "refactor: remove email password auth routes"
```

---

### Task 4: 本地 Key 登录

**Files:**
- Create: `code_review_server/backend/app/services/user_api_key_service.py`
- Modify: `code_review_server/backend/app/api/routes/login.py`
- Test: `code_review_server/backend/tests/api/routes/test_auth_key.py`

- [ ] **Step 1: 追加 Key 登录失败测试**

在 `tests/api/routes/test_auth_key.py` 追加：

```python
from fastapi.testclient import TestClient

from app.core.config import settings
from sqlmodel import select

from app.models import UserApiKey
from tests.utils.user import create_key_user


def test_key_login_returns_tokens(client: TestClient, db: Session) -> None:
    user, key = create_key_user(db=db)

    r = client.post(f"{settings.API_V1_STR}/auth/key-login", json={"key": key})

    assert r.status_code == 200
    body = r.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_key_login_rejects_disabled_key(client: TestClient, db: Session) -> None:
    _user, key = create_key_user(db=db)
    api_key = db.exec(select(UserApiKey).where(UserApiKey.key == key)).one()
    api_key.is_active = False
    api_key.disabled_reason = "key_disabled"
    db.add(api_key)
    db.commit()

    r = client.post(f"{settings.API_V1_STR}/auth/key-login", json={"key": key})

    assert r.status_code == 401


def test_key_login_rejects_disabled_user(client: TestClient, db: Session) -> None:
    user, key = create_key_user(db=db)
    user.is_active = False
    user.disabled_reason = "user_disabled"
    db.add(user)
    db.commit()

    r = client.post(f"{settings.API_V1_STR}/auth/key-login", json={"key": key})

    assert r.status_code == 401
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_key.py -v
```

Expected: FAIL，因为 `/auth/key-login` 尚未实现。

- [ ] **Step 3: 创建 `user_api_key_service.py`**

```python
from sqlmodel import Session

from app import crud
from app.models import User


class UserApiKeyService:
    def authenticate(self, session: Session, key: str) -> User | None:
        api_key = crud.get_user_api_key_by_key(session=session, key=key)
        if not api_key or not api_key.is_active:
            return None

        user = session.get(User, api_key.user_id)
        if not user or not user.is_active:
            return None

        return user
```

- [ ] **Step 4: 在 `login.py` 新增 Key 登录**

导入：

```python
from app.services.user_api_key_service import UserApiKeyService
```

新增 route：

```python
@router.post("/auth/key-login", response_model=AuthToken)
def login_with_key(session: SessionDep, body: KeyLogin) -> AuthToken:
    user = UserApiKeyService().authenticate(session, body.key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or inactive key")
    return _create_auth_tokens(user.id)
```

- [ ] **Step 5: 运行 Key 登录测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/api/routes/test_auth_key.py -v
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/services/user_api_key_service.py code_review_server/backend/app/api/routes/login.py code_review_server/backend/tests/api/routes/test_auth_key.py
git commit -m "feat: add local key login"
```

---

### Task 5: CCH 手动同步服务与管理员接口

**Files:**
- Create: `code_review_server/backend/app/services/cch_sync_service.py`
- Create: `code_review_server/backend/app/api/routes/cch_sync.py`
- Modify: `code_review_server/backend/app/api/main.py`
- Modify: `code_review_server/backend/app/core/config.py`
- Test: `code_review_server/backend/tests/services/test_cch_sync_service.py`
- Test: `code_review_server/backend/tests/api/routes/test_cch_sync.py`

- [ ] **Step 1: 写同步服务单元测试**

创建 `code_review_server/backend/tests/services/test_cch_sync_service.py`：

```python
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models import AuthSource, User, UserApiKey, UserRole
from app.services.cch_sync_service import CchKeyRow, CchSyncService, CchUserRow


def test_sync_creates_cch_user_and_key(db: Session) -> None:
    service = CchSyncService()
    now = datetime.now(timezone.utc)

    result = service.sync_rows(
        db,
        users=[
            CchUserRow(
                id=101,
                name="Ada",
                role="admin",
                is_enabled=True,
                expires_at=None,
                deleted_at=None,
            )
        ],
        keys=[
            CchKeyRow(
                id=201,
                user_id=101,
                key="sk-cch-201",
                name="Ada Key",
                is_enabled=True,
                expires_at=None,
                deleted_at=None,
            )
        ],
        synced_at=now,
    )

    user = db.exec(select(User).where(User.cch_user_id == 101)).one()
    api_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 201)).one()

    assert result.created_users == 1
    assert result.created_keys == 1
    assert user.full_name == "Ada"
    assert user.role == UserRole.admin
    assert user.is_superuser is True
    assert user.auth_source == AuthSource.cch
    assert api_key.key == "sk-cch-201"
    assert api_key.is_active is True


def test_sync_disables_expired_key(db: Session) -> None:
    service = CchSyncService()
    now = datetime.now(timezone.utc)

    service.sync_rows(
        db,
        users=[
            CchUserRow(
                id=102,
                name="Grace",
                role="user",
                is_enabled=True,
                expires_at=None,
                deleted_at=None,
            )
        ],
        keys=[
            CchKeyRow(
                id=202,
                user_id=102,
                key="sk-cch-202",
                name="Grace Key",
                is_enabled=True,
                expires_at=now - timedelta(days=1),
                deleted_at=None,
            )
        ],
        synced_at=now,
    )

    api_key = db.exec(select(UserApiKey).where(UserApiKey.cch_key_id == 202)).one()

    assert api_key.is_active is False
    assert api_key.disabled_reason == "key_expired"
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py -v
```

Expected: FAIL，因为 `CchSyncService` 尚未创建。

- [ ] **Step 3: 实现 `cch_sync_service.py`**

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlmodel import Session, create_engine

from app import crud
from app.models import AuthSource, AuditLog, User, UserApiKey, UserRole


@dataclass(frozen=True)
class CchUserRow:
    id: int
    name: str
    role: str | None
    is_enabled: bool
    expires_at: datetime | None
    deleted_at: datetime | None


@dataclass(frozen=True)
class CchKeyRow:
    id: int
    user_id: int
    key: str
    name: str | None
    is_enabled: bool
    expires_at: datetime | None
    deleted_at: datetime | None


@dataclass
class CchSyncResult:
    created_users: int = 0
    updated_users: int = 0
    disabled_users: int = 0
    created_keys: int = 0
    updated_keys: int = 0
    disabled_keys: int = 0
    skipped_records: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class CchSyncService:
    def fetch_rows(self, database_url: str) -> tuple[list[CchUserRow], list[CchKeyRow]]:
        engine = create_engine(database_url)
        with engine.connect() as connection:
            user_rows = connection.exec_driver_sql(
                """
                SELECT id, name, role, is_enabled, expires_at, deleted_at
                FROM users
                """
            ).mappings().all()
            key_rows = connection.exec_driver_sql(
                """
                SELECT id, user_id, key, name, is_enabled, expires_at, deleted_at
                FROM keys
                """
            ).mappings().all()

        users = [CchUserRow(**dict(row)) for row in user_rows]
        keys = [CchKeyRow(**dict(row)) for row in key_rows]
        return users, keys

    def sync_from_database(
        self, session: Session, database_url: str, actor_user_id
    ) -> CchSyncResult:
        started_at = datetime.now(timezone.utc)
        users, keys = self.fetch_rows(database_url)
        result = self.sync_rows(session, users=users, keys=keys, synced_at=started_at)
        result.started_at = started_at
        result.finished_at = datetime.now(timezone.utc)
        session.add(
            AuditLog(
                actor_user_id=actor_user_id,
                action="cch_users_synced",
                metadata_json=result.__dict__,
            )
        )
        session.commit()
        return result

    def sync_rows(
        self,
        session: Session,
        *,
        users: list[CchUserRow],
        keys: list[CchKeyRow],
        synced_at: datetime,
    ) -> CchSyncResult:
        result = CchSyncResult(started_at=synced_at)
        user_by_cch_id: dict[int, User] = {}

        for row in users:
            user = crud.get_user_by_cch_user_id(session=session, cch_user_id=row.id)
            is_active, disabled_reason = self._user_status(row, synced_at)
            role = UserRole.admin if row.role == "admin" else UserRole.user
            if not user:
                user = User(
                    full_name=row.name,
                    cch_user_id=row.id,
                    auth_source=AuthSource.cch,
                    role=role,
                    is_superuser=role == UserRole.admin,
                    is_active=is_active,
                    disabled_reason=disabled_reason,
                    last_synced_at=synced_at,
                )
                session.add(user)
                session.commit()
                session.refresh(user)
                result.created_users += 1
            else:
                user.full_name = row.name
                user.role = role
                user.is_superuser = role == UserRole.admin
                user.is_active = is_active
                user.disabled_reason = disabled_reason
                user.last_synced_at = synced_at
                session.add(user)
                session.commit()
                session.refresh(user)
                result.updated_users += 1
            if not is_active:
                result.disabled_users += 1
            user_by_cch_id[row.id] = user

        for row in keys:
            user = user_by_cch_id.get(row.user_id)
            if not user:
                result.skipped_records += 1
                result.errors.append(f"Key {row.id} skipped: missing CCH user {row.user_id}")
                continue

            key_active, key_reason = self._key_status(row, synced_at)
            is_active = key_active and user.is_active
            disabled_reason = key_reason if key_reason else None
            if not user.is_active and not disabled_reason:
                disabled_reason = "user_disabled"

            api_key = crud.get_user_api_key_by_cch_key_id(session=session, cch_key_id=row.id)
            if not api_key:
                api_key = UserApiKey(
                    user_id=user.id,
                    cch_key_id=row.id,
                    key=row.key,
                    name=row.name,
                    is_active=is_active,
                    disabled_reason=disabled_reason,
                    last_synced_at=synced_at,
                    updated_at=synced_at,
                )
                session.add(api_key)
                result.created_keys += 1
            else:
                api_key.user_id = user.id
                api_key.key = row.key
                api_key.name = row.name
                api_key.is_active = is_active
                api_key.disabled_reason = disabled_reason
                api_key.last_synced_at = synced_at
                api_key.updated_at = synced_at
                session.add(api_key)
                result.updated_keys += 1
            if not is_active:
                result.disabled_keys += 1
            session.commit()

        result.finished_at = datetime.now(timezone.utc)
        return result

    def _user_status(
        self, row: CchUserRow, now: datetime
    ) -> tuple[bool, str | None]:
        if row.deleted_at is not None:
            return False, "cch_user_deleted"
        if not row.is_enabled:
            return False, "cch_user_disabled"
        if row.expires_at and row.expires_at <= now:
            return False, "cch_user_expired"
        return True, None

    def _key_status(self, row: CchKeyRow, now: datetime) -> tuple[bool, str | None]:
        if row.deleted_at is not None:
            return False, "key_deleted"
        if not row.is_enabled:
            return False, "key_disabled"
        if row.expires_at and row.expires_at <= now:
            return False, "key_expired"
        return True, None
```

- [ ] **Step 4: 写管理员接口失败测试**

创建 `code_review_server/backend/tests/api/routes/test_cch_sync.py`：

```python
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.services.cch_sync_service import CchSyncResult
from tests.utils.user import create_key_user, user_authentication_headers_by_key


def test_admin_can_trigger_cch_sync(client: TestClient, db) -> None:
    _user, key = create_key_user(db=db, is_superuser=True)
    headers = user_authentication_headers_by_key(client=client, key=key)

    with patch("app.api.routes.cch_sync.CchSyncService") as service_cls:
        service_cls.return_value.sync_from_database.return_value = CchSyncResult(
            created_users=1,
            created_keys=2,
        )
        with patch("app.api.routes.cch_sync.settings.CCH_DATABASE_URL", "postgresql+psycopg://u:p@localhost/db"):
            r = client.post(f"{settings.API_V1_STR}/admin/cch-sync/users", headers=headers)

    assert r.status_code == 200
    assert r.json()["created_users"] == 1
    assert r.json()["created_keys"] == 2


def test_non_admin_cannot_trigger_cch_sync(client: TestClient, db) -> None:
    _user, key = create_key_user(db=db, is_superuser=False)
    headers = user_authentication_headers_by_key(client=client, key=key)

    r = client.post(f"{settings.API_V1_STR}/admin/cch-sync/users", headers=headers)

    assert r.status_code == 403
```

- [ ] **Step 5: 创建管理员接口**

创建 `code_review_server/backend/app/api/routes/cch_sync.py`：

```python
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel

from app.api.deps import CurrentUser, SessionDep, get_current_active_admin
from app.core.config import settings
from app.services.cch_sync_service import CchSyncService

router = APIRouter(prefix="/admin/cch-sync", tags=["cch-sync"])


class CchSyncResultPublic(SQLModel):
    created_users: int
    updated_users: int
    disabled_users: int
    created_keys: int
    updated_keys: int
    disabled_keys: int
    skipped_records: int
    errors: list[str]
    started_at: datetime | None
    finished_at: datetime | None


@router.post(
    "/users",
    dependencies=[Depends(get_current_active_admin)],
    response_model=CchSyncResultPublic,
)
def sync_cch_users(session: SessionDep, current_user: CurrentUser) -> CchSyncResultPublic:
    if not settings.CCH_DATABASE_URL:
        raise HTTPException(status_code=503, detail="CCH_DATABASE_URL is not configured")
    result = CchSyncService().sync_from_database(
        session,
        str(settings.CCH_DATABASE_URL),
        current_user.id,
    )
    return CchSyncResultPublic.model_validate(result.__dict__)
```

在 `app/api/main.py` 导入并注册：

```python
from app.api.routes import cch_sync
...
api_router.include_router(cch_sync.router)
```

- [ ] **Step 6: 运行同步测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/services/test_cch_sync_service.py tests/api/routes/test_cch_sync.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/services/cch_sync_service.py code_review_server/backend/app/api/routes/cch_sync.py code_review_server/backend/app/api/main.py code_review_server/backend/app/core/config.py code_review_server/backend/tests/services/test_cch_sync_service.py code_review_server/backend/tests/api/routes/test_cch_sync.py
git commit -m "feat: sync cch users and keys"
```

---

### Task 6: SVN 凭据绑定与旧用户合并

**Files:**
- Create: `code_review_server/backend/app/services/user_merge_service.py`
- Modify: `code_review_server/backend/app/api/routes/credentials.py`
- Test: `code_review_server/backend/tests/api/routes/test_credentials.py`
- Test: `code_review_server/backend/tests/services/test_user_merge_service.py`

- [ ] **Step 1: 写旧用户合并服务测试**

创建 `code_review_server/backend/tests/services/test_user_merge_service.py`：

```python
from app.models import AuthSource, ReviewTask, ReviewTaskStatus, User
from app.services.user_merge_service import UserMergeService


def test_merge_svn_user_moves_review_tasks(db) -> None:
    old_user = User(full_name="Old", svn_username="legacy-svn", auth_source=AuthSource.local)
    new_user = User(full_name="New", auth_source=AuthSource.cch, cch_user_id=3001)
    db.add(old_user)
    db.add(new_user)
    db.commit()
    db.refresh(old_user)
    db.refresh(new_user)

    task = ReviewTask(
        user_id=old_user.id,
        svn_url="svn://repo/project",
        old_revision="1",
        new_revision="2",
        status=ReviewTaskStatus.created,
    )
    db.add(task)
    db.commit()

    UserMergeService().merge_svn_user_into_current_user(
        db,
        old_user=old_user,
        current_user=new_user,
        svn_username="legacy-svn",
    )
    db.refresh(task)
    db.refresh(old_user)
    db.refresh(new_user)

    assert task.user_id == new_user.id
    assert new_user.svn_username == "legacy-svn"
    assert old_user.is_active is False
    assert old_user.disabled_reason == "merged_into_cch_user"
    assert old_user.svn_username is None
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/services/test_user_merge_service.py -v
```

Expected: FAIL，因为 `UserMergeService` 不存在。

- [ ] **Step 3: 创建 `user_merge_service.py`**

```python
from sqlmodel import Session, select

from app.models import AuditLog, ReviewTask, User, UserSvnCredential


class UserMergeService:
    def merge_svn_user_into_current_user(
        self,
        session: Session,
        *,
        old_user: User,
        current_user: User,
        svn_username: str,
    ) -> None:
        if old_user.id == current_user.id:
            current_user.svn_username = svn_username
            session.add(current_user)
            session.commit()
            return

        tasks = session.exec(
            select(ReviewTask).where(ReviewTask.user_id == old_user.id)
        ).all()
        for task in tasks:
            task.user_id = current_user.id
            session.add(task)

        old_credential = session.exec(
            select(UserSvnCredential).where(UserSvnCredential.user_id == old_user.id)
        ).first()
        if old_credential:
            current_credential = session.exec(
                select(UserSvnCredential).where(UserSvnCredential.user_id == current_user.id)
            ).first()
            if current_credential:
                session.delete(old_credential)
            else:
                old_credential.user_id = current_user.id
                session.add(old_credential)

        current_user.svn_username = svn_username
        old_user.svn_username = None
        old_user.is_active = False
        old_user.disabled_reason = "merged_into_cch_user"
        session.add(current_user)
        session.add(old_user)
        session.add(
            AuditLog(
                actor_user_id=current_user.id,
                action="svn_user_merged",
                target_user_id=old_user.id,
                metadata_json={"svn_username": svn_username},
            )
        )
        session.commit()
```

- [ ] **Step 4: 追加凭据绑定 API 测试**

在 `tests/api/routes/test_credentials.py` 追加：

```python
from app.models import AuthSource, User
from app.services.credential_service import CredentialService
from tests.utils.user import create_key_user, user_authentication_headers_by_key


def test_update_my_svn_credential_saves_encrypted_password(client, db) -> None:
    user, key = create_key_user(db=db)
    headers = user_authentication_headers_by_key(client=client, key=key)

    r = client.put(
        f"{settings.API_V1_STR}/me/svn-credential",
        headers=headers,
        json={"svn_username": "new-svn", "svn_password": "new-password"},
    )

    assert r.status_code == 200
    db.refresh(user)
    assert user.svn_username == "new-svn"
    saved = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).get_svn_password(
        db, user.id
    )
    assert saved == "new-password"


def test_update_my_svn_credential_merges_legacy_user(client, db) -> None:
    legacy = User(full_name="Legacy", svn_username="legacy-svn", auth_source=AuthSource.local)
    db.add(legacy)
    db.commit()
    db.refresh(legacy)
    CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).save_svn_password(
        db, legacy.id, "legacy-password"
    )
    current, key = create_key_user(db=db)
    headers = user_authentication_headers_by_key(client=client, key=key)

    r = client.put(
        f"{settings.API_V1_STR}/me/svn-credential",
        headers=headers,
        json={"svn_username": "legacy-svn", "svn_password": "new-password"},
    )

    assert r.status_code == 200
    db.refresh(current)
    db.refresh(legacy)
    assert current.svn_username == "legacy-svn"
    assert legacy.is_active is False
    assert legacy.svn_username is None
```

- [ ] **Step 5: 修改 `credentials.py`**

新增 schema：

```python
class SvnCredentialUpdate(SQLModel):
    svn_username: str
    svn_password: str
```

新增 route：

```python
@router.put("/svn-credential", response_model=SvnCredentialPublic)
def update_my_svn_credential(
    session: SessionDep, current_user: CurrentUser, body: SvnCredentialUpdate
) -> Any:
    existing_user = session.exec(
        select(User).where(User.svn_username == body.svn_username)
    ).first()
    if existing_user and existing_user.id != current_user.id:
        UserMergeService().merge_svn_user_into_current_user(
            session,
            old_user=existing_user,
            current_user=current_user,
            svn_username=body.svn_username,
        )
        session.refresh(current_user)
    else:
        current_user.svn_username = body.svn_username
        session.add(current_user)
        session.commit()
        session.refresh(current_user)

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    credential_service.save_svn_password(session, current_user.id, body.svn_password)
    return SvnCredentialPublic(
        svn_username=current_user.svn_username,
        svn_password=body.svn_password,
    )
```

导入：

```python
from sqlmodel import SQLModel, select
from app.models import AuditLog, User
from app.services.user_merge_service import UserMergeService
```

- [ ] **Step 6: 运行凭据和合并测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest tests/services/test_user_merge_service.py tests/api/routes/test_credentials.py -v
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app/services/user_merge_service.py code_review_server/backend/app/api/routes/credentials.py code_review_server/backend/tests/services/test_user_merge_service.py code_review_server/backend/tests/api/routes/test_credentials.py
git commit -m "feat: bind svn credentials and merge legacy users"
```

---

### Task 7: 后端全量测试修复与 OpenAPI 输出稳定

**Files:**
- Modify: `code_review_server/backend/tests/**/*.py`
- Modify: `code_review_server/backend/app/api/routes/*.py`
- Generated: `code_review_server/backend/openapi.json` if the project already tracks it; otherwise do not add it.

- [ ] **Step 1: 运行后端完整测试，收集剩余 email/password 失败点**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest -q
```

Expected: FAIL if any old tests still reference `email`、`password`、`signup`、`password-recovery`。记录失败文件名。

- [ ] **Step 2: 批量搜索残留邮箱身份引用**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
rg -n "email|hashed_password|password-recovery|reset-password|login/access-token|UserRegister|UpdatePassword|get_user_by_email|authenticate" app tests
```

Expected: 只允许以下残留：

- `tests` 中明确断言旧接口返回 404/410 的字符串。
- 第三方依赖或注释中非身份逻辑的普通单词。

- [ ] **Step 3: 修复剩余测试工具**

对于需要普通登录 headers 的测试，使用：

```python
from tests.utils.user import create_key_user, user_authentication_headers_by_key

user, key = create_key_user(db=db)
headers = user_authentication_headers_by_key(client=client, key=key)
```

对于需要管理员 headers 的测试，使用：

```python
admin, key = create_key_user(db=db, is_superuser=True)
headers = user_authentication_headers_by_key(client=client, key=key)
```

对于需要 SVN 用户的测试，直接创建 `User` 并使用 `CredentialService.save_svn_password()`。

- [ ] **Step 4: 运行后端完整测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest -q
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/backend/app code_review_server/backend/tests
git commit -m "test: update backend auth coverage for key and svn"
```

---

### Task 8: 重新生成 Web OpenAPI 客户端

**Files:**
- Generated/Modify: `code_review_server/frontend/src/client/index.ts`
- Generated/Modify: `code_review_server/frontend/src/client/schemas.gen.ts`
- Generated/Modify: `code_review_server/frontend/src/client/sdk.gen.ts`
- Generated/Modify: `code_review_server/frontend/src/client/types.gen.ts`

- [ ] **Step 1: 启动后端或生成 OpenAPI schema**

如果项目已有脚本生成前端 client，优先使用：

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bun run generate-client
```

Expected: `src/client/*` 根据新的 `/api/v1/openapi.json` 更新。

如果命令要求后端运行，先启动后端：

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run fastapi run app/main.py --port 8000
```

再另开 shell 运行 `bun run generate-client`。

- [ ] **Step 2: 检查生成结果包含新接口**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
rg -n "keyLogin|authKeyLogin|cchSync|syncCch|svnCredential|loginWithKey|auth/key-login|admin/cch-sync" src/client
```

Expected: 能找到 Key 登录和 CCH 同步接口。实际函数名以生成器输出为准，后续前端代码必须使用生成后的真实名称。

- [ ] **Step 3: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/client
git commit -m "chore: regenerate frontend api client"
```

---

### Task 9: Web 登录页改为 Key/SVN 双登录

**Files:**
- Modify: `code_review_server/frontend/src/hooks/useAuth.ts`
- Modify: `code_review_server/frontend/src/routes/login.tsx`
- Delete or Modify: `code_review_server/frontend/src/routes/signup.tsx`
- Delete or Modify: `code_review_server/frontend/src/routes/recover-password.tsx`
- Delete or Modify: `code_review_server/frontend/src/routes/reset-password.tsx`
- Modify: `code_review_server/frontend/src/routeTree.gen.ts`
- Test: `code_review_server/frontend/tests/login.spec.ts`

- [ ] **Step 1: 改写 Playwright 登录页测试**

修改 `frontend/tests/login.spec.ts` 中输入可见性测试：

```ts
test("Login page exposes key and SVN login tabs", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByRole("tab", { name: "Key 登录" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "SVN 登录" })).toBeVisible()
  await expect(page.getByLabel("Key")).toBeVisible()

  await page.getByRole("tab", { name: "SVN 登录" }).click()
  await expect(page.getByLabel("SVN账号")).toBeVisible()
  await expect(page.getByLabel("SVN密码")).toBeVisible()
})

test("Email signup and password recovery links are removed", async ({ page }) => {
  await page.goto("/login")

  await expect(page.getByText("Forgot your password?")).not.toBeVisible()
  await expect(page.getByText("Sign up")).not.toBeVisible()
  await expect(page.getByLabel("Email")).not.toBeVisible()
})
```

保留“错误 token 跳转登录”等和认证机制无关的测试；删除依赖 `firstSuperuser` 邮箱密码登录的测试，后续可用 API 创建 key 用户后再登录。

- [ ] **Step 2: 运行前端登录测试确认失败**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bunx playwright test tests/login.spec.ts
```

Expected: FAIL，因为登录页仍是邮箱密码。

- [ ] **Step 3: 修改 `useAuth.ts`**

根据 Task 8 生成的真实 service 名称替换以下示例。目标结构：

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { LoginService, type UserPublic, UsersService } from "@/client"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

type KeyLoginForm = { key: string }
type SvnLoginForm = { svn_username: string; svn_password: string }

const isLoggedIn = () => localStorage.getItem("access_token") !== null

const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()

  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    queryFn: UsersService.readUserMe,
    enabled: isLoggedIn(),
  })

  const saveToken = (response: { access_token: string }) => {
    localStorage.setItem("access_token", response.access_token)
  }

  const keyLoginMutation = useMutation({
    mutationFn: async (data: KeyLoginForm) => {
      const response = await LoginService.loginWithKey({ requestBody: data })
      saveToken(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
      navigate({ to: "/" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const svnLoginMutation = useMutation({
    mutationFn: async (data: SvnLoginForm) => {
      const response = await LoginService.loginSvnAccount({ requestBody: data })
      saveToken(response)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] })
      navigate({ to: "/" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const logout = () => {
    localStorage.removeItem("access_token")
    queryClient.removeQueries({ queryKey: ["currentUser"] })
    navigate({ to: "/login" })
  }

  return { keyLoginMutation, svnLoginMutation, logout, user }
}

export { isLoggedIn }
export default useAuth
```

如果生成器函数名不是 `loginWithKey`，用 `src/client/sdk.gen.ts` 中真实导出名替换。

- [ ] **Step 4: 修改 `routes/login.tsx`**

用 shadcn/ui tabs 或现有样式实现两个 tab。核心表单结构：

```tsx
const keyFormSchema = z.object({
  key: z.string().min(1, { message: "Key is required" }),
})

const svnFormSchema = z.object({
  svn_username: z.string().min(1, { message: "SVN账号必填" }),
  svn_password: z.string().min(1, { message: "SVN密码必填" }),
})
```

UI 文案使用中文：

- 标题：`登录代码审查平台`
- Tab：`Key 登录`、`SVN 登录`
- Key label：`Key`
- SVN label：`SVN账号`、`SVN密码`
- Button：`登录`

删除 `RouterLink` 到 `/signup` 和 `/recover-password`。

- [ ] **Step 5: 删除或禁用邮箱相关 routes**

删除文件：

```bash
rm code_review_server/frontend/src/routes/signup.tsx
rm code_review_server/frontend/src/routes/recover-password.tsx
rm code_review_server/frontend/src/routes/reset-password.tsx
```

然后重新生成 route tree：

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bunx vite --host 127.0.0.1 --port 5173
```

如果项目的 TanStack 插件在 dev/build 时生成 `routeTree.gen.ts`，启动后停止即可。也可以直接运行：

```bash
bun run build
```

Expected: `src/routeTree.gen.ts` 不再包含 signup/recover/reset routes。

- [ ] **Step 6: 运行 Web 类型检查/构建**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bun run build
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/hooks/useAuth.ts code_review_server/frontend/src/routes/login.tsx code_review_server/frontend/src/routes code_review_server/frontend/src/routeTree.gen.ts code_review_server/frontend/tests/login.spec.ts
git commit -m "feat: add web key and svn login"
```

---

### Task 10: Web 管理后台 CCH 同步按钮

**Files:**
- Modify: `code_review_server/frontend/src/components/Admin/UsersPage.tsx`
- Modify: `code_review_server/frontend/src/components/Admin/columns.tsx`
- Test: `code_review_server/frontend/tests/admin.spec.ts`

- [ ] **Step 1: 改写管理员页面测试**

在 `frontend/tests/admin.spec.ts` 增加：

```ts
test("Admin users page exposes CCH sync action", async ({ page }) => {
  await page.goto("/admin/users")

  await expect(page.getByRole("button", { name: "同步 CCH 用户" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "来源" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "CCH用户ID" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "最近同步" })).toBeVisible()
})
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bunx playwright test tests/admin.spec.ts
```

Expected: FAIL，因为按钮和列尚不存在。

- [ ] **Step 3: 修改 `UsersPage.tsx`**

新增 mutation。实际 service 名称以生成客户端为准：

```tsx
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { CchSyncService, type UserPublic, UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
```

在 `AdminUsersPage` 内：

```tsx
const queryClient = useQueryClient()
const { showSuccessToast, showErrorToast } = useCustomToast()
const syncMutation = useMutation({
  mutationFn: () => CchSyncService.syncCchUsers(),
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: ["users"] })
    showSuccessToast(
      `同步完成：新增用户 ${result.created_users}，新增 Key ${result.created_keys}`,
    )
  },
  onError: (error) => {
    showErrorToast(error)
  },
})
```

按钮：

```tsx
<Button
  type="button"
  variant="outline"
  onClick={() => syncMutation.mutate()}
  disabled={syncMutation.isPending}
>
  {syncMutation.isPending ? (
    <Loader2 className="mr-2 size-4 animate-spin" />
  ) : (
    <RefreshCw className="mr-2 size-4" />
  )}
  同步 CCH 用户
</Button>
```

和 `AddUser` 放在同一 action 区域。

- [ ] **Step 4: 修改 `columns.tsx`**

在用户表中增加列：

```tsx
{
  accessorKey: "auth_source",
  header: "来源",
  cell: ({ row }) => (row.original.auth_source === "cch" ? "CCH" : "本地"),
},
{
  accessorKey: "cch_user_id",
  header: "CCH用户ID",
  cell: ({ row }) => row.original.cch_user_id ?? "-",
},
{
  accessorKey: "last_synced_at",
  header: "最近同步",
  cell: ({ row }) =>
    row.original.last_synced_at
      ? new Date(row.original.last_synced_at).toLocaleString()
      : "-",
},
```

如果 `UserTableData` 类型缺少字段，从生成的 `UserPublic` 类型继承即可。

- [ ] **Step 5: 运行构建**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bun run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/components/Admin/UsersPage.tsx code_review_server/frontend/src/components/Admin/columns.tsx code_review_server/frontend/tests/admin.spec.ts
git commit -m "feat: add cch sync action to admin users"
```

---

### Task 11: Web 设置页移除邮箱密码并支持 SVN 凭据

**Files:**
- Modify: `code_review_server/frontend/src/routes/_layout/settings.tsx`
- Modify: `code_review_server/frontend/src/components/UserSettings/UserInformation.tsx`
- Modify: `code_review_server/frontend/src/components/UserSettings/ChangePassword.tsx`
- Modify: `code_review_server/frontend/src/components/UserSettings/DeleteAccount.tsx`
- Create: `code_review_server/frontend/src/components/UserSettings/SvnCredentialForm.tsx`
- Test: `code_review_server/frontend/tests/user-settings.spec.ts`

- [ ] **Step 1: 改写设置页测试**

修改 `frontend/tests/user-settings.spec.ts` 的 tab 断言：

```ts
const tabs = ["个人信息", "SVN凭据", "危险操作"]

test("Settings page no longer exposes email or password settings", async ({ page }) => {
  await page.goto("/settings")

  await expect(page.getByRole("tab", { name: "个人信息" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "SVN凭据" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Password" })).not.toBeVisible()
  await expect(page.getByLabel("Email")).not.toBeVisible()
})
```

删除修改邮箱和修改密码相关测试。

- [ ] **Step 2: 创建 `SvnCredentialForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { CredentialsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const schema = z.object({
  svn_username: z.string().min(1, "SVN账号必填"),
  svn_password: z.string().min(1, "SVN密码必填"),
})

type FormData = z.infer<typeof schema>

export function SvnCredentialForm() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { svn_username: "", svn_password: "" },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      CredentialsService.updateMySvnCredential({ requestBody: data }),
    onSuccess: () => showSuccessToast("SVN凭据已更新"),
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Form {...form}>
      <form className="grid gap-4" onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <FormField
          control={form.control}
          name="svn_username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SVN账号</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="svn_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SVN密码</FormLabel>
              <FormControl>
                <PasswordInput {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending}>
          保存
        </Button>
      </form>
    </Form>
  )
}
```

真实 service 名称以生成客户端为准。

- [ ] **Step 3: 修改 settings route**

将 tabs 改为：

```tsx
<TabsList>
  <TabsTrigger value="profile">个人信息</TabsTrigger>
  <TabsTrigger value="svn">SVN凭据</TabsTrigger>
  <TabsTrigger value="danger">危险操作</TabsTrigger>
</TabsList>
<TabsContent value="profile">
  <UserInformation />
</TabsContent>
<TabsContent value="svn">
  <SvnCredentialForm />
</TabsContent>
<TabsContent value="danger">
  <DeleteAccount />
</TabsContent>
```

删除 `ChangePassword` 引用。

- [ ] **Step 4: 修改 `UserInformation.tsx`**

移除邮箱字段，只显示和编辑 `full_name`。表单 schema：

```ts
const formSchema = z.object({
  full_name: z.string().optional(),
})
```

提交时调用 `UsersService.updateUserMe({ requestBody: data })`。

- [ ] **Step 5: 运行构建和设置页测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bun run build
bunx playwright test tests/user-settings.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/frontend/src/routes/_layout/settings.tsx code_review_server/frontend/src/components/UserSettings code_review_server/frontend/tests/user-settings.spec.ts
git commit -m "feat: update settings for svn credentials"
```

---

### Task 12: Electron API 与 IPC 改为 Key/SVN 登录

**Files:**
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Test: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 改写 ApiClient 测试**

在 `api-client.test.ts` 替换 register 测试为：

```ts
it('posts key login payload to the auth key-login endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token'
    })
  )
  const client = new ApiClient('https://server.example/', fetchMock)

  const result = await client.keyLogin({ key: 'sk-cch-test' })

  expect(result).toEqual({
    access_token: 'access-token',
    refresh_token: 'refresh-token'
  })
  expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/auth/key-login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ key: 'sk-cch-test' })
  })
})

it('posts svn login payload to the auth login endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token'
    })
  )
  const client = new ApiClient('https://server.example', fetchMock)

  await client.svnLogin({
    svn_username: 'ada',
    svn_password: 'secret'
  })

  expect(fetchMock).toHaveBeenCalledWith('https://server.example/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      svn_username: 'ada',
      svn_password: 'secret'
    })
  })
})
```

- [ ] **Step 2: 修改 `api-client.ts`**

类型：

```ts
export interface KeyLoginRequest {
  server_url: string
  key: string
}

export interface SvnLoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export type AuthKeyLoginRequest = Omit<KeyLoginRequest, 'server_url'>
export type AuthSvnLoginRequest = Omit<SvnLoginRequest, 'server_url'>
```

方法：

```ts
keyLogin(payload: AuthKeyLoginRequest): Promise<TokenPair> {
  return this.request<TokenPair>('/api/v1/auth/key-login', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

svnLogin(payload: AuthSvnLoginRequest): Promise<TokenPair> {
  return this.request<TokenPair>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}
```

删除 `RegisterRequest`、`AuthRegisterRequest` 和 `register()`。

- [ ] **Step 3: 修改 `ipc.ts`**

导入类型改为 `KeyLoginRequest`、`SvnLoginRequest`。删除 `auth:register` handler。

新增：

```ts
ipcMain.handle('auth:key-login', async (_event, payload: KeyLoginRequest): Promise<true> => {
  const serverUrl = normalizeServerUrl(payload.server_url)
  const api = apiOverride ?? new ApiClient(serverUrl)
  const tokens = await api.keyLogin({ key: payload.key })
  await serverConfigStore.save({ server_url: serverUrl })
  await authStore.save(tokens)
  return true
})

ipcMain.handle('auth:svn-login', async (_event, payload: SvnLoginRequest): Promise<true> => {
  const serverUrl = normalizeServerUrl(payload.server_url)
  const api = apiOverride ?? new ApiClient(serverUrl)
  const tokens = await api.svnLogin({
    svn_username: payload.svn_username,
    svn_password: payload.svn_password
  })
  await serverConfigStore.save({ server_url: serverUrl })
  await authStore.save(tokens)
  return true
})
```

- [ ] **Step 4: 修改 preload 和 renderer 类型**

`preload/index.ts`：

```ts
keyLogin: (payload: KeyLoginRequest): Promise<unknown> =>
  ipcRenderer.invoke('auth:key-login', payload),
svnLogin: (payload: SvnLoginRequest): Promise<unknown> =>
  ipcRenderer.invoke('auth:svn-login', payload),
```

`code-review-api.ts`：

```ts
export interface KeyLoginRequest {
  server_url: string
  key: string
}

export interface SvnLoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export interface CodeReviewApi {
  keyLogin(payload: KeyLoginRequest): Promise<unknown>
  svnLogin(payload: SvnLoginRequest): Promise<unknown>
  ...
}
```

- [ ] **Step 5: 运行 Electron main 测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_electron/src/main/api-client.ts code_review_electron/src/main/ipc.ts code_review_electron/src/preload/index.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/main/__tests__/api-client.test.ts code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "feat: update electron auth ipc"
```

---

### Task 13: Electron 登录页改为 Key/SVN 双登录

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/LoginPage.tsx`
- Modify: `code_review_electron/src/renderer/src/App.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 修改 `LoginPage.tsx` props 和 state**

目标类型：

```ts
type LoginPageProps = {
  onKeyLogin: (payload: KeyLoginRequest) => Promise<void>
  onSvnLogin: (payload: SvnLoginRequest) => Promise<void>
}

type AuthMode = 'key' | 'svn'
```

State：

```ts
const [mode, setMode] = useState<AuthMode>('key')
const [serverUrl, setServerUrl] = useState('')
const [key, setKey] = useState('')
const [svnUsername, setSvnUsername] = useState('')
const [svnPassword, setSvnPassword] = useState('')
const [rememberPassword, setRememberPassword] = useState(false)
```

- [ ] **Step 2: 修改 submit 逻辑**

```ts
if (mode === 'key') {
  await onKeyLogin({
    server_url: serverUrl.trim(),
    key: key.trim()
  })
} else {
  await onSvnLogin({
    server_url: serverUrl.trim(),
    svn_username: svnUsername.trim(),
    svn_password: svnPassword
  })
}
```

记住密码只对 SVN 模式生效：

```ts
if (mode === 'svn' && rememberPassword) {
  await window.codeReview.saveCredentials({
    server_url: serverUrl.trim(),
    svn_username: svnUsername.trim(),
    svn_password: svnPassword
  })
} else if (mode === 'svn') {
  await window.codeReview.clearCredentials()
}
```

- [ ] **Step 3: 修改 UI**

Tab 文案：

- `Key 登录`
- `SVN 登录`

Key 模式展示：

```tsx
<label className="field auth-field">
  <span>Key</span>
  <input
    required
    value={key}
    autoComplete="off"
    onChange={(event) => setKey(event.target.value)}
  />
</label>
```

SVN 模式展示 SVN 账号、SVN 密码、记住密码。删除注册 tab、姓名字段、注册账户链接。

- [ ] **Step 4: 修改 `App.tsx`**

类型：

```ts
import type { EnvironmentCheckResult, KeyLoginRequest, SvnLoginRequest } from './code-review-api'

type AuthSession = {
  displayName: string
}
```

Actions：

```ts
async keyLogin(payload: KeyLoginRequest): Promise<void> {
  await window.codeReview.keyLogin(payload)
  setSession({ displayName: 'Key 用户' })
  await checkEnvironment()
},
async svnLogin(payload: SvnLoginRequest): Promise<void> {
  await window.codeReview.svnLogin(payload)
  setSession({ displayName: payload.svn_username })
  await checkEnvironment()
}
```

Render：

```tsx
<LoginPage onKeyLogin={authActions.keyLogin} onSvnLogin={authActions.svnLogin} />
```

TaskPage 的 `svnUsername` 传：

```tsx
svnUsername={session.displayName}
```

- [ ] **Step 5: 运行 Electron 类型检查和测试**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
npm test
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_electron/src/renderer/src/components/LoginPage.tsx code_review_electron/src/renderer/src/App.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "feat: add electron key and svn login UI"
```

---

### Task 14: 最终清理、全量验证与文档更新

**Files:**
- Modify: `code_review_server/README.md` if it documents email login.
- Modify: `code_review_electron/README.md` if it documents register/login.
- Modify: `.env.example` or deployment docs if present.

- [ ] **Step 1: 搜索全仓库邮箱登录残留**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
rg -n "email|hashed_password|password-recovery|reset-password|login/access-token|signup|Sign up|Forgot your password|UserRegister|UpdatePassword|get_user_by_email|authenticate" code_review_server code_review_electron --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/out/**'
```

Expected: 没有邮箱身份流程残留。允许出现的情况：

- 设计文档或计划文档中的历史说明。
- 第三方生成文件中不可控的非身份字段，若确实不用则记录在最终说明。

- [ ] **Step 2: 后端全量验证**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/backend
uv run pytest -q
uv run ruff check app tests
```

Expected: PASS。

- [ ] **Step 3: Web 前端验证**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_server/frontend
bun run build
```

Expected: PASS。

如果测试环境可用，再运行：

```bash
bunx playwright test
```

Expected: PASS。

- [ ] **Step 4: Electron 验证**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
npm test
```

Expected: PASS。

- [ ] **Step 5: 更新 README / env 文档**

在文档中说明：

```markdown
认证方式：

- 管理员在 Web 管理后台点击“同步 CCH 用户”，将 CCH 用户名、角色和 Key 同步到 code_review 本地库。
- Web 和 Electron 支持 Key 登录和 SVN 账号密码登录。
- 邮箱注册、邮箱登录、找回密码和修改密码已移除。
- `CCH_DATABASE_URL` 需要配置为 Claude Code Hub 的 PostgreSQL 连接串。
```

- [ ] **Step 6: 最终提交**

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git add code_review_server/README.md code_review_electron/README.md code_review_server/.env.example code_review_server/deployment.md
git commit -m "docs: document key and svn auth setup"
```

如果某些文档文件不存在或没有改动，只 stage 实际修改过的文件。

- [ ] **Step 7: 最终状态检查**

Run:

```bash
cd /home/gpt/PeiChengAI/Agent/code_review_platform
git status --short
git log --oneline -5
```

Expected: 工作区干净，最近提交包含本计划的分阶段实现提交。
