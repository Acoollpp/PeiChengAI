from fastapi import APIRouter

from app.api.routes import (
    bom_change_check_tasks,
    bom_electronic_edit_tasks,
    bom_spec_compare_tasks,
    cch_sync,
    client_releases,
    credentials,
    feedback,
    gpio_tasks,
    items,
    login,
    private,
    review_tasks,
    skills,
    users,
    utils,
    whitebox_tasks,
    wire_harness_compare_tasks,
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
api_router.include_router(skills.router)
api_router.include_router(client_releases.router)
api_router.include_router(feedback.router)
api_router.include_router(gpio_tasks.router)
api_router.include_router(whitebox_tasks.router)
api_router.include_router(bom_spec_compare_tasks.router)
api_router.include_router(bom_change_check_tasks.router)
api_router.include_router(bom_electronic_edit_tasks.router)
api_router.include_router(wire_harness_compare_tasks.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
