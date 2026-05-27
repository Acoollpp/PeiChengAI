from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class TaskStatus(StrEnum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"
    enqueue_failed = "enqueue_failed"


class TaskCreateRequest(BaseModel):
    svn_url: str = Field(min_length=1)
    old_revision: str = Field(min_length=1)
    new_revision: str = Field(min_length=1)
    requester: str | None = None


class TaskCreateResponse(BaseModel):
    task_id: str
    status: TaskStatus


class SessionCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)


class UserResponse(BaseModel):
    user_id: str
    name: str
    phone: str
    is_admin: bool = False
    is_active: bool = True


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


class RepositoryResponse(BaseModel):
    key: str
    name: str
    url_prefix: str
    is_public: bool


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


class TaskResponse(BaseModel):
    task_id: str
    svn_url: str
    repository_key: str | None = None
    repository_name: str | None = None
    old_revision: str
    new_revision: str
    requester: str | None
    status: TaskStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None
    report_available: bool
