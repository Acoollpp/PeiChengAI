from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

from app.worker import _report_says_materials_unavailable


class CodexRunner:
    def __init__(self, command: str, args: tuple[str, ...]):
        self.command = command
        self.args = args

    def run(self, prompt: str, cwd: Path, timeout_seconds: int) -> tuple[int, str, str]:
        command = _resolve_command(self.command)
        process = subprocess.Popen(
            [command, *self.args, prompt],
            cwd=cwd,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        report_path = _extract_report_path(prompt)
        deadline = time.monotonic() + timeout_seconds
        while process.poll() is None:
            if report_path is not None and _report_indicates_terminal_failure(report_path):
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                stdout, stderr = process.communicate()
                raise subprocess.TimeoutExpired([command, *self.args], timeout_seconds, output=stdout, stderr=stderr)
            time.sleep(min(0.5, remaining))

        stdout, stderr = process.communicate()
        return process.returncode or 0, stdout, stderr


def _resolve_command(command: str) -> str:
    if command.lower() == "codex" and os.name == "nt":
        codex = _find_user_codex_exe()
        if codex is not None:
            return str(codex)
    return shutil.which(command) or command


def _extract_report_path(prompt: str) -> Path | None:
    marker = "报告输出路径："
    if marker in prompt:
        line = prompt.split(marker, 1)[1].splitlines()[0].strip()
        return Path(line) if line else None

    marker = "Write the report to "
    if marker in prompt:
        line = prompt.split(marker, 1)[1].splitlines()[0].strip().rstrip(".")
        return Path(line) if line else None

    return None


def _report_indicates_terminal_failure(report_path: Path) -> bool:
    if not report_path.exists() or report_path.stat().st_size == 0:
        return False
    report_text = report_path.read_text(encoding="utf-8", errors="replace")
    return _report_says_materials_unavailable(report_text)


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
