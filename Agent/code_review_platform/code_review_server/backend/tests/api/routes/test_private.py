from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User, UserRole
from tests.utils.utils import random_lower_string


def test_create_user(client: TestClient, db: Session) -> None:
    svn_username = f"svn-{random_lower_string()}"
    r = client.post(
        f"{settings.API_V1_STR}/private/users/",
        json={
            "full_name": "Pollo Listo",
            "svn_username": svn_username,
            "is_superuser": True,
        },
    )

    assert r.status_code == 200

    data = r.json()

    user = db.exec(select(User).where(User.id == data["id"])).first()

    assert user
    assert user.full_name == "Pollo Listo"
    assert user.svn_username == svn_username
    assert user.is_superuser is True
    assert user.role == UserRole.admin
    assert "email" not in data
