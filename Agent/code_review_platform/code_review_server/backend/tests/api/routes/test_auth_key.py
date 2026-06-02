import uuid

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import settings
from app.models import AuthSource, User, UserApiKey, UserRole
from tests.utils.user import create_key_user


def test_cch_user_and_plaintext_api_key_can_be_persisted(db: Session) -> None:
    user = User(
        full_name="CCH User",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.cch,
        cch_user_id=1001,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    api_key = UserApiKey(
        user_id=user.id,
        cch_key_id=2001,
        key="sk-cch-local-test",
        name="Desktop Key",
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    saved = db.exec(select(UserApiKey).where(UserApiKey.key == "sk-cch-local-test")).one()

    assert saved.id
    assert saved.user_id == user.id
    assert saved.cch_key_id == 2001
    assert saved.is_active is True
    assert saved.last_synced_at is not None
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_local_svn_user_does_not_require_email_or_hashed_password(db: Session) -> None:
    user = User(
        full_name="SVN User",
        svn_username=f"svn-{uuid.uuid4()}",
        is_active=True,
        is_superuser=False,
        role=UserRole.user,
        auth_source=AuthSource.local,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.id
    assert user.auth_source == AuthSource.local
    assert user.cch_user_id is None


def test_duplicate_plaintext_api_keys_are_rejected(db: Session) -> None:
    user = User(
        full_name="Duplicate Key User",
        auth_source=AuthSource.cch,
        cch_user_id=3001,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(
        UserApiKey(
            user_id=user.id,
            cch_key_id=30001,
            key="sk-cch-duplicate-test",
        )
    )
    db.commit()

    db.add(
        UserApiKey(
            user_id=user.id,
            cch_key_id=30002,
            key="sk-cch-duplicate-test",
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    else:
        db.rollback()
        raise AssertionError("Duplicate plaintext API keys should be rejected")


def test_key_login_with_valid_key_returns_tokens(
    client: TestClient, db: Session
) -> None:
    _, api_key = create_key_user(db)

    response = client.post(
        f"{settings.API_V1_STR}/auth/key-login", json={"key": api_key.key}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_key_login_with_disabled_key_returns_401(
    client: TestClient, db: Session
) -> None:
    _, api_key = create_key_user(db, is_active=False)

    response = client.post(
        f"{settings.API_V1_STR}/auth/key-login", json={"key": api_key.key}
    )

    assert response.status_code == 401


def test_key_login_with_disabled_user_returns_401(
    client: TestClient, db: Session
) -> None:
    user, api_key = create_key_user(db)
    user.is_active = False
    db.add(user)
    db.commit()

    response = client.post(
        f"{settings.API_V1_STR}/auth/key-login", json={"key": api_key.key}
    )

    assert response.status_code == 401


def test_openapi_security_scheme_uses_http_bearer(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/openapi.json")

    assert response.status_code == 200
    security_schemes = response.json()["components"]["securitySchemes"]
    bearer_scheme = security_schemes["HTTPBearer"]

    assert bearer_scheme["type"] == "http"
    assert bearer_scheme["scheme"] == "bearer"
    assert "flows" not in bearer_scheme
    assert "tokenUrl" not in str(security_schemes)
