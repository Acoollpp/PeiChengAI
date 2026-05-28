from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import AuditLog, User
from tests.utils.utils import random_lower_string


def _register_svn_user(client: TestClient) -> tuple[dict[str, str], dict[str, str]]:
    payload = {
        "full_name": "SVN Credential User",
        "svn_username": f"svn-{random_lower_string()}",
        "svn_password": random_lower_string(),
    }
    r = client.post(f"{settings.API_V1_STR}/auth/register", json=payload)
    assert r.status_code == 200
    token = r.json()["access_token"]
    return payload, {"Authorization": f"Bearer {token}"}


def test_current_user_gets_own_svn_credential(
    client: TestClient, db: Session
) -> None:
    payload, headers = _register_svn_user(client)

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
