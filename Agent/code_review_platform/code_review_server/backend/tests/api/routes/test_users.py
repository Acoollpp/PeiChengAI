import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.api.routes import users as users_route
from app.core.config import settings
from app.core.db import DEFAULT_LOCAL_ADMIN_NAME
from app.models import (
    AuditLog,
    AuthSource,
    ClientRelease,
    Feedback,
    FeedbackScreenshot,
    ReviewTask,
    SkillPackage,
    User,
    UserCreate,
    UserRole,
    UserSvnCredential,
)
from tests.utils.user import create_random_user
from tests.utils.utils import auth_headers_for_user_id, random_lower_string


def _user_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "full_name": f"User {random_lower_string()}",
        "svn_username": f"svn-{random_lower_string()}",
        "role": "user",
        "is_active": True,
        "is_superuser": False,
    }
    payload.update(overrides)
    return payload


def test_get_users_superuser_me(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=superuser_token_headers)
    current_user = r.json()
    assert r.status_code == 200
    assert current_user["is_active"] is True
    assert current_user["is_superuser"]
    assert current_user["full_name"] == DEFAULT_LOCAL_ADMIN_NAME
    assert current_user["role"] == "admin"
    assert "email" not in current_user


def test_get_users_normal_user_me(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=normal_user_token_headers)
    current_user = r.json()
    assert r.status_code == 200
    assert current_user["is_active"] is True
    assert current_user["is_superuser"] is False
    assert current_user["role"] == "user"
    assert current_user["svn_username"]
    assert "email" not in current_user


def test_create_user_new_svn_username(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    data = _user_payload(full_name="Created User")

    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json=data,
    )

    assert r.status_code == 200
    created_user = r.json()
    user = crud.get_user_by_svn_username(
        session=db, svn_username=str(data["svn_username"])
    )
    assert user
    assert created_user["full_name"] == "Created User"
    assert created_user["svn_username"] == data["svn_username"]
    assert created_user["role"] == "user"
    assert created_user["is_active"] is True
    assert "email" not in created_user


def test_get_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)

    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
    )

    assert r.status_code == 200
    api_user = r.json()
    assert api_user["id"] == str(user.id)
    assert api_user["svn_username"] == user.svn_username


def test_get_non_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json() == {"detail": "User not found"}


def test_get_existing_user_current_user(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    headers = auth_headers_for_user_id(user.id)

    r = client.get(f"{settings.API_V1_STR}/users/{user.id}", headers=headers)

    assert r.status_code == 200
    api_user = r.json()
    assert api_user["id"] == str(user.id)
    assert api_user["svn_username"] == user.svn_username


def test_get_existing_user_permissions_error(
    db: Session,
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user = create_random_user(db)

    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {"detail": "The user doesn't have enough privileges"}


def test_get_non_existing_user_permissions_error(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user_id = uuid.uuid4()

    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {"detail": "The user doesn't have enough privileges"}


def test_create_user_existing_svn_username(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    data = _user_payload(svn_username=user.svn_username)

    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json=data,
    )

    assert r.status_code == 409
    assert r.json()["detail"] == "User with this SVN username already exists"


def test_create_user_by_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    data = _user_payload()
    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=normal_user_token_headers,
        json=data,
    )
    assert r.status_code == 403


def test_retrieve_users(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    crud.create_user(
        session=db,
        user_create=UserCreate(
            full_name="First User", svn_username=f"svn-{random_lower_string()}"
        ),
    )
    crud.create_user(
        session=db,
        user_create=UserCreate(
            full_name="Second User", svn_username=f"svn-{random_lower_string()}"
        ),
    )

    r = client.get(f"{settings.API_V1_STR}/users/", headers=superuser_token_headers)
    all_users = r.json()

    assert r.status_code == 200
    assert len(all_users["data"]) > 1
    assert "count" in all_users
    for item in all_users["data"]:
        assert "id" in item
        assert "full_name" in item
        assert "role" in item
        assert "is_active" in item
        assert "email" not in item


def test_retrieve_users_as_role_admin(client: TestClient, db: Session) -> None:
    admin = crud.create_user(
        session=db,
        user_create=UserCreate(
            full_name="Role Admin",
            svn_username=f"svn-{random_lower_string()}",
            role=UserRole.admin,
        ),
    )
    headers = auth_headers_for_user_id(admin.id)

    r = client.get(f"{settings.API_V1_STR}/users/", headers=headers)

    assert r.status_code == 200
    all_users = r.json()
    assert all_users["count"] >= 1
    assert any(user["id"] == str(admin.id) for user in all_users["data"])


def test_retrieve_users_searches_full_dataset(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    for index in range(105):
        crud.create_user(
            session=db,
            user_create=UserCreate(
                full_name=f"Paged User {index:03d}",
                svn_username=f"paged-{index:03d}-{random_lower_string()}",
            ),
        )
    target = User(
        full_name="全量搜索目标用户",
        svn_username="svn-zhang-shengke",
        auth_source=AuthSource.cch,
        cch_user_id=991010,
        role=UserRole.user,
        is_active=True,
    )
    db.add(target)
    db.commit()

    name_response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        params={"skip": 0, "limit": 10, "search": "全量搜索目标"},
    )
    cch_response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        params={"skip": 0, "limit": 10, "search": "991010"},
    )
    svn_response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        params={"skip": 0, "limit": 10, "search": "zhang-sheng"},
    )

    assert name_response.status_code == 200
    assert cch_response.status_code == 200
    assert svn_response.status_code == 200
    assert name_response.json()["count"] == 1
    assert any(user["id"] == str(target.id) for user in name_response.json()["data"])
    assert any(user["id"] == str(target.id) for user in cch_response.json()["data"])
    assert any(user["id"] == str(target.id) for user in svn_response.json()["data"])


def test_update_user_me(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    full_name = "Updated Name"
    data = {"full_name": full_name, "svn_username": f"ignored-{random_lower_string()}"}

    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=normal_user_token_headers,
        json=data,
    )

    assert r.status_code == 200
    updated_user = r.json()
    assert updated_user["full_name"] == full_name
    assert updated_user["svn_username"] != data["svn_username"]

    user_db = db.get(User, uuid.UUID(updated_user["id"]))
    assert user_db
    assert user_db.full_name == full_name
    assert user_db.svn_username != data["svn_username"]


def test_update_password_me_route_removed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"current_password": "old-password", "new_password": "new-password"}

    r = client.patch(
        f"{settings.API_V1_STR}/users/me/password",
        headers=superuser_token_headers,
        json=data,
    )

    assert r.status_code in {404, 405, 410}


def test_register_user_route_removed(client: TestClient) -> None:
    data = {
        "full_name": random_lower_string(),
        "svn_username": f"svn-{random_lower_string()}",
    }

    r = client.post(f"{settings.API_V1_STR}/users/signup", json=data)

    assert r.status_code in {404, 405, 410}


def test_update_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    new_svn_username = f"svn-{random_lower_string()}"
    data = {
        "full_name": "Updated_full_name",
        "svn_username": new_svn_username,
        "role": "admin",
    }

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )

    assert r.status_code == 200
    updated_user = r.json()
    assert updated_user["full_name"] == "Updated_full_name"
    assert updated_user["svn_username"] == new_svn_username
    assert updated_user["role"] == "admin"

    user_db = db.get(User, user.id)
    assert user_db
    db.refresh(user_db)
    assert user_db.full_name == "Updated_full_name"
    assert user_db.svn_username == new_svn_username
    assert user_db.role == UserRole.admin


def test_update_user_not_exists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"full_name": "Updated_full_name"}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "The user with this id does not exist in the system"


def test_update_user_svn_username_exists(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    other_user = create_random_user(db)
    data = {"svn_username": other_user.svn_username}

    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )

    assert r.status_code == 409
    assert r.json()["detail"] == "User with this SVN username already exists"


def test_delete_user_me(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    user_id = user.id
    headers = auth_headers_for_user_id(user.id)

    r = client.delete(f"{settings.API_V1_STR}/users/me", headers=headers)

    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.exec(select(User).where(User.id == user_id)).first()
    assert result is None


def test_delete_user_me_removes_feedback_screenshot_files(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "FEEDBACK_STORAGE_DIR", str(tmp_path))
    user = create_random_user(db)
    user_id = user.id
    credential = UserSvnCredential(
        user_id=user_id,
        encrypted_password="encrypted-password",
        encryption_version="v1",
    )
    task = ReviewTask(
        user_id=user_id,
        svn_url="svn://example.com/project",
        old_revision="1",
        new_revision="2",
    )
    audit_log = AuditLog(
        actor_user_id=user_id,
        action="delete-user-test",
        target_user_id=user_id,
        metadata_json={"source": "test"},
    )
    skill_package = SkillPackage(
        name=f"skill-{random_lower_string()}",
        version="1.0.0",
        content_hash=random_lower_string(),
        file_path="/tmp/skill.zip",
        created_by_user_id=user_id,
    )
    client_release = ClientRelease(
        version=f"1.0.{random_lower_string()}",
        platform="win32",
        arch="x64",
        artifact_name="app.exe",
        artifact_path="/tmp/app.exe",
        artifact_sha512=random_lower_string(),
        latest_yml_name="latest.yml",
        latest_yml_path="/tmp/latest.yml",
        created_by_user_id=user_id,
    )
    db.add(credential)
    db.add(task)
    db.add(audit_log)
    db.add(skill_package)
    db.add(client_release)
    db.commit()
    credential_id = credential.id
    task_id = task.id
    audit_log_id = audit_log.id
    skill_package_id = skill_package.id
    client_release_id = client_release.id
    headers = auth_headers_for_user_id(user_id)
    upload_response = client.post(
        f"{settings.API_V1_STR}/feedback",
        headers=headers,
        data={"description": "自删前提交的截图意见"},
        files={"screenshots": ("screen.png", b"png-bytes", "image/png")},
    )
    assert upload_response.status_code == 200
    feedback = upload_response.json()
    feedback_id = feedback["id"]
    screenshot_id = feedback["screenshots"][0]["id"]
    assert (tmp_path / feedback_id).is_dir()

    response = client.delete(f"{settings.API_V1_STR}/users/me", headers=headers)

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    assert not (tmp_path / feedback_id).exists()
    db.expire_all()
    assert db.get(User, user_id) is None
    assert db.get(Feedback, feedback_id) is None
    assert db.get(FeedbackScreenshot, screenshot_id) is None
    assert db.get(UserSvnCredential, credential_id) is None
    assert db.get(ReviewTask, task_id) is None
    saved_audit_log = db.get(AuditLog, audit_log_id)
    assert saved_audit_log
    assert saved_audit_log.actor_user_id is None
    assert saved_audit_log.target_user_id is None
    saved_skill_package = db.get(SkillPackage, skill_package_id)
    assert saved_skill_package
    assert saved_skill_package.created_by_user_id is None
    saved_client_release = db.get(ClientRelease, client_release_id)
    assert saved_client_release
    assert saved_client_release.created_by_user_id is None


def test_delete_user_me_ignores_feedback_file_cleanup_errors(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_random_user(db)
    user_id = user.id
    feedback = Feedback(user_id=user_id, description="清理文件失败仍删除用户")
    db.add(feedback)
    db.commit()
    feedback_id = feedback.id
    headers = auth_headers_for_user_id(user_id)

    def fail_remove_feedback_files(_feedback_id: uuid.UUID) -> None:
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(
        users_route.feedback_service,
        "remove_feedback_files",
        fail_remove_feedback_files,
    )

    response = client.delete(f"{settings.API_V1_STR}/users/me", headers=headers)

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    db.expire_all()
    assert db.get(User, user_id) is None
    assert db.get(Feedback, feedback_id) is None


def test_delete_user_me_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    response = r.json()
    assert response["detail"] == "Admins are not allowed to delete themselves"


def test_delete_user_super_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.exec(select(User).where(User.id == user_id)).first()
    assert result is None


def test_delete_user_with_feedback(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    feedback = Feedback(user_id=user_id, description="删除用户前提交的意见")
    db.add(feedback)
    db.commit()

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )

    assert r.status_code == 200
    assert r.json()["message"] == "User deleted successfully"
    assert db.exec(select(User).where(User.id == user_id)).first() is None
    assert db.exec(select(Feedback).where(Feedback.user_id == user_id)).first() is None


def test_delete_user_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "User not found"


def test_delete_user_current_super_user_error(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    super_user = db.exec(select(User).where(User.role == UserRole.admin)).first()
    assert super_user

    r = client.delete(
        f"{settings.API_V1_STR}/users/{super_user.id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Admins are not allowed to delete themselves"


def test_delete_user_current_role_admin_error(client: TestClient, db: Session) -> None:
    admin = create_random_user(db)
    admin.role = UserRole.admin
    admin.is_superuser = False
    db.add(admin)
    db.commit()
    headers = auth_headers_for_user_id(admin.id)

    r = client.delete(
        f"{settings.API_V1_STR}/users/{admin.id}",
        headers=headers,
    )

    assert r.status_code == 403
    assert r.json()["detail"] == "Admins are not allowed to delete themselves"


def test_delete_user_without_privileges(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "The user doesn't have enough privileges"


def test_private_created_admin_shape_is_user_compatible(db: Session) -> None:
    user = User(
        full_name="Private Admin",
        svn_username=f"svn-{random_lower_string()}",
        is_superuser=True,
        role=UserRole.admin,
        auth_source=AuthSource.local,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.role == UserRole.admin
