import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import unquote
from xml.etree import ElementTree

from fastapi import HTTPException, UploadFile
from markdown_it import MarkdownIt
from markdown_it.token import Token
from PIL import Image, UnidentifiedImageError

from app.core.config import settings

ALLOWED_REQUIREMENT_EXTENSIONS = {".xls", ".xlsx"}
MAX_FILENAME_BYTES = 255
MAX_REPORT_MARKDOWN_BYTES = 5 * 1024 * 1024
MAX_REPORT_IMAGE_COUNT = 50
MAX_REPORT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_REPORT_ASSETS_TOTAL_BYTES = 50 * 1024 * 1024
MAX_REPORT_IMAGE_PIXELS = 40_000_000
UPLOAD_READ_CHUNK_BYTES = 64 * 1024
DELETE_TRASH_DIR_NAME = ".delete-trash"
DELETE_MANIFEST_NAME = "manifest.json"
REPORT_IMAGE_CONTENT_TYPES = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}
RASTER_IMAGE_FORMATS = {
    ".gif": "GIF",
    ".jpeg": "JPEG",
    ".jpg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
}
BLOCKED_SVG_ELEMENTS = {
    "animate",
    "animatemotion",
    "animatetransform",
    "audio",
    "embed",
    "foreignobject",
    "iframe",
    "object",
    "script",
    "set",
    "style",
    "video",
}


@dataclass(frozen=True)
class PreparedReportAsset:
    relative_path: PurePosixPath
    content: bytes


@dataclass(frozen=True)
class PreparedReportUpload:
    report_content: bytes
    assets: list[PreparedReportAsset]


@dataclass(frozen=True)
class QuarantinedTaskPath:
    original_path: Path
    quarantined_path: Path


@dataclass(frozen=True)
class QuarantinedTaskFiles:
    task_id: uuid.UUID
    root: Path
    paths: tuple[QuarantinedTaskPath, ...]


MARKDOWN_PARSER = MarkdownIt("commonmark")


def path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.md"


def pdf_path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.pdf"


def asset_root_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / str(task_id) / "assets"


def _validated_asset_relative_path(asset_path: str) -> PurePosixPath:
    if not asset_path or "\\" in asset_path or re.match(r"^[A-Za-z]:", asset_path):
        raise HTTPException(status_code=400, detail="图片资产路径无效")
    relative_path = PurePosixPath(asset_path)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise HTTPException(status_code=400, detail="图片资产路径无效")
    if len(relative_path.parts) < 2 or relative_path.parts[0] != "images":
        raise HTTPException(status_code=400, detail="图片资产必须位于 images 目录")
    return relative_path


def asset_path_for_task(task_id: uuid.UUID, asset_path: str) -> Path:
    relative_path = _validated_asset_relative_path(asset_path)
    return asset_root_for_task(task_id).joinpath(*relative_path.parts)


def remove_asset_root(task_id: uuid.UUID) -> None:
    try:
        shutil.rmtree(asset_root_for_task(task_id))
    except FileNotFoundError:
        pass


def _walk_markdown_tokens(tokens: list[Token]) -> list[Token]:
    walked: list[Token] = []
    pending = list(reversed(tokens))
    while pending:
        token = pending.pop()
        walked.append(token)
        if token.children:
            pending.extend(reversed(token.children))
    return walked


def extract_markdown_image_paths(markdown: str) -> list[str]:
    image_paths: list[str] = []
    for token in _walk_markdown_tokens(MARKDOWN_PARSER.parse(markdown)):
        if token.type != "image":
            continue
        raw_path = token.attrGet("src")
        if not isinstance(raw_path, str) or not raw_path:
            continue
        decoded_path = _decode_markdown_asset_path(raw_path)
        if decoded_path not in image_paths:
            image_paths.append(decoded_path)
    return image_paths


def _decode_markdown_asset_path(asset_path: str) -> str:
    if re.search(r"%(?![0-9A-Fa-f]{2})", asset_path):
        raise HTTPException(status_code=400, detail="报告图片路径编码无效")
    try:
        return unquote(asset_path, errors="strict")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="报告图片路径编码无效") from None


def _safe_filename(file_name: str | None, fallback: str) -> str:
    raw_name = file_name or fallback
    safe_name = Path(raw_name.replace("\\", "/")).name
    safe_name = "".join(
        "_" if _is_unsafe_filename_char(char) else char for char in safe_name
    ).strip()
    safe_name = safe_name.rstrip(". ")
    if not safe_name:
        safe_name = fallback

    suffix = Path(safe_name).suffix
    stem = safe_name[: -len(suffix)] if suffix else safe_name
    safe_name = _truncate_filename(stem, suffix)
    return safe_name or fallback


def _is_unsafe_filename_char(char: str) -> bool:
    return char in {"/", "\\", "\x00"} or ord(char) < 32 or ord(char) == 127


def _truncate_filename(stem: str, suffix: str) -> str:
    suffix_bytes = suffix.encode("utf-8")
    if len(suffix_bytes) > MAX_FILENAME_BYTES:
        return suffix_bytes[:MAX_FILENAME_BYTES].decode("utf-8", errors="ignore")

    available_stem_bytes = MAX_FILENAME_BYTES - len(suffix_bytes)
    stem_bytes = stem.encode("utf-8")
    if len(stem_bytes) <= available_stem_bytes:
        return stem + suffix
    truncated_stem = stem_bytes[:available_stem_bytes].decode("utf-8", errors="ignore")
    return truncated_stem.rstrip(". ") + suffix


def requirement_file_path_for_task(
    task_id: uuid.UUID, file_hash: str, file_name: str
) -> Path:
    return (
        Path(settings.REPORT_STORAGE_DIR)
        / str(task_id)
        / "requirements"
        / file_hash[:16]
        / file_name
    )


async def save_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Report file must not be empty")

    report_path = path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path


async def _read_upload_limited(
    upload: UploadFile,
    *,
    max_bytes: int,
    empty_detail: str,
    limit_detail: str,
) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = await upload.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(status_code=400, detail=limit_detail)
        chunks.append(chunk)
    if total_bytes == 0:
        raise HTTPException(status_code=400, detail=empty_detail)
    return b"".join(chunks)


def _xml_local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1].casefold()


def _is_safe_svg(content: bytes) -> bool:
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        return False
    try:
        root = ElementTree.fromstring(content)
    except (ElementTree.ParseError, UnicodeDecodeError, ValueError):
        return False
    if not isinstance(root.tag, str) or _xml_local_name(root.tag) != "svg":
        return False

    for element in root.iter():
        if not isinstance(element.tag, str):
            return False
        if _xml_local_name(element.tag) in BLOCKED_SVG_ELEMENTS:
            return False
        for raw_name, raw_value in element.attrib.items():
            attribute_name = _xml_local_name(raw_name)
            value = raw_value.strip()
            if attribute_name.startswith("on") or attribute_name in {
                "base",
                "style",
            }:
                return False
            if (
                attribute_name in {"href", "src"}
                and value
                and not value.startswith("#")
            ):
                return False
            if re.search(
                r"(?:url\s*\(|@import|expression\s*\()",
                value,
                flags=re.IGNORECASE,
            ):
                return False
            if "\\" in value or "/*" in value or "*/" in value:
                return False
    return True


def _is_raster_image_decodable(extension: str, content: bytes) -> bool:
    expected_format = RASTER_IMAGE_FORMATS.get(extension)
    if expected_format is None:
        return False
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if (
                    image.format != expected_format
                    or getattr(image, "n_frames", 1) != 1
                ):
                    return False
                width, height = image.size
                if (
                    width <= 0
                    or height <= 0
                    or width * height > MAX_REPORT_IMAGE_PIXELS
                ):
                    return False
                image.verify()
            with Image.open(BytesIO(content)) as image:
                image.load()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ):
        return False
    return True


def _is_image_content_valid(extension: str, content: bytes) -> bool:
    if extension == ".svg":
        return _is_safe_svg(content)
    return _is_raster_image_decodable(extension, content)


async def prepare_report_upload(
    upload: UploadFile,
    asset_paths: list[str],
    uploads: list[UploadFile],
) -> PreparedReportUpload:
    report_content = await _read_upload_limited(
        upload,
        max_bytes=MAX_REPORT_MARKDOWN_BYTES,
        empty_detail="Report file must not be empty",
        limit_detail="审查报告超过大小限制",
    )
    try:
        report_markdown = report_content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400, detail="审查报告必须使用 UTF-8 编码"
        ) from None

    if len(asset_paths) != len(uploads):
        raise HTTPException(status_code=400, detail="图片资产路径与文件数量不一致")
    if len(uploads) > MAX_REPORT_IMAGE_COUNT:
        raise HTTPException(status_code=400, detail="报告图片数量超过限制")
    relative_paths = [_validated_asset_relative_path(path) for path in asset_paths]
    if len(set(relative_paths)) != len(relative_paths):
        raise HTTPException(status_code=400, detail="图片资产路径重复")

    referenced_paths = [
        _validated_asset_relative_path(path)
        for path in extract_markdown_image_paths(report_markdown)
    ]
    referenced_path_set = set(referenced_paths)
    uploaded_path_set = set(relative_paths)
    if referenced_path_set - uploaded_path_set:
        raise HTTPException(status_code=400, detail="Markdown 引用的图片资产未完整上传")
    if uploaded_path_set - referenced_path_set:
        raise HTTPException(status_code=400, detail="存在未被 Markdown 引用的图片资产")

    prepared_assets: list[PreparedReportAsset] = []
    total_asset_bytes = 0
    for relative_path, upload_file in zip(relative_paths, uploads, strict=True):
        expected_content_type = REPORT_IMAGE_CONTENT_TYPES.get(
            relative_path.suffix.lower()
        )
        if expected_content_type is None:
            raise HTTPException(status_code=400, detail="不支持的报告图片格式")
        content_type = (upload_file.content_type or "").split(";", 1)[0].strip().lower()
        if content_type != expected_content_type:
            raise HTTPException(status_code=400, detail="报告图片格式与内容类型不一致")
        remaining_total_bytes = MAX_REPORT_ASSETS_TOTAL_BYTES - total_asset_bytes
        if remaining_total_bytes <= 0:
            raise HTTPException(status_code=400, detail="报告图片总大小超过限制")
        content_limit = min(MAX_REPORT_IMAGE_BYTES, remaining_total_bytes)
        limit_detail = (
            "报告图片总大小超过限制"
            if remaining_total_bytes < MAX_REPORT_IMAGE_BYTES
            else "单个报告图片超过大小限制"
        )
        content = await _read_upload_limited(
            upload_file,
            max_bytes=content_limit,
            empty_detail="图片资产不能为空",
            limit_detail=limit_detail,
        )
        total_asset_bytes += len(content)
        if total_asset_bytes > MAX_REPORT_ASSETS_TOTAL_BYTES:
            raise HTTPException(status_code=400, detail="报告图片总大小超过限制")
        if not _is_image_content_valid(relative_path.suffix.lower(), content):
            raise HTTPException(
                status_code=400,
                detail="报告图片内容与文件格式不一致",
            )
        prepared_assets.append(
            PreparedReportAsset(relative_path=relative_path, content=content)
        )

    return PreparedReportUpload(
        report_content=report_content,
        assets=prepared_assets,
    )


def install_prepared_report(task_id: uuid.UUID, prepared: PreparedReportUpload) -> Path:
    storage_root = Path(settings.REPORT_STORAGE_DIR)
    storage_root.mkdir(parents=True, exist_ok=True)
    staging_root = Path(
        tempfile.mkdtemp(prefix=f".{task_id}-report-", dir=storage_root)
    )
    staged_report = staging_root / "report.md"
    staged_asset_root = staging_root / "assets"
    report_path = path_for_task(task_id)
    final_asset_root = asset_root_for_task(task_id)
    report_installed = False
    assets_installed = False

    try:
        staged_report.write_bytes(prepared.report_content)
        for asset in prepared.assets:
            file_path = staged_asset_root.joinpath(*asset.relative_path.parts)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(asset.content)

        if report_path.exists() or final_asset_root.exists():
            raise HTTPException(status_code=409, detail="原始报告已上传，不能覆盖")

        os.replace(staged_report, report_path)
        report_installed = True
        if prepared.assets:
            final_asset_root.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged_asset_root, final_asset_root)
            assets_installed = True
        return report_path
    except Exception:
        if assets_installed:
            remove_asset_root(task_id)
        if report_installed:
            report_path.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def remove_report_bundle(task_id: uuid.UUID) -> None:
    path_for_task(task_id).unlink(missing_ok=True)
    remove_asset_root(task_id)
    storage_root = Path(settings.REPORT_STORAGE_DIR)
    if storage_root.is_dir():
        for staging_root in storage_root.glob(f".{task_id}-report-*"):
            shutil.rmtree(staging_root, ignore_errors=True)


def _delete_trash_root() -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / DELETE_TRASH_DIR_NAME


def pending_delete_trash_paths() -> list[Path]:
    trash_root = _delete_trash_root()
    if not trash_root.is_dir():
        return []
    return sorted(path for path in trash_root.iterdir() if path.is_dir())


def _write_delete_manifest(quarantine: QuarantinedTaskFiles) -> None:
    manifest_path = quarantine.root / DELETE_MANIFEST_NAME
    temporary_path = quarantine.root / f".{DELETE_MANIFEST_NAME}.tmp"
    payload = {
        "task_id": str(quarantine.task_id),
        "paths": [
            {
                "original_path": str(path.original_path),
                "quarantined_path": path.quarantined_path.relative_to(
                    quarantine.root
                ).as_posix(),
            }
            for path in quarantine.paths
        ],
    }
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary_path, manifest_path)


def _load_delete_manifest(root: Path) -> QuarantinedTaskFiles:
    raw_manifest = json.loads((root / DELETE_MANIFEST_NAME).read_text(encoding="utf-8"))
    task_id = uuid.UUID(raw_manifest["task_id"])
    paths: list[QuarantinedTaskPath] = []
    for raw_path in raw_manifest["paths"]:
        relative_path = PurePosixPath(raw_path["quarantined_path"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("隔离文件清单路径无效")
        paths.append(
            QuarantinedTaskPath(
                original_path=Path(raw_path["original_path"]),
                quarantined_path=root.joinpath(*relative_path.parts),
            )
        )
    return QuarantinedTaskFiles(task_id=task_id, root=root, paths=tuple(paths))


def retry_pending_task_file_deletions(
    task_exists: Callable[[uuid.UUID], bool],
) -> list[Path]:
    failures: list[Path] = []
    for pending_path in pending_delete_trash_paths():
        try:
            quarantine = _load_delete_manifest(pending_path)
            if task_exists(quarantine.task_id):
                restore_quarantined_task_files(quarantine)
            else:
                purge_quarantined_task_files(quarantine)
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            failures.append(pending_path)
    return failures


def quarantine_task_files(
    task_id: uuid.UUID,
    file_paths: list[Path],
) -> QuarantinedTaskFiles:
    trash_root = _delete_trash_root()
    quarantine_root = trash_root / f"{task_id}-{uuid.uuid4().hex}"
    unique_paths: list[Path] = []
    seen_paths: set[str] = set()
    for file_path in [*file_paths, asset_root_for_task(task_id)]:
        normalized = os.path.abspath(file_path)
        if normalized not in seen_paths:
            seen_paths.add(normalized)
            unique_paths.append(Path(normalized))

    existing_paths = [
        path for path in unique_paths if path.exists() or path.is_symlink()
    ]
    if not existing_paths:
        return QuarantinedTaskFiles(task_id=task_id, root=quarantine_root, paths=())

    trash_root.mkdir(parents=True, exist_ok=True)
    quarantine_root.mkdir()
    quarantine = QuarantinedTaskFiles(
        task_id=task_id,
        root=quarantine_root,
        paths=tuple(
            QuarantinedTaskPath(
                original_path=original_path,
                quarantined_path=(quarantine_root / str(index) / original_path.name),
            )
            for index, original_path in enumerate(existing_paths)
        ),
    )
    moved_paths: list[QuarantinedTaskPath] = []
    try:
        _write_delete_manifest(quarantine)
        for quarantined_path in quarantine.paths:
            quarantined_path.quarantined_path.parent.mkdir(parents=True)
            os.replace(
                quarantined_path.original_path,
                quarantined_path.quarantined_path,
            )
            moved_paths.append(quarantined_path)
    except Exception:
        restore_quarantined_task_files(
            QuarantinedTaskFiles(
                task_id=task_id,
                root=quarantine_root,
                paths=tuple(moved_paths),
            )
        )
        raise
    return quarantine


def restore_quarantined_task_files(quarantine: QuarantinedTaskFiles) -> None:
    for quarantined_path in reversed(quarantine.paths):
        quarantined_path.original_path.parent.mkdir(parents=True, exist_ok=True)
        original_exists = (
            quarantined_path.original_path.exists()
            or quarantined_path.original_path.is_symlink()
        )
        quarantined_exists = (
            quarantined_path.quarantined_path.exists()
            or quarantined_path.quarantined_path.is_symlink()
        )
        if original_exists and not quarantined_exists:
            continue
        if original_exists or not quarantined_exists:
            raise RuntimeError(f"无法恢复已隔离文件: {quarantined_path.original_path}")
        os.replace(
            quarantined_path.quarantined_path,
            quarantined_path.original_path,
        )
    shutil.rmtree(quarantine.root, ignore_errors=True)


def purge_quarantined_task_files(quarantine: QuarantinedTaskFiles) -> None:
    try:
        shutil.rmtree(quarantine.root)
    except FileNotFoundError:
        pass


async def save_requirement_upload(
    task_id: uuid.UUID, upload: UploadFile
) -> tuple[Path, int, str, str]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="产品开发需求表不能为空。")

    file_hash = hashlib.sha256(content).hexdigest()
    safe_file_name = _safe_filename(upload.filename, "产品开发需求表.xlsx")
    extension = Path(safe_file_name).suffix.lower()
    if extension not in ALLOWED_REQUIREMENT_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail="产品开发需求表仅支持 .xls 或 .xlsx 文件。"
        )

    file_path = requirement_file_path_for_task(task_id, file_hash, safe_file_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content)
    return file_path, len(content), file_hash, safe_file_name


async def save_pdf_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="PDF report file must not be empty")

    report_path = pdf_path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path
