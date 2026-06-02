from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.user import create_key_user
from tests.utils.utils import auth_headers_for_user_id


def test_email_password_access_token_route_removed(client: TestClient) -> None:
    login_data = {"username": "legacy@example.com", "password": "incorrect"}

    r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)

    assert r.status_code in {404, 410}


def test_use_access_token(client: TestClient, db: Session) -> None:
    user, _ = create_key_user(db)
    headers = auth_headers_for_user_id(user.id)

    r = client.post(f"{settings.API_V1_STR}/login/test-token", headers=headers)

    assert r.status_code == 200
    result = r.json()
    assert result["id"] == str(user.id)
    assert result["full_name"] == user.full_name
    assert result["auth_source"] == "cch"
    assert "email" not in result


def test_recovery_password_route_removed(client: TestClient) -> None:
    r = client.post(f"{settings.API_V1_STR}/password-recovery/test@example.com")

    assert r.status_code in {404, 410}


def test_reset_password_route_removed(client: TestClient) -> None:
    data = {"new_password": "changethis", "token": "invalid"}

    r = client.post(f"{settings.API_V1_STR}/reset-password/", json=data)

    assert r.status_code in {404, 410}
