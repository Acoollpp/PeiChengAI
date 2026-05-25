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
    requester: str | None
    status: TaskStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None
    report_available: bool
