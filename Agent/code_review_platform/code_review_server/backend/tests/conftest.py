import os
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlmodel import Session, delete

os.environ.setdefault("POSTGRES_DB", os.getenv("CODE_REVIEW_TEST_POSTGRES_DB", "app_test"))

from app.core.config import settings


def _ensure_test_database_exists() -> None:
    database_name = settings.POSTGRES_DB
    if not database_name.endswith("_test"):
        raise RuntimeError(
            "Refusing to initialize tests against non-test database "
            f"{database_name!r}. Set CODE_REVIEW_TEST_POSTGRES_DB to a database "
            "name ending in '_test'."
        )

    maintenance_url = str(settings.SQLALCHEMY_DATABASE_URI).replace(
        f"/{database_name}",
        "/postgres",
        1,
    )
    maintenance_engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
    with maintenance_engine.connect() as connection:
        exists = connection.execute(
            text("select 1 from pg_database where datname = :database_name"),
            {"database_name": database_name},
        ).first()
        if not exists:
            connection.execute(text(f'create database "{database_name}"'))
    maintenance_engine.dispose()


_ensure_test_database_exists()


def _run_test_migrations() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")


_run_test_migrations()

from app.core.db import engine, init_db
from app.main import app
from app.models import (
    AuditLog,
    ClientRelease,
    ClientUpdatePolicy,
    Department,
    Feedback,
    FeedbackScreenshot,
    Item,
    ReviewFocusDirection,
    ReviewFocusDirectionDepartment,
    ReviewFocusDirectionUsageState,
    ReviewTask,
    ReviewTaskIssue,
    ReviewTaskReportFeedback,
    ReviewTaskRequirementFile,
    SkillPackage,
    User,
    UserApiKey,
    UserSvnCredential,
)
from tests.utils.user import create_random_user
from tests.utils.utils import auth_headers_for_user_id, get_superuser_token_headers


def _assert_test_database(session: Session) -> None:
    database_name = session.exec(text("select current_database()")).one()[0]
    if not database_name.endswith("_test"):
        raise RuntimeError(
            "Refusing to run destructive test cleanup against non-test database "
            f"{database_name!r}. Set CODE_REVIEW_TEST_POSTGRES_DB to a database "
            "name ending in '_test'."
        )


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        _assert_test_database(session)
        init_db(session)
        yield session
        _assert_test_database(session)
        inspector = inspect(engine)
        if inspector.has_table("review_task_issue"):
            statement = delete(ReviewTaskIssue)
            session.execute(statement)
        if inspector.has_table("review_task_report_feedback"):
            statement = delete(ReviewTaskReportFeedback)
            session.execute(statement)
        if inspector.has_table("review_task_requirement_file"):
            statement = delete(ReviewTaskRequirementFile)
            session.execute(statement)
        if inspector.has_table("review_task"):
            statement = delete(ReviewTask)
            session.execute(statement)
        if inspector.has_table("review_focus_direction_department"):
            statement = delete(ReviewFocusDirectionDepartment)
            session.execute(statement)
        if inspector.has_table("review_focus_direction_usage_state"):
            statement = delete(ReviewFocusDirectionUsageState)
            session.execute(statement)
        if inspector.has_table("review_focus_direction"):
            statement = delete(ReviewFocusDirection)
            session.execute(statement)
        statement = delete(UserApiKey)
        session.execute(statement)
        statement = delete(UserSvnCredential)
        session.execute(statement)
        statement = delete(Item)
        session.execute(statement)
        statement = delete(AuditLog)
        session.execute(statement)
        if inspector.has_table("client_update_policy"):
            statement = delete(ClientUpdatePolicy)
            session.execute(statement)
        if inspector.has_table("client_release"):
            statement = delete(ClientRelease)
            session.execute(statement)
        if inspector.has_table("skill_package"):
            statement = delete(SkillPackage)
            session.execute(statement)
        if inspector.has_table("feedback_screenshot"):
            statement = delete(FeedbackScreenshot)
            session.execute(statement)
        if inspector.has_table("feedback"):
            statement = delete(Feedback)
            session.execute(statement)
        statement = delete(User)
        session.execute(statement)
        if inspector.has_table("department"):
            statement = delete(Department)
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
    _ = client
    user = create_random_user(db)
    return auth_headers_for_user_id(user.id)
