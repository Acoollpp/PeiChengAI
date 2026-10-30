from pathlib import Path
from subprocess import CompletedProcess
import json
import subprocess
import uuid

import pytest

from app.services import gpio_task_service


def test_run_svn_export_invokes_svn_through_powershell(
    monkeypatch, tmp_path: Path
) -> None:
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(args[0])
        return CompletedProcess(args=args[0], returncode=0, stdout="Exported", stderr="")

    monkeypatch.setattr("subprocess.run", fake_run)

    gpio_task_service._run_svn_export(
        "https://svn.example.com/svn/src_home/project",
        tmp_path / "code",
        code_revision="r123",
        svn_username="SW_26_XieJinHua",
        svn_password="secret",
        label="code",
        use_runner=False,
    )

    assert calls
    command = calls[0]
    assert command[:4] == [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
    ]
    assert "-File" in command


def test_run_svn_export_can_use_file_queue_runner(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(gpio_task_service, "SVN_RUNNER_POLL_SECONDS", 0)

    def fake_write_job(*args, **kwargs):
        job_dir = tmp_path / "_svn-runner" / "jobs" / "job-1"
        job_dir.mkdir(parents=True)
        (job_dir / "result.json").write_text('{"ok": true}', encoding="utf-8")
        return job_dir

    monkeypatch.setattr(gpio_task_service, "_write_svn_runner_job", fake_write_job)

    gpio_task_service._run_svn_export(
        "https://svn.example.com/svn/src_home/project",
        tmp_path / "code",
        code_revision="r123",
        svn_username="SW_26_XieJinHua",
        svn_password="secret",
        label="code",
        use_runner=True,
    )


def test_run_svn_export_explains_missing_repository_path(monkeypatch, tmp_path: Path) -> None:
    def fake_run(*args, **kwargs):
        return CompletedProcess(
            args=args[0],
            returncode=1,
            stdout="",
            stderr=(
                "svn: E170013: Unable to connect to a repository at URL "
                "'https://svn.example.com/svn/src_home/project'\n"
                "svn: E160013: '/svn/src_home/project' path not found"
            ),
        )

    monkeypatch.setattr("subprocess.run", fake_run)

    with pytest.raises(RuntimeError) as exc_info:
        gpio_task_service._run_svn_export(
            "https://svn.example.com/svn/src_home/project",
            tmp_path / "code",
            code_revision="r123",
            svn_username="SW_26_XieJinHua",
            svn_password="secret",
            label="芯片代码",
            use_runner=False,
        )

    message = str(exc_info.value)
    assert "SVN 地址路径不存在" in message
    assert "https://svn.example.com/svn/src_home/project" in message
    assert "r123" in message


def test_collect_documents_reads_pdf_files(monkeypatch, tmp_path: Path) -> None:
    pdf_path = tmp_path / "datasheet.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(
        gpio_task_service,
        "_read_pdf_text",
        lambda path: "表 3-1 管脚定义\n1 PE2/UART6_TX\n",
    )

    documents = gpio_task_service._collect_documents(
        [{"file_path": str(pdf_path), "file_name": pdf_path.name}]
    )

    assert documents == [
        {"name": "datasheet.pdf", "text": "表 3-1 管脚定义\n1 PE2/UART6_TX\n"}
    ]


def test_extract_manual_pin_rows_from_datasheet_text() -> None:
    documents = [
        {
            "name": "datasheet.pdf",
            "text": (
                "表 3-1 管脚定义\n"
                "QFN36 LQFP48 QFN48 LQFP64 QFN64 LQFP80 LQFP100\n"
                "- - - - - 1 1 PE2 I/O FT Yes PE2 UART6_TX -\n"
                "- - - - - 2 2 PE3 I/O FT Yes PE3 UART6_RX -\n"
                "- - - - - 3 3 VSS_1 S - - VSS_1 - -\n"
            ),
        }
    ]

    rows = gpio_task_service._extract_manual_pin_rows(documents)

    assert rows[:3] == [
        {"pin_no": "1", "pin_name": "PE2"},
        {"pin_no": "2", "pin_name": "PE3"},
        {"pin_no": "3", "pin_name": "VSS_1"},
    ]


def test_extract_manual_pin_rows_prefers_lqfp100_column() -> None:
    documents = [
        {
            "name": "datasheet.pdf",
            "text": (
                "表 3-1 管脚定义\n"
                "QFN36 LQFP48 QFN48 LQFP64 QFN64 LQFP80 LQFP100\n"
                "- - - - - 1 1 PE2 I/O FT Yes PE2 UART6_TX -\n"
                "- - - - - - 10 VSS_5 S - - VSS_5 - -\n"
                "20 29 39 41 41 55 67 PA8 I/O FT Yes PA8 USART1_CK\n"
            ),
        }
    ]

    rows = gpio_task_service._extract_manual_pin_rows(documents)

    assert rows == [
        {"pin_no": "1", "pin_name": "PE2"},
        {"pin_no": "10", "pin_name": "VSS_5"},
        {"pin_no": "67", "pin_name": "PA8"},
    ]


def test_svn_runner_job_uses_absolute_destination(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_STORAGE_DIR", str(tmp_path))
    destination = tmp_path / "relative" / ".." / "code"

    job_dir = gpio_task_service._write_svn_runner_job(
        "https://svn.example.com/repo",
        destination,
        code_revision="r123",
        svn_username="user",
        svn_password="secret",
    )

    payload = __import__("json").loads((job_dir / "job.json").read_text(encoding="utf-8"))
    assert Path(payload["destination"]).is_absolute()
    assert payload["destination"] == str(destination.resolve())


def test_extract_manual_pin_rows_ignores_register_bit_tables() -> None:
    documents = [
        {
            "name": "user-manual.pdf",
            "text": (
                "GPIO register bit definition\n"
                "00 PA0\n"
                "001 PB10\n"
                "011 PA7\n"
            ),
        }
    ]

    rows = gpio_task_service._extract_manual_pin_rows(documents)

    assert rows == []


def test_generate_workbook_with_codex_invokes_codex_and_uses_generated_excel(
    monkeypatch, tmp_path: Path
) -> None:
    task_id = uuid.uuid4()
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(
        gpio_task_service,
        "_resolve_codex_command",
        lambda command: "C:\\Tools\\codex.cmd",
    )
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_CODEX_COMMAND", "codex")
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_CODEX_TIMEOUT_SECONDS", 30)
    output_path = gpio_task_service.result_path(task_id)

    upload_path = tmp_path / "manual.pdf"
    upload_path.write_bytes(b"%PDF")
    code_dir = tmp_path / "svn-sources"
    (code_dir / "code").mkdir(parents=True)

    calls = []

    def fake_run(command, *, prompt, cwd, timeout_seconds):
        calls.append(
            (
                command,
                {
                    "prompt": prompt,
                    "cwd": cwd,
                    "timeout_seconds": timeout_seconds,
                },
            )
        )
        run_dir = Path(cwd)
        (run_dir / "GPIO配置表.xlsx").write_bytes(b"PK\x03\x04 generated by codex")
        (run_dir / "gpio-codex-summary.json").write_text(
            '{"project":"P1","chip":"N32G455VBL7","package":"LQFP100"}',
            encoding="utf-8",
        )
        return CompletedProcess(command, returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(gpio_task_service, "_run_codex_process", fake_run)

    result_path, summary = gpio_task_service.generate_workbook_with_codex(
        task_id,
        uploaded_files=[{"file_name": "manual.pdf", "file_path": str(upload_path)}],
        source_dir=code_dir,
        code_svn_url="svn://repo/code",
        code_revision="r123",
    )

    assert result_path == output_path
    assert result_path.read_bytes().startswith(b"PK\x03\x04")
    assert summary["source"] == "Codex GPIO skill 本地生成。"
    assert summary["project"] == "P1"
    assert summary["chip"] == "N32G455VBL7"
    assert calls
    command, kwargs = calls[0]
    assert command[:2] == ["C:\\Tools\\codex.cmd", "exec"]
    assert "--dangerously-bypass-approvals-and-sandbox" in command
    assert "$通用-GPIO配置表" in calls[0][1]["prompt"]
    prompt = calls[0][1]["prompt"]
    assert str(gpio_task_service._codex_run_dir(task_id) / "GPIO配置表.xlsx") in prompt
    assert str(upload_path.resolve()) in prompt
    assert str(code_dir.resolve()) in prompt
    assert "不要改用缓存目录" in prompt
    assert "先完整阅读并遵守" in prompt
    assert "不能只分析 GPIO/外设初始化函数" in prompt
    assert "GPIOx->PBSC" in prompt
    assert "自检并返工" in prompt
    invocation = output_path.parent / "gpio-codex-invocation.json"
    invocation_data = json.loads(invocation.read_text(encoding="utf-8"))
    assert invocation_data["source_dir"] == str(code_dir.resolve())
    assert invocation_data["uploaded_files"][0]["file_path"] == str(upload_path.resolve())
    assert invocation_data["skill"]["name"] == "通用-GPIO配置表"
    assert invocation_data["skill"]["path"].endswith("通用-GPIO配置表\\SKILL.md")
    assert invocation_data["skill"]["sha256"]
    assert invocation_data["skill"]["last_write_time"]


def test_generate_workbook_with_codex_fails_when_excel_missing(
    monkeypatch, tmp_path: Path
) -> None:
    task_id = uuid.uuid4()
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_CODEX_COMMAND", "codex")
    monkeypatch.setattr(gpio_task_service.settings, "GPIO_CODEX_TIMEOUT_SECONDS", 30)

    code_dir = tmp_path / "svn-sources"
    (code_dir / "code").mkdir(parents=True)

    def fake_run(command, **kwargs):
        return CompletedProcess(command, returncode=0, stdout="done", stderr="")

    monkeypatch.setattr(gpio_task_service, "_run_codex_process", fake_run)

    with pytest.raises(RuntimeError) as exc_info:
        gpio_task_service.generate_workbook_with_codex(
            task_id,
            uploaded_files=[],
            source_dir=code_dir,
            code_svn_url="svn://repo/code",
            code_revision="r123",
        )

    assert "Codex 执行完成但没有生成 GPIO配置表.xlsx" in str(exc_info.value)


def test_resolve_codex_command_prefers_windows_cmd_shim(monkeypatch) -> None:
    def fake_which(command: str) -> str | None:
        if command.lower() == "codex.cmd":
            return "C:\\Users\\admin\\AppData\\Roaming\\npm\\codex.cmd"
        if command.lower() == "codex":
            return "C:\\Users\\admin\\AppData\\Roaming\\npm\\codex"
        return None

    monkeypatch.setattr(gpio_task_service.shutil, "which", fake_which)

    assert (
        gpio_task_service._resolve_codex_command("codex")
        == "C:\\Users\\admin\\AppData\\Roaming\\npm\\codex.cmd"
    )


def test_format_codex_error_prefers_error_lines_and_redacts_api_keys() -> None:
    detail = gpio_task_service._format_codex_error(
        "\n".join(
            [
                "2026-06-22 WARN some noisy warning",
                "ERROR: unexpected status 401 Unauthorized: API 密钥无效。提供的密钥不存在、已被删除、已被禁用或已过期。, url: http://172.23.17.242:8090/v1/responses",
                "ERROR: Incorrect API key provided: ah-1234567890abcdef1234567890abcdef12345678.",
            ]
        )
    )

    assert "API 密钥无效" in detail
    assert "401 Unauthorized" in detail
    assert "ah-123456" not in detail
    assert "ah-1234***5678" in detail


def test_run_codex_process_kills_process_tree_on_timeout(monkeypatch) -> None:
    killed = []

    class FakeProcess:
        pid = 4321

        def communicate(self, input=None, timeout=None):
            raise subprocess.TimeoutExpired(["codex"], timeout)

    monkeypatch.setattr(gpio_task_service.subprocess, "Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(
        gpio_task_service.subprocess,
        "run",
        lambda command, **kwargs: killed.append(command),
    )

    with pytest.raises(subprocess.TimeoutExpired):
        gpio_task_service._run_codex_process(
            ["codex", "exec"],
            prompt="prompt",
            cwd=Path("C:/Temp/gpio"),
            timeout_seconds=1,
        )

    assert killed == [["taskkill", "/PID", "4321", "/T", "/F"]]
