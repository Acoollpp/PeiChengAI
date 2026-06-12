import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from sqlalchemy import JSON, DateTime, Index
from sqlmodel import Field, Relationship, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, Enum):
    admin = "admin"
    user = "user"


class AuthSource(str, Enum):
    local = "local"
    cch = "cch"


class ReviewTaskStatus(str, Enum):
    created = "created"
    checking_environment = "checking_environment"
    running_codex = "running_codex"
    uploading_report = "uploading_report"
    success = "success"
    failed = "failed"
    environment_error = "environment_error"
    cancelled = "cancelled"


class FeedbackStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    resolved = "resolved"


# Shared properties
class UserBase(SQLModel):
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole = UserRole.user


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole | None = None


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
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


class UserApiKey(SQLModel, table=True):
    __tablename__ = "user_api_key"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, index=True, ondelete="CASCADE"
    )
    cch_key_id: int = Field(unique=True, index=True)
    key: str = Field(unique=True, index=True, max_length=2048)
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


class ReviewTask(SQLModel, table=True):
    __tablename__ = "review_task"
    __table_args__ = (
        Index("ix_review_task_user_id_status", "user_id", "status"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False)
    svn_url: str = Field(max_length=2048)
    old_revision: str = Field(max_length=255)
    new_revision: str = Field(max_length=255)
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)
    status: ReviewTaskStatus = Field(default=ReviewTaskStatus.created)
    report_path: str | None = Field(default=None, max_length=2048)
    report_name: str | None = Field(default=None, max_length=255)
    pdf_report_path: str | None = Field(default=None, max_length=2048)
    pdf_report_name: str | None = Field(default=None, max_length=255)
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
        index=True,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    screenshots: list["FeedbackScreenshot"] = Relationship(
        back_populates="feedback",
        cascade_delete=True,
    )


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


class ReviewTaskCreate(SQLModel):
    svn_url: str = Field(min_length=1, max_length=2048)
    old_revision: str = Field(min_length=1, max_length=255)
    new_revision: str = Field(min_length=1, max_length=255)
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)


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
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)
    status: ReviewTaskStatus
    report_path: str | None = None
    report_name: str | None = None
    pdf_report_path: str | None = None
    pdf_report_name: str | None = None
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


class ReviewTaskReportUserStatsPublic(SQLModel):
    user_name: str | None = None
    svn_username: str | None = None
    report_count: int


class ReviewTaskStatsPublic(SQLModel):
    total: int
    success: int
    running: int
    failed_or_error: int
    by_status: dict[ReviewTaskStatus, int]
    reports_by_user: list[ReviewTaskReportUserStatsPublic] = Field(default_factory=list)


class FeedbackScreenshotPublic(SQLModel):
    id: uuid.UUID
    file_name: str
    content_type: str
    file_size: int
    sort_order: int
    created_at: datetime | None = None


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


class FeedbacksPublic(SQLModel):
    data: list[FeedbackPublic]
    count: int


class FeedbackStatusUpdate(SQLModel):
    status: FeedbackStatus


class SkillPackage(SQLModel, table=True):
    __tablename__ = "skill_package"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(index=True, max_length=255)
    version: str = Field(max_length=128)
    description: str | None = Field(default=None, max_length=1024)
    content_hash: str = Field(max_length=64, index=True)
    file_path: str = Field(max_length=2048)
    file_size: int = Field(default=0)
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
    file_size: int
    is_active: bool
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SkillPackagesPublic(SQLModel):
    data: list[SkillPackagePublic]
    count: int


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
    artifact_path: str
    artifact_size: int
    artifact_sha512: str
    latest_yml_name: str
    latest_yml_path: str
    blockmap_name: str | None = None
    blockmap_path: str | None = None
    is_active: bool
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ClientReleasesPublic(SQLModel):
    data: list[ClientReleasePublic]
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
    auth_source: AuthSource = AuthSource.local
    cch_user_id: int | None = None
    disabled_reason: str | None = None
    last_synced_at: datetime | None = None
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
