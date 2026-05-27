from pathlib import Path

from app.config import load_settings
from app.models import SessionCreateRequest, TaskStatus


def test_codex_args_preserve_quoted_windows_path(monkeypatch):
    monkeypatch.setenv("CODEX_ARGS", 'exec "D:\\Program Files\\Code_review\\demo" --flag')

    settings = load_settings()

    assert settings.codex_args == (
        "exec",
        "D:\\Program Files\\Code_review\\demo",
        "--flag",
    )


def test_codex_args_preserve_quoted_phrase(monkeypatch):
    monkeypatch.setenv("CODEX_ARGS", 'exec --label "hello world"')

    settings = load_settings()

    assert settings.codex_args == ("exec", "--label", "hello world")


def test_relative_database_path_resolves_under_app_base_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_PATH", "relative/app.db")

    settings = load_settings()

    assert settings.database_path == (tmp_path / "relative" / "app.db").resolve()


def test_load_settings_includes_postgres_redis_session_and_worker_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("SESSION_SECRET_KEY", raising=False)
    monkeypatch.delenv("WORKER_ID", raising=False)

    settings = load_settings()

    assert settings.database_url == "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
    assert settings.redis_url == "redis://127.0.0.1:6379/0"
    assert settings.session_secret_key
    assert settings.worker_id
    assert settings.redis_lock_ttl_seconds == 3600
    assert settings.reports_dir == (Path(tmp_path) / "data" / "reports").resolve()
    assert settings.svn_exports_dir == (Path(tmp_path) / "data" / "svn_exports").resolve()


def test_load_settings_reads_postgres_redis_and_session_env(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@db:5432/app")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/3")
    monkeypatch.setenv("SESSION_SECRET_KEY", "test-secret")
    monkeypatch.setenv("WORKER_ID", "worker-a")
    monkeypatch.setenv("REDIS_LOCK_TTL_SECONDS", "120")
    monkeypatch.setenv("SVN_EXPORTS_DIR", "custom-svn-exports")

    settings = load_settings()

    assert settings.database_url == "postgresql://user:pass@db:5432/app"
    assert settings.redis_url == "redis://redis:6379/3"
    assert settings.session_secret_key == "test-secret"
    assert settings.worker_id == "worker-a"
    assert settings.redis_lock_ttl_seconds == 120
    assert settings.svn_exports_dir == (Path(tmp_path) / "custom-svn-exports").resolve()


def test_models_include_session_request_and_enqueue_failed_status():
    request = SessionCreateRequest(name=" 张三 ", phone=" 13800138000 ")

    assert request.name == " 张三 "
    assert request.phone == " 13800138000 "
    assert TaskStatus.enqueue_failed.value == "enqueue_failed"


def test_admin_phones_are_parsed_from_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_BASE_DIR", str(tmp_path))
    monkeypatch.setenv("ADMIN_PHONES", " 15866582922, 13800138000 ,,")

    from app.config import load_settings

    loaded = load_settings()

    assert loaded.admin_phones == ("15866582922", "13800138000")
