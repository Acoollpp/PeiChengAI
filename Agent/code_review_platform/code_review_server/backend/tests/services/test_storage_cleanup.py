import sys
from pathlib import Path

import pytest

from app.services.storage_cleanup import robust_rmtree, robust_unlink


def test_robust_rmtree_removes_directory(tmp_path: Path) -> None:
    target = tmp_path / "task"
    (target / "nested").mkdir(parents=True)
    (target / "nested" / "file.xlsx").write_bytes(b"data")

    assert robust_rmtree(target) is True
    assert not target.exists()


def test_robust_rmtree_removes_read_only_files(tmp_path: Path) -> None:
    target = tmp_path / "task"
    target.mkdir()
    locked_file = target / "report.xlsx"
    locked_file.write_bytes(b"data")
    locked_file.chmod(0o444)

    assert robust_rmtree(target) is True
    assert not target.exists()


def test_robust_rmtree_missing_directory_is_success(tmp_path: Path) -> None:
    assert robust_rmtree(tmp_path / "missing") is True


@pytest.mark.skipif(sys.platform != "win32", reason="Windows file locks")
def test_robust_rmtree_reports_leftovers_when_file_is_locked(tmp_path: Path) -> None:
    target = tmp_path / "task"
    target.mkdir()
    locked = target / "locked.xlsx"
    locked.write_bytes(b"data")
    handle = locked.open("rb")
    try:
        assert robust_rmtree(target, retries=1, delay_seconds=0) is False
        assert locked.exists()
    finally:
        handle.close()

    assert robust_rmtree(target) is True


def test_robust_unlink_removes_read_only_file(tmp_path: Path) -> None:
    file = tmp_path / "report.pdf"
    file.write_bytes(b"data")
    file.chmod(0o444)

    assert robust_unlink(file) is True
    assert not file.exists()


def test_robust_unlink_missing_file_is_success(tmp_path: Path) -> None:
    assert robust_unlink(tmp_path / "missing.pdf") is True
