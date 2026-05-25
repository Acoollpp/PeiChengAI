from pathlib import Path

from app.config import load_settings


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
