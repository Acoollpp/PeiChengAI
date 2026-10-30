"""Best-effort storage cleanup helpers for task deletion.

Windows frequently keeps temporary handles on task files (Excel COM
automation, antivirus scanners, preview panes). A plain ``shutil.rmtree``
then raises, the API turns the failure into a 500 response, and the task
row stays stuck in the list. These helpers retry, clear read-only
attributes, and report whether removal fully succeeded so callers can
still delete the database record.
"""

from __future__ import annotations

import os
import shutil
import stat
import time
from pathlib import Path


def robust_rmtree(path: Path, *, retries: int = 3, delay_seconds: float = 0.5) -> bool:
    """Remove *path* and its contents, tolerating transient Windows locks.

    Returns ``True`` when the directory no longer exists. When some files
    remain locked after all retries the directory is left in place and
    ``False`` is returned, so callers can decide to keep going (for
    example, still delete the task row).
    """
    attempts = max(retries, 1)
    for attempt in range(attempts):
        if not path.exists():
            return True
        _clear_readonly_bits(path)
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return True
        if attempt + 1 < attempts:
            time.sleep(delay_seconds * (attempt + 1))
    return not path.exists()


def robust_unlink(path: Path, *, retries: int = 3, delay_seconds: float = 0.5) -> bool:
    """Delete a single file, clearing read-only bits and retrying."""
    attempts = max(retries, 1)
    for attempt in range(attempts):
        if not path.exists():
            return True
        try:
            os.chmod(path, stat.S_IWRITE)
            path.unlink()
        except OSError:
            pass
        if not path.exists():
            return True
        if attempt + 1 < attempts:
            time.sleep(delay_seconds * (attempt + 1))
    return not path.exists()


def _clear_readonly_bits(path: Path) -> None:
    try:
        os.chmod(path, stat.S_IRWXU)
    except OSError:
        return
    for root, dirs, files in os.walk(path):
        for name in dirs:
            try:
                os.chmod(Path(root) / name, stat.S_IRWXU)
            except OSError:
                continue
        for name in files:
            try:
                os.chmod(Path(root) / name, stat.S_IRWXU)
            except OSError:
                continue
