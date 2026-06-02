import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.core.config import settings
from app.models import AuthSource, User, UserCreate, UserRole
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
    assert current_user["full_name"] == settings.FIRST_SUPERUSER
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


def test_delete_user_me_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    response = r.json()
    assert response["detail"] == "Super users are not allowed to delete themselves"


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
    super_user = db.exec(select(User).where(User.is_superuser == True)).first()
    assert super_user

    r = client.delete(
        f"{settings.API_V1_STR}/users/{super_user.id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Super users are not allowed to delete themselves"


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
