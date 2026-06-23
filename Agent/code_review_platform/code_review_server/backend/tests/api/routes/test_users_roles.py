from fastapi import HTTPException

from app.api.deps import (
    ensure_department_admin_has_department,
    has_admin_privileges,
    has_department_admin_privileges,
    has_management_privileges,
    has_platform_admin_privileges,
)
from app.models import ReviewTask, ReviewTaskStatus, User, UserPublic, UserRole


def test_user_has_svn_username_and_role() -> None:
    user = User(svn_username="svn-reviewer")

    assert user.svn_username == "svn-reviewer"
    assert user.role == UserRole.user


def test_review_task_defaults_to_created() -> None:
    task = ReviewTask(
        user_id=User().id,
        svn_url="https://svn.example.com/project/trunk",
        old_revision="100",
        new_revision="101",
    )

    assert task.status == ReviewTaskStatus.created


def test_user_public_exposes_management_identity_fields() -> None:
    assert "svn_username" in UserPublic.model_fields
    assert "role" in UserPublic.model_fields


def test_department_admin_role_exists_and_is_not_platform_admin() -> None:
    user = User(role=UserRole.department_admin)

    assert user.role == UserRole.department_admin
    assert has_platform_admin_privileges(user) is False
    assert has_admin_privileges(user) is False


def test_department_admin_requires_department_for_department_privileges() -> None:
    user = User(role=UserRole.department_admin, department_id=None)

    assert has_department_admin_privileges(user) is False
    assert has_management_privileges(user) is True


def test_department_admin_with_department_has_department_privileges() -> None:
    user = User(role=UserRole.department_admin)

    assert user.department_id is not None
    assert has_department_admin_privileges(user) is True
    assert has_management_privileges(user) is True


def test_ensure_department_admin_has_department_rejects_unbound_admin() -> None:
    user = User(role=UserRole.department_admin, department_id=None)

    try:
        ensure_department_admin_has_department(user)
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "当前账号未绑定部门，请联系超级管理员。"
    else:
        raise AssertionError("Expected HTTPException")
