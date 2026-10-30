import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, has_admin_privileges
from app.models import (
    GpioGenerationTask,
    GpioTaskPublic,
    GpioTaskStatsPublic,
    GpioTaskUserStatsPublic,
    GpioTasksPublic,
    GpioTaskStatus,
    User,
)
from app.core.config import settings
from app.services import gpio_task_service
from app.services.credential_service import CredentialService

router = APIRouter(prefix="/gpio-tasks", tags=["gpio-tasks"])

_RUNNING_STATUSES = {
    GpioTaskStatus.uploaded,
    GpioTaskStatus.analyzing,
    GpioTaskStatus.exporting_svn,
    GpioTaskStatus.running_codex,
    GpioTaskStatus.needs_confirmation,
}

_FAILED_OR_ERROR_STATUSES = {GpioTaskStatus.failed}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_task_for_user(
    *, session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> GpioGenerationTask:
    task = session.get(GpioGenerationTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="GPIO task not found")
    if not has_admin_privileges(current_user) and task.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return task


def _task_public(
    task: GpioGenerationTask, user: User | None = None
) -> GpioTaskPublic:
    return GpioTaskPublic.model_validate(
        task,
        update={
            "user_name": user.full_name if user else None,
            "svn_username": user.svn_username if user else None,
        },
    )


def _load_svn_password(*, session: SessionDep, current_user: CurrentUser) -> str:
    if not current_user.svn_username:
        raise HTTPException(status_code=400, detail="Bind SVN credential before generation")

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    svn_password = credential_service.get_svn_password(session, current_user.id)
    if svn_password is None:
        raise HTTPException(status_code=400, detail="Bind SVN credential before generation")
    return svn_password


def _task_scope_filters(current_user: CurrentUser, scope: str = "mine") -> list[Any]:
    if scope == "all":
        if not has_admin_privileges(current_user):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return []
    if scope != "mine":
        raise HTTPException(status_code=400, detail="Unsupported task scope")
    return [GpioGenerationTask.user_id == current_user.id]


@router.post("", response_model=GpioTaskPublic)
async def create_gpio_task(
    *,
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
    code_svn_url: str = Form(...),
    code_revision: str = Form(...),
    manual_uploads: list[UploadFile] | None = File(default=None),
) -> Any:
    svn_password = _load_svn_password(session=session, current_user=current_user)
    try:
        normalized_revision = gpio_task_service.normalize_revision(code_revision)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now = _utcnow()
    task = GpioGenerationTask(
        user_id=current_user.id,
        project_no="",
        chip_model="",
        package_name=None,
        code_svn_url=code_svn_url.strip(),
        code_revision=normalized_revision,
        status=GpioTaskStatus.analyzing,
        started_at=now,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    try:
        uploads = manual_uploads or []
        if not uploads:
            form = await request.form()
            legacy_upload = form.get("manual_upload")
            if hasattr(legacy_upload, "filename") and hasattr(legacy_upload, "read"):
                uploads = [legacy_upload]
        manual_files = await gpio_task_service.save_manual_uploads(task.id, uploads)
        primary_manual_file = manual_files[0]
        task.manual_file_path = str(primary_manual_file["file_path"])
        task.manual_file_name = str(primary_manual_file["file_name"])
        task.uploaded_files = manual_files
        task.status = GpioTaskStatus.exporting_svn
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        source_dir = gpio_task_service.export_svn_sources(
            task.id,
            code_svn_url=task.code_svn_url,
            code_revision=task.code_revision,
            svn_username=current_user.svn_username,
            svn_password=svn_password,
        )
        task.svn_export_path = str(source_dir)
        task.status = GpioTaskStatus.running_codex
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        path, recognition_summary = gpio_task_service.generate_workbook_with_codex(
            task.id,
            uploaded_files=task.uploaded_files,
            source_dir=source_dir,
            code_svn_url=task.code_svn_url,
            code_revision=task.code_revision,
            project_no=task.project_no,
            chip_model=task.chip_model,
            package_name=task.package_name,
        )
    except Exception as exc:
        task.status = GpioTaskStatus.failed
        task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        session.refresh(task)
        raise HTTPException(status_code=500, detail=task.error_message) from exc

    finished_at = _utcnow()
    task.status = GpioTaskStatus.success
    task.project_no = str(recognition_summary.get("project") or task.project_no or "")
    task.chip_model = str(recognition_summary.get("chip") or task.chip_model or "")
    task.package_name = (
        str(recognition_summary["package"]) if recognition_summary.get("package") else task.package_name
    )
    task.result_path = str(path)
    task.result_name = gpio_task_service.RESULT_FILE_NAME
    task.svn_export_path = recognition_summary.get("svn_export_path")
    task.recognition_summary = recognition_summary
    task.error_message = None
    task.finished_at = finished_at
    task.updated_at = finished_at
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("", response_model=GpioTasksPublic)
def read_gpio_tasks(
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)

    count_statement = (
        select(func.count())
        .select_from(GpioGenerationTask)
        .join(User, GpioGenerationTask.user_id == User.id)
        .where(*filters)
    )
    statement = (
        select(GpioGenerationTask, User)
        .join(User, GpioGenerationTask.user_id == User.id)
        .where(*filters)
    )
    count = session.exec(count_statement).one()
    rows = session.exec(
        statement.order_by(col(GpioGenerationTask.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return GpioTasksPublic(
        data=[_task_public(task, user) for task, user in rows],
        count=count,
    )


@router.get("/stats", response_model=GpioTaskStatsPublic)
def read_gpio_task_stats(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = "mine",
) -> Any:
    filters = _task_scope_filters(current_user, scope)
    statement = (
        select(GpioGenerationTask.status, func.count())
        .where(*filters)
        .group_by(GpioGenerationTask.status)
    )
    rows = session.exec(statement).all()
    by_status = dict.fromkeys(GpioTaskStatus, 0)
    for status, count in rows:
        by_status[status] = count

    workbooks_by_user: list[GpioTaskUserStatsPublic] = []
    if has_admin_privileges(current_user):
        workbook_count = func.count(GpioGenerationTask.id)
        user_rows = session.exec(
            select(User.full_name, User.svn_username, workbook_count)
            .join(User, GpioGenerationTask.user_id == User.id)
            .where(*filters, GpioGenerationTask.result_path.is_not(None))
            .group_by(User.id, User.full_name, User.svn_username)
            .order_by(workbook_count.desc(), User.full_name)
        ).all()
        workbooks_by_user = [
            GpioTaskUserStatsPublic(
                user_name=user_name,
                svn_username=svn_username,
                workbook_count=count,
            )
            for user_name, svn_username, count in user_rows
        ]

    return GpioTaskStatsPublic(
        total=sum(by_status.values()),
        success=by_status[GpioTaskStatus.success],
        running=sum(by_status[status] for status in _RUNNING_STATUSES),
        failed_or_error=sum(by_status[status] for status in _FAILED_OR_ERROR_STATUSES),
        by_status=by_status,
        workbooks_by_user=workbooks_by_user,
    )


@router.get("/{task_id}", response_model=GpioTaskPublic)
def read_gpio_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> Any:
    return _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )


@router.post("/{task_id}/generate", response_model=GpioTaskPublic)
def generate_gpio_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
) -> Any:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    if task.status == GpioTaskStatus.success and task.result_path:
        return task
    if task.status == GpioTaskStatus.failed:
        raise HTTPException(status_code=400, detail="Create a new task to regenerate from SVN")
    svn_password = _load_svn_password(session=session, current_user=current_user)

    now = _utcnow()
    task.status = GpioTaskStatus.exporting_svn
    task.started_at = task.started_at or now
    task.updated_at = now
    session.add(task)
    session.commit()

    try:
        source_dir = gpio_task_service.export_svn_sources(
            task.id,
            code_svn_url=task.code_svn_url,
            code_revision=task.code_revision,
            svn_username=current_user.svn_username or "",
            svn_password=svn_password,
        )
        task.svn_export_path = str(source_dir)
        task.status = GpioTaskStatus.running_codex
        task.updated_at = _utcnow()
        session.add(task)
        session.commit()
        session.refresh(task)
        path, recognition_summary = gpio_task_service.generate_workbook_with_codex(
            task.id,
            uploaded_files=task.uploaded_files,
            source_dir=source_dir,
            code_svn_url=task.code_svn_url,
            code_revision=task.code_revision,
            project_no=task.project_no,
            chip_model=task.chip_model,
            package_name=task.package_name,
        )
    except Exception as exc:
        task.status = GpioTaskStatus.failed
        task.error_message = str(exc)
        task.finished_at = _utcnow()
        task.updated_at = task.finished_at
        session.add(task)
        session.commit()
        raise HTTPException(status_code=500, detail=task.error_message) from exc

    finished_at = _utcnow()
    task.status = GpioTaskStatus.success
    task.project_no = str(recognition_summary.get("project") or task.project_no or "")
    task.chip_model = str(recognition_summary.get("chip") or task.chip_model or "")
    task.package_name = (
        str(recognition_summary["package"]) if recognition_summary.get("package") else task.package_name
    )
    task.result_path = str(path)
    task.result_name = gpio_task_service.RESULT_FILE_NAME
    task.svn_export_path = recognition_summary.get("svn_export_path")
    task.recognition_summary = recognition_summary
    task.error_message = None
    task.finished_at = finished_at
    task.updated_at = finished_at
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("/{task_id}/download")
def download_gpio_task_result(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> FileResponse:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    result_path = Path(task.result_path) if task.result_path else None
    if not result_path or not result_path.is_file():
        raise HTTPException(status_code=404, detail="GPIO result not found")
    return FileResponse(
        result_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=task.result_name or gpio_task_service.RESULT_FILE_NAME,
    )


@router.delete("/{task_id}")
def delete_gpio_task(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> dict[str, str]:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    try:
        gpio_task_service.remove_task_files(task.id)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to delete GPIO task files") from exc

    session.delete(task)
    session.commit()
    return {"message": "GPIO task deleted"}
