import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlmodel import col, func, select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_admin,
)
from app.models import SkillPackage, SkillPackagePublic, SkillPackagesPublic
from app.services import skill_service

router = APIRouter(prefix="/skills", tags=["skills"])


def _get_skill_or_404(session: SessionDep, skill_id: uuid.UUID) -> SkillPackage:
    skill = session.get(SkillPackage, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


def _get_active_skill_or_404(session: SessionDep) -> SkillPackage:
    skill = skill_service.get_active_skill(session)
    if skill is None:
        raise HTTPException(status_code=404, detail="No active skill is configured")
    return skill


@router.get(
    "",
    dependencies=[Depends(get_current_active_admin)],
    response_model=SkillPackagesPublic,
)
def read_skills(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    count_statement = select(func.count()).select_from(SkillPackage)
    count = session.exec(count_statement).one()
    statement = (
        select(SkillPackage)
        .order_by(col(SkillPackage.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    skills = session.exec(statement).all()
    return SkillPackagesPublic(
        data=[SkillPackagePublic.model_validate(skill) for skill in skills],
        count=count,
    )


@router.post(
    "",
    dependencies=[Depends(get_current_active_admin)],
    response_model=SkillPackagePublic,
)
async def upload_skill(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    name: str = Form(..., min_length=1, max_length=255),
    version: str = Form(..., min_length=1, max_length=128),
    description: str | None = Form(default=None, max_length=1024),
    activate: bool = Form(default=True),
    upload: UploadFile = File(...),
) -> Any:
    skill = SkillPackage(
        name=name,
        version=version,
        description=description,
        content_hash="",
        file_path="",
        is_active=False,
        created_by_user_id=current_user.id,
    )
    skill_path, content_hash = await skill_service.save_upload(skill.id, upload)
    skill.content_hash = content_hash
    skill.file_path = str(skill_path)

    session.add(skill)
    session.commit()
    session.refresh(skill)
    if activate:
        skill = skill_service.activate_skill(session, skill)
    return skill


@router.post(
    "/{skill_id}/activate",
    dependencies=[Depends(get_current_active_admin)],
    response_model=SkillPackagePublic,
)
def activate_skill(session: SessionDep, skill_id: uuid.UUID) -> Any:
    skill = _get_skill_or_404(session, skill_id)
    return skill_service.activate_skill(session, skill)


@router.get("/active", response_model=SkillPackagePublic)
def read_active_skill(session: SessionDep, current_user: CurrentUser) -> Any:
    return _get_active_skill_or_404(session)


@router.get("/active/download")
def download_active_skill(
    session: SessionDep, current_user: CurrentUser
) -> Response:
    skill = _get_active_skill_or_404(session)
    return Response(
        skill_service.read_skill_content(skill),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="skill.zip"'},
    )
