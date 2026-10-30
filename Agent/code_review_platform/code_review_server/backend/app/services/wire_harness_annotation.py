from __future__ import annotations

import base64
import html
import io
import json
import re
import shutil
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image

from app.core.config import settings
from app.services.wire_harness_semantic_compare import (
    BBox,
    DifferenceRecord,
    OcrAdapter,
    _compact_text,
    normalize_text,
)


@dataclass(frozen=True)
class AnnotationAssets:
    old_pdf: Path
    new_pdf: Path
    old_png: Path
    new_png: Path
    old_pages: list[dict[str, Any]]
    new_pages: list[dict[str, Any]]
    marker_count: int


@dataclass(frozen=True)
class RenderedTextBox:
    text: str
    page: int
    bbox: BBox
    confidence: float


def _nearest_text_box(document: pymupdf.Document, text: str | None, fallback: tuple[float, float, float, float] | None, page_number: int) -> tuple[float, float, float, float] | None:
    if not text:
        return fallback
    try:
        matches = document[page_number - 1].search_for(text)
    except Exception:
        matches = []
    if not matches:
        return fallback
    if fallback is None:
        selected = matches[0]
    else:
        fallback_center = ((fallback[0] + fallback[2]) / 2, (fallback[1] + fallback[3]) / 2)
        selected = min(
            matches,
            key=lambda rect: ((rect.x0 + rect.x1) / 2 - fallback_center[0]) ** 2
            + ((rect.y0 + rect.y1) / 2 - fallback_center[1]) ** 2,
        )
    return (selected.x0, selected.y0, selected.x1, selected.y1)


def _display_bbox(document: pymupdf.Document, box: tuple[float, float, float, float] | None, page_number: int) -> tuple[float, float, float, float] | None:
    if box is None:
        return None
    page = document[page_number - 1]
    if page.rotation == 0:
        return box
    # PyMuPDF text and OCR coordinates use the page's unrotated coordinate
    # system, while get_pixmap() presents the page in display orientation.
    # The mapping to the rendered image is the inverse page rotation.
    rotation = (360 - page.rotation) % 360
    return _apply_extra_display_rotation(box, rotation, page.mediabox.width, page.mediabox.height)


def _apply_extra_display_rotation(
    box: tuple[float, float, float, float] | None,
    rotation: int,
    source_width: float,
    source_height: float,
) -> tuple[float, float, float, float] | None:
    if box is None:
        return None
    normalized = rotation % 360
    x0, y0, x1, y1 = box
    if normalized == 0:
        return box
    if normalized == 90:
        rotated = (y0, source_width - x1, y1, source_width - x0)
    elif normalized == 270:
        rotated = (source_height - y1, x0, source_height - y0, x1)
    elif normalized == 180:
        rotated = (source_width - x1, source_height - y1, source_width - x0, source_height - y0)
    else:
        return box
    return tuple(round(value, 3) for value in rotated)  # type: ignore[return-value]


def _extra_display_rotation(page: pymupdf.Page, target_landscape: bool | None) -> int:
    if target_landscape is None or page.rotation != 0:
        return 0
    is_landscape = page.rect.width > page.rect.height
    if target_landscape and not is_landscape:
        return 90
    if not target_landscape and is_landscape:
        return 270
    return 0


def _paired_extra_rotations(old_pdf: Path, new_pdf: Path) -> tuple[dict[int, int], dict[int, int]]:
    old_document = pymupdf.open(old_pdf)
    new_document = pymupdf.open(new_pdf)
    try:
        old_rotations: dict[int, int] = {}
        new_rotations: dict[int, int] = {}
        page_count = min(old_document.page_count, new_document.page_count)
        for page_index in range(page_count):
            old_page = old_document[page_index]
            new_page = new_document[page_index]
            old_landscape = old_page.rect.width > old_page.rect.height
            new_landscape = new_page.rect.width > new_page.rect.height
            target_landscape = old_landscape if old_landscape == new_landscape else (old_landscape or new_landscape)
            old_rotations[page_index + 1] = _extra_display_rotation(old_page, target_landscape)
            new_rotations[page_index + 1] = _extra_display_rotation(new_page, target_landscape)
        return old_rotations, new_rotations
    finally:
        old_document.close()
        new_document.close()


def relocate_difference_locations(old_pdf: Path, new_pdf: Path, differences: list[DifferenceRecord]) -> list[DifferenceRecord]:
    """Prefer the lower occurrence when a changed value appears in the diagram and table."""
    old_document = pymupdf.open(old_pdf)
    new_document = pymupdf.open(new_pdf)
    try:
        relocated: list[DifferenceRecord] = []
        for difference in differences:
            old_box = _display_bbox(
                old_document,
                _nearest_text_box(old_document, difference.old_text, difference.old_bbox, difference.page),
                difference.old_page or difference.page,
            )
            new_box = _display_bbox(
                new_document,
                _nearest_text_box(new_document, difference.new_text, difference.new_bbox, difference.page),
                difference.new_page or difference.page,
            )
            relocated.append(replace(difference, old_bbox=old_box, new_bbox=new_box))
        return relocated
    finally:
        old_document.close()
        new_document.close()


def _box_center(box: BBox) -> tuple[float, float]:
    return ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def _distance_squared(left: BBox, right: BBox) -> float:
    left_center = _box_center(left)
    right_center = _box_center(right)
    return (left_center[0] - right_center[0]) ** 2 + (left_center[1] - right_center[1]) ** 2


def _box_area(box: BBox) -> float:
    return max(1.0, box[2] - box[0]) * max(1.0, box[3] - box[1])


def _box_width(box: BBox) -> float:
    return max(1.0, box[2] - box[0])


def _box_height(box: BBox) -> float:
    return max(1.0, box[3] - box[1])


def _overlap_ratio(left: BBox, right: BBox) -> float:
    overlap_left = max(left[0], right[0])
    overlap_top = max(left[1], right[1])
    overlap_right = min(left[2], right[2])
    overlap_bottom = min(left[3], right[3])
    if overlap_right <= overlap_left or overlap_bottom <= overlap_top:
        return 0.0
    overlap_area = (overlap_right - overlap_left) * (overlap_bottom - overlap_top)
    left_area = max(1.0, (left[2] - left[0]) * (left[3] - left[1]))
    right_area = max(1.0, (right[2] - right[0]) * (right[3] - right[1]))
    return overlap_area / min(left_area, right_area)


def _pad_box(box: BBox, page_width: float, page_height: float) -> BBox:
    left, top, right, bottom = box
    width = max(1.0, right - left)
    height = max(1.0, bottom - top)
    pad_x = max(3.0, min(16.0, width * 0.18))
    pad_y = max(3.0, min(12.0, height * 0.35))
    return (
        round(max(0.0, left - pad_x), 3),
        round(max(0.0, top - pad_y), 3),
        round(min(page_width, right + pad_x), 3),
        round(min(page_height, bottom + pad_y), 3),
    )


def _rendered_ocr_boxes(image_path: Path, page: dict[str, Any], ocr: OcrAdapter | None) -> list[RenderedTextBox]:
    if ocr is None or not image_path.is_file():
        return []
    image = Image.open(image_path).convert("RGB")
    try:
        recognized = ocr.recognize((image.width, image.height, image.tobytes(), 72))
    except Exception:
        return []
    scale_x = float(page["width"]) / max(1, image.width)
    scale_y = float(page["height"]) / max(1, image.height)
    boxes: list[RenderedTextBox] = []
    for text, box, confidence in recognized:
        cleaned = normalize_text(text)
        compact = _compact_text(cleaned)
        if not cleaned or not compact or confidence < 0.35:
            continue
        scaled = (
            box[0] * scale_x,
            box[1] * scale_y,
            box[2] * scale_x,
            box[3] * scale_y,
        )
        boxes.append(RenderedTextBox(cleaned, int(page["page"]), _pad_box(scaled, float(page["width"]), float(page["height"])), float(confidence)))
    boxes.extend(_rendered_tesseract_phrase_boxes(image, page))
    return boxes


def _rendered_tesseract_phrase_boxes(image: Image.Image, page: dict[str, Any]) -> list[RenderedTextBox]:
    try:
        import pytesseract
    except ImportError:
        return []
    configured = settings.WIRE_HARNESS_COMPARE_TESSERACT_COMMAND.strip()
    if configured and Path(configured).is_file():
        pytesseract.pytesseract.tesseract_cmd = configured
    elif shutil.which("tesseract") is None:
        candidate = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
        if candidate.is_file():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
        else:
            return []
    try:
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT, lang="chi_sim+eng")
    except Exception:
        return []
    scale_x = float(page["width"]) / max(1, image.width)
    scale_y = float(page["height"]) / max(1, image.height)
    grouped: dict[tuple[int, int, int], list[tuple[str, BBox, float]]] = {}
    for index, raw_text in enumerate(data.get("text", [])):
        text = normalize_text(str(raw_text))
        if not text:
            continue
        try:
            confidence = max(0.0, float(data["conf"][index]) / 100)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence < 0.2:
            continue
        left = float(data["left"][index]) * scale_x
        top = float(data["top"][index]) * scale_y
        right = left + float(data["width"][index]) * scale_x
        bottom = top + float(data["height"][index]) * scale_y
        key = (
            int(data["block_num"][index]),
            int(data["par_num"][index]),
            int(data["line_num"][index]),
        )
        grouped.setdefault(key, []).append((text, (left, top, right, bottom), confidence))
    phrases: list[RenderedTextBox] = []
    for words in grouped.values():
        for start in range(len(words)):
            for end in range(start + 1, min(len(words), start + 8) + 1):
                items = words[start:end]
                text = normalize_text(" ".join(item[0] for item in items))
                compact = _compact_text(text)
                if len(compact) < 2:
                    continue
                left = min(item[1][0] for item in items)
                top = min(item[1][1] for item in items)
                right = max(item[1][2] for item in items)
                bottom = max(item[1][3] for item in items)
                confidence = sum(item[2] for item in items) / len(items)
                phrases.append(
                    RenderedTextBox(
                        text,
                        int(page["page"]),
                        _pad_box((left, top, right, bottom), float(page["width"]), float(page["height"])),
                        confidence,
                    )
                )
    return phrases


def _compact_variants(text: str | None) -> list[str]:
    if not text:
        return []
    compact = _compact_text(text)
    variants = [compact]
    stripped_number = re.sub(r"^\d+", "", compact)
    if stripped_number and stripped_number != compact:
        variants.append(stripped_number)
    for separator in ("步", ":", "："):
        if separator in compact:
            tail = compact.split(separator, 1)[1]
            if tail:
                variants.append(tail)
    result: list[str] = []
    for variant in variants:
        if variant and variant not in result:
            result.append(variant)
    return result


def _rendered_match_score(target: str | None, candidate: RenderedTextBox) -> float:
    target_variants = _compact_variants(target)
    candidate_variants = _compact_variants(candidate.text)
    if not target_variants or not candidate_variants:
        return 0.0
    best = 0.0
    for target_compact in target_variants:
        for candidate_compact in candidate_variants:
            if "打透明uv胶" in target_compact:
                if not any(value in candidate_compact for value in ("打透明uv胶", "打透明uv", "打透明")):
                    continue
                if not candidate_compact.startswith("打透明"):
                    continue
                if len(candidate_compact) > len(target_compact) + 2:
                    continue
            if target_compact == candidate_compact:
                best = max(best, 1000.0 + min(len(target_compact), 80))
            elif target_compact in candidate_compact:
                best = max(best, 850.0 + min(len(target_compact), 80))
            elif candidate_compact in target_compact and len(candidate_compact) >= 4:
                best = max(best, 520.0 + min(len(candidate_compact), 80))
            else:
                shared = len(set(target_compact) & set(candidate_compact))
                coverage = shared / max(1, min(len(target_compact), len(candidate_compact)))
                if coverage >= 0.75 and min(len(target_compact), len(candidate_compact)) >= 5:
                    best = max(best, 250.0 + coverage * 100.0)
    return best


def _target_needs_tight_box(target: str | None) -> bool:
    compact = _compact_text(target or "")
    if not compact:
        return False
    if len(compact) <= 10 and re.search(r"\d", compact):
        return True
    return bool(re.fullmatch(r"[A-Za-z]*\d+[A-Za-z]*", compact))


def _candidate_box_is_too_large_for_fallback(target: str | None, candidate: RenderedTextBox, fallback: BBox | None) -> bool:
    if fallback is None or not _target_needs_tight_box(target):
        return False
    candidate_compact = _compact_text(candidate.text)
    target_compact = _compact_text(target or "")
    fallback_area = _box_area(fallback)
    candidate_area = _box_area(candidate.bbox)
    if len(candidate_compact) <= len(target_compact) + 3:
        return candidate_area >= fallback_area * 10 or _box_width(candidate.bbox) >= _box_width(fallback) * 5
    if candidate_area >= fallback_area * 8:
        return True
    if _box_width(candidate.bbox) >= _box_width(fallback) * 4:
        return True
    return _box_height(candidate.bbox) >= _box_height(fallback) * 4


def _display_fallback_bbox(box: BBox | None, page: dict[str, Any] | None) -> BBox | None:
    if box is None or page is None:
        return box
    rotation = int(page.get("display_rotation", 0) or 0)
    if rotation % 360 == 0:
        return box
    return _apply_extra_display_rotation(
        box,
        rotation,
        float(page["source_width"]),
        float(page["source_height"]),
    )


def _select_rendered_box(
    target: str | None,
    candidates: list[RenderedTextBox],
    used: set[int],
    fallback: BBox | None,
) -> BBox | None:
    scored: list[tuple[float, float, int, RenderedTextBox]] = []
    for index, candidate in enumerate(candidates):
        if index in used:
            continue
        score = _rendered_match_score(target, candidate)
        if score <= 0:
            continue
        if _candidate_box_is_too_large_for_fallback(target, candidate, fallback):
            continue
        distance = _distance_squared(candidate.bbox, fallback) if fallback is not None else 0.0
        scored.append((score, -distance, index, candidate))
    if not scored:
        return fallback
    if fallback is not None:
        nearby = [item for item in scored if -item[1] <= 180.0**2]
        if not nearby:
            return fallback
        _score, _negative_distance, index, selected = min(
            nearby,
            key=lambda item: (-item[1], -item[0], item[2]),
        )
    else:
        _score, _negative_distance, index, selected = max(scored, key=lambda item: (item[0], item[1], -item[2]))
    used.add(index)
    return selected.bbox


def relocate_difference_locations_on_rendered_pages(
    old_pages: list[dict[str, Any]],
    new_pages: list[dict[str, Any]],
    output_dir: Path,
    differences: list[DifferenceRecord],
    ocr: OcrAdapter | None,
) -> list[DifferenceRecord]:
    """Keep visual AI boxes authoritative and use OCR only when a box is missing."""
    needs_old_ocr = any(difference.old_bbox is None and difference.old_text for difference in differences)
    needs_new_ocr = any(difference.new_bbox is None and difference.new_text for difference in differences)
    old_candidates = (
        {
            int(page["page"]): _rendered_ocr_boxes(output_dir / str(page["image"]), page, ocr)
            for page in old_pages
        }
        if needs_old_ocr
        else {}
    )
    new_candidates = (
        {
            int(page["page"]): _rendered_ocr_boxes(output_dir / str(page["image"]), page, ocr)
            for page in new_pages
        }
        if needs_new_ocr
        else {}
    )
    used_old: dict[int, set[int]] = {page: set() for page in old_candidates}
    used_new: dict[int, set[int]] = {page: set() for page in new_candidates}
    relocated: list[DifferenceRecord] = []
    for difference in differences:
        old_page = difference.old_page or difference.page
        new_page = difference.new_page or difference.page
        old_page_data = next((page for page in old_pages if int(page["page"]) == old_page), None)
        new_page_data = next((page for page in new_pages if int(page["page"]) == new_page), None)
        old_fallback = _display_fallback_bbox(difference.old_bbox, old_page_data)
        new_fallback = _display_fallback_bbox(difference.new_bbox, new_page_data)
        old_box = _select_rendered_box(
            difference.old_text,
            old_candidates.get(old_page, []),
            used_old.setdefault(old_page, set()),
            old_fallback,
        ) if old_fallback is None and difference.old_text else old_fallback
        new_box = _select_rendered_box(
            difference.new_text,
            new_candidates.get(new_page, []),
            used_new.setdefault(new_page, set()),
            new_fallback,
        ) if new_fallback is None and difference.new_text else new_fallback
        relocated.append(replace(difference, old_bbox=old_box, new_bbox=new_box))
    return relocated


def _point(record: DifferenceRecord, old: bool) -> tuple[float, float]:
    box = record.old_bbox if old else record.new_bbox
    if box is None:
        return (24.0, 24.0)
    return (max(14.0, box[0] - 12), max(14.0, box[1] - 12))


def _save_rotated_pixmap(pixmap: pymupdf.Pixmap, image_path: Path, rotation: int) -> None:
    if rotation % 360 == 0:
        pixmap.save(image_path)
        return
    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
    buffer = io.BytesIO()
    image.rotate(rotation, expand=True).save(buffer, format="PNG")
    image_path.write_bytes(buffer.getvalue())


def _annotate_document(source: Path, target: Path, differences: list[DifferenceRecord], old: bool, extra_rotations: dict[int, int] | None = None) -> list[dict[str, Any]]:
    # Permanent PDF/PNG outputs stay clean; markers are rendered only by the interactive report.
    _ = differences, old
    document = pymupdf.open(source)
    pages: list[dict[str, Any]] = []
    for page_index, page in enumerate(document, start=1):
        image_name = f"{'旧图' if old else '新图'}_第{page_index}页.png"
        image_path = target.parent / image_name
        pixmap = page.get_pixmap(dpi=160, alpha=False)
        extra_rotation = (extra_rotations or {}).get(page_index, 0)
        _save_rotated_pixmap(pixmap, image_path, extra_rotation)
        source_width = page.rect.width
        source_height = page.rect.height
        width = source_height if extra_rotation % 180 else source_width
        height = source_width if extra_rotation % 180 else source_height
        pages.append({
            "page": page_index,
            "image": image_name,
            "width": width,
            "height": height,
            "source_width": source_width,
            "source_height": source_height,
            "display_rotation": extra_rotation,
            "bbox_space": "display",
        })
    document.save(target)
    document.close()
    return pages


def build_annotation_assets(
    old_pdf: Path,
    new_pdf: Path,
    differences: list[DifferenceRecord],
    output_dir: Path,
) -> AnnotationAssets:
    output_dir.mkdir(parents=True, exist_ok=True)
    old_target = output_dir / "旧图纸_红色批注.pdf"
    new_target = output_dir / "新图纸_蓝色批注.pdf"
    shutil.copyfile(old_pdf, output_dir / "原始旧图纸.pdf")
    shutil.copyfile(new_pdf, output_dir / "原始新图纸.pdf")
    old_rotations, new_rotations = _paired_extra_rotations(old_pdf, new_pdf)
    old_pages = _annotate_document(old_pdf, old_target, differences, old=True, extra_rotations=old_rotations)
    new_pages = _annotate_document(new_pdf, new_target, differences, old=False, extra_rotations=new_rotations)
    old_png = output_dir / str(old_pages[0]["image"])
    new_png = output_dir / str(new_pages[0]["image"])
    return AnnotationAssets(old_target, new_target, old_png, new_png, old_pages, new_pages, len(differences))


def _difference_json(difference: DifferenceRecord) -> dict[str, Any]:
    return {
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
    }


def _script_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


def _inline_pages(output_path: Path, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for page in pages:
        item = dict(page)
        image_path = output_path.parent / str(page["image"])
        if image_path.is_file():
            encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
            item["image"] = f"data:image/png;base64,{encoded}"
        result.append(item)
    return result


def build_interactive_report(
    output_path: Path,
    pair_name: str,
    old_pages: list[dict[str, Any]],
    new_pages: list[dict[str, Any]],
    differences: list[DifferenceRecord],
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = [_difference_json(difference) for difference in differences]
    old_page_data = _script_json(_inline_pages(output_path, old_pages))
    new_page_data = _script_json(_inline_pages(output_path, new_pages))
    difference_data = _script_json(data)
    title = html.escape(pair_name)
    output_path.write_text(
        f"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>线束图差异报告 - {title}</title>
<style>
:root {{ color-scheme: light; font-family: Arial, "Microsoft YaHei", sans-serif; }}
body {{ margin: 0; background: #f3f4f6; color: #172033; }}
header {{ position: sticky; top: 0; z-index: 4; padding: 14px 20px; background: #fff; border-bottom: 1px solid #d8dee8; }}
header h1 {{ margin: 0; font-size: 18px; }}
.layout {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 280px; gap: 12px; padding: 12px; }}
.panel {{ min-width: 0; background: #fff; border: 1px solid #d8dee8; border-radius: 6px; overflow: auto; max-height: calc(100vh - 90px); }}
.viewer-panel {{ cursor: grab; overscroll-behavior: contain; }}
.viewer-panel.dragging {{ cursor: grabbing; user-select: none; }}
.viewer-panel.dragging * {{ cursor: grabbing !important; user-select: none; }}
.panel h2 {{ position: sticky; top: 0; z-index: 2; margin: 0; padding: 10px 12px; background: #fff; border-bottom: 1px solid #e5e7eb; font-size: 14px; }}
.viewer-toolbar {{ position: sticky; top: 39px; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }}
.viewer-toolbar button {{ min-width: 30px; height: 28px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #172033; cursor: pointer; }}
.viewer-toolbar button:hover {{ background: #e2e8f0; }}
.zoom-value {{ min-width: 48px; text-align: center; font-size: 12px; color: #475569; }}
.pages-viewport {{ min-width: 100%; overflow: visible; touch-action: none; }}
.pages-viewport .page {{ width: calc(100% * var(--zoom, 1)); }}
.old-title {{ color: #dc2626; }} .new-title {{ color: #2563eb; }}
.page {{ position: relative; margin: 12px; border: 1px solid #e5e7eb; scroll-margin-top: 55px; }}
.page img {{ display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; pointer-events: none; }}
.highlight {{ display: none; position: absolute; box-sizing: border-box; border: 2px solid; pointer-events: none; z-index: 1; }}
.highlight.visible {{ display: block; }}
.old-highlight {{ border-color: #b91c1c; background: rgba(254, 202, 202, .18); color: #991b1b; }}
.new-highlight {{ border-color: #1d4ed8; background: rgba(191, 219, 254, .18); color: #1e40af; }}
.marker {{ display: none; position: absolute; align-items: center; justify-content: center; width: 24px; height: 24px; border: 2px solid #fff; border-radius: 50%; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; z-index: 2; }}
.marker.visible {{ display: flex; }}
.old-marker {{ background: #dc2626; }} .new-marker {{ background: #2563eb; }}
.marker.active {{ box-shadow: 0 0 0 4px #fbbf24; }}
.details {{ padding: 12px; }}
.diff {{ width: 100%; padding: 9px; margin-bottom: 7px; text-align: left; background: #fff; border: 1px solid #d8dee8; border-radius: 5px; cursor: pointer; }}
.diff.active {{ border-color: #f59e0b; background: #fffbeb; }}
.diff.needs-review {{ border-left: 4px solid #f59e0b; }}
.review-badge {{ display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #fffbeb; color: #92400e; border: 1px solid #f59e0b; font-size: 11px; font-weight: 700; vertical-align: middle; }}
.diff strong {{ display: block; margin-bottom: 4px; }}
.diff small {{ color: #64748b; }}
.value-old {{ color: #dc2626; }} .value-new {{ color: #2563eb; }}
@media (max-width: 1000px) {{ .layout {{ grid-template-columns: 1fr 1fr; }} .details {{ grid-column: 1 / -1; max-height: none; }} }}
@media (max-width: 650px) {{ .layout {{ grid-template-columns: 1fr; }} .details {{ grid-column: auto; }} .panel {{ max-height: none; }} }}
</style></head>
<body>
<header><h1>线束图差异报告 · {title}</h1></header>
<main class="layout"><section class="panel viewer-panel" id="old-panel"><h2 class="old-title">旧图纸 · 红色批注</h2><div class="viewer-toolbar"><button type="button" title="缩小" onclick="zoomOut('old')">−</button><span class="zoom-value" id="old-zoom">100%</span><button type="button" title="放大" onclick="zoomIn('old')">+</button><button type="button" title="恢复100%" onclick="resetZoom('old')">100%</button></div><div class="pages-viewport" id="old-viewport"><div id="old-pages"></div></div></section><section class="panel viewer-panel" id="new-panel"><h2 class="new-title">新图纸 · 蓝色批注</h2><div class="viewer-toolbar"><button type="button" title="缩小" onclick="zoomOut('new')">−</button><span class="zoom-value" id="new-zoom">100%</span><button type="button" title="放大" onclick="zoomIn('new')">+</button><button type="button" title="恢复100%" onclick="resetZoom('new')">100%</button></div><div class="pages-viewport" id="new-viewport"><div id="new-pages"></div></div></section><aside class="panel details"><h2>差异列表</h2><div id="diff-list"></div><div id="diff-detail"></div></aside></main>
<script id="diff-data" type="application/json">{difference_data}</script>
<script>
const oldPages = {old_page_data};
const newPages = {new_page_data};
const differences = {difference_data};
const oldRoot = document.getElementById('old-pages');
const newRoot = document.getElementById('new-pages');
const listRoot = document.getElementById('diff-list');
const detailRoot = document.getElementById('diff-detail');
const zooms = {{ old: 1, new: 1 }};
function updateZoom(side, value) {{
  zooms[side] = Math.max(0.5, Math.min(4, value));
  document.getElementById(side + '-pages').style.setProperty('--zoom', zooms[side]);
  document.getElementById(side + '-zoom').textContent = Math.round(zooms[side] * 100) + '%';
}}
function zoomIn(side) {{ updateZoom(side, zooms[side] + 0.25); }}
function zoomOut(side) {{ updateZoom(side, zooms[side] - 0.25); }}
function resetZoom(side) {{ updateZoom(side, 1); }}
function scrollDifferenceIntoView(side, diff) {{
  const sideRoot = document.getElementById(side + '-pages');
  const sidePanel = document.getElementById(side + '-panel');
  if (!sideRoot || !sidePanel) return;
  const marker = sideRoot.querySelector('.' + side + '-marker[data-number="' + diff.number + '"]');
  const pageNumber = side === 'old' ? (diff.old_page || diff.page) : (diff.new_page || diff.page);
  const page = document.getElementById(side + '-' + pageNumber);
  const target = marker || (page && page.querySelector('[data-number="' + diff.number + '"]')) || page;
  if (!target) return;
  const targetRect = target.getBoundingClientRect();
  const panelRect = sidePanel.getBoundingClientRect();
  const left = sidePanel.scrollLeft + targetRect.left - panelRect.left - (sidePanel.clientWidth - targetRect.width) / 2;
  const top = sidePanel.scrollTop + targetRect.top - panelRect.top - (sidePanel.clientHeight - targetRect.height) / 2;
  sidePanel.scrollTo({{ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' }});
}}
function enablePan(side) {{
  const viewport = document.getElementById(side + '-panel'); let dragging = false; let startX = 0; let startY = 0; let scrollLeft = 0; let scrollTop = 0;
  viewport.addEventListener('pointerdown', event => {{ if (event.button !== 0 || event.target.closest('button, .marker, .viewer-toolbar')) return; event.preventDefault(); dragging = true; startX = event.clientX; startY = event.clientY; scrollLeft = viewport.scrollLeft; scrollTop = viewport.scrollTop; viewport.classList.add('dragging'); viewport.setPointerCapture(event.pointerId); }});
  viewport.addEventListener('pointermove', event => {{ if (!dragging) return; event.preventDefault(); viewport.scrollLeft = scrollLeft - (event.clientX - startX) * 1.25; viewport.scrollTop = scrollTop - (event.clientY - startY) * 1.25; }});
  const stop = event => {{ dragging = false; viewport.classList.remove('dragging'); if (event.pointerId !== undefined && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); }};
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('wheel', event => {{ if (!event.ctrlKey) return; event.preventDefault(); if (event.deltaY < 0) zoomIn(side); else zoomOut(side); }}, {{ passive: false }});
}}
function pageFor(pages, number) {{ return pages.find(page => page.page === number) || pages[0]; }}
function transformBox(page, box) {{
  if (!box) return null;
  if (page.bbox_space === 'display') return box;
  const rotation = ((page.display_rotation || 0) % 360 + 360) % 360;
  if (!rotation) return box;
  const sourceWidth = page.source_width || page.width;
  const sourceHeight = page.source_height || page.height;
  const x0 = box[0], y0 = box[1], x1 = box[2], y1 = box[3];
  if (rotation === 90) return [y0, sourceWidth - x1, y1, sourceWidth - x0];
  if (rotation === 270) return [sourceHeight - y1, x0, sourceHeight - y0, x1];
  if (rotation === 180) return [sourceWidth - x1, sourceHeight - y1, sourceWidth - x0, sourceHeight - y0];
  return box;
}}
function addPages(root, pages, old) {{
  pages.forEach(page => {{
    const wrapper = document.createElement('div'); wrapper.className = 'page'; wrapper.id = (old ? 'old-' : 'new-') + page.page;
    const image = document.createElement('img'); image.src = page.image; image.alt = (old ? '旧图' : '新图') + '第' + page.page + '页'; wrapper.appendChild(image);
    differences.filter(diff => (old ? (diff.old_page || diff.page) : (diff.new_page || diff.page)) === page.page).forEach(diff => {{
      const sourceBox = old ? diff.old_bbox : diff.new_bbox; if (!sourceBox) return;
      const box = transformBox(page, sourceBox); if (!box) return;
      const highlight = document.createElement('div'); highlight.className = 'highlight ' + (old ? 'old-highlight' : 'new-highlight'); highlight.dataset.number = diff.number;
      highlight.style.left = ((Math.max(0, box[0] - 2) / page.width) * 100) + '%'; highlight.style.top = ((Math.max(0, box[1] - 2) / page.height) * 100) + '%'; highlight.style.width = (Math.max(8, box[2] - box[0] + 4) / page.width * 100) + '%'; highlight.style.height = (Math.max(8, box[3] - box[1] + 4) / page.height * 100) + '%'; wrapper.appendChild(highlight);
      const marker = document.createElement('button'); marker.className = 'marker ' + (old ? 'old-marker' : 'new-marker'); marker.dataset.number = diff.number; marker.textContent = diff.number;
      marker.style.left = ((Math.max(0, box[0] - 14) / page.width) * 100) + '%'; marker.style.top = ((Math.max(0, box[1] - 14) / page.height) * 100) + '%'; marker.onclick = () => selectDifference(diff.number); wrapper.appendChild(marker);
    }}); root.appendChild(wrapper);
  }});
}}
function selectDifference(number) {{
  const diff = differences.find(item => item.number === number); if (!diff) return;
  document.querySelectorAll('.active').forEach(node => node.classList.remove('active'));
  document.querySelectorAll('.marker.visible').forEach(node => node.classList.remove('visible'));
  document.querySelectorAll('.highlight.visible').forEach(node => node.classList.remove('visible'));
  ['old', 'new'].forEach(side => {{
    const sideRoot = document.getElementById(side + '-pages');
    if (!sideRoot) return;
    sideRoot.querySelectorAll('[data-number="' + number + '"]').forEach(node => {{
      node.classList.add('active');
      if (node.classList.contains('marker') || node.classList.contains('highlight')) node.classList.add('visible');
    }});
    scrollDifferenceIntoView(side, diff);
  }});
  detailRoot.innerHTML = '<p><b>差异 ' + diff.number + '</b> · ' + diff.kind + '</p><p class="value-old">旧图：' + (diff.old_text || '无') + '</p><p class="value-new">新图：' + (diff.new_text || '无') + '</p><p>置信度：' + Math.round(diff.confidence * 100) + '% ' + (diff.needs_review ? '· 需人工确认' : '') + '</p>';
  document.querySelectorAll('.diff').forEach(node => node.classList.toggle('active', node.dataset.number === String(number)));
}}
function renderList() {{ differences.forEach(diff => {{ const button = document.createElement('button'); button.className = 'diff'; button.dataset.number = diff.number; button.innerHTML = '<strong>' + diff.number + ' · ' + diff.kind + '</strong><small>' + (diff.old_text || '无') + ' → ' + (diff.new_text || '无') + '</small>'; button.onclick = () => selectDifference(diff.number); listRoot.appendChild(button); }}); }}
const reviewLabel = '\u5f85\u786e\u8ba4';
renderList = function() {{ differences.forEach(diff => {{ const button = document.createElement('button'); button.className = 'diff' + (diff.needs_review ? ' needs-review' : ''); button.dataset.number = diff.number; button.dataset.review = String(Boolean(diff.needs_review)); button.innerHTML = '<strong>' + diff.number + ' \u00b7 ' + diff.kind + (diff.needs_review ? '<span class="review-badge">' + reviewLabel + '</span>' : '') + '</strong><small>' + (diff.old_text || '\u65e0') + ' \u2192 ' + (diff.new_text || '\u65e0') + '</small>'; button.onclick = () => selectDifference(diff.number); listRoot.appendChild(button); }}); }};
addPages(oldRoot, oldPages, true); addPages(newRoot, newPages, false); renderList(); enablePan('old'); enablePan('new');
</script></body></html>""",
        encoding="utf-8",
    )
    return output_path


def _page_data_from_pdf(pdf_path: Path, output_dir: Path, prefix: str, extra_rotations: dict[int, int] | None = None) -> list[dict[str, Any]]:
    document = pymupdf.open(pdf_path)
    pages: list[dict[str, Any]] = []
    try:
        for page_index, page in enumerate(document, start=1):
            image_name = f"交互_{prefix}_第{page_index}页.png"
            image_path = output_dir / image_name
            pixmap = page.get_pixmap(dpi=160, alpha=False)
            extra_rotation = (extra_rotations or {}).get(page_index, 0)
            _save_rotated_pixmap(pixmap, image_path, extra_rotation)
            source_width = page.rect.width
            source_height = page.rect.height
            width = source_height if extra_rotation % 180 else source_width
            height = source_width if extra_rotation % 180 else source_height
            pages.append({
                "page": page_index,
                "image": image_name,
                "width": width,
                "height": height,
                "source_width": source_width,
                "source_height": source_height,
                "display_rotation": extra_rotation,
                "bbox_space": "display",
            })
    finally:
        document.close()
    return pages


def refresh_legacy_interactive_report(report_path: Path) -> Path:
    """Regenerate old reports so historical tasks use click-to-show markers too."""
    output_dir = report_path.parent
    old_pdf = output_dir / "原始旧图纸.pdf"
    new_pdf = output_dir / "原始新图纸.pdf"
    data_path = output_dir / "差异数据.json"
    if not old_pdf.is_file() or not new_pdf.is_file() or not data_path.is_file():
        return report_path
    raw_records = json.loads(data_path.read_text(encoding="utf-8"))
    differences = [
        DifferenceRecord(
            number=int(item["number"]),
            kind=str(item["kind"]),
            page=int(item["page"]),
            old_text=item.get("old_text"),
            new_text=item.get("new_text"),
            old_bbox=tuple(item["old_bbox"]) if item.get("old_bbox") else None,
            new_bbox=tuple(item["new_bbox"]) if item.get("new_bbox") else None,
            confidence=float(item.get("confidence", 1.0)),
            needs_review=bool(item.get("needs_review", False)),
            reason=str(item.get("reason", "文本或数值内容发生变化")),
            old_page=int(item["old_page"]) if item.get("old_page") else None,
            new_page=int(item["new_page"]) if item.get("new_page") else None,
        )
        for item in raw_records
    ]
    from app.services.wire_harness_semantic_compare import default_ocr_adapter

    ocr = default_ocr_adapter()
    old_rotations, new_rotations = _paired_extra_rotations(old_pdf, new_pdf)
    old_pages = _page_data_from_pdf(old_pdf, output_dir, "旧图", old_rotations)
    new_pages = _page_data_from_pdf(new_pdf, output_dir, "新图", new_rotations)

    differences = relocate_difference_locations_on_rendered_pages(old_pages, new_pages, output_dir, differences, ocr)
    data_path.write_text(
        json.dumps([_difference_json(difference) for difference in differences], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return build_interactive_report(report_path, output_dir.name, old_pages, new_pages, differences)
