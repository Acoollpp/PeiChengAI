import uuid
from pathlib import Path
from typing import TypedDict

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
    Department,
    Feedback,
    FeedbackScreenshot,
    ReviewFocusDirection,
    ReviewFocusDirectionUsageState,
    ReviewTask,
    ReviewTaskRequirementFile,
    SkillPackage,
    User,
    UserCreate,
    UserRole,
    UserSvnCredential,
)
from tests.utils.user import (
    authentication_token_from_key,
    create_key_user,
    create_random_user,
)
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


def _create_department(db: Session, name: str | None = None) -> Department:
    department = Department(name=name or f"部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


class DepartmentAdminContext(TypedDict):
    user: User
    headers: dict[str, str]


def _create_department_admin(
    *,
    client: TestClient,
    db: Session,
    department: Department | None,
) -> DepartmentAdminContext:
    user, api_key = create_key_user(db)
    user.role = UserRole.department_admin
    user.is_superuser = False
    user.department_id = department.id if department else None
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "user": user,
        "headers": authentication_token_from_key(client=client, key=api_key.key, db=db),
    }


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


def test_admin_can_create_user_with_department(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    department = _create_department(db, "研发部门")
    data = _user_payload(
        full_name="Department User",
        department_id=str(department.id),
    )

    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json=data,
    )

    assert response.status_code == 200
    created_user = response.json()
    assert created_user["department_id"] == str(department.id)
    assert created_user["department_name"] == "研发部门"


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


def test_get_non_existing_user_returns_not_found_before_permissions(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user_id = uuid.uuid4()

    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 404
    assert r.json() == {"detail": "User not found"}


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


def test_department_admin_lists_only_own_department_users(
    client: TestClient,
    db: Session,
) -> None:
    department_a = Department(name=f"部门A-{random_lower_string()}")
    department_b = Department(name=f"部门B-{random_lower_string()}")
    db.add(department_a)
    db.add(department_b)
    db.commit()
    db.refresh(department_a)
    db.refresh(department_b)
    admin_context = _create_department_admin(client=client, db=db, department=department_a)
    user_a, _ = create_key_user(db)
    user_a.department_id = department_a.id
    user_b, _ = create_key_user(db)
    user_b.department_id = department_b.id
    db.add(user_a)
    db.add(user_b)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
    )

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["data"]}
    assert str(user_a.id) in ids
    assert str(admin_context["user"].id) in ids
    assert str(user_b.id) not in ids


def test_department_admin_user_list_requires_department(
    client: TestClient,
    db: Session,
) -> None:
    admin_context = _create_department_admin(client=client, db=db, department=None)

    response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "当前账号未绑定部门，请联系超级管理员。"


def test_department_admin_can_read_same_department_user(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_context = _create_department_admin(client=client, db=db, department=department)
    user, _ = create_key_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)


def test_department_admin_cannot_read_other_department_user(
    client: TestClient,
    db: Session,
) -> None:
    department_a = Department(name=f"部门A-{random_lower_string()}")
    department_b = Department(name=f"部门B-{random_lower_string()}")
    db.add(department_a)
    db.add(department_b)
    db.commit()
    db.refresh(department_a)
    db.refresh(department_b)
    admin_context = _create_department_admin(client=client, db=db, department=department_a)
    user, _ = create_key_user(db)
    user.department_id = department_b.id
    db.add(user)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "没有足够权限"


def test_department_admin_cannot_create_update_or_delete_users(
    client: TestClient,
    db: Session,
) -> None:
    department = Department(name=f"部门-{random_lower_string()}")
    db.add(department)
    db.commit()
    db.refresh(department)
    admin_context = _create_department_admin(client=client, db=db, department=department)
    user, _ = create_key_user(db)

    create_response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=admin_context["headers"],
        json={"svn_username": f"svn-{random_lower_string()}", "role": "user"},
    )
    update_response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
        json={"full_name": "不允许修改"},
    )
    delete_response = client.delete(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=admin_context["headers"],
    )

    assert create_response.status_code == 403
    assert update_response.status_code == 403
    assert delete_response.status_code == 403


def test_create_department_admin_requires_department(
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={
            "svn_username": f"svn-{random_lower_string()}",
            "role": "department_admin",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门管理员必须绑定部门。"


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


def test_admin_update_user_department_is_visible_in_read_and_list(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    department = _create_department(db, "质量部门")
    user = create_random_user(db)

    update_response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"department_id": str(department.id)},
    )

    assert update_response.status_code == 200
    updated_user = update_response.json()
    assert updated_user["department_id"] == str(department.id)
    assert updated_user["department_name"] == "质量部门"

    read_response = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
    )
    assert read_response.status_code == 200
    read_user = read_response.json()
    assert read_user["department_id"] == str(department.id)
    assert read_user["department_name"] == "质量部门"

    list_response = client.get(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
    )
    assert list_response.status_code == 200
    listed_user = next(
        item for item in list_response.json()["data"] if item["id"] == str(user.id)
    )
    assert listed_user["department_id"] == str(department.id)
    assert listed_user["department_name"] == "质量部门"


def test_admin_update_user_omitted_department_keeps_existing_department(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    department = _create_department(db, "保留部门")
    user = create_random_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"full_name": "仅更新名称"},
    )

    assert response.status_code == 200
    updated_user = response.json()
    assert updated_user["full_name"] == "仅更新名称"
    assert updated_user["department_id"] == str(department.id)
    assert updated_user["department_name"] == "保留部门"


def test_admin_update_user_null_department_clears_department(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    department = _create_department(db, "待清空部门")
    user = create_random_user(db)
    user.department_id = department.id
    db.add(user)
    db.commit()

    response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"department_id": None},
    )

    assert response.status_code == 200
    updated_user = response.json()
    assert updated_user["department_id"] is None
    assert updated_user["department_name"] is None
    db.expire_all()
    saved_user = db.get(User, user.id)
    assert saved_user
    assert saved_user.department_id is None


def test_create_user_with_missing_department_returns_400(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = _user_payload(department_id=str(uuid.uuid4()))

    response = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json=data,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门不存在"


def test_update_user_with_missing_department_returns_400(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    user = create_random_user(db)

    response = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json={"department_id": str(uuid.uuid4())},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门不存在"


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


def test_current_user_can_set_department_once(
    client: TestClient, db: Session
) -> None:
    department = _create_department(db, "首次选择部门")
    user = create_random_user(db)
    user.department_id = None
    db.add(user)
    db.commit()
    headers = auth_headers_for_user_id(user.id)

    response = client.patch(
        f"{settings.API_V1_STR}/users/me/department",
        headers=headers,
        json={"department_id": str(department.id)},
    )

    assert response.status_code == 200
    content = response.json()
    assert content["department_id"] == str(department.id)
    assert content["department_name"] == "首次选择部门"
    db.expire_all()
    saved_user = db.get(User, user.id)
    assert saved_user
    assert saved_user.department_id == department.id


def test_current_user_cannot_set_department_again(
    client: TestClient, db: Session
) -> None:
    original_department = _create_department(db, "原部门")
    target_department = _create_department(db, "目标部门")
    user = create_random_user(db)
    user.department_id = original_department.id
    db.add(user)
    db.commit()
    headers = auth_headers_for_user_id(user.id)

    response = client.patch(
        f"{settings.API_V1_STR}/users/me/department",
        headers=headers,
        json={"department_id": str(target_department.id)},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "当前账号已绑定部门，请联系管理员修改。"
    db.expire_all()
    saved_user = db.get(User, user.id)
    assert saved_user
    assert saved_user.department_id == original_department.id


def test_current_user_cannot_set_inactive_department(
    client: TestClient, db: Session
) -> None:
    department = _create_department(db, "停用不可选部门")
    department.is_active = False
    user = create_random_user(db)
    user.department_id = None
    db.add(department)
    db.add(user)
    db.commit()
    headers = auth_headers_for_user_id(user.id)

    response = client.patch(
        f"{settings.API_V1_STR}/users/me/department",
        headers=headers,
        json={"department_id": str(department.id)},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门不存在或已停用。"


def test_current_user_cannot_set_missing_department(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    user.department_id = None
    db.add(user)
    db.commit()
    headers = auth_headers_for_user_id(user.id)

    response = client.patch(
        f"{settings.API_V1_STR}/users/me/department",
        headers=headers,
        json={"department_id": str(uuid.uuid4())},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "部门不存在或已停用。"


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


def test_delete_user_nulls_created_review_focus_direction_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    direction = ReviewFocusDirection(
        title="删除用户时保留方向",
        content="方向创建人应置空",
        created_by_user_id=user_id,
    )
    db.add(direction)
    db.commit()
    direction_id = direction.id

    response = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    db.expire_all()
    saved_direction = db.get(ReviewFocusDirection, direction_id)
    assert saved_direction
    assert saved_direction.created_by_user_id is None


def test_delete_user_nulls_review_focus_direction_usage_state_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    usage_state = ReviewFocusDirectionUsageState(
        normalized_content="删除管理员时保留统计状态",
        is_used=True,
        updated_by_user_id=user_id,
    )
    db.add(usage_state)
    db.commit()
    usage_state_id = usage_state.id

    response = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    db.expire_all()
    saved_usage_state = db.get(ReviewFocusDirectionUsageState, usage_state_id)
    assert saved_usage_state
    assert saved_usage_state.updated_by_user_id is None


def test_delete_user_removes_review_task_requirement_files(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    task = ReviewTask(
        user_id=user_id,
        svn_url="svn://example.com/project",
        old_revision="10",
        new_revision="11",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    requirement_file = ReviewTaskRequirementFile(
        task_id=task.id,
        file_name="requirement.md",
        file_path="/tmp/requirement.md",
        content_type="text/markdown",
        file_size=128,
        sha256="a" * 64,
    )
    db.add(requirement_file)
    db.commit()
    task_id = task.id
    requirement_file_id = requirement_file.id

    response = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "User deleted successfully"
    db.expire_all()
    assert db.get(User, user_id) is None
    assert db.get(ReviewTask, task_id) is None
    assert db.get(ReviewTaskRequirementFile, requirement_file_id) is None


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
