import zipfile
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import BomElectronicEditTask, BomElectronicEditTaskStatus
from tests.utils.user import create_random_user


def _write_xlsx(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws["A1"] = "test"
    wb.save(path)
    return path


def _write_archive(path: Path, files: dict[str, Path]) -> Path:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for archive_name, source in files.items():
            archive.write(source, archive_name)
    return path


def _clear_active_bom_electronic_edit_tasks(db: Session) -> None:
    existing_active_tasks = db.exec(
        select(BomElectronicEditTask).where(
            col(BomElectronicEditTask.status).in_(
                [
                    BomElectronicEditTaskStatus.queued,
                    BomElectronicEditTaskStatus.running,
                    BomElectronicEditTaskStatus.uploading_report,
                ]
            )
        )
    ).all()
    for task in existing_active_tasks:
        task.status = BomElectronicEditTaskStatus.success
        db.add(task)
    db.commit()


def test_create_bom_electronic_edit_task_accepts_archive_with_change_master_and_bom_folder(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_ELECTRONIC_EDIT_STORAGE_DIR", str(tmp_path))
    started_task_ids = []
    monkeypatch.setattr(
        "app.api.routes.bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks",
        lambda task_id: started_task_ids.append(task_id),
    )

    change = _write_xlsx(tmp_path / "change.xlsx")
    bom = _write_xlsx(tmp_path / "bom.xlsx")
    second_bom = _write_xlsx(tmp_path / "bom2.xlsx")
    master = _write_xlsx(tmp_path / "master.xlsx")
    archive = _write_archive(
        tmp_path / "input.zip",
        {
            "工程变更通知单.xlsx": change,
            "01-物料主数据查询.xlsx": master,
            "变更BOM/BOM.xlsx": bom,
            "变更BOM/BOM2.xlsx": second_bom,
        },
    )
    with archive.open("rb") as archive_file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-electronic-edit-tasks",
            headers=normal_user_token_headers,
            data={"task_name": "BOM电子档修改测试"},
            files={"project_archive_upload": ("资料包.zip", archive_file, "application/zip")},
        )

    assert response.status_code == 200
    content = response.json()
    assert content["task_name"] == "BOM电子档修改测试"
    assert content["status"] == BomElectronicEditTaskStatus.queued
    assert {file["role"] for file in content["input_files"]} == {
        "change_notice",
        "bom",
        "material_master",
        "project_archive",
    }
    assert not any(file["role"] == "task_options" for file in content["input_files"])
    assert [str(task_id) for task_id in started_task_ids] == [content["id"]]
    assert (tmp_path / content["id"] / "input" / "package" / "工程变更通知单.xlsx").is_file()
    assert (tmp_path / content["id"] / "input" / "package" / "变更BOM" / "BOM.xlsx").is_file()
    assert (tmp_path / content["id"] / "input" / "package" / "变更BOM" / "BOM2.xlsx").is_file()


def test_create_bom_electronic_edit_task_accepts_xls_boms_in_archive(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_ELECTRONIC_EDIT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "app.api.routes.bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks",
        lambda task_id: None,
    )
    change = _write_xlsx(tmp_path / "change.xlsx")
    master = _write_xlsx(tmp_path / "master.xlsx")
    archive = _write_archive(
        tmp_path / "input.zip",
        {
            "工程变更通知单.xlsx": change,
            "01-物料主数据查询.xlsx": master,
            "变更BOM/BOM-SST20-8331-3.1-001.xls": change,
            "变更BOM/BOM-SST24-1574-1.0-005.xlsx": change,
        },
    )
    with archive.open("rb") as archive_file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-electronic-edit-tasks",
            headers=normal_user_token_headers,
            files={"project_archive_upload": ("资料包.zip", archive_file, "application/zip")},
        )

    assert response.status_code == 200
    content = response.json()
    bom_files = [file for file in content["input_files"] if file["role"] == "bom"]
    assert [Path(file["file_name"]).suffix for file in bom_files] == [".xls", ".xlsx"]


def test_create_bom_electronic_edit_task_requires_all_uploads(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/bom-electronic-edit-tasks",
        headers=normal_user_token_headers,
        data={"task_name": "missing"},
    )

    assert response.status_code == 422


def test_read_bom_electronic_edit_stats(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/bom-electronic-edit-tasks/stats",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] >= 0
    assert content["modified_count"] >= 0
    assert "success" in content["by_status"]


def test_download_ticket_serves_existing_bom_electronic_edit_result(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_ELECTRONIC_EDIT_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "app.api.routes.bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks",
        lambda task_id: None,
    )
    archive = _write_archive(
        tmp_path / "input.zip",
        {
            "工程变更通知单.xlsx": _write_xlsx(tmp_path / "change.xlsx"),
            "物料主数据查询.xlsx": _write_xlsx(tmp_path / "master.xlsx"),
            "变更BOM/bom.xlsx": _write_xlsx(tmp_path / "bom.xlsx"),
        },
    )
    with archive.open("rb") as archive_file:
        create_response = client.post(
            f"{settings.API_V1_STR}/bom-electronic-edit-tasks",
            headers=normal_user_token_headers,
            files={"project_archive_upload": ("资料包.zip", archive_file, "application/zip")},
        )
    task_id = create_response.json()["id"]
    result_file = tmp_path / task_id / "reports" / "BOM电子档修改结果.zip"
    result_file.parent.mkdir(parents=True, exist_ok=True)
    _write_archive(result_file, {"bom.xlsx": _write_xlsx(tmp_path / "result-bom.xlsx")})

    with Session(engine) as session:
        task = session.get(BomElectronicEditTask, task_id)
        assert task is not None
        task.result_files = []
        session.add(task)
        session.commit()

    ticket_response = client.post(
        f"{settings.API_V1_STR}/bom-electronic-edit-tasks/{task_id}/download-ticket",
        headers=normal_user_token_headers,
    )

    assert ticket_response.status_code == 200
    response = client.get(ticket_response.json()["url"])
    assert response.status_code == 200
    assert response.content
    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        assert "bom.xlsx" in archive.namelist()
        assert "BOM电子档修改清单汇总.xlsx" not in archive.namelist()


def test_schedule_bom_electronic_edit_tasks_starts_at_most_two(db: Session, monkeypatch) -> None:
    from app.api.routes import bom_electronic_edit_tasks

    user = create_random_user(db)
    _clear_active_bom_electronic_edit_tasks(db)
    tasks = [
        BomElectronicEditTask(
            user_id=user.id,
            task_name=f"queued-{index}",
            status=BomElectronicEditTaskStatus.queued,
        )
        for index in range(3)
    ]
    for task in tasks:
        db.add(task)
    db.commit()
    for task in tasks:
        db.refresh(task)

    started_task_ids = []
    monkeypatch.setattr(
        bom_electronic_edit_tasks,
        "start_bom_electronic_edit_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks()

    for task in tasks:
        db.refresh(task)
    assert started_task_ids == [tasks[0].id, tasks[1].id]
    assert tasks[0].status == BomElectronicEditTaskStatus.running
    assert tasks[1].status == BomElectronicEditTaskStatus.running
    assert tasks[2].status == BomElectronicEditTaskStatus.queued


def test_schedule_bom_electronic_edit_tasks_starts_one_task_per_user(db: Session, monkeypatch) -> None:
    from app.api.routes import bom_electronic_edit_tasks

    first_user = create_random_user(db)
    second_user = create_random_user(db)
    _clear_active_bom_electronic_edit_tasks(db)
    first_user_tasks = [
        BomElectronicEditTask(
            user_id=first_user.id,
            task_name=f"first-user-{index}",
            status=BomElectronicEditTaskStatus.queued,
        )
        for index in range(2)
    ]
    second_user_task = BomElectronicEditTask(
        user_id=second_user.id,
        task_name="second-user",
        status=BomElectronicEditTaskStatus.queued,
    )
    for task in [*first_user_tasks, second_user_task]:
        db.add(task)
    db.commit()
    for task in [*first_user_tasks, second_user_task]:
        db.refresh(task)

    started_task_ids = []
    monkeypatch.setattr(
        bom_electronic_edit_tasks,
        "start_bom_electronic_edit_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks()

    for task in [*first_user_tasks, second_user_task]:
        db.refresh(task)
    assert started_task_ids == [first_user_tasks[0].id, second_user_task.id]
    assert first_user_tasks[0].status == BomElectronicEditTaskStatus.running
    assert first_user_tasks[1].status == BomElectronicEditTaskStatus.queued
    assert second_user_task.status == BomElectronicEditTaskStatus.running


def test_schedule_bom_electronic_edit_tasks_prefers_user_without_active_task(
    db: Session, monkeypatch
) -> None:
    from app.api.routes import bom_electronic_edit_tasks

    first_user = create_random_user(db)
    second_user = create_random_user(db)
    _clear_active_bom_electronic_edit_tasks(db)
    running_task = BomElectronicEditTask(
        user_id=first_user.id,
        task_name="first-user-running",
        status=BomElectronicEditTaskStatus.running,
    )
    first_user_queued_task = BomElectronicEditTask(
        user_id=first_user.id,
        task_name="first-user-queued",
        status=BomElectronicEditTaskStatus.queued,
    )
    second_user_queued_task = BomElectronicEditTask(
        user_id=second_user.id,
        task_name="second-user-queued",
        status=BomElectronicEditTaskStatus.queued,
    )
    for task in [running_task, first_user_queued_task, second_user_queued_task]:
        db.add(task)
    db.commit()
    for task in [running_task, first_user_queued_task, second_user_queued_task]:
        db.refresh(task)

    started_task_ids = []
    monkeypatch.setattr(
        bom_electronic_edit_tasks,
        "start_bom_electronic_edit_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    bom_electronic_edit_tasks.schedule_bom_electronic_edit_tasks()

    for task in [running_task, first_user_queued_task, second_user_queued_task]:
        db.refresh(task)
    assert started_task_ids == [second_user_queued_task.id]
    assert running_task.status == BomElectronicEditTaskStatus.running
    assert first_user_queued_task.status == BomElectronicEditTaskStatus.queued
    assert second_user_queued_task.status == BomElectronicEditTaskStatus.running


def test_run_bom_electronic_edit_task_schedules_next_queued_task(db: Session, monkeypatch) -> None:
    from app.api.routes import bom_electronic_edit_tasks

    user = create_random_user(db)
    running_task = BomElectronicEditTask(
        user_id=user.id,
        task_name="running",
        status=BomElectronicEditTaskStatus.running,
        input_files=[],
    )
    queued_task = BomElectronicEditTask(
        user_id=user.id,
        task_name="queued",
        status=BomElectronicEditTaskStatus.queued,
        input_files=[],
    )
    db.add(running_task)
    db.add(queued_task)
    db.commit()
    db.refresh(running_task)
    db.refresh(queued_task)

    monkeypatch.setattr(
        bom_electronic_edit_tasks.bom_electronic_edit_task_service,
        "run_task",
        lambda *args, **kwargs: {
            "result_files": [],
            "modified_count": 0,
            "abnormal_count": 0,
            "report_count": 0,
            "processed_sheet_count": 0,
        },
    )
    scheduled = []
    monkeypatch.setattr(
        bom_electronic_edit_tasks,
        "schedule_bom_electronic_edit_tasks",
        lambda task_id=None: scheduled.append(task_id),
    )

    bom_electronic_edit_tasks.run_bom_electronic_edit_task(running_task.id)

    db.refresh(running_task)
    db.refresh(queued_task)
    assert running_task.status == BomElectronicEditTaskStatus.success
    assert queued_task.status == BomElectronicEditTaskStatus.queued
    assert scheduled == [None]
