from __future__ import annotations

import os
import shlex
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    base_dir: Path
    database_path: Path
    database_url: str
    redis_url: str
    reports_dir: Path
    workspaces_dir: Path
    prompt_template_path: Path
    svn_allowed_prefix: str
    codex_command: str
    codex_args: tuple[str, ...]
    codex_timeout_seconds: int
    worker_poll_seconds: float
    retention_days: int
    session_secret_key: str
    worker_id: str
    redis_lock_ttl_seconds: int
    heartbeat_seconds: int


def _parse_codex_args(value: str) -> tuple[str, ...]:
    return tuple(shlex.split(value, posix=True))


def _resolve_path(value: str | os.PathLike[str], base_dir: Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def load_settings() -> Settings:
    base_dir = Path(os.getenv("APP_BASE_DIR", Path.cwd())).resolve()
    data_dir = base_dir / "data"
    codex_args = _parse_codex_args(
        os.getenv(
            "CODEX_ARGS",
            "exec --dangerously-bypass-approvals-and-sandbox",
        )
    )
    return Settings(
        base_dir=base_dir,
        database_path=_resolve_path(os.getenv("DATABASE_PATH", data_dir / "app.db"), base_dir),
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@127.0.0.1:5432/code_review",
        ),
        redis_url=os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
        reports_dir=_resolve_path(os.getenv("REPORTS_DIR", data_dir / "reports"), base_dir),
        workspaces_dir=_resolve_path(
            os.getenv("WORKSPACES_DIR", data_dir / "workspaces"),
            base_dir,
        ),
        prompt_template_path=_resolve_path(
            os.getenv("PROMPT_TEMPLATE_PATH", base_dir / "config" / "prompt_template.md"),
            base_dir,
        ),
        svn_allowed_prefix=os.getenv(
            "SVN_ALLOWED_PREFIX",
            "https://192.168.0.233/svn/src_home/",
        ),
        codex_command=os.getenv("CODEX_COMMAND", "codex"),
        codex_args=codex_args,
        codex_timeout_seconds=int(os.getenv("CODEX_TIMEOUT_SECONDS", "1800")),
        worker_poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "2")),
        retention_days=int(os.getenv("RETENTION_DAYS", "90")),
        session_secret_key=os.getenv("SESSION_SECRET_KEY", "dev-session-secret-change-me"),
        worker_id=os.getenv("WORKER_ID", f"worker-{os.getpid()}"),
        redis_lock_ttl_seconds=int(os.getenv("REDIS_LOCK_TTL_SECONDS", "3600")),
        heartbeat_seconds=int(os.getenv("HEARTBEAT_SECONDS", "30")),
    )


settings = load_settings()
