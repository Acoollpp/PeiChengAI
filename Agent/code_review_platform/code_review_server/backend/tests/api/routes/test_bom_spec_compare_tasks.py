import json
import subprocess
import zipfile
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import BomSpecCompareTask, BomSpecCompareTaskStatus, UserRole
from tests.utils.user import authentication_token_from_key, create_key_user


def _mock_rar_extraction(monkeypatch) -> None:
    from app.services import bom_spec_compare_task_service

    def fake_subprocess_run(command, **kwargs):
        output_arg = next((part for part in command if str(part).startswith("-o")), None)
        output_dir = Path(str(output_arg)[2:]) if output_arg else Path(command[-1])
        (output_dir / "demo").mkdir(parents=True, exist_ok=True)
        (output_dir / "demo" / "bom.xlsx").write_bytes(b"xlsx")
        (output_dir / "demo" / "spec.pdf").write_bytes(b"pdf")

        class Completed:
            returncode = 0
            stdout = "Everything is Ok"
            stderr = ""

        return Completed()

    monkeypatch.setattr(bom_spec_compare_task_service.shutil, "which", lambda command: "WinRAR.exe")
    monkeypatch.setattr(bom_spec_compare_task_service.subprocess, "run", fake_subprocess_run)


def _write_complete_summary(report_path: Path, name: str = "BOM与规格书配件对比清单20260916.json") -> Path:
    summary_path = report_path / name
    summary_path.write_text(
        json.dumps(
            {
                "generated_date": "20260916",
                "project_count": 2,
                "results": [
                    {
                        "project": "41646-1.2",
                        "status": "成功",
                        "summary": {
                            "一致": 4,
                            "不一致": 0,
                            "BOM有规格书无": 0,
                            "规格书有BOM无": 0,
                        },
                    },
                    {
                        "project": "41730-1.3",
                        "status": "成功",
                        "summary": {
                            "一致": 5,
                            "不一致": 0,
                            "BOM有规格书无": 0,
                            "规格书有BOM无": 0,
                        },
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return summary_path


def test_create_bom_spec_task_returns_immediately_and_queues_background_work(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.services import bom_spec_compare_task_service

    started_task_ids = []
    monkeypatch.setattr(
        "app.api.routes.bom_spec_compare_tasks.start_bom_spec_compare_task",
        lambda task_id: started_task_ids.append(task_id),
    )
    monkeypatch.setattr(
        bom_spec_compare_task_service,
        "run_task_with_codex",
        lambda task_id: (_ for _ in ()).throw(AssertionError("Codex should run in background")),
    )

    _mock_rar_extraction(monkeypatch)
    rar_path = tmp_path / "bom-input.rar"
    rar_path.write_bytes(b"rar")
    with rar_path.open("rb") as file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-spec-compare-tasks",
            headers=normal_user_token_headers,
            data={"task_name": "7-3 BOM检查"},
            files={"project_upload": ("bom-input.rar", file, "application/vnd.rar")},
        )

    assert response.status_code == 200
    content = response.json()
    assert content["task_name"] == "7-3 BOM检查"
    assert content["status"] == BomSpecCompareTaskStatus.queued
    assert content["project_count"] == 0
    assert [str(task_id) for task_id in started_task_ids] == [content["id"]]


def test_run_bom_spec_task_updates_status_and_report(
    db: Session,
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.api.routes.bom_spec_compare_tasks import run_bom_spec_compare_task
    from app.services import bom_spec_compare_task_service

    user = create_key_user(db)[0]
    task = BomSpecCompareTask(
        user_id=user.id,
        task_name="background",
        status=BomSpecCompareTaskStatus.queued,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    def fake_run_task(task_id):
        reports_dir = tmp_path / str(task_id) / "reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        report_path = reports_dir / "7-3.zip"
        report_path.write_bytes(b"zip-report")
        return {
            "result_files": [
                {
                    "file_name": report_path.name,
                    "file_path": str(report_path),
                    "content_type": "application/zip",
                    "file_size": report_path.stat().st_size,
                }
            ],
            "project_count": 3,
            "success_count": 3,
            "consistent_count": 2,
            "different_count": 1,
            "failed_count": 0,
        }

    monkeypatch.setattr(bom_spec_compare_task_service, "run_task_with_codex", fake_run_task)

    run_bom_spec_compare_task(task.id)

    db.refresh(task)
    assert task.status == BomSpecCompareTaskStatus.success
    assert task.project_count == 3
    assert task.consistent_count == 2
    assert task.different_count == 1
    assert task.result_files[0]["file_name"] == "7-3.zip"


def test_report_zip_uses_uploaded_archive_name(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.services import bom_spec_compare_task_service

    task_id = UUID("11111111-1111-1111-1111-111111111111")
    input_dir = tmp_path / str(task_id) / "input"
    report_dir = tmp_path / str(task_id) / "reports"
    input_dir.mkdir(parents=True)
    report_dir.mkdir(parents=True)
    (input_dir / "7-3.rar").write_bytes(b"rar")
    (report_dir / "BOM与规格书配件对比清单.xlsx").write_bytes(b"xlsx")

    report_zip = bom_spec_compare_task_service._create_report_zip(task_id)

    assert report_zip.name == "7-3.zip"
    assert report_zip.is_file()
    with zipfile.ZipFile(report_zip) as archive:
        names = set(archive.namelist())
    assert "input/7-3.rar" in names
    assert "reports/BOM与规格书配件对比清单.xlsx" in names


def test_run_bom_spec_task_recovers_complete_report_after_codex_timeout(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.services import bom_spec_compare_task_service

    task_id = UUID("22222222-2222-2222-2222-222222222222")
    input_path = tmp_path / str(task_id) / "input"
    report_path = tmp_path / str(task_id) / "reports"
    input_path.mkdir(parents=True)
    report_path.mkdir(parents=True)
    (input_path / "9-9.rar").write_bytes(b"rar")
    _write_complete_summary(report_path, "BOM与规格书配件对比清单20260914.json")

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(
            cmd=["codex"],
            timeout=kwargs.get("timeout_seconds", 1800),
            output="partial stdout",
            stderr="partial stderr",
        )

    monkeypatch.setattr(bom_spec_compare_task_service, "_run_codex_process", timeout)

    result = bom_spec_compare_task_service.run_task_with_codex(task_id)

    assert result["project_count"] == 2
    assert result["success_count"] == 2
    assert result["consistent_count"] == 2
    assert result["different_count"] == 0
    assert result["failed_count"] == 0
    assert result["result_files"][0]["file_name"] == "9-9.zip"
    assert (tmp_path / str(task_id) / "logs" / "recovery.log").is_file()


def test_run_bom_spec_task_recovers_complete_report_after_nonzero_codex_exit(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.services import bom_spec_compare_task_service

    task_id = UUID("44444444-4444-4444-4444-444444444444")
    input_path = tmp_path / str(task_id) / "input"
    report_path = tmp_path / str(task_id) / "reports"
    input_path.mkdir(parents=True)
    report_path.mkdir(parents=True)
    (input_path / "9-16.rar").write_bytes(b"rar")
    existing_zip = report_path / "9-16.zip"
    existing_zip.write_bytes(b"existing zip")
    _write_complete_summary(report_path)

    monkeypatch.setattr(
        bom_spec_compare_task_service,
        "_run_codex_process",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=["codex"],
            returncode=1,
            stdout="报告已生成",
            stderr="[Errno 9] Bad file descriptor",
        ),
    )

    result = bom_spec_compare_task_service.run_task_with_codex(task_id)

    assert result["project_count"] == 2
    assert result["success_count"] == 2
    assert result["consistent_count"] == 2
    assert result["different_count"] == 0
    assert result["failed_count"] == 0
    assert result["result_files"][0]["file_name"] == "9-16.zip"
    assert result["result_files"][0]["file_size"] == len(b"existing zip")
    assert (tmp_path / str(task_id) / "logs" / "recovery.log").is_file()


def test_run_bom_spec_task_keeps_timeout_failure_without_complete_report(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    from app.services import bom_spec_compare_task_service

    task_id = UUID("33333333-3333-3333-3333-333333333333")
    (tmp_path / str(task_id) / "input").mkdir(parents=True)
    (tmp_path / str(task_id) / "reports").mkdir(parents=True)

    monkeypatch.setattr(
        bom_spec_compare_task_service,
        "_run_codex_process",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            subprocess.TimeoutExpired(["codex"], kwargs.get("timeout_seconds", 1800))
        ),
    )

    with pytest.raises(RuntimeError, match="BOM配送检查超时"):
        bom_spec_compare_task_service.run_task_with_codex(task_id)


def test_summary_from_json_reads_success_results_with_summary_counts(
    tmp_path: Path,
) -> None:
    from app.services import bom_spec_compare_task_service

    summary_path = tmp_path / "BOM与规格书配件对比清单20260916.json"
    summary_path.write_text(
        json.dumps(
            {
                "project_count": 2,
                "results": [
                    {
                        "project": "ok",
                        "status": "成功",
                        "summary": {
                            "一致": 4,
                            "不一致": 0,
                            "BOM有规格书无": 0,
                            "规格书有BOM无": 0,
                        },
                    },
                    {
                        "project": "diff",
                        "status": "成功",
                        "summary": {
                            "一致": 3,
                            "不一致": 0,
                            "BOM有规格书无": 1,
                            "规格书有BOM无": 0,
                        },
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    summary = bom_spec_compare_task_service._summary_from_json(summary_path)

    assert summary == {
        "project_count": 2,
        "success_count": 2,
        "consistent_count": 1,
        "different_count": 1,
        "failed_count": 0,
    }


def test_create_bom_spec_task_extracts_rar(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))

    started_task_ids = []
    _mock_rar_extraction(monkeypatch)
    monkeypatch.setattr(
        "app.api.routes.bom_spec_compare_tasks.start_bom_spec_compare_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    rar_path = tmp_path / "bom-input.rar"
    rar_path.write_bytes(b"rar")
    with rar_path.open("rb") as file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-spec-compare-tasks",
            headers=normal_user_token_headers,
            data={"task_name": "rar 检查"},
            files={"project_upload": ("bom-input.rar", file, "application/vnd.rar")},
        )

    assert response.status_code == 200
    content = response.json()
    extracted_dir = tmp_path / content["id"] / "input" / "projects" / "demo"
    assert (extracted_dir / "bom.xlsx").is_file()
    assert (extracted_dir / "spec.pdf").is_file()
    assert [str(task_id) for task_id in started_task_ids] == [content["id"]]


def test_normal_user_cannot_access_other_user_bom_spec_task(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))
    other_user, _ = create_key_user(db)
    task = BomSpecCompareTask(
        user_id=other_user.id,
        task_name="other",
        status=BomSpecCompareTaskStatus.success,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    response = client.get(
        f"{settings.API_V1_STR}/bom-spec-compare-tasks/{task.id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_admin_can_list_all_bom_spec_tasks_with_all_scope(
    client: TestClient,
    db: Session,
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_SPEC_COMPARE_STORAGE_DIR", str(tmp_path))
    user = create_key_user(db)[0]
    user_task = BomSpecCompareTask(
        user_id=user.id,
        task_name="visible-to-admin",
        status=BomSpecCompareTaskStatus.success,
    )
    db.add(user_task)
    admin, admin_key = create_key_user(db)
    admin.role = UserRole.admin
    db.add(admin)
    db.commit()
    admin_headers = authentication_token_from_key(client=client, key=admin_key.key, db=db)

    response = client.get(
        f"{settings.API_V1_STR}/bom-spec-compare-tasks?scope=all",
        headers=admin_headers,
    )

    assert response.status_code == 200
    ids = {task["id"] for task in response.json()["data"]}
    assert str(user_task.id) in ids


def test_bom_spec_stats_separate_task_and_project_counts(
    client: TestClient,
    db: Session,
) -> None:
    user, api_key = create_key_user(db)
    headers = authentication_token_from_key(client=client, key=api_key.key, db=db)
    success_task = BomSpecCompareTask(
        user_id=user.id,
        task_name="success",
        status=BomSpecCompareTaskStatus.success,
        project_count=10,
        success_count=10,
        consistent_count=9,
        different_count=1,
        failed_count=0,
    )
    failed_task = BomSpecCompareTask(
        user_id=user.id,
        task_name="failed-before-report",
        status=BomSpecCompareTaskStatus.failed,
        project_count=0,
        success_count=0,
        consistent_count=0,
        different_count=0,
        failed_count=0,
    )
    db.add(success_task)
    db.add(failed_task)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/bom-spec-compare-tasks/stats",
        headers=headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["task_total_count"] == 2
    assert content["task_success_count"] == 1
    assert content["task_failed_count"] == 1
    assert content["project_total_count"] == 10
    assert content["project_consistent_count"] == 9
    assert content["project_different_count"] == 1
    assert content["project_failed_count"] == 0
