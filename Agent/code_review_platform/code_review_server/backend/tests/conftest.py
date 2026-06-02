from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlmodel import Session, delete

from app.core.db import engine, init_db
from app.main import app
from app.models import (
    AuditLog,
    Item,
    ReviewTask,
    SkillPackage,
    User,
    UserApiKey,
    UserSvnCredential,
)
from tests.utils.user import create_random_user
from tests.utils.utils import auth_headers_for_user_id, get_superuser_token_headers


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        init_db(session)
        yield session
        statement = delete(UserApiKey)
        session.execute(statement)
        statement = delete(UserSvnCredential)
        session.execute(statement)
        statement = delete(Item)
        session.execute(statement)
        statement = delete(ReviewTask)
        session.execute(statement)
        statement = delete(AuditLog)
        session.execute(statement)
        if inspect(engine).has_table("skill_package"):
            statement = delete(SkillPackage)
            session.execute(statement)
        statement = delete(User)
        session.execute(statement)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    user = create_random_user(db)
    return auth_headers_for_user_id(user.id)
