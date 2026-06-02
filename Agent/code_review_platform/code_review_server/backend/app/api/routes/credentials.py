from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.models import AuditLog, AuthSource, User
from app.services.credential_service import CredentialService
from app.services.user_merge_service import UserMergeService

router = APIRouter(prefix="/me", tags=["credentials"])


class SvnCredential(SQLModel):
    svn_username: str
    svn_password: str


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


@router.put("/svn-credential", response_model=SvnCredentialPublic)
def update_my_svn_credential(
    session: SessionDep, current_user: CurrentUser, body: SvnCredential
) -> Any:
    existing_user = session.exec(
        select(User).where(User.svn_username == body.svn_username)
    ).first()

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)

    if existing_user is not None and existing_user.id != current_user.id:
        if existing_user.auth_source != AuthSource.local:
            raise HTTPException(
                status_code=409, detail="SVN username is already bound"
            )

        existing_password = credential_service.get_svn_password(
            session, existing_user.id
        )
        if existing_password is None or existing_password != body.svn_password:
            raise HTTPException(
                status_code=403, detail="SVN credential verification failed"
            )

        UserMergeService.merge_svn_user_into_current_user(
            session,
            old_user=existing_user,
            current_user=current_user,
            svn_username=body.svn_username,
        )
    else:
        current_user.svn_username = body.svn_username
        session.add(current_user)
        session.commit()

    credential_service.save_svn_password(
        session, current_user.id, body.svn_password
    )

    return SvnCredentialPublic(
        svn_username=body.svn_username,
        svn_password=body.svn_password,
    )
