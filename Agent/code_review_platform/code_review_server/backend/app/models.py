import uuid
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any

from sqlalchemy import JSON, DateTime, Index, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel

MAX_REVIEW_TASK_ISSUE_TEXT_LENGTH = 8 * 1024
MAX_REVIEW_TASK_ISSUE_DESCRIPTION_LENGTH = 64 * 1024
MAX_REVIEW_TASK_ISSUE_DISPLAY_SNAPSHOT_LENGTH = 256 * 1024
MAX_REVIEW_TASK_ISSUE_FEEDBACK_LENGTH = 4 * 1024


def get_datetime_utc() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, Enum):
    admin = "admin"
    department_admin = "department_admin"
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


class FeedbackStatsRange(str, Enum):
    today = "today"
    yesterday = "yesterday"
    all = "all"


class ReviewTaskStatsRange(str, Enum):
    this_week = "this_week"
    last_week = "last_week"
    today = "today"
    yesterday = "yesterday"
    all = "all"


class DepartmentBase(SQLModel):
    name: str = Field(min_length=1, max_length=255, unique=True, index=True)
    description: str | None = Field(default=None, max_length=1024)
    is_active: bool = Field(default=True, index=True)


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    is_active: bool | None = None


class Department(DepartmentBase, table=True):
    __tablename__ = "department"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class DepartmentPublic(DepartmentBase):
    id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DepartmentsPublic(SQLModel):
    data: list[DepartmentPublic]
    count: int


# Shared properties
class UserBase(SQLModel):
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)
    department_id: uuid.UUID | None = Field(default=None, foreign_key="department.id")


# Properties to receive via API on creation
class UserCreate(UserBase):
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole = UserRole.user


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    svn_username: str | None = Field(default=None, max_length=255)
    role: UserRole | None = None
    department_id: uuid.UUID | None = None


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)


class UserDepartmentUpdate(SQLModel):
    department_id: uuid.UUID


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


class ReviewFocusDirection(SQLModel, table=True):
    __tablename__ = "review_focus_direction"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=4096)
    department_id: uuid.UUID | None = Field(
        default=None, foreign_key="department.id", index=True
    )
    is_active: bool = Field(default=True, index=True)
    usage_count: int = Field(default=0)
    created_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewFocusDirectionDepartment(SQLModel, table=True):
    __tablename__ = "review_focus_direction_department"
    __table_args__ = (
        Index(
            "uq_review_focus_direction_department",
            "direction_id",
            "department_id",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    direction_id: uuid.UUID = Field(
        foreign_key="review_focus_direction.id",
        nullable=False,
        index=True,
    )
    department_id: uuid.UUID = Field(
        foreign_key="department.id",
        nullable=False,
        index=True,
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewFocusDirectionUsageState(SQLModel, table=True):
    __tablename__ = "review_focus_direction_usage_state"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    normalized_content: str = Field(
        min_length=1,
        max_length=4096,
        unique=True,
        index=True,
    )
    is_used: bool = Field(default=False, index=True)
    updated_by_user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewFocusDirectionCreate(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=4096)
    department_id: uuid.UUID | None = None
    department_ids: list[uuid.UUID] | None = None
    is_active: bool = True


class ReviewFocusDirectionUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, min_length=1, max_length=4096)
    department_id: uuid.UUID | None = Field(default=None)
    department_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class ReviewFocusDirectionPublic(SQLModel):
    id: uuid.UUID
    title: str
    content: str
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    departments: list[DepartmentPublic] = Field(default_factory=list)
    is_active: bool
    usage_count: int
    created_by_user_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ReviewFocusDirectionsPublic(SQLModel):
    data: list[ReviewFocusDirectionPublic]
    count: int


class ReviewFocusDirectionUsageStatPublic(SQLModel):
    content: str
    usage_count: int
    latest_used_at: datetime | None = None
    departments: list[str] = Field(default_factory=list)
    submitter_names: list[str] = Field(default_factory=list)
    is_used: bool = False


class ReviewFocusDirectionUsageStateUpdate(SQLModel):
    content: str = Field(min_length=1, max_length=4096)
    is_used: bool


class ReviewFocusDirectionUsageStatsPublic(SQLModel):
    data: list[ReviewFocusDirectionUsageStatPublic]
    count: int


class ReviewTaskRequirementFile(SQLModel, table=True):
    __tablename__ = "review_task_requirement_file"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(foreign_key="review_task.id", nullable=False, index=True)
    file_name: str = Field(max_length=255)
    file_path: str = Field(max_length=2048)
    content_type: str | None = Field(default=None, max_length=128)
    file_size: int
    sha256: str = Field(max_length=64, index=True)
    uploaded_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewTask(SQLModel, table=True):
    __tablename__ = "review_task"
    __table_args__ = (Index("ix_review_task_user_id_status", "user_id", "status"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False)
    svn_url: str = Field(max_length=2048)
    old_revision: str = Field(max_length=255)
    new_revision: str = Field(max_length=255)
    review_item_ids: list[str] = Field(default_factory=list, sa_type=JSONB)
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)
    department_id: uuid.UUID | None = Field(
        default=None, foreign_key="department.id", index=True
    )
    department_name: str | None = Field(default=None, max_length=255)
    focus_direction_id: uuid.UUID | None = Field(
        default=None, foreign_key="review_focus_direction.id", index=True
    )
    focus_direction_snapshot: str | None = Field(default=None, max_length=4096)
    requirement_file_id: uuid.UUID | None = Field(default=None, index=True)
    requirement_file_name: str | None = Field(default=None, max_length=255)
    requirement_file_size: int | None = Field(default=None)
    requirement_file_sha256: str | None = Field(default=None, max_length=64)
    status: ReviewTaskStatus = Field(default=ReviewTaskStatus.created)
    report_path: str | None = Field(default=None, max_length=2048)
    report_name: str | None = Field(default=None, max_length=255)
    pdf_report_path: str | None = Field(default=None, max_length=2048)
    pdf_report_name: str | None = Field(default=None, max_length=255)
    feedback_protocol_version: int | None = Field(default=None)
    feedback_submitted_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
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


class ReviewTaskReportFeedback(SQLModel, table=True):
    __tablename__ = "review_task_report_feedback"
    __table_args__ = (
        Index(
            "ix_review_task_report_feedback_helpful_created_at",
            "helpful",
            "created_at",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(
        foreign_key="review_task.id", nullable=False, unique=True, index=True
    )
    user_id: uuid.UUID = Field(foreign_key="user.id", nullable=False, index=True)
    helpful: bool = Field(nullable=False, index=True)
    useful_issues_text: str | None = Field(default=None, max_length=4096)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        index=True,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ReviewTaskIssue(SQLModel, table=True):
    __tablename__ = "review_task_issue"
    __table_args__ = (
        UniqueConstraint("task_id", "order", name="uq_review_task_issue_task_order"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    task_id: uuid.UUID = Field(
        foreign_key="review_task.id",
        ondelete="CASCADE",
        nullable=False,
        index=True,
    )
    issue_text: str = Field(
        max_length=MAX_REVIEW_TASK_ISSUE_TEXT_LENGTH,
        sa_type=Text,
    )
    description_text: str = Field(
        max_length=MAX_REVIEW_TASK_ISSUE_DESCRIPTION_LENGTH,
        sa_type=Text,
    )
    display_snapshot: str = Field(
        max_length=MAX_REVIEW_TASK_ISSUE_DISPLAY_SNAPSHOT_LENGTH,
        sa_type=Text,
    )
    order: int = Field(nullable=False)
    source: str = Field(max_length=64)
    location: dict[str, int] = Field(sa_type=JSONB)
    helpful: bool | None = Field(default=None, index=True)
    feedback_text: str | None = Field(
        default=None,
        max_length=MAX_REVIEW_TASK_ISSUE_FEEDBACK_LENGTH,
        sa_type=Text,
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
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
    review_item_ids: list[str] = Field(default_factory=list, max_length=32)
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)
    focus_direction_id: uuid.UUID | None = None
    focus_direction_snapshot: str | None = Field(default=None, max_length=4096)
    requirement_file_name: str | None = Field(default=None, max_length=255)


class ReviewTaskStatusUpdate(SQLModel):
    status: ReviewTaskStatus
    error_message: str | None = None
    client_hostname: str | None = Field(default=None, max_length=255)
    client_version: str | None = Field(default=None, max_length=255)


class ReviewTaskReportFeedbackCreate(SQLModel):
    helpful: bool
    useful_issues_text: str | None = Field(default=None, max_length=4096)


class ReviewTaskReportFeedbackPublic(SQLModel):
    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    helpful: bool
    useful_issues_text: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ReviewTaskIssueLocation(SQLModel):
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    feedback_insertion_offset: int = Field(ge=0)
    anchor_line: int = Field(ge=0)
    heading_level: int = Field(ge=0, le=6)


class ReviewTaskIssueSnapshotCreate(SQLModel):
    issue_text: str = Field(
        min_length=1,
        max_length=MAX_REVIEW_TASK_ISSUE_TEXT_LENGTH,
    )
    description_text: str = Field(
        max_length=MAX_REVIEW_TASK_ISSUE_DESCRIPTION_LENGTH,
    )
    display_snapshot: str = Field(
        min_length=1,
        max_length=MAX_REVIEW_TASK_ISSUE_DISPLAY_SNAPSHOT_LENGTH,
    )
    order: int = Field(ge=0)
    source: str = Field(min_length=1, max_length=64)
    location: ReviewTaskIssueLocation


class ReviewTaskIssuePublic(SQLModel):
    id: uuid.UUID
    task_id: uuid.UUID
    issue_text: str
    description_text: str
    display_snapshot: str
    order: int
    source: str
    location: ReviewTaskIssueLocation
    helpful: bool | None = None
    feedback_text: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ReviewTaskIssueFeedbackDraftUpdate(SQLModel):
    helpful: bool | None
    feedback_text: str | None = Field(
        max_length=MAX_REVIEW_TASK_ISSUE_FEEDBACK_LENGTH,
    )


class ReviewTaskIssuesPublic(SQLModel):
    data: list[ReviewTaskIssuePublic]
    count: int
    evaluated_count: int
    feedback_submitted_at: datetime | None = None


class ReviewTaskPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None = None
    svn_username: str | None = None
    svn_url: str
    old_revision: str
    new_revision: str
    review_item_ids: list[str] = Field(default_factory=list)
    template_key: str | None = Field(default=None, max_length=64)
    skill_name: str | None = Field(default=None, max_length=255)
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    focus_direction_id: uuid.UUID | None = None
    focus_direction_snapshot: str | None = None
    requirement_file_id: uuid.UUID | None = None
    requirement_file_name: str | None = None
    requirement_file_size: int | None = None
    requirement_file_sha256: str | None = None
    status: ReviewTaskStatus
    report_path: str | None = None
    report_name: str | None = None
    pdf_report_path: str | None = None
    pdf_report_name: str | None = None
    feedback_protocol_version: int | None = None
    feedback_submitted_at: datetime | None = None
    issue_count: int = 0
    evaluated_issue_count: int = 0
    has_issue_feedback_draft: bool = False
    report_feedback_helpful: bool | None = None
    report_feedback_useful_issues_text: str | None = None
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


class ReviewTaskTrendPointPublic(SQLModel):
    label: str
    count: int


class ReviewTaskStatsPublic(SQLModel):
    range: ReviewTaskStatsRange
    total: int
    success: int
    running: int
    failed_or_error: int
    average_duration_seconds: int | None = None
    by_status: dict[ReviewTaskStatus, int]
    reports_by_user: list[ReviewTaskReportUserStatsPublic] = Field(default_factory=list)
    trend: list[ReviewTaskTrendPointPublic] = Field(default_factory=list)


class ReviewTaskWeeklyDailyPointPublic(SQLModel):
    date: date
    success: int
    helpful: int
    not_helpful: int
    no_feedback: int


class ReviewTaskWeeklyCategoryStatsPublic(SQLModel):
    category: str
    subcategory: str
    useful_count: int
    high_risk_count: int
    medium_risk_count: int
    low_risk_count: int


class ReviewTaskWeeklyDepartmentStatsPublic(SQLModel):
    department_name: str
    success: int
    helpful: int
    not_helpful: int
    no_feedback: int


class ReviewTaskWeeklyRepresentativeIssuePublic(SQLModel):
    task_id: uuid.UUID
    task_date: date
    department_name: str
    description: str
    category: str
    subcategory: str
    risk_level: str


class ReviewTaskWeeklyInsightsPublic(SQLModel):
    period_start: date
    period_end: date
    generated_at: datetime
    scope_label: str
    taxonomy_version: str
    success_tasks: int
    helpful: int
    not_helpful: int
    no_feedback: int
    feedback_coverage_rate: float
    explicit_useful_rate: float
    valid_useful_tasks: int
    cleaning_tasks: int
    valid_issue_count: int
    risk_counts: dict[str, int]
    attention_points: list[str] = Field(default_factory=list)
    daily: list[ReviewTaskWeeklyDailyPointPublic] = Field(default_factory=list)
    categories: list[ReviewTaskWeeklyCategoryStatsPublic] = Field(default_factory=list)
    departments: list[ReviewTaskWeeklyDepartmentStatsPublic] = Field(
        default_factory=list
    )
    representative_issues: list[ReviewTaskWeeklyRepresentativeIssuePublic] = Field(
        default_factory=list
    )


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


class FeedbackTrendPointPublic(SQLModel):
    label: str
    count: int


class FeedbackUserStatsPublic(SQLModel):
    user_name: str | None = None
    svn_username: str | None = None
    feedback_count: int


class FeedbackStatsPublic(SQLModel):
    range: FeedbackStatsRange
    total: int
    pending: int
    processing: int
    resolved: int
    unresolved: int
    resolution_rate: float
    average_resolution_seconds: int | None = None
    by_status: dict[FeedbackStatus, int]
    trend: list[FeedbackTrendPointPublic] = Field(default_factory=list)
    feedback_by_user: list[FeedbackUserStatsPublic] = Field(default_factory=list)


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


class ClientUpdatePolicy(SQLModel, table=True):
    __tablename__ = "client_update_policy"
    __table_args__ = (
        UniqueConstraint(
            "platform", "arch", name="uq_client_update_policy_platform_arch"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    platform: str = Field(default="win32", max_length=32, index=True)
    arch: str = Field(default="x64", max_length=32, index=True)
    minimum_supported_release_id: uuid.UUID | None = Field(
        default=None, foreign_key="client_release.id"
    )
    updated_by_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    updated_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ClientUpdatePolicyUpdate(SQLModel):
    minimum_supported_release_id: uuid.UUID | None = None


class ClientUpdatePolicyPublic(SQLModel):
    platform: str
    arch: str
    active_release_id: uuid.UUID | None = None
    active_version: str | None = None
    minimum_supported_release_id: uuid.UUID | None = None
    minimum_supported_version: str | None = None
    updated_by_user_id: uuid.UUID | None = None
    updated_at: datetime | None = None


class ClientUpdateCheckPublic(ClientUpdatePolicyPublic):
    current_version: str
    update_available: bool
    update_required: bool
    release_notes: str | None = None


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
    department_name: str | None = None
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
