import re
import hashlib
import json
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from csv import DictReader
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from xml.sax.saxutils import escape

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

from app.core.config import settings
from app.services.codex_command import resolve_codex_command as _resolve_configured_codex_command
from app.services.storage_cleanup import robust_rmtree

RESULT_FILE_NAME = "GPIO配置表.xlsx"
CODEX_SUMMARY_FILE_NAME = "gpio-codex-summary.json"
CODEX_LAST_MESSAGE_FILE_NAME = "gpio-codex-last-message.txt"
GPIO_SKILL_NAME = "通用-GPIO配置表"
GPIO_HEADERS = ["引脚编号", "引脚名称", "使用引脚定义", "IO模式", "说明"]
TRIGGER_HEADERS = [
    "分类",
    "外设模块",
    "关联引脚",
    "使用引脚定义",
    "触发/控制规则",
    "触发后动作",
    "证据/备注",
]
TEXT_SUFFIXES = {
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".txt",
    ".csv",
    ".md",
    ".ioc",
}
DOCUMENT_SUFFIXES = TEXT_SUFFIXES | {".pdf"}
SVN_EXPORT_TIMEOUT_SECONDS = 300
SVN_RUNNER_POLL_SECONDS = 0.5
REVISION_RE = re.compile(r"^r?(\d+)$", re.IGNORECASE)
PIN_RE = re.compile(r"\bP([A-K])(\d{1,2})\b", re.IGNORECASE)
PIN_DEFINITION_RE = re.compile(
    r"^\s*(?P<pin_no>\d{1,3})\s+"
    r"(?P<pin_name>(?:P[A-K]\d{1,2}|VSS[A-Z0-9_+-]*|VDD[A-Z0-9_+-]*|VDDA|VSSA|"
    r"VREF[+-]?|VBAT|NRST|BOOT0|OSC_IN|OSC_OUT|NC)"
    r"(?:/[A-Za-z0-9_+-]+)*)\b",
    re.IGNORECASE,
)
PROJECT_RE = re.compile(r"\b[A-Z]{2,}\d{2}-\d{4}-REV\d+(?:\.\d+)?\b")
CHIP_RE = re.compile(r"\b[A-Z]{1,3}\d{2,}[A-Z0-9]{3,}\b")
PACKAGE_RE = re.compile(r"\b(?:LQFP|QFN|TSSOP|BGA|TQFP)\d+\b", re.IGNORECASE)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def task_dir(task_id: uuid.UUID) -> Path:
    return Path(settings.GPIO_STORAGE_DIR) / str(task_id)


def uploads_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "uploads"


def svn_sources_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "svn-sources"


def normalize_revision(revision: str) -> str:
    match = REVISION_RE.match(revision.strip())
    if not match:
        raise ValueError("SVN revision must be a number or r-number")
    return f"r{match.group(1)}"


def result_path(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / RESULT_FILE_NAME


def remove_task_files(task_id: uuid.UUID) -> None:
    storage_dir = Path(settings.GPIO_STORAGE_DIR).resolve()
    target_dir = (storage_dir / str(task_id)).resolve()
    if target_dir.name != str(task_id) or target_dir.parent != storage_dir:
        raise RuntimeError("Invalid GPIO task storage path")
    if target_dir.exists():
        if not target_dir.is_dir():
            raise RuntimeError("GPIO task storage path is not a directory")
        robust_rmtree(target_dir)


def _safe_filename(filename: str | None, fallback: str) -> str:
    name = Path(filename or fallback).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
    return name or fallback


async def save_uploads(
    task_id: uuid.UUID, uploads: list[UploadFile]
) -> list[dict[str, str | int | None]]:
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one file is required")

    destination_dir = uploads_dir(task_id)
    destination_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, str | int | None]] = []
    try:
        for index, upload in enumerate(uploads):
            content = await upload.read()
            if not content:
                raise HTTPException(status_code=400, detail="Uploaded file must not be empty")
            file_name = _safe_filename(upload.filename, f"upload-{index + 1}")
            path = destination_dir / file_name
            if path.exists():
                path = destination_dir / f"{path.stem}-{index + 1}{path.suffix}"
                file_name = path.name
            path.write_bytes(content)
            saved.append(
                {
                    "file_name": file_name,
                    "file_path": str(path),
                    "content_type": upload.content_type,
                    "file_size": len(content),
                }
            )
    except Exception:
        remove_task_files(task_id)
        raise
    return saved


async def save_manual_upload(task_id: uuid.UUID, upload: UploadFile) -> dict[str, str | int | None]:
    saved = await save_uploads(task_id, [upload])
    return saved[0]


async def save_manual_uploads(
    task_id: uuid.UUID, uploads: list[UploadFile]
) -> list[dict[str, str | int | None]]:
    return await save_uploads(task_id, uploads)


def create_workbook(
    task_id: uuid.UUID, uploaded_files: list[dict[str, object]] | None = None
) -> tuple[Path, dict[str, object]]:
    path = result_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    analysis = analyze_uploaded_files(uploaded_files or [])
    _write_gpio_workbook(path, analysis)
    return path, analysis["summary"]


def create_workbook_from_svn(
    task_id: uuid.UUID,
    *,
    uploaded_files: list[dict[str, object]],
    code_svn_url: str,
    code_revision: str,
    svn_username: str,
    svn_password: str,
    project_no: str,
    chip_model: str,
    package_name: str | None = None,
) -> tuple[Path, dict[str, object]]:
    source_dir = export_svn_sources(
        task_id,
        code_svn_url=code_svn_url,
        code_revision=code_revision,
        svn_username=svn_username,
        svn_password=svn_password,
    )
    path, summary = generate_workbook_with_codex(
        task_id,
        uploaded_files=uploaded_files,
        source_dir=source_dir,
        code_svn_url=code_svn_url,
        code_revision=code_revision,
        project_no=project_no,
        chip_model=chip_model,
        package_name=package_name,
    )
    summary["svn_export_path"] = str(source_dir)
    return path, summary


def generate_workbook_with_codex(
    task_id: uuid.UUID,
    *,
    uploaded_files: list[dict[str, object]],
    source_dir: Path,
    code_svn_url: str,
    code_revision: str,
    project_no: str = "",
    chip_model: str = "",
    package_name: str | None = None,
) -> tuple[Path, dict[str, object]]:
    path = result_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()

    source_dir = source_dir.resolve()
    uploaded_files = _normalize_uploaded_file_paths(uploaded_files)
    run_dir = _codex_run_dir(task_id)
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    codex_output_path = run_dir / RESULT_FILE_NAME
    summary_path = run_dir / CODEX_SUMMARY_FILE_NAME
    last_message_path = run_dir / CODEX_LAST_MESSAGE_FILE_NAME
    prompt = _build_codex_gpio_prompt(
        output_path=codex_output_path,
        summary_path=summary_path,
        uploaded_files=uploaded_files,
        source_dir=source_dir,
        code_svn_url=code_svn_url,
        code_revision=code_revision,
        project_no=project_no,
        chip_model=chip_model,
        package_name=package_name,
    )
    command = [
        _resolve_codex_command(settings.GPIO_CODEX_COMMAND),
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        str(run_dir),
        "-o",
        str(last_message_path),
        "-",
    ]
    _write_codex_invocation_log(
        path.parent,
        command=command,
        output_path=codex_output_path,
        summary_path=summary_path,
        source_dir=source_dir,
        uploaded_files=uploaded_files,
    )
    try:
        completed = _run_codex_process(
            command,
            prompt=prompt,
            cwd=run_dir,
            timeout_seconds=settings.GPIO_CODEX_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "服务端未找到 codex 命令，无法按 skill 生成 GPIO 配置表。"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Codex 生成 GPIO 配置表超时，请检查任务资料大小或稍后重试。") from exc

    (path.parent / "gpio-codex-stdout.log").write_text(
        completed.stdout or "", encoding="utf-8"
    )
    (path.parent / "gpio-codex-stderr.log").write_text(
        completed.stderr or "", encoding="utf-8"
    )
    if completed.returncode != 0:
        detail = _format_codex_error(
            "\n".join(part for part in [completed.stderr, completed.stdout] if part)
        )
        raise RuntimeError(f"Codex 生成 GPIO 配置表失败：{detail or '未知错误'}")
    if not codex_output_path.is_file() or codex_output_path.stat().st_size == 0:
        raise RuntimeError(
            f"Codex 执行完成但没有生成 {RESULT_FILE_NAME}，请查看任务目录下的 Codex 日志。"
        )
    shutil.copy2(codex_output_path, path)

    summary = _read_codex_summary(summary_path)
    summary.setdefault("project", project_no or "TODO[需识别]")
    summary.setdefault("chip", chip_model or "TODO[需识别]")
    if package_name:
        summary.setdefault("package", package_name)
    summary["source"] = "Codex GPIO skill 本地生成。"
    summary["codex_last_message_path"] = str(last_message_path)
    summary["codex_run_dir"] = str(run_dir)
    return path, summary


def _normalize_uploaded_file_paths(
    uploaded_files: list[dict[str, object]],
) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for item in uploaded_files:
        copy = dict(item)
        file_path = copy.get("file_path")
        if file_path:
            copy["file_path"] = str(Path(str(file_path)).resolve())
        normalized.append(copy)
    return normalized


def _codex_run_dir(task_id: uuid.UUID) -> Path:
    return Path(tempfile.gettempdir()) / "gpio-codex-runs" / str(task_id)


def _run_codex_process(
    command: list[str],
    *,
    prompt: str,
    cwd: Path,
    timeout_seconds: int,
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(cwd),
    )
    try:
        stdout, stderr = process.communicate(prompt, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        _kill_process_tree(process.pid)
        raise
    return subprocess.CompletedProcess(
        args=command,
        returncode=process.returncode or 0,
        stdout=stdout,
        stderr=stderr,
    )


def _kill_process_tree(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        check=False,
        capture_output=True,
        text=True,
    )


def _write_codex_invocation_log(
    task_path: Path,
    *,
    command: list[str],
    output_path: Path,
    summary_path: Path,
    source_dir: Path,
    uploaded_files: list[dict[str, object]],
) -> None:
    payload = {
        "command": command,
        "cwd": str(task_path),
        "cwd_exists": task_path.exists(),
        "skill": _gpio_skill_snapshot(),
        "output_path": str(output_path),
        "output_parent_exists": output_path.parent.exists(),
        "summary_path": str(summary_path),
        "source_dir": str(source_dir),
        "source_dir_exists": source_dir.exists(),
        "uploaded_files": [
            {
                "file_name": item.get("file_name"),
                "file_path": item.get("file_path"),
                "exists": Path(str(item.get("file_path", ""))).exists(),
            }
            for item in uploaded_files
        ],
    }
    (task_path / "gpio-codex-invocation.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _gpio_skill_snapshot() -> dict[str, object]:
    codex_home = (
        Path(settings.CODEX_HOME_DIR).expanduser()
        if settings.CODEX_HOME_DIR.strip()
        else Path.home() / ".codex"
    )
    skill_path = codex_home / "skills" / GPIO_SKILL_NAME / "SKILL.md"
    snapshot: dict[str, object] = {
        "name": GPIO_SKILL_NAME,
        "path": str(skill_path),
        "exists": skill_path.exists(),
    }
    if not skill_path.is_file():
        return snapshot
    content = skill_path.read_bytes()
    snapshot["sha256"] = hashlib.sha256(content).hexdigest()
    snapshot["last_write_time"] = datetime.fromtimestamp(
        skill_path.stat().st_mtime,
        timezone.utc,
    ).isoformat()
    snapshot["size"] = len(content)
    return snapshot


def _resolve_codex_command(command: str) -> str:
    return _resolve_configured_codex_command(command, which=shutil.which)

def _format_codex_error(detail: str) -> str:
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    important = [
        line
        for line in lines
        if line.startswith("ERROR:")
        or "401 Unauthorized" in line
        or "API 密钥无效" in line
        or "Incorrect API key" in line
        or "os error" in line.lower()
    ]
    selected = important or lines[-8:]
    message = "\n".join(selected[-8:])
    return _redact_api_keys(message)


def _redact_api_keys(value: str) -> str:
    return re.sub(
        r"\b([A-Za-z]{2}-[A-Za-z0-9]{4})[A-Za-z0-9]{8,}([A-Za-z0-9]{4})\b",
        r"\1***\2",
        value,
    )


def _build_codex_gpio_prompt(
    *,
    output_path: Path,
    summary_path: Path,
    uploaded_files: list[dict[str, object]],
    source_dir: Path,
    code_svn_url: str,
    code_revision: str,
    project_no: str,
    chip_model: str,
    package_name: str | None,
) -> str:
    upload_lines = "\n".join(
        f"- {item.get('file_name')}: {item.get('file_path')}" for item in uploaded_files
    )
    known_fields = {
        "project_no": project_no,
        "chip_model": chip_model,
        "package_name": package_name or "",
    }
    skill_path = str(_gpio_skill_snapshot()["path"])
    return f"""[$通用-GPIO配置表]({skill_path})

请使用 $通用-GPIO配置表 skill 生成正式 GPIO 配置表 Excel。

重要要求：
1. 先完整阅读并遵守 `$通用-GPIO配置表` skill 的全部规则，再开始生成；不能只按本 prompt 的简写要求执行。
2. 必须读取芯片手册和 SVN 导出的完整代码目录，按 skill 做全项目 GPIO/外设行为分析。
3. 不能只分析 GPIO/外设初始化函数。初始化函数只能证明 IO 模式、复用、上拉下拉、默认配置；`说明` 和 `MCU外设触发关系` 必须继续追踪宏定义、直接寄存器读写、IRQHandler、Callback、周期任务、协议处理、业务调用点。
4. 必须重点搜索并解析 `GPIOx->PBSC`、`GPIOx->PBC`、`GPIOx->PID`、`GPIOx->POD`、`EXTI_Trigger_*`、`#define` 引脚宏、Enable/Disable/Open/Close/On/Off/Wake/Reset/Set/Clear 等调用语义；代码能证明高/低有效、默认电平、触发边沿、外设角色时，不要写成笼统的 `控制输出`、`检测输入` 或 `需人工确认`。
5. 芯片手册中如果存在目标封装的正式管脚定义表，必须用该表生成 `引脚编号` 和完整 `引脚名称`，不要为了方便改用封装图、PDF 抽取顺序或只保留基础 GPIO 名。
6. Excel 内容要像人工 Codex 审查结果一样保留细节：每个代码可证明的 GPIO 要写清楚用途、IO模式、上拉/下拉、默认状态、有效电平、触发边沿、关联外设和触发后动作。
7. 生成后必须自检并返工一次：抽查固定功能脚、EXTI、ADC/COMP、UART/CAN/SPI/I2C/TIM/RTC/WDG、输出控制宏、输入状态读取宏；发现 `TODO[需人工确认]` 或泛泛描述时，必须回到代码继续搜索，只有代码确实无法证明才保留。
8. 最终 Excel 必须直接保存到：{output_path}
9. 不要只输出 Markdown，不要让平台再根据 JSON 二次生成 Excel。
10. Excel 至少包含 `GPIO配置表` 和 `MCU外设触发关系` 两个工作表。
11. 完成后把识别摘要写入 JSON 文件：{summary_path}
    JSON 结构示例：{{"project":"项目号或TODO[需识别]","chip":"芯片型号或TODO[需识别]","package":"封装或TODO[需识别]"}}
12. 只能使用下面列出的芯片资料路径和 SVN 导出目录；如果这些路径不存在或资料不足，必须报错说明，**不要改用缓存目录、历史任务目录、手工验证目录或自行重新 SVN 导出**。

任务输入：
- SVN 路径：{code_svn_url}
- SVN 版本：{code_revision}
- SVN 导出目录：{source_dir}
- 已上传芯片资料：
{upload_lines or "- 无"}
- 平台已知字段：{json.dumps(known_fields, ensure_ascii=False)}

请直接在本机文件系统生成 Excel 到指定路径。"""


def _read_codex_summary(summary_path: Path) -> dict[str, object]:
    if not summary_path.is_file():
        return {}
    try:
        data = json.loads(summary_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def export_svn_sources(
    task_id: uuid.UUID,
    *,
    code_svn_url: str,
    code_revision: str,
    svn_username: str,
    svn_password: str,
) -> Path:
    source_dir = svn_sources_dir(task_id)
    if source_dir.exists():
        shutil.rmtree(source_dir)
    code_dir = source_dir / "code"
    source_dir.mkdir(parents=True, exist_ok=True)
    _run_svn_export(
        code_svn_url,
        code_dir,
        code_revision=code_revision,
        svn_username=svn_username,
        svn_password=svn_password,
        label="芯片代码",
    )
    return source_dir


def _run_svn_export(
    svn_url: str,
    destination: Path,
    *,
    code_revision: str,
    svn_username: str,
    svn_password: str,
    label: str,
    use_runner: bool = True,
) -> None:
    if use_runner:
        _run_svn_export_via_runner(
            svn_url,
            destination,
            code_revision=code_revision,
            svn_username=svn_username,
            svn_password=svn_password,
            label=label,
        )
        return

    script_path = _write_svn_export_script(
        svn_url,
        destination,
        code_revision=code_revision,
        svn_username=svn_username,
        svn_password=svn_password,
    )
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=SVN_EXPORT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("服务端未安装 SVN CLI") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{label} SVN 拉取超时") from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(
            f"{label} SVN 拉取失败：{_format_svn_error(detail, svn_url, code_revision)}"
        )


def _write_svn_export_script(
    svn_url: str,
    destination: Path,
    *,
    code_revision: str,
    svn_username: str,
    svn_password: str,
) -> Path:
    script_path = Path(tempfile.gettempdir()) / f"gpio-svn-export-{uuid.uuid4()}.ps1"
    script = "\n".join(
        [
            "$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
            "$ErrorActionPreference = 'Continue'",
            "$svnArgs = @(",
            "  'export',",
            "  '--force',",
            "  '--non-interactive',",
            "  '--trust-server-cert',",
            "  '--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other',",
            "  '-r',",
            f"  {_powershell_quote(code_revision.removeprefix('r'))},",
            "  '--username',",
            f"  {_powershell_quote(svn_username)},",
            "  '--password',",
            f"  {_powershell_quote(svn_password)},",
            f"  {_powershell_quote(svn_url)},",
            f"  {_powershell_quote(str(destination))}",
            ")",
            "& svn @svnArgs",
            "exit $LASTEXITCODE",
            "",
        ]
    )
    script_path.write_text(script, encoding="utf-8-sig")
    return script_path


def svn_runner_dir() -> Path:
    return Path(settings.GPIO_STORAGE_DIR) / "_svn-runner"


def _run_svn_export_via_runner(
    svn_url: str,
    destination: Path,
    *,
    code_revision: str,
    svn_username: str,
    svn_password: str,
    label: str,
) -> None:
    job_dir = _write_svn_runner_job(
        svn_url,
        destination,
        code_revision=code_revision,
        svn_username=svn_username,
        svn_password=svn_password,
    )
    result_path = job_dir / "result.json"
    deadline = time.monotonic() + SVN_EXPORT_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if result_path.exists():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            if result.get("ok"):
                return
            detail = str(result.get("error") or "svn export failed")
            raise RuntimeError(
                f"{label} SVN 拉取失败：{_format_svn_error(detail, svn_url, code_revision)}"
            )
        time.sleep(SVN_RUNNER_POLL_SECONDS)
    raise RuntimeError(f"{label} SVN 拉取超时")


def _write_svn_runner_job(
    svn_url: str,
    destination: Path,
    *,
    code_revision: str,
    svn_username: str,
    svn_password: str,
) -> Path:
    runner_dir = svn_runner_dir()
    jobs_dir = runner_dir / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    job_dir = jobs_dir / str(uuid.uuid4())
    job_dir.mkdir()
    payload = {
        "svn_url": svn_url,
        "destination": str(destination.resolve()),
        "revision": code_revision.removeprefix("r"),
        "svn_username": svn_username,
        "svn_password": svn_password,
    }
    pending_path = job_dir / "job.pending.json"
    ready_path = job_dir / "job.json"
    pending_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    pending_path.replace(ready_path)
    return job_dir


def _powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _format_svn_error(detail: str, svn_url: str, code_revision: str) -> str:
    if not detail:
        return "svn export failed"

    normalized_revision = normalize_revision(code_revision)
    lowered = detail.lower()
    if "e160013" in lowered or "path not found" in lowered or "找不到路径" in detail:
        return (
            "SVN 地址路径不存在。请检查填写的是完整 SVN 仓库路径，并确认该路径在"
            f"版本 {normalized_revision} 下存在：{svn_url}。原始错误：{detail}"
        )
    if (
        "e170001" in lowered
        or "authorization failed" in lowered
        or "authentication failed" in lowered
        or "认证失败" in detail
        or "授权失败" in detail
    ):
        return "SVN 账号或密码无权限访问该路径。请重新输入 SVN 凭据或确认账号权限。原始错误：" + detail
    if "e230001" in lowered or "certificate" in lowered or "证书" in detail:
        return "SVN 服务器证书校验失败。请确认服务器证书或联系管理员。原始错误：" + detail
    return detail


def collect_source_files(source_dir: Path) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for path in source_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.suffix.lower() != ".zip":
            continue
        files.append(
            {
                "file_name": path.name,
                "file_path": str(path),
                "content_type": None,
                "file_size": path.stat().st_size,
            }
        )
    return files


def analyze_uploaded_files(uploaded_files: list[dict[str, object]]) -> dict[str, object]:
    documents = _collect_documents(uploaded_files)
    combined_text = "\n".join(document["text"] for document in documents)
    manual_rows = _extract_manual_pin_rows(documents)
    resource_rows = _extract_resource_rows(documents)
    code_text = "\n".join(
        document["text"]
        for document in documents
        if Path(str(document["name"])).suffix.lower() in {".c", ".h", ".cpp", ".hpp", ".ioc"}
    )
    gpio_modes = _extract_gpio_modes(code_text)
    gpio_rows = _build_gpio_rows(manual_rows, resource_rows, gpio_modes)
    trigger_rows = _build_trigger_rows(code_text, gpio_rows)
    summary = {
        "project": _first_match(PROJECT_RE, combined_text) or "TODO[需识别]",
        "chip": _first_chip(combined_text) or "TODO[需识别]",
        "package": _first_package(combined_text) or "TODO[需识别]",
        "source": "已按 GPIO 配置表 skill 解析上传资料。",
        "pin_count": len(gpio_rows),
        "peripheral_count": len(trigger_rows),
    }
    return {
        "summary": summary,
        "gpio_rows": gpio_rows,
        "trigger_rows": trigger_rows,
    }


def _collect_documents(
    uploaded_files: list[dict[str, object]]
) -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []
    for file_info in uploaded_files:
        path = Path(str(file_info.get("file_path", "")))
        if not path.is_file():
            continue
        if path.suffix.lower() == ".zip":
            documents.extend(_read_zip_documents(path))
        elif path.suffix.lower() == ".pdf":
            documents.append({"name": path.name, "text": _read_pdf_text(path)})
        elif path.suffix.lower() in TEXT_SUFFIXES:
            documents.append({"name": path.name, "text": _read_text(path.read_bytes())})
    return documents


def _read_zip_documents(path: Path) -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            item_path = Path(item.filename)
            if item_path.suffix.lower() not in DOCUMENT_SUFFIXES:
                continue
            if item_path.suffix.lower() == ".pdf":
                extracted_path = Path(tempfile.gettempdir()) / f"gpio-upload-{uuid.uuid4()}.pdf"
                extracted_path.write_bytes(archive.read(item))
                try:
                    text = _read_pdf_text(extracted_path)
                finally:
                    extracted_path.unlink(missing_ok=True)
            else:
                text = _read_text(archive.read(item))
            documents.append({"name": item.filename, "text": text})
    return documents


def _read_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _read_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _extract_manual_pin_rows(
    documents: list[dict[str, str]]
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for document in documents:
        if Path(document["name"]).suffix.lower() == ".csv":
            for row in DictReader(StringIO(document["text"])):
                pin_no = _row_value(row, "引脚编号", "pin_no", "pin", "no")
                pin_name = _row_value(row, "引脚名称", "pin_name", "name")
                if pin_no and pin_name:
                    key = (pin_no, pin_name)
                    if key not in seen:
                        rows.append({"pin_no": pin_no, "pin_name": pin_name})
                        seen.add(key)
            continue
        for row in _extract_pin_rows_from_text(document["text"]):
            key = (row["pin_no"], row["pin_name"])
            if key not in seen:
                rows.append(row)
                seen.add(key)
    return rows


def _extract_pin_rows_from_text(text: str) -> list[dict[str, str]]:
    return _extract_package_table_pin_rows(text)


def _extract_package_table_pin_rows(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    table_text = _pin_definition_table_text(text)
    if not table_text:
        return rows
    for line in table_text.splitlines():
        normalized = re.sub(r"\s+", " ", line).strip()
        if normalized.startswith("1. ") or normalized.startswith("注："):
            break
        parsed = _parse_lqfp100_pin_definition_line(normalized)
        if parsed:
            rows.append(parsed)
    return rows


def _pin_definition_table_text(text: str) -> str:
    first_row_index = text.find("UART6_TX")
    if first_row_index < 0:
        return ""
    start = text.rfind("QFN36", 0, first_row_index)
    if start < 0:
        start = max(first_row_index - 1000, 0)
    end_markers = ["1. I = 输入", "注： 表中的引脚名称", "4 电气特性"]
    end = len(text)
    for marker in end_markers:
        marker_index = text.find(marker, first_row_index)
        if marker_index >= 0:
            end = min(end, marker_index)
    return text[start:end]


def _parse_lqfp100_pin_definition_line(line: str) -> dict[str, str] | None:
    parts = line.split()
    if len(parts) < 8:
        return None
    package_columns = parts[:7]
    if not all(value == "-" or value.isdigit() for value in package_columns):
        return None
    lqfp100_pin = package_columns[6]
    if lqfp100_pin == "-":
        return None
    pin_name = parts[7]
    if pin_name == "Not" and len(parts) > 8 and parts[8] == "Connect":
        pin_name = "NC"
    if not _looks_like_pin_name(pin_name):
        return None
    return {"pin_no": lqfp100_pin, "pin_name": pin_name}


def _looks_like_pin_name(value: str) -> bool:
    upper = value.upper()
    if PIN_RE.search(upper):
        return True
    return upper.startswith(
        (
            "VSS",
            "VDD",
            "VREF",
            "VBAT",
            "VDDA",
            "VSSA",
            "NRST",
            "BOOT0",
            "OSC_IN",
            "OSC_OUT",
            "NC",
        )
    )


def _extract_resource_rows(
    documents: list[dict[str, str]]
) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for document in documents:
        if Path(document["name"]).suffix.lower() != ".csv":
            continue
        for row in DictReader(StringIO(document["text"])):
            pin_name = _row_value(row, "引脚名称", "pin_name", "pin", "name")
            signal = _row_value(row, "使用引脚定义", "signal", "definition")
            if not pin_name or not signal:
                continue
            description = _row_value(row, "说明", "description", "desc")
            rows[_base_pin(pin_name)] = {
                "signal": signal,
                "description": description,
            }
    return rows


def _row_value(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        if key in row and row[key]:
            return row[key].strip()
    return ""


def _extract_gpio_modes(code_text: str) -> dict[str, str]:
    modes: dict[str, str] = {}
    current_mode = ""
    for line in code_text.splitlines():
        mode_match = re.search(r"GPIO_Mode_([A-Za-z0-9_]+)", line)
        if mode_match:
            current_mode = mode_match.group(1)
        init_match = re.search(
            r"GPIO_InitPeripheral\s*\(\s*GPIO([A-K])\s*,\s*GPIO_PIN_(\d+)",
            line,
        )
        if init_match:
            pin = f"P{init_match.group(1).upper()}{init_match.group(2)}"
            modes[pin] = _mode_label(current_mode)
    return modes


def _mode_label(mode: str) -> str:
    mode = mode.upper()
    if mode in {"AF_PP", "AFPP"}:
        return "复用-推挽"
    if mode in {"AF_OD", "AFOD"}:
        return "复用-开漏"
    if mode in {"AIN", "ANALOG"}:
        return "模拟"
    if mode in {"OUT_PP", "OUTPUT_PP"}:
        return "输出-推挽"
    if mode in {"OUT_OD", "OUTPUT_OD"}:
        return "输出-开漏"
    if mode in {"IPU", "INPUT_PULLUP"}:
        return "输入-上拉"
    if mode in {"IPD", "INPUT_PULLDOWN"}:
        return "输入-下拉"
    if mode in {"IN_FLOATING", "INPUT"}:
        return "输入-浮空"
    return "TODO[需确认]"


def _build_gpio_rows(
    manual_rows: list[dict[str, str]],
    resource_rows: dict[str, dict[str, str]],
    gpio_modes: dict[str, str],
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for manual_row in manual_rows:
        pin_name = manual_row["pin_name"]
        base_pin = _base_pin(pin_name)
        resource = resource_rows.get(base_pin, {})
        signal = resource.get("signal") or _fixed_signal(pin_name) or "TODO[需人工确认]"
        io_mode = gpio_modes.get(base_pin) or _fixed_mode(pin_name) or "TODO[需确认]"
        description = resource.get("description") or _default_description(
            signal, io_mode
        )
        rows.append(
            {
                "pin_no": manual_row["pin_no"],
                "pin_name": pin_name,
                "signal": signal,
                "io_mode": io_mode,
                "description": description,
            }
        )
    return rows


def _build_trigger_rows(
    code_text: str, gpio_rows: list[dict[str, str]]
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    pin_by_hint = _pin_lookup(gpio_rows)
    if "EXTI_Trigger_Falling" in code_text:
        rows.append(
            _trigger_row(
                "EXTI",
                "EXTI",
                _first_pin(pin_by_hint) or "TODO[需人工确认]",
                _first_signal(gpio_rows) or "TODO[需人工确认]",
                "下降沿触发：默认电平需确认，低电平有效。",
                "外部中断触发后动作需结合中断处理函数确认。",
                "代码配置 EXTI_Trigger_Falling。",
            )
        )
    if "ADC_" in code_text:
        rows.append(
            _trigger_row(
                "ADC/COMP",
                "ADC",
                _pin_for_signal(gpio_rows, "NTC") or "TODO[需人工确认]",
                _signal_for_hint(gpio_rows, "NTC") or "TODO[需人工确认]",
                "软件采样触发：ADC 通道采样，采样周期按代码配置。",
                "采样值用途需结合业务代码确认。",
                "代码发现 ADC 初始化或通道配置。",
            )
        )
    for category, keyword in [
        ("UART", "USART_"),
        ("UART", "UART"),
        ("CAN", "CAN_"),
        ("SPI", "SPI_"),
        ("I2C", "I2C_"),
        ("TIM/WDG", "TIM_"),
    ]:
        if keyword not in code_text:
            continue
        if any(row["分类"] == category for row in rows):
            continue
        rows.append(
            _trigger_row(
                category,
                keyword.rstrip("_"),
                _pin_for_category(gpio_rows, category) or "TODO[需人工确认]",
                _signal_for_category(gpio_rows, category) or "TODO[需人工确认]",
                f"{category} 外设控制/通信触发：具体时序按初始化代码配置。",
                "收发、采样或定时后的业务动作需结合调用链确认。",
                f"代码发现 {keyword.rstrip('_')} 初始化或使用。",
            )
        )
    return rows


def _trigger_row(
    category: str,
    module: str,
    pin: str,
    signal: str,
    rule: str,
    action: str,
    evidence: str,
) -> dict[str, str]:
    return {
        "分类": category,
        "外设模块": module,
        "关联引脚": pin,
        "使用引脚定义": signal,
        "触发/控制规则": rule,
        "触发后动作": action,
        "证据/备注": evidence,
    }


def _base_pin(pin_name: str) -> str:
    match = PIN_RE.search(pin_name)
    if not match:
        return pin_name.strip()
    return f"P{match.group(1).upper()}{int(match.group(2))}"


def _fixed_signal(pin_name: str) -> str | None:
    upper = pin_name.upper()
    if upper.startswith(("VSS", "VSSA", "VREF-")):
        return "GND"
    if upper.startswith(("VDD", "VDDA", "VREF+", "VBAT")):
        return upper.split("/")[0]
    for name in ("NRST", "OSC_IN", "OSC_OUT", "BOOT0", "NC"):
        if name in upper:
            return name
    return None


def _fixed_mode(pin_name: str) -> str | None:
    return "固定功能" if _fixed_signal(pin_name) else None


def _default_description(signal: str, io_mode: str) -> str:
    if io_mode == "固定功能":
        return f"{signal} 固定功能引脚。"
    return "TODO[需人工确认]"


def _first_match(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(0) if match else None


def _first_chip(text: str) -> str | None:
    for match in CHIP_RE.finditer(text):
        value = match.group(0)
        if value.upper().startswith(("GPIO", "UART", "USART", "ADC", "CAN")):
            continue
        if "REV" in value.upper():
            continue
        return value
    return None


def _first_package(text: str) -> str | None:
    value = _first_match(PACKAGE_RE, text)
    return value.upper() if value else None


def _pin_lookup(gpio_rows: list[dict[str, str]]) -> dict[str, str]:
    return {row["signal"]: _base_pin(row["pin_name"]) for row in gpio_rows}


def _first_pin(pin_by_hint: dict[str, str]) -> str | None:
    return next(iter(pin_by_hint.values()), None)


def _first_signal(gpio_rows: list[dict[str, str]]) -> str | None:
    return gpio_rows[0]["signal"] if gpio_rows else None


def _pin_for_signal(gpio_rows: list[dict[str, str]], hint: str) -> str | None:
    for row in gpio_rows:
        if hint.upper() in row["signal"].upper():
            return _base_pin(row["pin_name"])
    return None


def _signal_for_hint(gpio_rows: list[dict[str, str]], hint: str) -> str | None:
    for row in gpio_rows:
        if hint.upper() in row["signal"].upper():
            return row["signal"]
    return None


def _pin_for_category(gpio_rows: list[dict[str, str]], category: str) -> str | None:
    signal = _signal_for_category(gpio_rows, category)
    if signal is None:
        return None
    return _pin_for_signal(gpio_rows, signal)


def _signal_for_category(gpio_rows: list[dict[str, str]], category: str) -> str | None:
    hints = {
        "UART": ("UART", "USART", "TX", "RX"),
        "CAN": ("CAN",),
        "SPI": ("SPI", "SCK", "MISO", "MOSI", "CS"),
        "I2C": ("I2C", "SCL", "SDA"),
        "TIM/WDG": ("TIM", "PWM", "WDG"),
    }.get(category, (category,))
    for row in gpio_rows:
        upper_signal = row["signal"].upper()
        upper_pin = row["pin_name"].upper()
        if any(hint in upper_signal or hint in upper_pin for hint in hints):
            return row["signal"]
    return None


def _shared_strings_xml(values: list[str]) -> str:
    items = "".join(f"<si><t>{escape(value)}</t></si>" for value in values)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(values)}" uniqueCount="{len(values)}">{items}</sst>'
    )


def _sheet_xml(rows: list[list[int]]) -> str:
    row_xml = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, shared_string_index in enumerate(row, start=1):
            column = chr(ord("A") + column_index - 1)
            cells.append(
                f'<c r="{column}{row_index}" t="s"><v>{shared_string_index}</v></c>'
            )
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheetData>{"".join(row_xml)}</sheetData></worksheet>'
    )


def _write_gpio_workbook(path: Path, analysis: dict[str, object]) -> None:
    summary = analysis["summary"]
    gpio_rows = analysis["gpio_rows"]
    trigger_rows = analysis["trigger_rows"]
    title = f"{summary['project']}-MCU资源分配（{summary['chip']}）"
    sheet1_values = [
        [title],
        GPIO_HEADERS,
        *[
            [
                row["pin_no"],
                row["pin_name"],
                row["signal"],
                row["io_mode"],
                row["description"],
            ]
            for row in gpio_rows
        ],
    ]
    sheet2_values = [
        TRIGGER_HEADERS,
        *[
            [row[header] for header in TRIGGER_HEADERS]
            for row in trigger_rows
        ],
    ]
    shared_strings, sheet1_rows, sheet2_rows = _index_workbook_values(
        sheet1_values, sheet2_values
    )

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            "</Types>",
        )
        workbook.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        workbook.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
            "</Relationships>",
        )
        workbook.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="GPIO配置表" sheetId="1" r:id="rId1"/>'
            '<sheet name="MCU外设触发关系" sheetId="2" r:id="rId2"/></sheets></workbook>',
        )
        workbook.writestr("xl/sharedStrings.xml", _shared_strings_xml(shared_strings))
        workbook.writestr("xl/worksheets/sheet1.xml", _sheet_xml(sheet1_rows))
        workbook.writestr("xl/worksheets/sheet2.xml", _sheet_xml(sheet2_rows))


def _index_workbook_values(
    sheet1_values: list[list[str]], sheet2_values: list[list[str]]
) -> tuple[list[str], list[list[int]], list[list[int]]]:
    shared_strings: list[str] = []
    indexes: dict[str, int] = {}

    def index(value: str) -> int:
        if value not in indexes:
            indexes[value] = len(shared_strings)
            shared_strings.append(value)
        return indexes[value]

    return (
        shared_strings,
        [[index(value) for value in row] for row in sheet1_values],
        [[index(value) for value in row] for row in sheet2_values],
    )
