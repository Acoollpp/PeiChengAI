import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.core.config import settings
from app.models import (
    User,
    WhiteboxAgent,
    WhiteboxAgentPublic,
    WhiteboxAgentsPublic,
    WhiteboxAgentStatus,
    WhiteboxTaskPublic,
    WhiteboxTasksPublic,
    WhiteboxTaskStatsPublic,
    WhiteboxTaskStatus,
    WhiteboxTestTask,
)
from app.services import whitebox_task_service

router = APIRouter(tags=["whitebox"])

_RUNNING_STATUSES = {
    WhiteboxTaskStatus.claimed,
    WhiteboxTaskStatus.preparing,
    WhiteboxTaskStatus.running,
    WhiteboxTaskStatus.uploading_report,
}

_FAILED_OR_ERROR_STATUSES = {
    WhiteboxTaskStatus.failed,
    WhiteboxTaskStatus.environment_error,
    WhiteboxTaskStatus.timeout,
}


class WhiteboxAgentHeartbeat(BaseModel):
    name: str
    machine_id: str
    status: WhiteboxAgentStatus = WhiteboxAgentStatus.online
    capabilities: dict[str, Any] | None = None


class WhiteboxTaskStatusReport(BaseModel):
    status: WhiteboxTaskStatus
    message: str | None = None


class WhiteboxTaskLogReport(BaseModel):
    message: str


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _project_name_from_source_url(source_url: str) -> str:
    normalized = source_url.strip().rstrip("/\\")
    if not normalized:
        raise HTTPException(status_code=400, detail="SVN路径不能为空")
    name = Path(normalized).name
    if not name or name in {".", "/"}:
        name = normalized.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return name or "白盒测试任务"


def _authenticate_agent(
    session: SessionDep,
    x_whitebox_agent_token: str | None = Header(default=None),
) -> WhiteboxAgent:
    if not x_whitebox_agent_token or x_whitebox_agent_token != settings.WHITEBOX_AGENT_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid whitebox agent token")
    agent = session.exec(select(WhiteboxAgent).order_by(col(WhiteboxAgent.updated_at).desc())).first()
    if agent is None:
        raise HTTPException(status_code=404, detail="Whitebox agent is not registered")
    if agent.status == WhiteboxAgentStatus.disabled:
        raise HTTPException(status_code=403, detail="Whitebox agent is disabled")
    return agent


def _task_public(
    task: WhiteboxTestTask,
    user: User | None = None,
) -> WhiteboxTaskPublic:
    return WhiteboxTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
        },
    )


def _task_scope_filters(current_user: CurrentUser, scope: str = "mine") -> list[Any]:
    if scope == "all":
        if not has_admin_privileges(current_user):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return []
    if scope != "mine":
        raise HTTPException(status_code=400, detail="Unsupported task scope")
    return [WhiteboxTestTask.user_id == current_user.id]


def _expire_stale_running_tasks(session: SessionDep, now: datetime | None = None) -> int:
    timeout_seconds = max(int(settings.WHITEBOX_TASK_TIMEOUT_SECONDS), 1)
    now = now or _utcnow()
    cutoff = now - timedelta(seconds=timeout_seconds)
    tasks = session.exec(
        select(WhiteboxTestTask).where(
            col(WhiteboxTestTask.status).in_(_RUNNING_STATUSES),
            WhiteboxTestTask.updated_at < cutoff,
        )
    ).all()
    for task in tasks:
        task.status = WhiteboxTaskStatus.timeout
        task.finished_at = now
        task.updated_at = now
        task.error_message = (
            f"白盒测试任务超过 {timeout_seconds} 秒没有进度更新，平台已自动标记为超时。"
        )
        agent = session.exec(
            select(WhiteboxAgent).where(WhiteboxAgent.current_task_id == task.id)
        ).first()
        if agent is not None:
            agent.current_task_id = None
            agent.status = WhiteboxAgentStatus.idle
            agent.updated_at = now
            session.add(agent)
        session.add(task)
    if tasks:
        session.commit()
    return len(tasks)


def _get_task_for_user(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> WhiteboxTestTask:
    task = session.get(WhiteboxTestTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Whitebox task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def _get_task_for_agent(
    *,
    session: SessionDep,
    agent: WhiteboxAgent,
    task_id: uuid.UUID,
) -> WhiteboxTestTask:
    task = session.get(WhiteboxTestTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Whitebox task not found")
    if task.agent_id != agent.id:
        raise HTTPException(status_code=403, detail="Task is not assigned to this agent")
    return task


@router.post("/whitebox-tasks", response_model=WhiteboxTaskPublic)
async def create_whitebox_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    source_url: str = Form(...),
    revision: str = Form(...),
    project_name: str | None = Form(default=None),
    test_config: str | None = Form(default=None),
    input_uploads: list[UploadFile] | None = File(default=None),
) -> Any:
    now = _utcnow()
    task = WhiteboxTestTask(
        user_id=current_user.id,
        project_name=project_name.strip() if project_name else _project_name_from_source_url(source_url),
        source_url=source_url.strip(),
        revision=revision.strip(),
        test_config=test_config.strip() if test_config else None,
        status=WhiteboxTaskStatus.queued,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    try:
        task.input_files = await whitebox_task_service.save_input_uploads(
            task.id,
            input_uploads or [],
        )
    except Exception:
        session.delete(task)
        session.commit()
        raise

    task.updated_at = _utcnow()
    session.add(task)
    session.commit()
    session.refresh(task)
    return _task_public(task, current_user)


@router.get("/whitebox-tasks", response_model=WhiteboxTasksPublic)
def read_whitebox_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    _expire_stale_running_tasks(session)
    filters = _task_scope_filters(current_user, scope)
    count_statement = (
        select(func.count())
        .select_from(WhiteboxTestTask)
        .join(User, WhiteboxTestTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(WhiteboxTestTask, User)
        .join(User, WhiteboxTestTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(WhiteboxTestTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return WhiteboxTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/whitebox-tasks/stats", response_model=WhiteboxTaskStatsPublic)
def read_whitebox_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = "mine",
) -> Any:
    _expire_stale_running_tasks(session)
    filters = _task_scope_filters(current_user, scope)
    rows = session.exec(
        select(WhiteboxTestTask.status, func.count())
        .where(*filters)
        .group_by(WhiteboxTestTask.status)
    ).all()
    by_status = dict.fromkeys(WhiteboxTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count
    return WhiteboxTaskStatsPublic(
        total=sum(by_status.values()),
        success=by_status[WhiteboxTaskStatus.success],
        running=sum(by_status[status] for status in _RUNNING_STATUSES),
        failed_or_error=sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES),
        queued=by_status[WhiteboxTaskStatus.queued],
        by_status=by_status,
    )


@router.get("/whitebox-tasks/{task_id}", response_model=WhiteboxTaskPublic)
def read_whitebox_task(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> Any:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    return _task_public(task)


@router.get("/whitebox-tasks/{task_id}/report")
def download_whitebox_task_report(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> FileResponse:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    if not task.result_files:
        raise HTTPException(status_code=404, detail="Whitebox report not found")
    report = task.result_files[0]
    report_path = Path(str(report["file_path"]))
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="Whitebox report not found")
    return FileResponse(
        report_path,
        media_type=str(report.get("content_type") or "application/octet-stream"),
        filename=str(report.get("file_name") or report_path.name),
    )


@router.delete("/whitebox-tasks/{task_id}")
def delete_whitebox_task(
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> dict[str, str]:
    task = _get_task_for_user(
        session=session,
        current_user=current_user,
        task_id=task_id,
    )
    try:
        whitebox_task_service.remove_task_files(task.id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete whitebox task files") from exc
    session.delete(task)
    session.commit()
    return {"message": "Whitebox task deleted"}


@router.get("/whitebox-agents", response_model=WhiteboxAgentsPublic)
def read_whitebox_agents(
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    agents = session.exec(
        select(WhiteboxAgent).order_by(col(WhiteboxAgent.updated_at).desc())
    ).all()
    return WhiteboxAgentsPublic(data=agents, count=len(agents))


@router.post("/whitebox-agents/heartbeat", response_model=WhiteboxAgentPublic)
def whitebox_agent_heartbeat(
    *,
    session: SessionDep,
    body: WhiteboxAgentHeartbeat,
    x_whitebox_agent_token: str | None = Header(default=None),
) -> Any:
    if not x_whitebox_agent_token or x_whitebox_agent_token != settings.WHITEBOX_AGENT_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid whitebox agent token")
    now = _utcnow()
    _expire_stale_running_tasks(session, now)
    agent = session.exec(
        select(WhiteboxAgent).where(WhiteboxAgent.machine_id == body.machine_id)
    ).first()
    if agent is None:
        agent = WhiteboxAgent(
            name=body.name.strip(),
            machine_id=body.machine_id.strip(),
            status=body.status,
            capabilities=body.capabilities,
            last_heartbeat_at=now,
            updated_at=now,
        )
    else:
        agent.name = body.name.strip()
        agent.status = body.status
        agent.capabilities = body.capabilities
        agent.last_heartbeat_at = now
        agent.updated_at = now
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


@router.post("/whitebox-agents/claim-task", response_model=WhiteboxTaskPublic | None)
def claim_whitebox_task(
    *,
    session: SessionDep,
    agent: WhiteboxAgent = None,  # type: ignore[assignment]
    x_whitebox_agent_token: str | None = Header(default=None),
) -> Any:
    agent = _authenticate_agent(session, x_whitebox_agent_token)
    _expire_stale_running_tasks(session)
    task = session.exec(
        select(WhiteboxTestTask)
        .where(WhiteboxTestTask.status == WhiteboxTaskStatus.queued)
        .order_by(col(WhiteboxTestTask.created_at))
    ).first()
    if task is None:
        agent.status = WhiteboxAgentStatus.idle
        agent.current_task_id = None
        agent.updated_at = _utcnow()
        session.add(agent)
        session.commit()
        return None

    now = _utcnow()
    task.status = WhiteboxTaskStatus.claimed
    task.agent_id = agent.id
    task.started_at = task.started_at or now
    task.updated_at = now
    agent.status = WhiteboxAgentStatus.busy
    agent.current_task_id = task.id
    agent.updated_at = now
    session.add(task)
    session.add(agent)
    session.commit()
    session.refresh(task)
    return _task_public(task)


@router.get("/whitebox-agent-tasks/{task_id}/input", response_model=WhiteboxTaskPublic)
def read_whitebox_agent_task_input(
    *,
    session: SessionDep,
    task_id: uuid.UUID,
    x_whitebox_agent_token: str | None = Header(default=None),
) -> Any:
    agent = _authenticate_agent(session, x_whitebox_agent_token)
    task = _get_task_for_agent(session=session, agent=agent, task_id=task_id)
    return _task_public(task)


@router.post("/whitebox-agent-tasks/{task_id}/status", response_model=WhiteboxTaskPublic)
def update_whitebox_agent_task_status(
    *,
    session: SessionDep,
    task_id: uuid.UUID,
    body: WhiteboxTaskStatusReport,
    x_whitebox_agent_token: str | None = Header(default=None),
) -> Any:
    agent = _authenticate_agent(session, x_whitebox_agent_token)
    task = _get_task_for_agent(session=session, agent=agent, task_id=task_id)
    task.status = body.status
    task.error_message = body.message
    task.updated_at = _utcnow()
    if body.status in {
        WhiteboxTaskStatus.success,
        WhiteboxTaskStatus.failed,
        WhiteboxTaskStatus.environment_error,
        WhiteboxTaskStatus.timeout,
        WhiteboxTaskStatus.cancelled,
    }:
        task.finished_at = task.updated_at
        agent.current_task_id = None
        agent.status = WhiteboxAgentStatus.idle
    session.add(task)
    session.add(agent)
    session.commit()
    session.refresh(task)
    return _task_public(task)


@router.post("/whitebox-agent-tasks/{task_id}/logs")
def append_whitebox_agent_task_log(
    *,
    session: SessionDep,
    task_id: uuid.UUID,
    body: WhiteboxTaskLogReport,
    x_whitebox_agent_token: str | None = Header(default=None),
) -> dict[str, str]:
    agent = _authenticate_agent(session, x_whitebox_agent_token)
    task = _get_task_for_agent(session=session, agent=agent, task_id=task_id)
    whitebox_task_service.append_log(task.id, body.message)
    task.updated_at = _utcnow()
    session.add(task)
    session.commit()
    return {"message": "Log appended"}


@router.post("/whitebox-agent-tasks/{task_id}/result", response_model=WhiteboxTaskPublic)
async def upload_whitebox_agent_task_result(
    *,
    session: SessionDep,
    task_id: uuid.UUID,
    status: WhiteboxTaskStatus = Form(...),
    summary: str | None = Form(default=None),
    report_uploads: list[UploadFile] | None = File(default=None),
    x_whitebox_agent_token: str | None = Header(default=None),
) -> Any:
    agent = _authenticate_agent(session, x_whitebox_agent_token)
    task = _get_task_for_agent(session=session, agent=agent, task_id=task_id)
    task.status = WhiteboxTaskStatus.uploading_report
    task.updated_at = _utcnow()
    session.add(task)
    session.commit()

    task.result_files = await whitebox_task_service.save_report_uploads(
        task.id,
        report_uploads or [],
    )
    task.status = status
    task.error_message = summary
    task.finished_at = _utcnow()
    task.updated_at = task.finished_at
    agent.current_task_id = None
    agent.status = WhiteboxAgentStatus.idle
    agent.updated_at = task.finished_at
    session.add(task)
    session.add(agent)
    session.commit()
    session.refresh(task)
    return _task_public(task)
