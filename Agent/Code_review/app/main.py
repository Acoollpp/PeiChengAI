from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.cleanup import cleanup_old_tasks
from app.codex_runner import CodexRunner
from app.config import Settings, settings
from app.database import TaskRepository
from app.models import TaskCreateRequest, TaskCreateResponse, TaskResponse, TaskStatus
from app.validation import normalize_revision, validate_svn_url
from app.worker import Worker, WorkerThread


logger = logging.getLogger(__name__)


def create_app(
    *,
    database_path: Path | str | None = None,
    reports_dir: Path | str | None = None,
    workspaces_dir: Path | str | None = None,
    start_worker: bool = True,
    prompt_template_path: Path | str | None = None,
    app_settings: Settings = settings,
) -> FastAPI:
    database_path = Path(database_path or app_settings.database_path).resolve()
    reports_dir = Path(reports_dir or app_settings.reports_dir).resolve()
    workspaces_dir = Path(workspaces_dir or app_settings.workspaces_dir).resolve()
    prompt_template_path = Path(prompt_template_path or app_settings.prompt_template_path).resolve()

    reports_dir.mkdir(parents=True, exist_ok=True)
    workspaces_dir.mkdir(parents=True, exist_ok=True)

    repo = TaskRepository(database_path)
    repo.init_schema()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        stale_cutoff = datetime.now(UTC) - timedelta(seconds=app_settings.codex_timeout_seconds)
        repo.fail_stale_running_tasks(
            stale_cutoff,
            "Task was marked failed because the worker restarted before it finished.",
        )
        cleanup_old_tasks(repo, workspaces_dir, app_settings.retention_days, reports_dir=reports_dir)
        worker_thread: WorkerThread | None = None
        if start_worker:
            prompt_template = prompt_template_path.read_text(encoding="utf-8")
            runner = CodexRunner(app_settings.codex_command, app_settings.codex_args)
            worker = Worker(
                repo=repo,
                runner=runner,
                prompt_template=prompt_template,
                workspaces_dir=workspaces_dir,
                timeout_seconds=app_settings.codex_timeout_seconds,
            )
            worker_thread = WorkerThread(worker, app_settings.worker_poll_seconds)
            worker_thread.start()
            app.state.worker_thread = worker_thread

        try:
            yield
        finally:
            if worker_thread is not None:
                if not worker_thread.stop():
                    logger.warning("Worker thread did not stop cleanly during shutdown")

    app = FastAPI(lifespan=lifespan)
    app.state.repo = repo
    app.state.reports_dir = reports_dir
    app.state.workspaces_dir = workspaces_dir
    static_dir = Path(__file__).resolve().parent.parent / "static"

    @app.post("/api/tasks", response_model=TaskCreateResponse)
    def create_task(request: TaskCreateRequest) -> TaskCreateResponse:
        try:
            svn_url = validate_svn_url(request.svn_url, app_settings.svn_allowed_prefix)
            old_revision = normalize_revision(request.old_revision)
            new_revision = normalize_revision(request.new_revision)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if old_revision == new_revision:
            raise HTTPException(status_code=400, detail="old_revision and new_revision must differ")

        task_id = str(uuid.uuid4())
        report_path = (reports_dir / f"{task_id}.md").resolve()
        task = repo.create_task(
            svn_url=svn_url,
            old_revision=old_revision,
            new_revision=new_revision,
            requester=request.requester,
            report_path=str(report_path),
            task_id=task_id,
        )
        return TaskCreateResponse(task_id=task["id"], status=task["status"])

    @app.get("/api/tasks", response_model=list[TaskResponse])
    def list_tasks() -> list[TaskResponse]:
        return [_to_task_response(task, reports_dir) for task in repo.list_tasks()]

    @app.get("/api/tasks/{task_id}", response_model=TaskResponse)
    def get_task(task_id: str) -> TaskResponse:
        task = _get_existing_task(repo, task_id)
        return _to_task_response(task, reports_dir)

    @app.get("/api/tasks/{task_id}/report")
    def get_report(task_id: str) -> PlainTextResponse:
        task = _get_existing_task(repo, task_id)
        report_path = _ready_report_path(task, reports_dir)
        return PlainTextResponse(
            report_path.read_text(encoding="utf-8"),
            media_type="text/markdown",
        )

    @app.get("/api/tasks/{task_id}/download")
    def download_report(task_id: str) -> FileResponse:
        task = _get_existing_task(repo, task_id)
        report_path = _ready_report_path(task, reports_dir)
        return FileResponse(
            report_path,
            media_type="text/markdown",
            filename=f"code-review-{task_id}.md",
        )

    @app.get("/")
    def serve_frontend() -> FileResponse:
        return FileResponse(static_dir / "index.html", media_type="text/html")

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    return app


def _get_existing_task(repo: TaskRepository, task_id: str) -> dict[str, Any]:
    task = repo.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _to_task_response(task: dict[str, Any], reports_root: Path) -> TaskResponse:
    report_path = _resolve_report_path(task, reports_root)
    return TaskResponse(
        task_id=task["id"],
        svn_url=task["svn_url"],
        old_revision=task["old_revision"],
        new_revision=task["new_revision"],
        requester=task["requester"] or "anonymous",
        status=task["status"],
        created_at=task["created_at"],
        started_at=task["started_at"],
        finished_at=task["finished_at"],
        error_message=task["error_message"],
        report_available=task["status"] == TaskStatus.success
        and report_path is not None
        and report_path.exists(),
    )


def _ready_report_path(task: dict[str, Any], reports_root: Path) -> Path:
    report_path = _resolve_report_path(task, reports_root)
    if report_path is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != TaskStatus.success or not report_path.exists():
        raise HTTPException(status_code=409, detail="Report is not available")
    return report_path


def _resolve_report_path(task: dict[str, Any], reports_root: Path) -> Path | None:
    reports_root = reports_root.resolve()
    report_path = Path(task["report_path"]).resolve()
    if report_path.is_relative_to(reports_root):
        return report_path

    migrated_report_path = (reports_root / f"{task['id']}.md").resolve()
    if migrated_report_path.exists():
        return migrated_report_path

    return None
