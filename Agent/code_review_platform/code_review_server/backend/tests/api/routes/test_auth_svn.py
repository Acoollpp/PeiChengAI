from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import User, UserRole
from app.services.credential_service import CredentialService
from tests.utils.utils import random_lower_string


def _create_svn_user(db: Session) -> tuple[User, str]:
    svn_password = random_lower_string()
    user = User(
        full_name="SVN User",
        svn_username=f"svn-{random_lower_string()}",
        role=UserRole.user,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    credential_service = CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY)
    credential_service.save_svn_password(db, user.id, svn_password)
    return user, svn_password


def test_svn_register_route_removed(client: TestClient) -> None:
    payload = {
        "full_name": "SVN User",
        "svn_username": f"svn-{random_lower_string()}",
        "svn_password": random_lower_string(),
    }

    r = client.post(f"{settings.API_V1_STR}/auth/register", json=payload)

    assert r.status_code == 404


def test_svn_login_returns_access_token(client: TestClient, db: Session) -> None:
    user, svn_password = _create_svn_user(db)

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "svn_username": user.svn_username,
            "svn_password": svn_password,
        },
    )

    assert r.status_code == 200
    tokens = r.json()
    assert tokens["access_token"]
    assert tokens["refresh_token"]
    assert tokens["token_type"] == "bearer"


def test_svn_login_with_wrong_password_returns_401(
    client: TestClient, db: Session
) -> None:
    user, _ = _create_svn_user(db)

    r = client.post(
        f"{settings.API_V1_STR}/auth/login",
        json={
            "svn_username": user.svn_username,
            "svn_password": "wrong-password",
        },
    )

    assert r.status_code == 401
