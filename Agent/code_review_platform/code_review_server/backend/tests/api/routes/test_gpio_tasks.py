from pathlib import Path
from urllib.parse import unquote
import uuid
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import GpioTaskStatus, UserRole
from app.services.credential_service import CredentialService
from tests.utils.user import authentication_token_from_key, create_key_user


def _bind_svn_password(db: Session, user_id: object, password: str = "secret") -> None:
    CredentialService(settings.SVN_CREDENTIAL_MASTER_KEY).save_svn_password(
        db, user_id, password
    )


def _create_gpio_task(
    client: TestClient,
    headers: dict[str, str],
    *,
    code_svn_url: str = "svn://repo/code",
    code_revision: str = "123",
) -> dict:
    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=headers,
        data={
            "code_svn_url": code_svn_url,
            "code_revision": code_revision,
        },
        files={
            "manual_upload": (
                "manual.csv",
                b"\xe5\xbc\x95\xe8\x84\x9a\xe7\xbc\x96\xe5\x8f\xb7,\xe5\xbc\x95\xe8\x84\x9a\xe5\x90\x8d\xe7\xa7\xb0\n1,PA0\n",
                "text/csv",
            )
        },
    )
    assert response.status_code == 200
    return response.json()


def _stub_svn_workbook(monkeypatch, tmp_path: Path) -> None:
    def fake_export_svn_sources(task_id, *args, **kwargs):
        export_path = tmp_path / str(task_id) / "svn-sources"
        export_path.mkdir(parents=True, exist_ok=True)
        return export_path

    def fake_generate_workbook_with_codex(task_id, *args, **kwargs):
        result_path = tmp_path / str(task_id) / "GPIO配置表.xlsx"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_bytes(b"PK\x03\x04")
        return result_path, {"source": "fake"}

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )


def test_create_gpio_task_uses_current_user(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    result_path = tmp_path / "GPIO配置表.xlsx"

    def fake_export_svn_sources(task_id, *args, **kwargs):
        assert kwargs["code_svn_url"] == "svn://repo/code"
        assert kwargs["code_revision"] == "r123"
        assert kwargs["svn_password"] == "secret"
        export_path = tmp_path / str(task_id) / "svn-sources"
        export_path.mkdir(parents=True, exist_ok=True)
        return export_path

    def fake_generate_workbook_with_codex(*args, **kwargs):
        result_path.write_bytes(b"PK\x03\x04")
        assert kwargs["uploaded_files"][0]["file_name"] == "manual.csv"
        assert len(kwargs["uploaded_files"]) == 1
        assert kwargs["code_svn_url"] == "svn://repo/code"
        assert kwargs["code_revision"] == "r123"
        assert kwargs["project_no"] == ""
        assert kwargs["chip_model"] == ""
        assert kwargs["package_name"] is None
        return result_path, {"source": "fake", "project": "P1", "chip": "N32G455VBL7"}

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )
    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=normal_user_token_headers,
        data={
            "code_svn_url": "svn://repo/code",
            "code_revision": "123",
        },
        files={
            "manual_upload": ("manual.csv", b"pin_no,pin_name\n1,PA0\n", "text/csv")
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["status"] == "success"
    assert content["project_no"] == "P1"
    assert content["chip_model"] == "N32G455VBL7"
    assert content["code_svn_url"] == "svn://repo/code"
    assert content["code_revision"] == "r123"
    assert content["uploaded_files"][0]["file_name"] == "manual.csv"
    assert content["result_path"] == str(result_path)
    assert content["result_name"] == "GPIO配置表.xlsx"


def test_create_gpio_task_accepts_multiple_manual_files(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    result_path = tmp_path / "GPIO配置表.xlsx"

    def fake_export_svn_sources(task_id, *args, **kwargs):
        export_path = tmp_path / str(task_id) / "svn-sources"
        export_path.mkdir(parents=True, exist_ok=True)
        return export_path

    def fake_generate_workbook_with_codex(*args, **kwargs):
        result_path.write_bytes(b"PK\x03\x04")
        uploaded_names = [item["file_name"] for item in kwargs["uploaded_files"]]
        assert uploaded_names == ["manual.csv", "supplement.txt"]
        return result_path, {"source": "fake", "project": "P1", "chip": "N32G455VBL7"}

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )

    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=normal_user_token_headers,
        data={
            "code_svn_url": "svn://repo/code",
            "code_revision": "123",
        },
        files=[
            ("manual_uploads", ("manual.csv", b"pin_no,pin_name\n1,PA0\n", "text/csv")),
            ("manual_uploads", ("supplement.txt", b"N32G455VBL7 LQFP100", "text/plain")),
        ],
    )

    assert response.status_code == 200
    content = response.json()
    assert [item["file_name"] for item in content["uploaded_files"]] == [
        "manual.csv",
        "supplement.txt",
    ]
    assert content["manual_file_name"] == "manual.csv"


def test_create_gpio_task_records_server_svn_export_path(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    result_path = tmp_path / "GPIO配置表.xlsx"
    export_path = tmp_path / "task" / "svn-sources"

    def fake_export_svn_sources(*args, **kwargs):
        export_path.mkdir(parents=True, exist_ok=True)
        return export_path

    def fake_generate_workbook_with_codex(*args, **kwargs):
        result_path.write_bytes(b"PK\x03\x04")
        return result_path, {"source": "fake", "svn_export_path": str(export_path)}

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )

    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=normal_user_token_headers,
        data={
            "code_svn_url": "svn://repo/code",
            "code_revision": "123",
        },
        files={
            "manual_upload": ("manual.csv", b"pin_no,pin_name\n1,PA0\n", "text/csv")
        },
    )

    assert response.status_code == 200
    content = response.json()
    assert content["status"] == "success"
    assert content["svn_export_path"] == str(export_path)


def test_create_gpio_task_requires_manual_file_and_code_svn_fields(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=normal_user_token_headers,
        data={"code_svn_url": "svn://repo/code"},
    )

    assert response.status_code == 422


def test_create_gpio_task_rejects_invalid_revision(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/gpio-tasks",
        headers=normal_user_token_headers,
        data={
            "code_svn_url": "svn://repo/code",
            "code_revision": "abc",
        },
        files={
            "manual_upload": ("manual.csv", b"pin_no,pin_name\n1,PA0\n", "text/csv")
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "SVN revision must be a number or r-number"


def test_generate_gpio_task_creates_downloadable_workbook(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "GPIO_STORAGE_DIR", str(tmp_path))
    result_path = tmp_path / "GPIO配置表.xlsx"

    def fake_export_svn_sources(task_id, *args, **kwargs):
        export_path = tmp_path / str(task_id) / "svn-sources"
        export_path.mkdir(parents=True, exist_ok=True)
        return export_path

    def fake_generate_workbook_with_codex(*args, **kwargs):
        from app.services.gpio_task_service import _write_gpio_workbook

        analysis = {
            "summary": {
                "project": "P1",
                "chip": "N32G455VBL7",
                "package": "LQFP100",
                "source": "fake",
            },
            "gpio_rows": [],
            "trigger_rows": [],
        }
        _write_gpio_workbook(result_path, analysis)
        return result_path, analysis["summary"]

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )
    generated = _create_gpio_task(client, normal_user_token_headers)

    assert generated["status"] == "success"
    assert generated["result_name"] == "GPIO配置表.xlsx"
    result_path = Path(generated["result_path"])
    assert result_path.is_file()

    with ZipFile(result_path) as workbook:
        workbook_xml = workbook.read("xl/workbook.xml").decode("utf-8")
        shared_strings = workbook.read("xl/sharedStrings.xml").decode("utf-8")
    assert 'name="GPIO配置表"' in workbook_xml
    assert 'name="MCU外设触发关系"' in workbook_xml
    for header in ["引脚编号", "引脚名称", "使用引脚定义", "IO模式", "说明"]:
        assert header in shared_strings
    for header in [
        "分类",
        "外设模块",
        "关联引脚",
        "触发/控制规则",
        "触发后动作",
        "证据/备注",
    ]:
        assert header in shared_strings

    download_response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/{generated['id']}/download",
        headers=normal_user_token_headers,
    )
    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "GPIO配置表.xlsx" in unquote(
        download_response.headers["content-disposition"]
    )


def test_create_gpio_task_extracts_real_gpio_skill_inputs_from_svn_sources(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "GPIO_STORAGE_DIR", str(tmp_path))
    bundle_path = tmp_path / "SST25-0001-REV1.0_gpio_inputs.zip"
    import zipfile

    with zipfile.ZipFile(bundle_path, "w") as archive:
        archive.writestr(
            "manual/pin_table.csv",
            "\n".join(
                [
                    "引脚编号,引脚名称",
                    "1,PE2/UART6_TX",
                    "2,PC0/ADC12_IN6/I2C3_SCL/COMP7_INM/UART6_TX",
                    "3,VSS_1",
                ]
            ),
        )
        archive.writestr(
            "resource/gpio_resource.csv",
            "\n".join(
                [
                    "引脚名称,使用引脚定义,说明",
                    "PE2,CAN_TX,CAN 通信发送。",
                    "PC0,NTC1,NTC1 温度模拟采样输入。",
                    "VSS_1,GND,数字地。",
                ]
            ),
        )
        archive.writestr(
            "project/Device_Init.c",
            """
            // SST25-0001-REV1.0 N32G455VBL7 LQFP100
            GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AF_PP;
            GPIO_InitPeripheral(GPIOE, GPIO_PIN_2, &GPIO_InitStructure);
            GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AIN;
            GPIO_InitPeripheral(GPIOC, GPIO_PIN_0, &GPIO_InitStructure);
            ADC_RegularChannelConfig(ADC1, ADC_Channel_10, 1, ADC_SampleTime_55Cycles5);
            EXTI_InitStructure.EXTI_Trigger = EXTI_Trigger_Falling;
            USART_Init(UART6, &USART_InitStructure);
            CAN_Init(CAN1, &CAN_InitStructure);
            """,
        )

    from app.services import gpio_task_service

    task_id = uuid.uuid4()
    source_dir = gpio_task_service.svn_sources_dir(task_id)
    source_dir.mkdir(parents=True)
    shutil_path = source_dir / bundle_path.name
    shutil_path.write_bytes(bundle_path.read_bytes())

    result_path, summary = gpio_task_service.create_workbook(
        task_id, gpio_task_service.collect_source_files(source_dir)
    )

    assert summary["project"] == "SST25-0001-REV1.0"
    assert summary["chip"] == "N32G455VBL7"
    assert summary["package"] == "LQFP100"

    with ZipFile(result_path) as workbook:
        workbook_xml = workbook.read("xl/workbook.xml").decode("utf-8")
        shared_strings = workbook.read("xl/sharedStrings.xml").decode("utf-8")

    assert 'name="GPIO配置表"' in workbook_xml
    assert 'name="MCU外设触发关系"' in workbook_xml
    for value in [
        "SST25-0001-REV1.0-MCU资源分配（N32G455VBL7）",
        "PE2/UART6_TX",
        "CAN_TX",
        "复用-推挽",
        "PC0/ADC12_IN6/I2C3_SCL/COMP7_INM/UART6_TX",
        "NTC1",
        "模拟",
        "GND",
        "固定功能",
        "ADC/COMP",
        "UART",
        "CAN",
        "EXTI",
        "下降沿触发",
    ]:
        assert value in shared_strings


def test_normal_user_cannot_access_other_user_gpio_task(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    other_user, other_api_key = create_key_user(db)
    other_user.svn_username = "other-svn-user"
    db.add(other_user)
    db.commit()
    _bind_svn_password(db, other_user.id)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    task = _create_gpio_task(client, other_headers)

    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_admin_default_gpio_task_list_only_includes_own_tasks(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    user_task = _create_gpio_task(client, normal_user_token_headers)
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    admin.svn_username = "admin-svn-user"
    db.add(admin)
    db.commit()
    _bind_svn_password(db, admin.id)
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )
    admin_task = _create_gpio_task(client, admin_headers)

    response = client.get(f"{settings.API_V1_STR}/gpio-tasks", headers=admin_headers)

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert admin_task["id"] in listed_ids
    assert user_task["id"] not in listed_ids


def test_admin_can_list_all_gpio_tasks_with_all_scope(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    user_task = _create_gpio_task(client, normal_user_token_headers)
    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    admin.svn_username = "admin-svn-user-all"
    db.add(admin)
    db.commit()
    _bind_svn_password(db, admin.id)
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )

    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks?scope=all",
        headers=admin_headers,
    )

    assert response.status_code == 200
    listed_ids = {task["id"] for task in response.json()["data"]}
    assert user_task["id"] in listed_ids


def test_normal_user_cannot_list_all_gpio_tasks(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks?scope=all",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_gpio_task_stats_are_scoped_to_current_user(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    baseline_response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/stats",
        headers=normal_user_token_headers,
    )
    assert baseline_response.status_code == 200
    baseline = baseline_response.json()

    _create_gpio_task(client, normal_user_token_headers)

    other_user, other_api_key = create_key_user(db)
    other_user.svn_username = "other-svn-user-stats"
    db.add(other_user)
    db.commit()
    _bind_svn_password(db, other_user.id)
    other_headers = authentication_token_from_key(
        client=client, key=other_api_key.key, db=db
    )
    _create_gpio_task(client, other_headers)

    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/stats",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] - baseline["total"] == 1
    assert content["success"] - baseline["success"] == 1
    assert content["failed_or_error"] - baseline["failed_or_error"] == 0
    assert content["by_status"]["success"] - baseline["by_status"]["success"] == 1
    assert set(content["by_status"]) == {status.value for status in GpioTaskStatus}


def test_admin_default_gpio_task_stats_only_include_own_tasks(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    _create_gpio_task(client, normal_user_token_headers)

    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    admin.svn_username = "admin-svn-user-stats"
    db.add(admin)
    db.commit()
    _bind_svn_password(db, admin.id)
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )
    _create_gpio_task(client, admin_headers)

    response = client.get(f"{settings.API_V1_STR}/gpio-tasks/stats", headers=admin_headers)

    assert response.status_code == 200
    content = response.json()
    assert content["total"] == 1
    assert content["success"] == 1
    assert content["workbooks_by_user"][0]["svn_username"] == "admin-svn-user-stats"


def test_admin_gpio_task_stats_include_all_users_with_all_scope(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    _stub_svn_workbook(monkeypatch, tmp_path)
    _create_gpio_task(client, normal_user_token_headers)

    admin, admin_api_key = create_key_user(db)
    admin.role = UserRole.admin
    admin.svn_username = "admin-svn-user-all-stats"
    db.add(admin)
    db.commit()
    _bind_svn_password(db, admin.id)
    admin_headers = authentication_token_from_key(
        client=client, key=admin_api_key.key, db=db
    )
    _create_gpio_task(client, admin_headers)

    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/stats?scope=all",
        headers=admin_headers,
    )

    assert response.status_code == 200
    content = response.json()
    assert content["total"] >= 2
    assert content["success"] >= 2
    assert content["workbooks_by_user"]


def test_normal_user_cannot_read_all_gpio_task_stats(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/gpio-tasks/stats?scope=all",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403


def test_delete_gpio_task_removes_svn_sources_and_result_files(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "GPIO_STORAGE_DIR", str(tmp_path))

    def fake_export_svn_sources(task_id, *args, **kwargs):
        source_dir = tmp_path / str(task_id) / "svn-sources"
        source_dir.mkdir(parents=True)
        source_file = source_dir / "manual.csv"
        source_file.write_text("引脚编号,引脚名称\n1,PA0\n", encoding="utf-8")
        return source_dir

    def fake_generate_workbook_with_codex(task_id, *args, **kwargs):
        result_path = tmp_path / str(task_id) / "GPIO配置表.xlsx"
        result_path.write_bytes(b"PK\x03\x04")
        return result_path, {"source": "fake"}

    monkeypatch.setattr(
        "app.services.gpio_task_service.export_svn_sources",
        fake_export_svn_sources,
    )
    monkeypatch.setattr(
        "app.services.gpio_task_service.generate_workbook_with_codex",
        fake_generate_workbook_with_codex,
    )
    task = _create_gpio_task(client, normal_user_token_headers)
    task_dir = tmp_path / task["id"]
    result_path = Path(task["result_path"])

    response = client.delete(
        f"{settings.API_V1_STR}/gpio-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "GPIO task deleted"}
    assert not result_path.exists()
    assert not task_dir.exists()
