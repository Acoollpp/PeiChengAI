import json
import os
import re
import shutil
import subprocess
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, col, select

from app.core.config import settings
from app.services.codex_command import resolve_codex_command as _resolve_configured_codex_command
from app.services.storage_cleanup import robust_rmtree
from app.models import (
    BomSpecCompareTask,
    BomSpecCompareTaskStatus,
    get_datetime_utc,
)

ARTIFACT_NAME = "BOM与规格书配件对比清单"
REPORT_ZIP_NAME = f"{ARTIFACT_NAME}.zip"
INTERRUPTED_TASK_MESSAGE = "服务重启导致任务中断，请重新提交任务"
INTERRUPTED_STATUSES = {
    BomSpecCompareTaskStatus.preparing,
    BomSpecCompareTaskStatus.running,
    BomSpecCompareTaskStatus.uploading_report,
}


def _codex_home_dir() -> Path:
    configured = settings.CODEX_HOME_DIR.strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


BOM_SPEC_SKILL_PATH = _codex_home_dir() / "skills" / "bom-spec-compare" / "SKILL.md"


def _dated_artifact_name(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return f"{ARTIFACT_NAME}{current.strftime('%Y%m%d')}"


def task_dir(task_id: uuid.UUID) -> Path:
    return Path(settings.BOM_SPEC_COMPARE_STORAGE_DIR) / str(task_id)


def input_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "input"


def logs_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "logs"


def reports_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "reports"


def report_zip_path(task_id: uuid.UUID) -> Path:
    return reports_dir(task_id) / _report_zip_name(task_id)


def mark_interrupted_tasks_failed(session: Session) -> int:
    tasks = session.exec(
        select(BomSpecCompareTask).where(
            col(BomSpecCompareTask.status).in_(INTERRUPTED_STATUSES)
        )
    ).all()
    now = get_datetime_utc()
    changed_count = 0
    for task in tasks:
        recovered_result = _recover_completed_result(task.id)
        if recovered_result is not None:
            task.result_files = recovered_result["result_files"]  # type: ignore[assignment]
            task.project_count = int(recovered_result.get("project_count", 0))
            task.success_count = int(recovered_result.get("success_count", 0))
            task.consistent_count = int(recovered_result.get("consistent_count", 0))
            task.different_count = int(recovered_result.get("different_count", 0))
            task.failed_count = int(recovered_result.get("failed_count", 0))
            task.status = BomSpecCompareTaskStatus.success
            task.error_message = None
            recovery_log = logs_dir(task.id) / "recovery.log"
            recovery_log.parent.mkdir(parents=True, exist_ok=True)
            recovery_log.write_text(
                "服务重启后回收完整批量报告并完成任务结果写回。\n",
                encoding="utf-8",
            )
        else:
            task.status = BomSpecCompareTaskStatus.failed
            task.error_message = INTERRUPTED_TASK_MESSAGE
        task.finished_at = now
        task.updated_at = now
        session.add(task)
        changed_count += 1
    if tasks:
        session.commit()
    return changed_count


def remove_task_files(task_id: uuid.UUID) -> None:
    storage_dir = Path(settings.BOM_SPEC_COMPARE_STORAGE_DIR).resolve()
    target_dir = (storage_dir / str(task_id)).resolve()
    if target_dir.name != str(task_id) or target_dir.parent != storage_dir:
        raise RuntimeError("Invalid BOM spec compare task storage path")
    if target_dir.exists():
        if not target_dir.is_dir():
            raise RuntimeError("BOM spec compare task storage path is not a directory")
        robust_rmtree(target_dir)


def _safe_filename(filename: str | None, fallback: str) -> str:
    name = Path(filename or fallback).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
    return name or fallback


async def save_project_upload(
    task_id: uuid.UUID,
    upload: UploadFile,
) -> list[dict[str, str | int | None]]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file must not be empty")

    destination_dir = input_dir(task_id)
    destination_dir.mkdir(parents=True, exist_ok=True)
    file_name = _safe_filename(upload.filename, "bom-spec-upload.zip")
    path = destination_dir / file_name
    path.write_bytes(content)
    suffix = path.suffix.lower()
    if suffix == ".zip":
        _extract_zip(path, destination_dir / "projects")
    elif suffix == ".rar":
        _extract_with_rar(path, destination_dir / "projects")
    elif suffix == ".7z":
        _extract_with_7zip(path, destination_dir / "projects")
    return [
        {
            "file_name": file_name,
            "file_path": str(path),
            "content_type": upload.content_type,
            "file_size": len(content),
        }
    ]


def _extract_with_7zip(path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    command = _resolve_7z_command(settings.BOM_SPEC_COMPARE_7Z_COMMAND)
    _extract_with_archive_tool(path, destination, [command, "x", str(path), f"-o{destination}", "-y"])


def _extract_with_rar(path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    command = _resolve_rar_command()
    _extract_with_archive_tool(path, destination, [command, "x", "-y", str(path), str(destination) + "\\"])


def _extract_with_archive_tool(path: Path, destination: Path, command: list[str]) -> None:
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.BOM_SPEC_COMPARE_ARCHIVE_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"服务器未安装可用解压工具，无法解压 {path.suffix.lower()} 文件",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=400, detail="压缩包解压超时，请检查文件大小") from exc
    if completed.returncode != 0:
        detail = _format_archive_error("\n".join([completed.stderr or "", completed.stdout or ""]))
        raise HTTPException(
            status_code=400,
            detail=f"压缩包解压失败，请检查文件是否损坏或带密码：{detail or '未知错误'}",
        )
    _validate_extracted_paths(destination)


def _resolve_7z_command(command: str) -> str:
    command = command.strip() or "7z"
    command_path = Path(command)
    if command_path.suffix or command_path.parent != Path("."):
        return command
    candidates = [
        command,
        f"{command}.exe",
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise HTTPException(
        status_code=400,
        detail="服务器未安装 7-Zip，无法解压 7z 文件",
    )


def _resolve_rar_command() -> str:
    candidates = [
        r"D:\SoftWare\WinRAR\UnRAR.exe",
        r"D:\SoftWare\WinRAR\Rar.exe",
        r"D:\SoftWare\WinRAR\WinRAR.exe",
        "WinRAR",
        "WinRAR.exe",
        "RAR",
        "RAR.exe",
        "UnRAR",
        "UnRAR.exe",
        r"C:\Program Files\WinRAR\WinRAR.exe",
        r"C:\Program Files\WinRAR\Rar.exe",
        r"C:\Program Files\WinRAR\UnRAR.exe",
        r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
        r"C:\Program Files (x86)\WinRAR\Rar.exe",
        r"C:\Program Files (x86)\WinRAR\UnRAR.exe",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise HTTPException(
        status_code=400,
        detail="服务器未安装 WinRAR/RAR/UnRAR，无法解压 rar 文件",
    )


def _validate_extracted_paths(destination: Path) -> None:
    root = destination.resolve()
    for extracted in destination.rglob("*"):
        target = extracted.resolve()
        if root not in target.parents and target != root:
            raise HTTPException(status_code=400, detail="压缩包包含不安全路径")


def _extract_zip(path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            target = (destination / item.filename).resolve()
            if destination.resolve() not in target.parents and target != destination.resolve():
                raise HTTPException(status_code=400, detail="Zip contains unsafe path")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(item))


def run_task_with_codex(task_id: uuid.UUID) -> dict[str, object]:
    task_path = task_dir(task_id)
    input_path = input_dir(task_id)
    output_path = reports_dir(task_id)
    log_path = logs_dir(task_id)
    output_path.mkdir(parents=True, exist_ok=True)
    log_path.mkdir(parents=True, exist_ok=True)
    prompt = _build_codex_prompt(input_path=input_path, output_path=output_path)
    command = [
        _resolve_codex_command(settings.BOM_SPEC_COMPARE_CODEX_COMMAND),
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
        "-C",
        str(task_path),
        "-",
    ]
    _write_invocation_log(log_path, command=command, input_path=input_path, output_path=output_path)
    try:
        completed = _run_codex_process(
            command,
            prompt=prompt,
            cwd=task_path,
            timeout_seconds=settings.BOM_SPEC_COMPARE_CODEX_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("服务端未找到 codex 命令，无法执行 BOM配送检查。") from exc
    except subprocess.TimeoutExpired as exc:
        (log_path / "codex-stdout.log").write_text(
            _process_output_text(exc.stdout),
            encoding="utf-8",
        )
        (log_path / "codex-stderr.log").write_text(
            _process_output_text(exc.stderr),
            encoding="utf-8",
        )
        recovered_result = _recover_completed_result(task_id)
        if recovered_result is not None:
            (log_path / "recovery.log").write_text(
                "Codex进程超时，但已回收完整批量报告并完成任务结果写回。\n",
                encoding="utf-8",
            )
            return recovered_result
        raise RuntimeError("BOM配送检查超时，请检查上传资料大小或稍后重试。") from exc

    (log_path / "codex-stdout.log").write_text(completed.stdout or "", encoding="utf-8")
    (log_path / "codex-stderr.log").write_text(completed.stderr or "", encoding="utf-8")
    if completed.returncode != 0:
        recovered_result = _recover_completed_result(task_id)
        if recovered_result is not None:
            (log_path / "recovery.log").write_text(
                "Codex进程返回异常，但已回收完整批量报告并完成任务结果写回。\n",
                encoding="utf-8",
            )
            return recovered_result
        detail = _format_codex_error("\n".join([completed.stderr or "", completed.stdout or ""]))
        raise RuntimeError(f"Codex 执行 BOM配送检查失败：{detail or '未知错误'}")

    report_zip = _create_report_zip(task_id)
    summary = _read_summary(output_path)
    return {
        "result_files": [
            {
                "file_name": report_zip.name,
                "file_path": str(report_zip),
                "content_type": "application/zip",
                "file_size": report_zip.stat().st_size,
            }
        ],
        **summary,
    }


def _recover_completed_result(task_id: uuid.UUID) -> dict[str, object] | None:
    output_path = reports_dir(task_id)
    summary_path = _find_summary_json(output_path)
    if not _is_complete_batch_summary(summary_path):
        return None
    report_zip = report_zip_path(task_id)
    if not report_zip.is_file() or report_zip.stat().st_size <= 0:
        report_zip = _create_report_zip(task_id)
    return {
        "result_files": [
            {
                "file_name": report_zip.name,
                "file_path": str(report_zip),
                "content_type": "application/zip",
                "file_size": report_zip.stat().st_size,
            }
        ],
        **_summary_from_json(summary_path),
    }


def _is_complete_batch_summary(summary_path: Path) -> bool:
    if not summary_path.is_file():
        return False
    try:
        data = json.loads(summary_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    results = data.get("results")
    if not isinstance(results, list) or not results:
        return False
    declared_count = _safe_int(
        data.get("total_projects"),
        _safe_int(data.get("project_count"), len(results)),
    )
    if declared_count != len(results):
        return False
    return all(_is_finished_project(item) for item in results)


def _is_finished_project(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    status = str(item.get("status") or item.get("状态") or "").strip().lower()
    return status in {"完成", "成功", "失败", "success", "failed", "error", "ok"}


def _process_output_text(output: object) -> str:
    if output is None:
        return ""
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace")
    return str(output)


def _build_codex_prompt(*, input_path: Path, output_path: Path) -> str:
    dated_artifact_name = _dated_artifact_name()
    return f"""[$bom-spec-compare]({BOM_SPEC_SKILL_PATH})

请对 input 目录中的项目进行 BOM配送检查。

输入目录：
{input_path}

输出目录：
{output_path}

要求：
1. 先完整阅读并遵守 `$bom-spec-compare` skill 的全部规则。
2. 自动识别每个项目中的 BOM Excel 和规格书 PDF/Word/Excel。
3. 如果 input/projects 下存在批量项目目录，以其中每个子文件夹作为项目。
4. 如果只有单项目文件，则直接对该项目进行对比。
5. 每个项目的输出文件夹和文件名必须使用 `BOM与规格书配件对比清单`。
6. 在输出目录生成批量汇总 `{dated_artifact_name}.xlsx`、`{dated_artifact_name}.md`、`{dated_artifact_name}.json`，文件名必须在 `BOM与规格书配件对比清单` 后追加当天年月日 `YYYYMMDD`。
7. 规格书里 `物料号` 或 `物料编码` 以 `7` 开头的行，BOM 里没有不算错误；不得计入 `规格书有BOM无` 或差异，明细结论写 `一致`，备注固定写 `7开头物料号，BOM无需录入`。
8. 型号对比前必须忽略中文/英文括号及括号内全部文字，例如 `P168S200A-TT20412-电阻连接线-1.0（电阻连接线: Resistance cable）` 按 `P168S200A-TT20412-电阻连接线-1.0` 对比；半角括号如 `(Resistance cable)` 也同样忽略。
9. Excel-vs-Excel 文件角色必须按表头识别，不得只按文件名识别：带 `T_CITT1`、`物料号`、`物料描述`、`基本用量` 的系统导出表是 BOM；带 `物料清单`、`物料编码`、`用量`、`型号` 的模板表是规格书/配件清单，即使文件名包含 `BOM` 也按规格书侧读取。真实表头可能不在第 1 行，必须扫描前若干行定位。
10. Excel 报告格式必须完全沿用 7-3 历史格式，不允许使用其他批量汇总格式：
   - 每个项目明细 Excel 工作表：`BOM与规格书配件对比清单`、`summary`。
   - 项目明细列顺序必须是：`序号`、`BOM物料号`、`BOM名称`、`规格书名称`、`BOM规格型号`、`规格书型号`、`BOM数量`、`规格书数量`、`结论`、`备注`。
   - 批量总表工作表：`BOM与规格书配件对比清单`、`meta`。
   - 批量总表列顺序必须是：`项目`、`状态`、`BOM`、`规格书/对比文件`、`耗时(秒)`、`BOM有效行数`、`规格书有效行数`、`匹配成功`、`一致`、`不一致`、`BOM有规格书无`、`规格书有BOM无`、`判定结论`、`备注`。
   - 批量总表 `备注`：一致时为空；不一致时必须写物品级具体原因，包含名称、型号、数量；数量不一致格式为 `<名称> / <型号> 数量不一致：BOM=<BOM数量>，规格书=<规格书数量>`；BOM 有规格书无格式为 `BOM有规格书无：<BOM名称> / <BOM规格型号> / 数量=<BOM数量>`；规格书有 BOM 无格式为 `规格书有BOM无：<规格书名称> / <规格书型号> / 数量=<规格书数量>`；多条原因在 Excel 单元格中换行，纯文本/JSON 单行字段用 `；` 连接。
11. 批量 JSON 也要沿用 7-3 语义，至少包含 `results` 列表；每个项目包含 `project`、`status`、`summary.判定结论`、`summary.备注`、各项统计数量、BOM 文件、规格书文件、耗时。
12. 记录每个项目耗时和总耗时。
13. 如果执行失败，保留可诊断日志并说明原因。
14. 不要输出到 input 目录，所有交付文件必须写入输出目录。
"""


def _run_codex_process(
    command: list[str],
    *,
    prompt: str,
    cwd: Path,
    timeout_seconds: int,
) -> subprocess.CompletedProcess[str]:
    process_env = os.environ.copy()
    codex_home = _codex_home_dir()
    # Windows 服务通常以 LocalSystem 账户运行，不能继承管理员账户的
    # HOME/PATH。显式传入 Codex 主目录，确保技能、认证和插件目录一致。
    process_env["CODEX_HOME"] = str(codex_home)
    process_env["USERPROFILE"] = str(codex_home.parent)
    process_env["HOME"] = str(codex_home.parent)
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(cwd),
        env=process_env,
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


def _resolve_codex_command(command: str) -> str:
    return _resolve_configured_codex_command(command, user_profile=_codex_home_dir().parent, which=shutil.which)

def _write_invocation_log(
    log_path: Path,
    *,
    command: list[str],
    input_path: Path,
    output_path: Path,
) -> None:
    payload = {
        "command": command,
        "input_path": str(input_path),
        "input_exists": input_path.exists(),
        "output_path": str(output_path),
        "output_exists": output_path.exists(),
        "skill_path": str(BOM_SPEC_SKILL_PATH),
        "skill_exists": BOM_SPEC_SKILL_PATH.exists(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (log_path / "codex-invocation.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _create_report_zip(task_id: uuid.UUID) -> Path:
    report_zip = report_zip_path(task_id)
    report_zip.parent.mkdir(parents=True, exist_ok=True)
    if report_zip.exists():
        report_zip.unlink()
    root = reports_dir(task_id)
    input_root = input_dir(task_id)
    log_root = logs_dir(task_id)
    with zipfile.ZipFile(report_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for source_root in (input_root, root, log_root):
            if not source_root.exists():
                continue
            for path in source_root.rglob("*"):
                if not path.is_file() or path == report_zip:
                    continue
                if source_root == input_root:
                    prefix = "input"
                elif source_root == root:
                    prefix = "reports"
                else:
                    prefix = "logs"
                archive.write(path, Path(prefix) / path.relative_to(source_root))
    return report_zip


def _report_zip_name(task_id: uuid.UUID) -> str:
    source_name = _uploaded_archive_stem(task_id)
    if source_name:
        return f"{source_name}.zip"
    return REPORT_ZIP_NAME


def _uploaded_archive_stem(task_id: uuid.UUID) -> str | None:
    source_dir = input_dir(task_id)
    if not source_dir.is_dir():
        return None
    for suffix in (".zip", ".rar", ".7z"):
        archives = sorted(path for path in source_dir.glob(f"*{suffix}") if path.is_file())
        if archives:
            return archives[0].stem
    return None


def _read_summary(output_path: Path) -> dict[str, int]:
    summary_path = _find_summary_json(output_path)
    if summary_path.is_file():
        return _summary_from_json(summary_path)
    return _empty_summary()


def _find_summary_json(output_path: Path) -> Path:
    exact_path = output_path / f"{ARTIFACT_NAME}.json"
    candidates = [path for path in output_path.glob(f"{ARTIFACT_NAME}*.json") if path.is_file()]
    dated_candidates = [
        path
        for path in candidates
        if re.fullmatch(rf"{re.escape(ARTIFACT_NAME)}\d{{8}}\.json", path.name)
    ]
    if dated_candidates:
        return max(dated_candidates, key=lambda path: (path.stat().st_mtime, path.name))
    if exact_path.is_file():
        return exact_path
    if candidates:
        return max(candidates, key=lambda path: (path.stat().st_mtime, path.name))
    return exact_path


def _empty_summary() -> dict[str, int]:
    return {
        "project_count": 0,
        "success_count": 0,
        "consistent_count": 0,
        "different_count": 0,
        "failed_count": 0,
    }


def _summary_from_json(path: Path) -> dict[str, int]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        return _empty_summary()

    if any(
        key in data
        for key in (
            "total_projects",
            "project_count",
            "success_projects",
            "failed_projects",
            "difference_projects",
            "diff_projects",
        )
    ):
        projects = data.get("projects")
        if not isinstance(projects, list) and isinstance(data.get("results"), list):
            projects = data.get("results")
        project_count = _safe_int(
            data.get("total_projects"),
            _safe_int(data.get("project_count"), len(projects) if isinstance(projects, list) else 0),
        )
        success_count = _safe_int(data.get("success_projects"))
        failed_count = _safe_int(data.get("failed_projects"))
        difference_projects = data.get("difference_projects")
        if isinstance(difference_projects, list):
            different_count = len(difference_projects) or (
                sum(1 for item in projects if _is_different_project(item))
                if isinstance(projects, list)
                else 0
            )
        else:
            different_count = _safe_int(
                data.get("difference_project_count"),
                _safe_int(data.get("diff_projects")),
            )
            if not different_count and isinstance(projects, list):
                different_count = sum(1 for item in projects if _is_different_project(item))
        if not failed_count and isinstance(projects, list):
            failed_count = sum(1 for item in projects if not _is_success_project(item))
        if not project_count:
            project_count = success_count + failed_count
        if not success_count:
            success_count = max(project_count - failed_count, 0)
        consistent_count = max(success_count - different_count, 0)
        return {
            "project_count": project_count,
            "success_count": success_count,
            "consistent_count": consistent_count,
            "different_count": different_count,
            "failed_count": failed_count,
        }

    projects = data.get("projects")
    if isinstance(projects, list):
        project_count = _safe_int(data.get("project_count"), len(projects))
        failed_count = _safe_int(
            data.get("failed_project_count"),
            sum(1 for item in projects if not _is_success_project(item)),
        )
        different_count = _safe_int(
            data.get("difference_project_count"),
            sum(1 for item in projects if _is_different_project(item)),
        )
        success_count = max(project_count - failed_count, 0)
        consistent_count = max(success_count - different_count, 0)
        return {
            "project_count": project_count,
            "success_count": success_count,
            "consistent_count": consistent_count,
            "different_count": different_count,
            "failed_count": failed_count,
        }

    results = data.get("results")
    if not isinstance(results, list):
        return _empty_summary()
    project_count = len(results)
    success_count = sum(1 for item in results if _is_success_project(item))
    failed_count = project_count - success_count
    consistent_count = 0
    different_count = 0
    for item in results:
        summary = item.get("summary") if isinstance(item.get("summary"), dict) else {}
        conclusion = summary.get("判定结论")
        if _is_success_project(item) and _is_different_project(item):
            different_count += 1
        elif _is_success_project(item) and (
            conclusion == "一致"
            or str(summary.get("一致") or "").strip()
            or not _is_different_project(item)
        ):
            consistent_count += 1
    return {
        "project_count": project_count,
        "success_count": success_count,
        "consistent_count": consistent_count,
        "different_count": different_count,
        "failed_count": failed_count,
    }


def _is_success_project(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    status = str(item.get("status") or item.get("状态") or "").strip().lower()
    return status in {"完成", "ok", "success", "成功"}


def _is_different_project(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    summary = item.get("summary") if isinstance(item.get("summary"), dict) else {}
    conclusion = str(
        item.get("判定结论")
        or summary.get("判定结论")
        or item.get("conclusion")
        or "",
    ).strip()
    if conclusion in {"不一致", "差异", "存在差异"}:
        return True
    has_difference_counts = any(
        _safe_int(item.get(key)) > 0 or _safe_int(summary.get(key)) > 0
        for key in (
            "difference_count",
            "diff_count",
            "different",
            "inconsistent",
            "bom_only",
            "spec_only",
            "不一致",
            "BOM有规格书无",
            "规格书有BOM无",
        )
    )
    if has_difference_counts:
        return True
    if conclusion == "一致":
        return False
    return False


def _safe_int(value: object, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _format_codex_error(detail: str) -> str:
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    selected = lines[-8:]
    return "\n".join(selected)


def _format_archive_error(detail: str) -> str:
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    selected = lines[-5:]
    return "\n".join(selected)
