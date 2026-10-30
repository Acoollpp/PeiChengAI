import json
import uuid
import zipfile
from pathlib import Path

from sqlmodel import Session

from app.models import BomSpecCompareTask, BomSpecCompareTaskStatus
from app.services.bom_spec_compare_task_service import (
    mark_interrupted_tasks_failed,
)
from tests.utils.user import create_key_user


def test_mark_interrupted_tasks_failed_marks_running_task(
    db: Session,
    tmp_path: Path,
    monkeypatch,
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))
    user, _ = create_key_user(db)
    task = BomSpecCompareTask(
        user_id=user.id,
        task_name="running",
        status=BomSpecCompareTaskStatus.running,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    changed = mark_interrupted_tasks_failed(db)

    db.refresh(task)
    assert changed == 1
    assert task.status == BomSpecCompareTaskStatus.failed
    assert task.error_message == "服务重启导致任务中断，请重新提交任务"
    assert task.finished_at is not None


def test_mark_interrupted_tasks_failed_recovers_complete_batch_report(
    db: Session,
    tmp_path: Path,
    monkeypatch,
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))
    user, _ = create_key_user(db)
    task = BomSpecCompareTask(
        user_id=user.id,
        task_name="running with complete report",
        status=BomSpecCompareTaskStatus.running,
        input_files=[
            {
                "file_name": "10-19.rar",
                "file_path": str(tmp_path / "10-19.rar"),
                "file_size": 7,
            }
        ],
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    task_root = tmp_path / str(task.id)
    input_dir = task_root / "input"
    report_dir = task_root / "reports"
    input_dir.mkdir(parents=True)
    report_dir.mkdir(parents=True)
    (input_dir / "10-19.rar").write_bytes(b"archive")
    (report_dir / "BOM与规格书配件对比清单20261019.json").write_text(
        json.dumps(
            {
                "total_projects": 1,
                "results": [
                    {
                        "project": "demo",
                        "status": "成功",
                        "summary": {
                            "一致": 2,
                            "不一致": 1,
                            "BOM有规格书无": 0,
                            "规格书有BOM无": 0,
                        },
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    changed = mark_interrupted_tasks_failed(db)

    db.refresh(task)
    assert changed == 1
    assert task.status == BomSpecCompareTaskStatus.success
    assert task.error_message is None
    assert task.project_count == 1
    assert task.consistent_count == 0
    assert task.different_count == 1
    assert len(task.result_files) == 1
    zip_path = Path(task.result_files[0]["file_path"])
    assert zip_path.name == "10-19.zip"
    assert zip_path.is_file()
    with zipfile.ZipFile(zip_path) as archive:
        assert "reports/BOM与规格书配件对比清单20261019.json" in archive.namelist()
    assert (task_root / "logs" / "recovery.log").is_file()
