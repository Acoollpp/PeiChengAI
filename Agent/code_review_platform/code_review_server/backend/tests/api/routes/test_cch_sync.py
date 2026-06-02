from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import AuditLog, UserRole
from app.services.cch_sync_service import (
    CchKeyRow,
    CchSyncResult,
    CchSyncService,
    CchUserRow,
)
from tests.utils.user import authentication_token_from_key, create_key_user


def test_admin_can_trigger_cch_sync(
    client: TestClient, db: Session, monkeypatch
) -> None:
    admin, api_key = create_key_user(db)
    admin.is_superuser = True
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)

    captured: dict[str, object] = {}

    def fake_sync_from_database(_self, _session, database_url, actor_user_id):
        captured["database_url"] = database_url
        captured["actor_user_id"] = actor_user_id
        return CchSyncResult(
            created=1,
            updated=2,
            disabled=3,
            skipped_records=4,
            errors=["example"],
            started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            finished_at=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        )

    monkeypatch.setattr(settings, "CCH_DATABASE_URL", "postgresql://cch:test@db/cch")
    monkeypatch.setattr(
        "app.api.routes.cch_sync.CchSyncService.sync_from_database",
        fake_sync_from_database,
    )

    response = client.post(f"{settings.API_V1_STR}/admin/cch-sync/users", headers=headers)

    assert response.status_code == 200
    assert response.json()["created"] == 1
    assert response.json()["updated"] == 2
    assert response.json()["disabled"] == 3
    assert response.json()["skipped_records"] == 4
    assert response.json()["errors"] == ["example"]
    assert captured == {
        "database_url": "postgresql://cch:test@db/cch",
        "actor_user_id": admin.id,
    }


def test_non_admin_cannot_trigger_cch_sync(
    client: TestClient, db: Session, monkeypatch
) -> None:
    user, api_key = create_key_user(db)
    user.is_superuser = False
    user.role = UserRole.user
    db.add(user)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    monkeypatch.setattr(settings, "CCH_DATABASE_URL", "postgresql://cch:test@db/cch")

    response = client.post(f"{settings.API_V1_STR}/admin/cch-sync/users", headers=headers)

    assert response.status_code == 403


def test_cch_sync_returns_503_when_database_url_is_not_configured(
    client: TestClient, db: Session, monkeypatch
) -> None:
    admin, api_key = create_key_user(db)
    admin.is_superuser = True
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    monkeypatch.setattr(settings, "CCH_DATABASE_URL", None)

    response = client.post(f"{settings.API_V1_STR}/admin/cch-sync/users", headers=headers)

    assert response.status_code == 503
    assert response.json()["detail"] == "CCH database is not configured"


def test_sync_from_database_writes_audit_log(db: Session, monkeypatch) -> None:
    actor, _ = create_key_user(db)

    def fake_fetch_rows(_self, _database_url):
        return (
            [CchUserRow(cch_user_id=301, full_name="Audit User")],
            [CchKeyRow(cch_key_id=401, cch_user_id=301, key="sk-cch-audit")],
        )

    monkeypatch.setattr(CchSyncService, "fetch_rows", fake_fetch_rows)
    result = CchSyncService().sync_from_database(db, "postgresql://cch:test@db/cch", actor.id)

    audit_log = db.exec(
        select(AuditLog).where(AuditLog.action == "cch_users_synced")
    ).all()[-1]
    assert result.created == 2
    assert audit_log.actor_user_id == actor.id
    assert audit_log.metadata_json["created"] == 2
