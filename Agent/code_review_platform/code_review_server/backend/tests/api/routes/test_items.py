import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import UserRole
from tests.utils.item import create_random_item
from tests.utils.user import authentication_token_from_key, create_key_user


def test_create_item(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"title": "Foo", "description": "Fighters"}
    response = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["title"] == data["title"]
    assert content["description"] == data["description"]
    assert "id" in content
    assert "owner_id" in content


def test_read_item(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    response = client.get(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["title"] == item.title
    assert content["description"] == item.description
    assert content["id"] == str(item.id)
    assert content["owner_id"] == str(item.owner_id)


def test_read_item_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/items/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404
    content = response.json()
    assert content["detail"] == "Item not found"


def test_read_item_not_enough_permissions(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    response = client.get(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
    content = response.json()
    assert content["detail"] == "Not enough permissions"


def test_read_items(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    create_random_item(db)
    create_random_item(db)
    response = client.get(
        f"{settings.API_V1_STR}/items/",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert len(content["data"]) >= 2


def test_role_admin_can_read_all_items(
    client: TestClient, db: Session
) -> None:
    first_item = create_random_item(db)
    second_item = create_random_item(db)
    admin, api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()

    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    response = client.get(
        f"{settings.API_V1_STR}/items/",
        headers=headers,
    )

    assert response.status_code == 200
    content = response.json()
    item_ids = {item["id"] for item in content["data"]}
    assert str(first_item.id) in item_ids
    assert str(second_item.id) in item_ids


def test_role_admin_can_manage_other_users_item(
    client: TestClient, db: Session
) -> None:
    item = create_random_item(db)
    admin, api_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["id"] == str(item.id)
    assert content["owner_id"] == str(item.owner_id)

    data = {"title": "Role admin title", "description": "Role admin description"}
    response = client.put(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=headers,
        json=data,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["title"] == data["title"]
    assert content["description"] == data["description"]
    assert content["id"] == str(item.id)
    assert content["owner_id"] == str(item.owner_id)

    response = client.delete(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["message"] == "Item deleted successfully"


def test_superuser_flag_without_admin_role_cannot_read_all_items(
    client: TestClient, db: Session
) -> None:
    item = create_random_item(db)
    user, api_key = create_key_user(db)
    user.is_superuser = True
    user.role = UserRole.user
    db.add(user)
    db.commit()

    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    response = client.get(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=headers,
    )

    assert response.status_code == 403


def test_update_item(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    data = {"title": "Updated title", "description": "Updated description"}
    response = client.put(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["title"] == data["title"]
    assert content["description"] == data["description"]
    assert content["id"] == str(item.id)
    assert content["owner_id"] == str(item.owner_id)


def test_update_item_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"title": "Updated title", "description": "Updated description"}
    response = client.put(
        f"{settings.API_V1_STR}/items/{uuid.uuid4()}",
        headers=superuser_token_headers,
        json=data,
    )
    assert response.status_code == 404
    content = response.json()
    assert content["detail"] == "Item not found"


def test_update_item_not_enough_permissions(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    data = {"title": "Updated title", "description": "Updated description"}
    response = client.put(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=normal_user_token_headers,
        json=data,
    )
    assert response.status_code == 403
    content = response.json()
    assert content["detail"] == "Not enough permissions"


def test_delete_item(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    response = client.delete(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["message"] == "Item deleted successfully"


def test_delete_item_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.delete(
        f"{settings.API_V1_STR}/items/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404
    content = response.json()
    assert content["detail"] == "Item not found"


def test_delete_item_not_enough_permissions(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    item = create_random_item(db)
    response = client.delete(
        f"{settings.API_V1_STR}/items/{item.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 403
    content = response.json()
    assert content["detail"] == "Not enough permissions"
