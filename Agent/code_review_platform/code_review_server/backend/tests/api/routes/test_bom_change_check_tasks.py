import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.models import BomChangeCheckTaskStatus


def _create_project_zip(path: Path) -> Path:
    zip_path = path / "bom-change-input.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("项目A/改制前BOM.xlsx", b"xlsx")
        archive.writestr("项目A/改制后BOM.xlsx", b"xlsx")
        archive.writestr("项目A/改制单.xlsx", b"xlsx")
        archive.writestr("项目A/公司总料表.xlsx", b"xlsx")
    return zip_path


def _create_nested_project_zip(path: Path) -> Path:
    zip_path = path / "bom-change-nested-input.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("7-24/改制前BOM/改制前.xlsx", b"xlsx")
        archive.writestr("7-24/改制后BOM/改制后.xlsx", b"xlsx")
        archive.writestr("7-24/改制单/改制单.xlsx", b"xlsx")
        archive.writestr("7-24/公司物料表/压缩包旧表.xlsx", b"old")
    return zip_path


def _write_replacement_table(path: Path, content: bytes = b"replacement") -> Path:
    path.write_bytes(content)
    return path


def test_create_bom_change_check_task_accepts_project_archive(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_CHANGE_CHECK_STORAGE_DIR", str(tmp_path))
    started_task_ids = []
    monkeypatch.setattr(
        "app.api.routes.bom_change_check_tasks.start_bom_change_check_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    zip_path = _create_project_zip(tmp_path)
    key_replacement_path = _write_replacement_table(tmp_path / "key-replacement.xlsx", b"key")
    no_key_replacement_path = _write_replacement_table(tmp_path / "no-key-replacement.xlsx", b"no-key")
    with zip_path.open("rb") as file:
        with key_replacement_path.open("rb") as key_replacement_file:
            with no_key_replacement_path.open("rb") as no_key_replacement_file:
                response = client.post(
                    f"{settings.API_V1_STR}/bom-change-check-tasks",
                    headers=normal_user_token_headers,
                    data={"task_name": "616291001 批量检查"},
                    files={
                        "project_upload": ("bom-change-input.zip", file, "application/zip"),
                        "key_replacement_table_upload": (
                            "网页关键物料替代表.xlsx",
                            key_replacement_file,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        ),
                        "no_key_replacement_table_upload": (
                            "网页无关键物料替代表.xlsx",
                            no_key_replacement_file,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        ),
                    },
                )

    assert response.status_code == 200
    content = response.json()
    assert content["task_name"] == "616291001 批量检查"
    assert content["status"] == BomChangeCheckTaskStatus.queued
    assert content["input_files"][0]["role"] == "project_upload"
    assert any(file["role"] == "replacement_table_used" for file in content["input_files"])
    assert [str(task_id) for task_id in started_task_ids] == [content["id"]]
    extracted_dir = tmp_path / content["id"] / "input" / "projects" / "项目A"
    assert (extracted_dir / "改制前BOM.xlsx").is_file()
    company_dir = tmp_path / content["id"] / "input" / "projects" / "公司物料表"
    assert (company_dir / "网页关键物料替代表.xlsx").read_bytes() == b"key"
    assert (company_dir / "网页无关键物料替代表.xlsx").read_bytes() == b"no-key"


def test_create_bom_change_check_task_places_replacement_table_in_detected_batch_root(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_CHANGE_CHECK_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "app.api.routes.bom_change_check_tasks.start_bom_change_check_task",
        lambda task_id: None,
    )

    zip_path = _create_nested_project_zip(tmp_path)
    replacement_path = _write_replacement_table(tmp_path / "replacement.xlsx", b"web")
    with zip_path.open("rb") as file:
        with replacement_path.open("rb") as replacement_file:
            response = client.post(
                f"{settings.API_V1_STR}/bom-change-check-tasks",
                headers=normal_user_token_headers,
                data={"task_name": "嵌套目录"},
                files={
                    "project_upload": ("bom-change-nested-input.zip", file, "application/zip"),
                    "key_replacement_table_upload": ("网页关键物料替代表.xlsx", replacement_file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                },
            )

    assert response.status_code == 200
    content = response.json()
    batch_root = tmp_path / content["id"] / "input" / "projects" / "7-24"
    assert (batch_root / "公司物料表" / "网页关键物料替代表.xlsx").read_bytes() == b"web"
    assert not (batch_root / "公司物料表" / "压缩包旧表.xlsx").exists()
    assert not (tmp_path / content["id"] / "input" / "projects" / "公司物料表").exists()


def test_create_bom_change_check_task_reuses_latest_replacement_table(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_CHANGE_CHECK_STORAGE_DIR", str(tmp_path))
    started_task_ids = []
    monkeypatch.setattr(
        "app.api.routes.bom_change_check_tasks.start_bom_change_check_task",
        lambda task_id: started_task_ids.append(task_id),
    )
    from app.services import bom_change_check_task_service

    bom_change_check_task_service.save_global_replacement_table_bytes(
        filename="历史关键物料替代表.xlsx",
        content=b"key-latest",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by="tester",
        role="key",
    )
    bom_change_check_task_service.save_global_replacement_table_bytes(
        filename="历史无关键物料替代表.xlsx",
        content=b"no-key-latest",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by="tester",
        role="no_key",
    )

    zip_path = _create_project_zip(tmp_path)
    with zip_path.open("rb") as file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-change-check-tasks",
            headers=normal_user_token_headers,
            data={"task_name": "复用替代料表"},
            files={"project_upload": ("bom-change-input.zip", file, "application/zip")},
        )

    assert response.status_code == 200
    content = response.json()
    assert [str(task_id) for task_id in started_task_ids] == [content["id"]]
    company_dir = tmp_path / content["id"] / "input" / "projects" / "公司物料表"
    assert (company_dir / "历史关键物料替代表.xlsx").read_bytes() == b"key-latest"
    assert (company_dir / "历史无关键物料替代表.xlsx").read_bytes() == b"no-key-latest"


def test_create_bom_change_check_task_requires_replacement_table_when_none_saved(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_CHANGE_CHECK_STORAGE_DIR", str(tmp_path))
    started_task_ids = []
    monkeypatch.setattr(
        "app.api.routes.bom_change_check_tasks.start_bom_change_check_task",
        lambda task_id: started_task_ids.append(task_id),
    )

    zip_path = _create_project_zip(tmp_path)
    with zip_path.open("rb") as file:
        response = client.post(
            f"{settings.API_V1_STR}/bom-change-check-tasks",
            headers=normal_user_token_headers,
            data={"task_name": "missing replacement"},
            files={"project_upload": ("bom-change-input.zip", file, "application/zip")},
        )

    assert response.status_code == 400
    assert "请先上传关键物料/无关键物料替代表" in response.json()["detail"]
    assert started_task_ids == []


def test_read_latest_bom_change_replacement_table_metadata(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "BOM_CHANGE_CHECK_STORAGE_DIR", str(tmp_path))
    from app.services import bom_change_check_task_service

    response = client.get(
        f"{settings.API_V1_STR}/bom-change-check-tasks/replacement-table",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["exists"] is False

    bom_change_check_task_service.save_global_replacement_table_bytes(
        filename="关键物料替代表.xlsx",
        content=b"key",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by="tester",
        role="key",
    )
    bom_change_check_task_service.save_global_replacement_table_bytes(
        filename="无关键物料替代表.xlsx",
        content=b"no-key",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by="tester",
        role="no_key",
    )

    response = client.get(
        f"{settings.API_V1_STR}/bom-change-check-tasks/replacement-table",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    content = response.json()
    assert content["exists"] is True
    assert content["all_exists"] is True
    assert content["tables"]["key"]["file_name"] == "关键物料替代表.xlsx"
    assert content["tables"]["key"]["file_size"] == 3
    assert content["tables"]["no_key"]["file_name"] == "无关键物料替代表.xlsx"
    assert content["tables"]["no_key"]["file_size"] == 6


def test_bom_change_check_task_requires_project_archive(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/bom-change-check-tasks",
        headers=normal_user_token_headers,
        data={"task_name": "missing"},
    )

    assert response.status_code == 422
