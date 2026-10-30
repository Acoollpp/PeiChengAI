import secrets
import warnings
from typing import Annotated, Any, Literal

from pydantic import (
    AnyUrl,
    BeforeValidator,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""
    CCH_DATABASE_URL: PostgresDsn | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return PostgresDsn.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    FIRST_SUPERUSER: str
    SVN_CREDENTIAL_MASTER_KEY: str
    REPORT_STORAGE_DIR: str = "/app/reports"
    SKILL_STORAGE_DIR: str = "/app/skills"
    CLIENT_RELEASE_STORAGE_DIR: str = "/app/client-releases"
    FEEDBACK_STORAGE_DIR: str = "/app/feedback-screenshots"
    CODEX_HOME_DIR: str = ""
    GPIO_STORAGE_DIR: str = "/app/gpio-tasks"
    GPIO_CODEX_COMMAND: str = "codex"
    GPIO_CODEX_TIMEOUT_SECONDS: int = 1800
    WHITEBOX_STORAGE_DIR: str = "/app/whitebox-tasks"
    WHITEBOX_AGENT_TOKEN: str = "change-this-whitebox-agent-token"
    WHITEBOX_TASK_TIMEOUT_SECONDS: int = 10800
    BOM_SPEC_COMPARE_STORAGE_DIR: str = "/app/bom-spec-compare-tasks"
    BOM_SPEC_COMPARE_CODEX_COMMAND: str = "codex"
    BOM_SPEC_COMPARE_CODEX_TIMEOUT_SECONDS: int = 1800
    BOM_SPEC_COMPARE_7Z_COMMAND: str = "7z"
    BOM_SPEC_COMPARE_ARCHIVE_TIMEOUT_SECONDS: int = 300
    BOM_CHANGE_CHECK_STORAGE_DIR: str = "/app/bom-change-check-tasks"
    BOM_CHANGE_CHECK_CODEX_COMMAND: str = "codex"
    BOM_CHANGE_CHECK_CODEX_TIMEOUT_SECONDS: int = 1800
    BOM_ELECTRONIC_EDIT_STORAGE_DIR: str = "/app/bom-electronic-edit-tasks"
    WIRE_HARNESS_COMPARE_STORAGE_DIR: str = "/app/wire-harness-compare-tasks"
    WIRE_HARNESS_COMPARE_MAX_ARCHIVE_BYTES: int = 500 * 1024 * 1024
    WIRE_HARNESS_COMPARE_MAX_FILES: int = 2000
    WIRE_HARNESS_COMPARE_RAR_COMMAND: str = "UnRAR"
    WIRE_HARNESS_COMPARE_OCR_ENGINE: str = "auto"
    WIRE_HARNESS_COMPARE_OCR_DPI: int = 300
    WIRE_HARNESS_COMPARE_TESSERACT_COMMAND: str = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    WIRE_HARNESS_COMPARE_CODEX_COMMAND: str = "codex"
    WIRE_HARNESS_COMPARE_CODEX_MODEL: str = 'gpt-6.1-sol'
    WIRE_HARNESS_COMPARE_CODEX_TRANSIENT_RETRIES: int = 3
    WIRE_HARNESS_COMPARE_CODEX_TIMEOUT_SECONDS: int = 1800
    WIRE_HARNESS_COMPARE_RENDER_DPI: int = 160

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)

        return self


settings = Settings()  # type: ignore
