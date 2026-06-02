import random
import string
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import AuthSource, User, UserRole


def random_lower_string() -> str:
    return "".join(random.choices(string.ascii_lowercase, k=32))


def random_email() -> str:
    return f"{random_lower_string()}@{random_lower_string()}.com"


def auth_headers_for_user_id(user_id: object) -> dict[str, str]:
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    token = security.create_access_token(user_id, expires_delta=access_token_expires)
    return {"Authorization": f"Bearer {token}"}


def get_superuser_token_headers(client: TestClient) -> dict[str, str]:
    _ = client
    with Session(engine) as session:
        superuser = session.exec(select(User).where(User.is_superuser)).first()
        if not superuser:
            superuser = session.exec(
                select(User).where(User.full_name == settings.FIRST_SUPERUSER)
            ).first()
        if not superuser:
            superuser = User(
                full_name=settings.FIRST_SUPERUSER,
                is_active=True,
                is_superuser=True,
                role=UserRole.admin,
                auth_source=AuthSource.local,
            )
            session.add(superuser)
            session.commit()
            session.refresh(superuser)
        return auth_headers_for_user_id(superuser.id)
