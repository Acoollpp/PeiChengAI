#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-code_review_server-backend-1}"
LOCK_FILE="${LOCK_FILE:-/tmp/code-review-sub2api-user-sync.lock}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] sub2api user key sync is already running"
  exit 0
fi

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

echo "[$(timestamp)] sub2api user key sync started"

health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
if [[ "$health" != "healthy" && "$health" != "running" ]]; then
  echo "[$(timestamp)] backend container is not ready: ${health:-missing}"
  exit 1
fi

docker exec "$CONTAINER_NAME" sh -lc '/app/.venv/bin/python - <<'"'"'PY'"'"'
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.cch_sync_service import CchSyncService

if settings.CCH_DATABASE_URL is None:
    raise SystemExit("CCH_DATABASE_URL is not configured")

with Session(engine) as session:
    result = CchSyncService().sync_from_database(
        session,
        str(settings.CCH_DATABASE_URL),
        actor_user_id=None,
    )

print(
    "created={created} updated={updated} disabled={disabled} "
    "skipped_records={skipped_records} errors={errors}".format(
        created=result.created,
        updated=result.updated,
        disabled=result.disabled,
        skipped_records=result.skipped_records,
        errors=len(result.errors),
    )
)
for error in result.errors:
    print(f"error={error}")
PY'

echo "[$(timestamp)] sub2api user key sync finished"
