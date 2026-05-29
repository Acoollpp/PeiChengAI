import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import EmailStr
from sqlalchemy import JSON, DateTime
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, Enum):
    admin = "admin"
    user = "user"


class ReviewTaskStatus(str, Enum):
    created = "created"
    checking_environment = "checking_environment"
    running_codex = "running_codex"
    uploading_report = "uploading_report"
    success = "success"
    failed = "failed"
    environment_error = "environment_error"
    cancelled = "cancelled"


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(UserBase):
    email: EmailStr | None = Field(default=None, max_length=255)  # type: ignore[assignment]
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    svn_username: str | None = Field(
        default=None, unique=True, index=True, max_length=255
    )
    role: UserRole = Field(default=UserRole.user, index=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)


class UserSvnCredential(SQLModel, table=True):
    __tablename__ = "user_svn_credential"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, unique=True, index=True
    )
    encrypted_password: str
    encryption_version: str = Field(max_length=64)
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewTask(SQLModel, table=True):
    __tablename__ = "review_task"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False)
    svn_url: str = Field(max_length=2048)
    old_revision: str = Field(max_length=255)
    new_revision: str = Field(max_length=255)
    status: ReviewTaskStatus = Field(default=ReviewTaskStatus.created)
    report_path: str | None = Field(default=None, max_length=2048)
    error_message: str | None = None
    client_hostname: str | None = Field(default=None, max_length=255)
    client_version: str | None = Field(default=None, max_length=255)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    started_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    finished_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewTaskCreate(SQLModel):
    svn_url: str = Field(min_length=1, max_length=2048)
    old_revision: str = Field(min_length=1, max_length=255)
    new_revision: str = Field(min_length=1, max_length=255)


class ReviewTaskStatusUpdate(SQLModel):
    status: ReviewTaskStatus
    error_message: str | None = None
    client_hostname: str | None = Field(default=None, max_length=255)
    client_version: str | None = Field(default=None, max_length=255)


class ReviewTaskPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    svn_username: str | None = None
    svn_url: str
    old_revision: str
    new_revision: str
    status: ReviewTaskStatus
    report_path: str | None = None
    error_message: str | None = None
    client_hostname: str | None = None
    client_version: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime | None = None


class ReviewTasksPublic(SQLModel):
    data: list[ReviewTaskPublic]
    count: int


class SkillPackage(SQLModel, table=True):
    __tablename__ = "skill_package"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(index=True, max_length=255)
    version: str = Field(max_length=128)
    description: str | None = Field(default=None, max_length=1024)
    content_hash: str = Field(max_length=64, index=True)
    file_path: str = Field(max_length=2048)
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


class SkillPackagePublic(SQLModel):
    id: uuid.UUID
    name: str
    version: str
    description: str | None = None
    content_hash: str
    is_active: bool
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SkillPackagesPublic(SQLModel):
    data: list[SkillPackagePublic]
    count: int


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    actor_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    action: str = Field(max_length=255)
    target_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    metadata_json: dict[str, Any] | None = Field(default=None, sa_type=JSON)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    svn_username: str | None = None
    role: UserRole = UserRole.user
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Shared properties
class ItemBase(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


# Properties to receive on item creation
class ItemCreate(ItemBase):
    pass


# Properties to receive on item update
class ItemUpdate(ItemBase):
    title: str | None = Field(default=None, min_length=1, max_length=255)  # type: ignore[assignment]


# Database model, database table inferred from class name
class Item(ItemBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")


# Properties to return via API, id is always required
class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


class ItemsPublic(SQLModel):
    data: list[ItemPublic]
    count: int


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
