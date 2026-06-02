from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import SQLModel

from app.api.deps import SessionDep, get_current_active_admin
from app.core.config import settings
from app.models import User
from app.services.cch_sync_service import CchSyncService

router = APIRouter(prefix="/admin/cch-sync", tags=["cch-sync"])


class CchSyncResultPublic(SQLModel):
    created: int
    updated: int
    disabled: int
    skipped_records: int
    errors: list[str]
    started_at: datetime
    finished_at: datetime | None = None


@router.post("/users", response_model=CchSyncResultPublic)
def sync_cch_users(
    session: SessionDep,
    current_user: User = Depends(get_current_active_admin),
) -> CchSyncResultPublic:
    if settings.CCH_DATABASE_URL is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CCH database is not configured",
        )

    result = CchSyncService().sync_from_database(
        session, str(settings.CCH_DATABASE_URL), current_user.id
    )
    return CchSyncResultPublic.model_validate(result)
