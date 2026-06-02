from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import AuditLog, ReviewTask, User, UserRole
from app.services.credential_service import CredentialService
from tests.utils.user import (
    authentication_token_from_key,
    create_key_user,
    create_random_user,
)
from tests.utils.utils import auth_headers_for_user_id, random_lower_string


def _create_svn_user_with_credential(db: Session) -> tuple[dict[str, str], dict[str, str]]:
    payload = {
        "full_name": "SVN Credential User",
        "svn_username": f"svn-{random_lower_string()}",
        "svn_password": random_lower_string(),
    }
    user = User(
        full_name=payload["full_name"],
        svn_username=payload["svn_username"],
        role=UserRole.user,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).save_svn_password(
        db, user.id, payload["svn_password"]
    )
    return payload, auth_headers_for_user_id(user.id)


def test_current_user_gets_own_svn_credential(
    client: TestClient, db: Session
) -> None:
    payload, headers = _create_svn_user_with_credential(db)

    r = client.get(f"{settings.API_V1_STR}/me/svn-credential", headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "svn_username": payload["svn_username"],
        "svn_password": payload["svn_password"],
    }

    user = db.exec(
        select(User).where(User.svn_username == payload["svn_username"])
    ).one()
    audit_log = db.exec(
        select(AuditLog).where(
            AuditLog.action == "svn_credential_retrieved",
            AuditLog.actor_user_id == user.id,
            AuditLog.target_user_id == user.id,
        )
    ).first()
    assert audit_log is not None
    assert audit_log.metadata_json is not None
    assert "svn_password" not in audit_log.metadata_json
    assert payload["svn_password"] not in str(audit_log.metadata_json)


def test_current_user_updates_svn_credential_and_password_is_readable(
    client: TestClient, db: Session
) -> None:
    current_user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    payload = {
        "svn_username": f"svn-{random_lower_string()}",
        "svn_password": "new-svn-password",
    }

    r = client.put(f"{settings.API_V1_STR}/me/svn-credential", headers=headers, json=payload)

    assert r.status_code == 200
    assert r.json() == payload
    db.refresh(current_user)
    assert current_user.svn_username == payload["svn_username"]
    assert (
        CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).get_svn_password(
            db, current_user.id
        )
        == payload["svn_password"]
    )


def test_current_user_binding_legacy_svn_username_merges_old_user(
    client: TestClient, db: Session
) -> None:
    legacy_user = create_random_user(db)
    current_user, api_key = create_key_user(db)
    task = ReviewTask(
        user_id=legacy_user.id,
        svn_url=f"https://svn.example.com/{random_lower_string()}",
        old_revision="1",
        new_revision="2",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    svn_username = legacy_user.svn_username
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    payload = {"svn_username": svn_username, "svn_password": "bound-password"}

    r = client.put(f"{settings.API_V1_STR}/me/svn-credential", headers=headers, json=payload)

    assert r.status_code == 200
    assert r.json() == payload
    db.refresh(current_user)
    db.refresh(legacy_user)
    db.refresh(task)
    assert current_user.svn_username == svn_username
    assert legacy_user.svn_username is None
    assert legacy_user.is_active is False
    assert legacy_user.disabled_reason == "merged_into_cch_user"
    assert task.user_id == current_user.id
    assert (
        CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).get_svn_password(
            db, current_user.id
        )
        == payload["svn_password"]
    )
    audit_log = db.exec(
        select(AuditLog).where(
            AuditLog.action == "svn_user_merged",
            AuditLog.actor_user_id == current_user.id,
            AuditLog.target_user_id == legacy_user.id,
        )
    ).one()
    assert audit_log.metadata_json == {"svn_username": svn_username}
