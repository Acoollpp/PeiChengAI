import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_current_active_admin
from app.models import (
    ClientRelease,
    ClientReleasePublic,
    ClientReleasesPublic,
    ClientUpdateCheckPublic,
    ClientUpdatePolicyPublic,
    ClientUpdatePolicyUpdate,
)
from app.services import client_release_service

router = APIRouter(tags=["client-releases"])
logger = logging.getLogger(__name__)


def _get_client_release_or_404(
    session: SessionDep, release_id: uuid.UUID
) -> ClientRelease:
    release = session.get(ClientRelease, release_id)
    if release is None:
        raise HTTPException(status_code=404, detail="Client release not found")
    return release


def _get_active_release_or_404(
    session: SessionDep, platform: str, arch: str
) -> ClientRelease:
    release = client_release_service.get_active_release(session, platform, arch)
    if release is None:
        raise HTTPException(
            status_code=404,
            detail="No active client release is configured",
        )
    return release


def _policy_public(
    session: SessionDep, platform: str, arch: str
) -> ClientUpdatePolicyPublic:
    active_release = client_release_service.get_active_release(session, platform, arch)
    policy = client_release_service.get_update_policy(session, platform, arch)
    minimum_release = (
        session.get(ClientRelease, policy.minimum_supported_release_id)
        if policy and policy.minimum_supported_release_id
        else None
    )
    return ClientUpdatePolicyPublic(
        platform=platform,
        arch=arch,
        active_release_id=active_release.id if active_release else None,
        active_version=active_release.version if active_release else None,
        minimum_supported_release_id=minimum_release.id if minimum_release else None,
        minimum_supported_version=minimum_release.version if minimum_release else None,
        updated_by_user_id=policy.updated_by_user_id if policy else None,
        updated_at=policy.updated_at if policy else None,
    )


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
    client_release_service.parse_semantic_version(version)
    if activate:
        pending_release = ClientRelease(
            version=version,
            platform=client_release_service.SUPPORTED_PLATFORM,
            arch=client_release_service.SUPPORTED_ARCH,
            artifact_name="",
            artifact_path="",
            artifact_sha512="",
            latest_yml_name=client_release_service.LATEST_YML_NAME,
            latest_yml_path="",
        )
        client_release_service.validate_release_activation(session, pending_release)
    release = ClientRelease(
        version=version,
        release_notes=release_notes,
        artifact_name="",
        artifact_path="",
        artifact_size=0,
        artifact_sha512="",
        latest_yml_name=client_release_service.LATEST_YML_NAME,
        latest_yml_path="",
        is_active=False,
        created_by_user_id=current_user.id,
    )
    saved = await client_release_service.save_upload(
        release_id=release.id,
        version=version,
        installer=installer,
        latest_yml=latest_yml,
        blockmap=blockmap,
    )
    release.artifact_name = saved.metadata.installer_name
    release.artifact_path = str(saved.release_path / saved.metadata.installer_name)
    release.artifact_size = saved.installer_size
    release.artifact_sha512 = saved.metadata.sha512
    release.latest_yml_name = client_release_service.LATEST_YML_NAME
    release.latest_yml_path = str(
        saved.release_path / client_release_service.LATEST_YML_NAME
    )
    release.blockmap_name = saved.blockmap_name
    release.blockmap_path = str(saved.blockmap_path) if saved.blockmap_path else None

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
    release = _get_client_release_or_404(session, release_id)
    return client_release_service.activate_release(session, release)


@router.get(
    "/client-update-policy/{platform}/{arch}",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ClientUpdatePolicyPublic,
)
def read_client_update_policy(
    session: SessionDep, platform: str, arch: str
) -> ClientUpdatePolicyPublic:
    return _policy_public(session, platform, arch)


@router.put(
    "/client-update-policy/{platform}/{arch}",
    dependencies=[Depends(get_current_active_admin)],
    response_model=ClientUpdatePolicyPublic,
)
def update_client_update_policy(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    platform: str,
    arch: str,
    policy_in: ClientUpdatePolicyUpdate,
) -> ClientUpdatePolicyPublic:
    try:
        client_release_service.set_minimum_supported_release(
            session=session,
            platform=platform,
            arch=arch,
            release_id=policy_in.minimum_supported_release_id,
            updated_by_user_id=current_user.id,
        )
    except HTTPException as error:
        logger.warning(
            "客户端最低支持版本更新失败 platform=%s arch=%s release_id=%s operator=%s status=%s detail=%s",
            platform,
            arch,
            policy_in.minimum_supported_release_id,
            current_user.id,
            error.status_code,
            error.detail,
        )
        raise
    return _policy_public(session, platform, arch)


@router.get(
    "/client-update-policy/{platform}/{arch}/check",
    response_model=ClientUpdateCheckPublic,
)
def check_client_update_policy(
    *,
    session: SessionDep,
    _current_user: CurrentUser,
    platform: str,
    arch: str,
    current_version: str,
) -> ClientUpdateCheckPublic:
    client_release_service.parse_semantic_version(current_version)
    policy = _policy_public(session, platform, arch)
    active_release = client_release_service.get_active_release(session, platform, arch)
    update_available = bool(
        active_release
        and client_release_service.compare_versions(
            current_version, active_release.version
        )
        < 0
    )
    update_required = bool(
        policy.minimum_supported_version
        and client_release_service.compare_versions(
            current_version, policy.minimum_supported_version
        )
        < 0
    )
    return ClientUpdateCheckPublic(
        **policy.model_dump(),
        current_version=current_version,
        update_available=update_available,
        update_required=update_required,
        release_notes=active_release.release_notes if active_release else None,
    )


@router.get("/client-updates/{platform}/{arch}/latest.yml")
def download_latest_yml(
    session: SessionDep, _current_user: CurrentUser, platform: str, arch: str
) -> FileResponse:
    release = _get_active_release_or_404(session, platform, arch)
    return _download_release_file(release, client_release_service.LATEST_YML_NAME)


@router.get("/client-updates/{platform}/{arch}/{filename}")
def download_release_file(
    session: SessionDep,
    _current_user: CurrentUser,
    platform: str,
    arch: str,
    filename: str,
) -> FileResponse:
    release = _get_active_release_or_404(session, platform, arch)
    return _download_release_file(release, filename)


def _download_release_file(release: ClientRelease, filename: str) -> FileResponse:
    file_path = client_release_service.resolve_release_file(release, filename)
    return FileResponse(
        path=file_path,
        filename=Path(filename).name,
        media_type="application/octet-stream",
    )
