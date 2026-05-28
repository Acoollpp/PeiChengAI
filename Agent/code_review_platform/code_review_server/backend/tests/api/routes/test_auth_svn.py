from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import random_lower_string


def _svn_register_payload() -> dict[str, str]:
    svn_username = f"svn-{random_lower_string()}"
    return {
        "full_name": "SVN User",
        "svn_username": svn_username,
        "svn_password": random_lower_string(),
    }


def test_svn_register_returns_access_and_refresh_tokens(client: TestClient) -> None:
    payload = _svn_register_payload()

    r = client.post(f"{settings.API_V1_STR}/auth/register", json=payload)

    assert r.status_code == 200
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_svn_login_returns_access_token(client: TestClient) -> None:
    payload = _svn_register_payload()
    client.post(f"{settings.API_V1_STR}/auth/register", json=payload)

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "svn_username": payload["svn_username"],
            "svn_password": payload["svn_password"],
        },
    )

    assert r.status_code == 200
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_svn_login_with_wrong_password_returns_401(client: TestClient) -> None:
    payload = _svn_register_payload()
    client.post(f"{settings.API_V1_STR}/auth/register", json=payload)

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "svn_username": payload["svn_username"],
            "svn_password": "wrong-password",
        },
    )

    assert r.status_code == 401


def test_svn_register_with_duplicate_username_updates_password(
    client: TestClient,
) -> None:
    payload = _svn_register_payload()
    client.post(f"{settings.API_V1_STR}/auth/register", json=payload)
    updated_payload = {
        **payload,
        "full_name": "Updated SVN User",
        "svn_password": "updated-password",
    }

    r = client.post(f"{settings.API_V1_STR}/auth/register", json=updated_payload)

    assert r.status_code == 200
    login_response = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "svn_username": payload["svn_username"],
            "svn_password": "updated-password",
        },
    )
    assert login_response.status_code == 200
