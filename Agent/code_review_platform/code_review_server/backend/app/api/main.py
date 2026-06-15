from fastapi import APIRouter

from app.api.routes import (
    cch_sync,
    client_releases,
    credentials,
    departments,
    feedback,
    items,
    login,
    private,
    review_tasks,
    skills,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(review_tasks.router)
api_router.include_router(credentials.router)
api_router.include_router(cch_sync.router)
api_router.include_router(departments.router)
api_router.include_router(skills.router)
api_router.include_router(client_releases.router)
api_router.include_router(feedback.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
