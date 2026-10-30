"""Resolve the locally installed Codex CLI across desktop/VS Code updates."""

import os
import shutil
from pathlib import Path


def resolve_codex_command(command: str, *, user_profile: Path | None = None, which=shutil.which) -> str:
    """Return an executable path for a configured Codex command.

    Codex desktop and the VS Code extension install versioned directories and
    remove old ones during updates. A bare ``codex`` is therefore not stable
    for long-running backend processes; search known versioned locations too.
    """
    command = command.strip() or "codex"
    command_path = Path(command)
    if command_path.is_absolute() or command_path.parent != Path("."):
        return str(command)

    names = (f"{command}.cmd", f"{command}.exe", command)
    candidates: list[Path] = []

    for name in names:
        resolved = which(name)
        if resolved:
            # ``which`` is the authoritative lookup for the current process
            # PATH. Return it immediately so tests and custom environments can
            # override the known-install search below.
            return resolved

    home = Path.home()
    profile = user_profile or home
    candidates.extend(
        [
            profile / "AppData" / "Roaming" / "npm" / f"{command}.cmd",
            profile / "AppData" / "Roaming" / "npm" / f"{command}.exe",
            profile / "AppData" / "Roaming" / "npm" / command,
        ]
    )

    desktop_bin = home / "AppData" / "Local" / "OpenAI" / "Codex" / "bin"
    if desktop_bin.is_dir():
        candidates.extend(path for path in desktop_bin.glob("*/codex.exe") if path.is_file())

    vscode_root = home / ".vscode" / "extensions"
    if vscode_root.is_dir():
        candidates.extend(
            path
            for path in vscode_root.glob(
                "openai.chatgpt-*-win32-x64/bin/windows-x86_64/codex.exe"
            )
            if path.is_file()
        )

    # Prefer the newest executable when multiple Codex installations coexist.
    unique_existing: dict[Path, float] = {}
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            if resolved.is_file():
                unique_existing[resolved] = resolved.stat().st_mtime
        except OSError:
            continue
    if unique_existing:
        return str(max(unique_existing, key=unique_existing.get))

    return command
