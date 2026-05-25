from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


class CodexRunner:
    def __init__(self, command: str, args: tuple[str, ...]):
        self.command = command
        self.args = args

    def run(self, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        command = _resolve_command(self.command)
        completed = subprocess.run(
            [command, *self.args, prompt],
            cwd=cwd,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        return completed.returncode, completed.stdout, completed.stderr


def _resolve_command(command: str) -> str:
    if command.lower() == "codex" and os.name == "nt":
        codex = _find_user_codex_exe()
        if codex is not None:
            return str(codex)
    return shutil.which(command) or command


def _find_user_codex_exe() -> Path | None:
    local_app_data = os.getenv("LOCALAPPDATA")
    if not local_app_data:
        return None

    codex_bin = Path(local_app_data) / "OpenAI" / "Codex" / "bin"
    if not codex_bin.exists():
        return None

    candidates = sorted(
        codex_bin.glob("*/codex.exe"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None
