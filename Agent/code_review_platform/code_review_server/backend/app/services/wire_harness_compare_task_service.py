from __future__ import annotations

import json
import re
import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

import pymupdf
from fastapi import HTTPException, UploadFile
from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageFilter,
    ImageFont,
    ImageOps,
    ImageStat,
)

from app.core.config import settings
from app.services.storage_cleanup import robust_rmtree
from app.services.wire_harness_annotation import (
    build_annotation_assets,
    build_interactive_report,
    relocate_difference_locations_on_rendered_pages,
)
from app.services.wire_harness_codex_compare import compare_drawings_with_codex
from app.services.wire_harness_semantic_compare import (
    DifferenceRecord,
    compare_text_blocks,
    default_ocr_adapter,
    extract_text_blocks,
)

RESULT_ZIP_NAME = "线束图对比_左右并排图.zip"
PDF_SUFFIX = ".pdf"
OLD_MARKERS = ("原档", "原版", "旧版", "旧", "old", "before")
NEW_MARKERS = ("改", "新版", "新", "new", "after")


def task_dir(task_id: uuid.UUID) -> Path:
    return Path(settings.WIRE_HARNESS_COMPARE_STORAGE_DIR) / str(task_id)


def input_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "input"


def extract_dir(task_id: uuid.UUID) -> Path:
    return input_dir(task_id) / "解压文件"


def result_dir(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "results"


def report_zip_path(task_id: uuid.UUID) -> Path:
    return task_dir(task_id) / "线束图对比_左右并排图.zip"


def remove_task_files(task_id: uuid.UUID) -> None:
    storage_dir = Path(settings.WIRE_HARNESS_COMPARE_STORAGE_DIR).resolve()
    target_dir = (storage_dir / str(task_id)).resolve()
    if target_dir.name != str(task_id) or target_dir.parent != storage_dir:
        raise RuntimeError("Invalid wire harness task storage path")
    if target_dir.exists():
        robust_rmtree(target_dir)


def _safe_filename(filename: str | None, fallback: str) -> str:
    name = Path(filename or fallback).name
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()
    return name or fallback


def _archive_suffix(filename: str | None) -> str | None:
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in {".zip", ".rar"} else None


async def save_archive_upload(
    task_id: uuid.UUID,
    upload: UploadFile,
) -> list[dict[str, str | int | None]]:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="压缩包不能为空")
    if len(content) > settings.WIRE_HARNESS_COMPARE_MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=400, detail="压缩包超过大小限制")
    file_name = _safe_filename(upload.filename, "线束图对比.zip")
    suffix = _archive_suffix(file_name)
    if suffix is None:
        raise HTTPException(status_code=400, detail="目前只支持 ZIP 或 RAR 压缩包")
    destination = input_dir(task_id)
    destination.mkdir(parents=True, exist_ok=True)
    path = destination / file_name
    path.write_bytes(content)
    return [
        {
            "file_name": file_name,
            "file_path": str(path),
            "content_type": upload.content_type
            or ("application/x-rar-compressed" if suffix == ".rar" else "application/zip"),
            "file_size": len(content),
        }
    ]


def _extract_zip(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            if len(members) > settings.WIRE_HARNESS_COMPARE_MAX_FILES:
                raise RuntimeError("压缩包内文件数量超过限制")
            root = destination.resolve()
            for member in members:
                target = (destination / member.filename).resolve()
                if root not in target.parents and target != root:
                    raise RuntimeError("压缩包包含不安全路径")
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(member))
    except zipfile.BadZipFile as exc:
        raise RuntimeError("压缩包损坏或不是有效 ZIP 文件") from exc


def _resolve_rar_command() -> str:
    configured = settings.WIRE_HARNESS_COMPARE_RAR_COMMAND.strip() or "UnRAR"
    candidates = [
        r"D:\SoftWare\WinRAR\UnRAR.exe",
        r"D:\SoftWare\WinRAR\Rar.exe",
        r"D:\SoftWare\WinRAR\WinRAR.exe",
        configured,
        "UnRAR",
        "UnRAR.exe",
        "RAR",
        "RAR.exe",
        "WinRAR",
        "WinRAR.exe",
        r"C:\Program Files\WinRAR\UnRAR.exe",
        r"C:\Program Files\WinRAR\Rar.exe",
        r"C:\Program Files\WinRAR\WinRAR.exe",
        r"C:\Program Files (x86)\WinRAR\UnRAR.exe",
        r"C:\Program Files (x86)\WinRAR\Rar.exe",
        r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise RuntimeError("服务器未安装 WinRAR/UnRAR，无法解压 RAR 压缩包")


def _validate_extracted_paths(destination: Path) -> None:
    root = destination.resolve()
    for extracted in destination.rglob("*"):
        target = extracted.resolve()
        if root not in target.parents and target != root:
            raise RuntimeError("压缩包包含不安全路径")


def _extract_rar(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    command = _resolve_rar_command()
    try:
        completed = subprocess.run(
            [command, "x", "-y", str(archive_path), str(destination) + "\\"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("RAR 压缩包解压超时") from exc
    except OSError as exc:
        raise RuntimeError(f"无法启动 RAR 解压工具: {command}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "未知错误").strip().splitlines()[-1]
        raise RuntimeError(f"RAR 压缩包解压失败: {detail}")
    _validate_extracted_paths(destination)
    extracted_files = [path for path in destination.rglob("*") if path.is_file()]
    if len(extracted_files) > settings.WIRE_HARNESS_COMPARE_MAX_FILES:
        raise RuntimeError("压缩包内文件数量超过限制")


def _extract_archive(archive_path: Path, destination: Path) -> None:
    suffix = _archive_suffix(archive_path.name)
    if suffix == ".zip":
        _extract_zip(archive_path, destination)
        return
    if suffix == ".rar":
        _extract_rar(archive_path, destination)
        return
    raise RuntimeError("只支持 ZIP 或 RAR 压缩包")


def _pair_sort_key(path: Path) -> tuple[int, str]:
    name = path.name.lower()
    old_score = sum(1 for marker in OLD_MARKERS if marker.lower() in name)
    new_score = sum(1 for marker in NEW_MARKERS if marker.lower() in name)
    if old_score > new_score:
        priority = 0
    elif new_score > old_score:
        priority = 1
    else:
        # An unmarked drawing is conventionally the original when paired with
        # a file explicitly marked as modified/new.
        priority = 0
    return (priority, name)


def _find_pdf_pairs(root: Path) -> list[tuple[Path, Path, str]]:
    pairs: list[tuple[Path, Path, str]] = []
    directories = [root, *sorted(path for path in root.rglob("*") if path.is_dir())]
    for directory in directories:
        pdfs = sorted(
            (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() == PDF_SUFFIX),
            key=lambda path: path.name.lower(),
        )
        if not pdfs:
            continue
        if len(pdfs) != 2:
            raise RuntimeError(f"文件夹 {directory.name} 中需要正好 2 份 PDF，实际为 {len(pdfs)} 份")
        ordered = sorted(pdfs, key=_pair_sort_key)
        relative_name = directory.relative_to(root).as_posix() or "根目录"
        pairs.append((ordered[0], ordered[1], relative_name))
    if not pairs:
        raise RuntimeError("压缩包中未找到包含两份 PDF 的线束图文件夹")
    return pairs


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for font_path in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if Path(font_path).is_file():
            return ImageFont.truetype(font_path, size=size)
    return ImageFont.load_default()


def _render_page(document: pymupdf.Document, page_number: int, dpi: int = 160) -> Image.Image:
    pixmap = document[page_number].get_pixmap(dpi=dpi, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _translate_image(image: Image.Image, dx: int, dy: int) -> Image.Image:
    result = Image.new("RGB", image.size, "white")
    source_box = (
        max(0, -dx),
        max(0, -dy),
        min(image.width, image.width - dx),
        min(image.height, image.height - dy),
    )
    target = (max(0, dx), max(0, dy))
    if source_box[2] > source_box[0] and source_box[3] > source_box[1]:
        result.paste(image.crop(source_box), target)
    return result


def _alignment_score(reference: Image.Image, candidate: Image.Image) -> float:
    reference_edges = ImageOps.grayscale(reference).filter(ImageFilter.FIND_EDGES)
    candidate_edges = ImageOps.grayscale(candidate).filter(ImageFilter.FIND_EDGES)
    return ImageStat.Stat(ImageChops.difference(reference_edges, candidate_edges)).mean[0]


def _align_image_to_reference(reference: Image.Image, candidate: Image.Image) -> Image.Image:
    """Correct small scan/export translations before computing pixel differences."""
    if candidate.size != reference.size:
        candidate = candidate.resize(reference.size, Image.Resampling.LANCZOS)
    scale = 4
    small_reference = reference.resize((max(1, reference.width // scale), max(1, reference.height // scale)), Image.Resampling.BILINEAR)
    small_candidate = candidate.resize(small_reference.size, Image.Resampling.BILINEAR)
    best_shift = (0, 0)
    best_score = _alignment_score(small_reference, small_candidate)
    for dy in range(-12, 13):
        for dx in range(-12, 13):
            shifted = _translate_image(small_candidate, dx, dy)
            score = _alignment_score(small_reference, shifted)
            if score < best_score:
                best_shift, best_score = (dx, dy), score
    if best_shift == (0, 0):
        return candidate
    return _translate_image(candidate, best_shift[0] * scale, best_shift[1] * scale)


def _difference_boxes(old_image: Image.Image, new_image: Image.Image) -> list[tuple[int, int, int, int]]:
    new_image = _align_image_to_reference(old_image, new_image)
    width, height = old_image.size
    small_size = (max(1, width // 4), max(1, height // 4))
    old_small = old_image.resize(small_size, Image.Resampling.BILINEAR)
    new_small = new_image.resize(small_size, Image.Resampling.BILINEAR)
    difference = ImageOps.autocontrast(
        ImageOps.grayscale(ImageChops.difference(old_small, new_small))
    ).filter(ImageFilter.GaussianBlur(1.2))
    mask = difference.point(lambda value: 255 if value >= 96 else 0).filter(ImageFilter.MaxFilter(5))
    pixels = mask.load()
    small_width, small_height = mask.size
    visited: set[tuple[int, int]] = set()
    boxes: list[tuple[int, int, int, int]] = []
    for y in range(small_height):
        for x in range(small_width):
            if pixels[x, y] == 0 or (x, y) in visited:
                continue
            stack = [(x, y)]
            visited.add((x, y))
            points: list[tuple[int, int]] = []
            while stack:
                current_x, current_y = stack.pop()
                points.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if (
                        0 <= next_x < small_width
                        and 0 <= next_y < small_height
                        and pixels[next_x, next_y] != 0
                        and (next_x, next_y) not in visited
                    ):
                        visited.add((next_x, next_y))
                        stack.append((next_x, next_y))
            if len(points) < 3:
                continue
            left = min(point[0] for point in points) * 4
            top = min(point[1] for point in points) * 4
            right = min(width, (max(point[0] for point in points) + 1) * 4)
            bottom = min(height, (max(point[1] for point in points) + 1) * 4)
            boxes.append((left, top, right, bottom))
    return sorted(boxes, key=lambda box: (box[1], box[0]))[:99]


def _side_by_side(old_image: Image.Image, new_image: Image.Image) -> Image.Image:
    old_image = old_image.convert("RGB")
    new_image = new_image.convert("RGB")
    new_image = _align_image_to_reference(old_image, new_image)
    width, height = old_image.size
    label_height = max(42, height // 28)
    result = Image.new("RGB", (width * 2, height + label_height), "white")
    result.paste(old_image, (0, label_height))
    result.paste(new_image, (width, label_height))
    draw = ImageDraw.Draw(result)
    label_font = _load_font(max(18, label_height // 2))
    draw.text((14, 10), "旧版", fill="black", font=label_font)
    draw.text((width + 14, 10), "新版", fill="black", font=label_font)
    return result


def _safe_result_folder(name: str) -> str:
    value = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", name).strip("._")
    return value or "线束图"


def _create_result_zip(task_id: uuid.UUID) -> Path:
    archive_path = report_zip_path(task_id)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for result_path in sorted(result_dir(task_id).rglob("*")):
            if result_path.is_file():
                archive.write(result_path, Path("线束图对比结果") / result_path.relative_to(result_dir(task_id)))
    return archive_path


def _result_file(path: Path, content_type: str) -> dict[str, str | int]:
    return {
        "file_name": path.name,
        "file_path": str(path),
        "content_type": content_type,
        "file_size": path.stat().st_size,
    }


def _write_difference_files(output_folder: Path, differences: list[DifferenceRecord]) -> tuple[Path, Path]:
    markdown = output_folder / "差异明细.md"
    markdown_lines = ["# 线束图语义差异", "", "| 编号 | 类型 | 旧图 | 新图 | 页码 | 置信度 |", "|---:|---|---|---|---:|---:|"]
    json_records: list[dict[str, object]] = []
    for difference in differences:
        old_text = difference.old_text or "无"
        new_text = difference.new_text or "无"
        review = "，需人工确认" if difference.needs_review else ""
        page_text = f"旧{difference.old_page or difference.page}/新{difference.new_page or difference.page}"
        markdown_lines.append(f"| {difference.number} | {difference.kind} | {old_text} | {new_text} | {page_text} | {difference.confidence:.0%}{review} |")
        json_records.append({
            "number": difference.number,
            "kind": difference.kind,
            "page": difference.page,
            "old_page": difference.old_page,
            "new_page": difference.new_page,
            "old_text": difference.old_text,
            "new_text": difference.new_text,
            "old_bbox": difference.old_bbox,
            "new_bbox": difference.new_bbox,
            "confidence": difference.confidence,
            "needs_review": difference.needs_review,
            "reason": difference.reason,
        })
    markdown.write_text("\n".join(markdown_lines) + "\n", encoding="utf-8")
    data = output_folder / "差异数据.json"
    data.write_text(json.dumps(json_records, ensure_ascii=False, indent=2), encoding="utf-8")
    return markdown, data


def run_task(task_id: uuid.UUID) -> dict[str, object]:
    archive_path = next(
        (path for path in input_dir(task_id).iterdir() if _archive_suffix(path.name)),
        None,
    )
    if archive_path is None:
        raise RuntimeError("未找到已上传的 ZIP 压缩包")
    _extract_archive(archive_path, extract_dir(task_id))
    pairs = _find_pdf_pairs(extract_dir(task_id))
    result_dir(task_id).mkdir(parents=True, exist_ok=True)
    image_count = 0
    failed_count = 0
    semantic_diff_count = 0
    review_required_count = 0
    ocr_page_count = 0
    result_files: list[dict[str, str | int]] = []
    ocr = default_ocr_adapter()
    for old_pdf, new_pdf, folder_name in pairs:
        output_folder = result_dir(task_id) / _safe_result_folder(folder_name)
        output_folder.mkdir(parents=True, exist_ok=True)
        old_document = pymupdf.open(old_pdf)
        new_document = pymupdf.open(new_pdf)
        try:
            page_count = min(old_document.page_count, new_document.page_count)
            if page_count == 0:
                failed_count += 1
                continue
            old_blocks = extract_text_blocks(old_pdf, ocr=ocr)
            new_blocks = extract_text_blocks(new_pdf, ocr=ocr)
            if not old_blocks and not new_blocks and ocr is None:
                raise RuntimeError("图纸未提取到文字，服务器未安装可用 OCR 引擎")
            script_differences = compare_text_blocks(old_blocks, new_blocks)
            differences = compare_drawings_with_codex(
                task_root=task_dir(task_id),
                old_pdf=old_pdf,
                new_pdf=new_pdf,
                output_folder=output_folder,
                old_blocks=old_blocks,
                new_blocks=new_blocks,
                script_differences=script_differences,
            )
            semantic_diff_count += len(differences)
            review_required_count += sum(1 for difference in differences if difference.needs_review)
            ocr_page_count += len({(block.source, block.page) for block in old_blocks + new_blocks if block.source == "ocr"})
            assets = build_annotation_assets(old_pdf, new_pdf, differences, output_folder)
            differences = relocate_difference_locations_on_rendered_pages(
                assets.old_pages,
                assets.new_pages,
                output_folder,
                differences,
                ocr,
            )
            report = output_folder / "差异报告.html"
            build_interactive_report(report, folder_name, assets.old_pages, assets.new_pages, differences)
            markdown, data = _write_difference_files(output_folder, differences)
            result_files.extend([
                _result_file(assets.old_pdf, "application/pdf"),
                _result_file(assets.new_pdf, "application/pdf"),
                _result_file(report, "text/html"),
                _result_file(markdown, "text/markdown"),
                _result_file(data, "application/json"),
            ])
            for page_number in range(page_count):
                image = _side_by_side(
                    _render_page(old_document, page_number),
                    _render_page(new_document, page_number),
                )
                image.save(output_folder / f"第{page_number + 1}页_左右并排对比.png")
                image_count += 1
        finally:
            old_document.close()
            new_document.close()
    result_zip = _create_result_zip(task_id)
    result_files.insert(0, _result_file(result_zip, "application/zip"))
    return {
        "result_files": result_files,
        "pair_count": len(pairs),
        "image_count": image_count,
        "failed_count": failed_count,
        "semantic_diff_count": semantic_diff_count,
        "review_required_count": review_required_count,
        "ocr_page_count": ocr_page_count,
    }
