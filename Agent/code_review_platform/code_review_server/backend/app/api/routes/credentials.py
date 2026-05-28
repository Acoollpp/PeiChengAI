from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models import AuditLog
from app.services.credential_service import CredentialService

router = APIRouter(prefix="/me", tags=["credentials"])


class SvnCredentialPublic(SQLModel):
    svn_username: str
    svn_password: str


@router.get("/svn-credential", response_model=SvnCredentialPublic)
def read_my_svn_credential(
    session: SessionDep, current_user: CurrentUser
) -> Any:
    if current_user.svn_username is None:
        raise HTTPException(status_code=404, detail="SVN credential not found")

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    svn_password = credential_service.get_svn_password(session, current_user.id)
    if svn_password is None:
        raise HTTPException(status_code=404, detail="SVN credential not found")

    session.add(
        AuditLog(
            actor_user_id=current_user.id,
            action="svn_credential_retrieved",
            target_user_id=current_user.id,
            metadata_json={"svn_username": current_user.svn_username},
        )
    )
    session.commit()

    return SvnCredentialPublic(
        svn_username=current_user.svn_username,
        svn_password=svn_password,
    )
