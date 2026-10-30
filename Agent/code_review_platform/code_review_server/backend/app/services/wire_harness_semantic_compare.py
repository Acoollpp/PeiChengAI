from __future__ import annotations

import math
import os
import re
import shutil
import unicodedata
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from pathlib import Path
from typing import Protocol

import pymupdf

from app.core.config import settings

BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class TextBlock:
    text: str
    page: int
    bbox: BBox
    source: str
    confidence: float
    needs_review: bool = False
    original_page: int | None = None


@dataclass(frozen=True)
class DifferenceRecord:
    number: int
    kind: str
    page: int
    old_text: str | None
    new_text: str | None
    old_bbox: BBox | None
    new_bbox: BBox | None
    confidence: float
    needs_review: bool
    reason: str
    old_page: int | None = None
    new_page: int | None = None


class OcrAdapter(Protocol):
    def recognize(self, image: object) -> list[tuple[str, BBox, float]]: ...


def _ocr_image_parts(image: object) -> tuple[int, int, bytes, int]:
    parts = image  # type: ignore[assignment]
    if not isinstance(parts, tuple) or len(parts) not in (3, 4):
        raise ValueError("OCR 图像数据格式无效")
    width, height, samples = parts[:3]
    dpi = int(parts[3]) if len(parts) == 4 else 160
    return int(width), int(height), samples, dpi  # type: ignore[return-value]


class PytesseractOcrAdapter:
    def recognize(self, image: object) -> list[tuple[str, BBox, float]]:
        import pytesseract
        from PIL import Image

        configured = settings.WIRE_HARNESS_COMPARE_TESSERACT_COMMAND.strip()
        if configured and Path(configured).is_file():
            pytesseract.pytesseract.tesseract_cmd = configured
        elif shutil.which("tesseract") is None:
            raise RuntimeError("未找到 Tesseract OCR 程序")
        width, height, samples, dpi = _ocr_image_parts(image)
        rendered = Image.frombytes("RGB", (width, height), samples)
        data = pytesseract.image_to_data(rendered, output_type=pytesseract.Output.DICT, lang="chi_sim+eng")
        scale_x = 72 / dpi
        scale_y = 72 / dpi
        grouped: dict[tuple[int, int, int], dict[str, object]] = {}
        for index, raw_text in enumerate(data.get("text", [])):
            text = normalize_text(raw_text)
            if not text:
                continue
            confidence = float(data["conf"][index]) / 100
            left = float(data["left"][index]) * scale_x
            top = float(data["top"][index]) * scale_y
            right = left + float(data["width"][index]) * scale_x
            bottom = top + float(data["height"][index]) * scale_y
            key = (
                int(data["block_num"][index]),
                int(data["par_num"][index]),
                int(data["line_num"][index]),
            )
            line = grouped.setdefault(key, {"words": [], "bbox": [left, top, right, bottom], "confidence": []})
            words = line["words"]
            confidences = line["confidence"]
            assert isinstance(words, list) and isinstance(confidences, list)
            words.append((float(data["left"][index]), text))
            confidences.append(max(0.0, confidence))
            box = line["bbox"]
            assert isinstance(box, list)
            box[0] = min(box[0], left)
            box[1] = min(box[1], top)
            box[2] = max(box[2], right)
            box[3] = max(box[3], bottom)
        results: list[tuple[str, BBox, float]] = []
        for line in grouped.values():
            words = sorted(line["words"], key=lambda item: item[0])
            text = normalize_text(" ".join(item[1] for item in words))
            box = line["bbox"]
            confidences = line["confidence"]
            if text and isinstance(box, list) and isinstance(confidences, list):
                results.append((text, _bbox(box), sum(confidences) / len(confidences)))
        return results


class PaddleOcrAdapter:
    """Optional high-resolution OCR backend for scanned engineering drawings."""

    def __init__(self) -> None:
        from paddleocr import PaddleOCR

        self._ocr = PaddleOCR(
            lang="ch",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )

    def recognize(self, image: object) -> list[tuple[str, BBox, float]]:
        from PIL import Image

        width, height, samples, _dpi = _ocr_image_parts(image)
        rendered = Image.frombytes("RGB", (width, height), samples)
        result = self._ocr.predict(rendered)
        output: list[tuple[str, BBox, float]] = []
        for page in result:
            texts = page.get("rec_texts", [])
            scores = page.get("rec_scores", [])
            boxes = page.get("rec_boxes", [])
            for text, score, box in zip(texts, scores, boxes, strict=False):
                values = [float(value) for value in box]
                if len(values) >= 4:
                    output.append((normalize_text(str(text)), _bbox((values[0], values[1], values[2], values[3])), float(score)))
        return output


def default_ocr_adapter() -> OcrAdapter | None:
    engine = getattr(settings, "WIRE_HARNESS_COMPARE_OCR_ENGINE", "auto").strip().lower()
    if engine in {"auto", "paddle", "paddleocr"}:
        try:
            import paddleocr  # noqa: F401

            return PaddleOcrAdapter()
        except (ImportError, OSError, RuntimeError, TypeError, ValueError):
            if engine in {"paddle", "paddleocr"}:
                raise RuntimeError("已指定 PaddleOCR，但服务器未正确安装 PaddleOCR 及其运行环境")
    try:
        import pytesseract
    except ImportError:
        return None
    configured = os.getenv("TESSERACT_CMD", "").strip()
    candidates = [
        configured,
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            pytesseract.pytesseract.tesseract_cmd = candidate
            break
    return PytesseractOcrAdapter()


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = normalized.replace("\u00a0", " ")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    # In the wire-color table, OCR occasionally drops the first character of
    # "白色" and returns the standalone fragment "颜色".
    return "白色" if normalized == "颜色" else normalized


IGNORED_METADATA_TEXT = re.compile(
    r"(?:"
    r"印章|发行章|工程部|盖章|签章|签字|审核章|批准章|"
    r"Autodesk\s*教育版|"
    r"ROHS"
    r")",
    re.I,
)
TITLE_BLOCK_ANCHOR_TEXT = re.compile(
    r"(?:"
    r"Part\s*No\.?|沛城\s*料号|"
    r"Description|沛城\s*型号|"
    r"Material\s*code|物料\s*编号|"
    r"Drawn(?:\s*BY)?|Checke?d(?:\s*BY)?|Checke\b|Approved(?:\s*BY)?|"
    r"Supplier\s*Acknowledgement|Customer\s*acknowledges|"
    r"Sheet|Ver\.?|Unit"
    r")",
    re.I,
)
TITLE_BLOCK_STRONG_ANCHOR_TEXT = re.compile(
    r"(?:"
    r"Part\s*No\.?|沛城\s*料号|"
    r"Description|沛城\s*型号|"
    r"Material\s*code|物料\s*编号|"
    r"Supplier\s*Acknowledgement|Customer\s*acknowledges|"
    r"Sheet|Ver\.?|Unit"
    r")",
    re.I,
)
PROCESS_STEP_TEXT = re.compile(r"(?:第\s*[一二三四五六七八九\d]+\s*步|^[\s\d]*[一二三四五六七八九][、.])")
REQUIRED_PART_TEXT = re.compile(r"(?:沛城\s*料号|沛城\s*型号|Part\s*No\.?|Description)", re.I)
DATE_ONLY = re.compile(r"^\d{4}[./-]\d{1,2}[./-]\d{1,2}$")
DATE_ANY = re.compile(r"\d{4}[./-]\d{1,2}[./-]\d{1,2}")
SINGLE_MARKER = re.compile(r"^[A-Za-z0-9]$")
SINGLE_COLOR_FRAGMENT = re.compile(r"^[色白黄蓝紫红黑绿橙灰棕粉]$")
COLOR_FRAGMENT_WITH_PUNCTUATION = re.compile(r"^[.．、,，]?[色白黄蓝紫红黑绿橙灰棕粉]$")
GRAPHICAL_COLOR_LABEL = re.compile(r"^\d+\.?\s*(?:黄色|白色|蓝色|紫色|红色|黑色|绿色|橙色|灰色|棕色|粉色)[A-Z]\d+$")
STANDALONE_TITLE_LABEL = re.compile(
    r"^(?:Drawn(?:BY)?|Checke?d(?:BY)?|Checke|Approved(?:BY)?|CheckBy|"
    r"SupplierAcknowledgement|Customeracknowledges|Sheet|Ver\.?|Unit)$",
    re.I,
)
STAMP_SIGNATURE_TEXT = re.compile(r"^[\u4e00-\u9fff]{2,6}\s+\d{4}[./-]\d{1,2}[./-]\d{1,2}$")
# Title blocks may contain the model without the literal "沛城型号" label.
REQUIRED_PART_VALUE_TEXT = re.compile(
    r"(?:HHX[-_]?PC\d+[-_][A-Z0-9-]+|BMU[-_][A-Z0-9_.\-\u4e00-\u9fff]+|P\d+[A-Z]\d+[A-Z0-9-]+|^\d+P[-_][A-Z0-9_.+-]+|NI[-_]PC[-_][A-Z0-9-]+|YKS[-_][A-Z0-9-]+|\b1\.19\.\d{2}\.\d{6}\b)",
    re.I,
)
FILENAME_MATERIAL_TEXT = re.compile(r"\b1\.19\.\d{2}\.\d{6}\b", re.I)


def _is_ignored_text(text: str, include_fragments: bool = True) -> bool:
    compact = re.sub(r"\s+", "", text)
    return bool(
        IGNORED_METADATA_TEXT.search(compact)
        or GRAPHICAL_COLOR_LABEL.fullmatch(compact)
        or (include_fragments and STANDALONE_TITLE_LABEL.fullmatch(compact))
        or (include_fragments and SINGLE_MARKER.fullmatch(compact))
        or (include_fragments and SINGLE_COLOR_FRAGMENT.fullmatch(compact))
        or (include_fragments and COLOR_FRAGMENT_WITH_PUNCTUATION.fullmatch(compact))
        or (include_fragments and compact and not re.search(r"[A-Za-z0-9\u4e00-\u9fff]", compact))
    )


def _process_step_key(text: str) -> str | None:
    match = re.search(r"第\s*([一二三四五六七八九\d]+)\s*步", text)
    if match:
        return match.group(1)
    # Wire-color tables also start with "1." / "2.". Only treat a numbered
    # block as a process step when it contains an explicit process term.
    if not re.search(r"(?:步骤|工序|裁线|打端子|热缩|穿孔|测试|贴标签|全检|包装)", text):
        return None
    match = re.match(r"\s*([一二三四五六七八九\d]+)[、.]", text)
    return match.group(1) if match else None


def _filter_title_block_regions(blocks: list[TextBlock]) -> list[TextBlock]:
    """Ignore the drawing title block as a whole, while keeping revision tables."""
    by_page: dict[int, list[TextBlock]] = {}
    for block in blocks:
        by_page.setdefault(block.page, []).append(block)
    result: list[TextBlock] = []
    for page_blocks in by_page.values():
        anchors = [block for block in page_blocks if TITLE_BLOCK_ANCHOR_TEXT.search(block.text)]
        has_strong_anchor = any(TITLE_BLOCK_STRONG_ANCHOR_TEXT.search(block.text) for block in anchors)
        if not anchors or not has_strong_anchor:
            result.extend(page_blocks)
            continue
        regions = [_title_anchor_region(anchor) for anchor in anchors]
        for block in page_blocks:
            center_x = (block.bbox[0] + block.bbox[2]) / 2
            center_y = (block.bbox[1] + block.bbox[3]) / 2
            if not any(left <= center_x <= right and top <= center_y <= bottom for left, top, right, bottom in regions):
                result.append(block)
    return sorted(result, key=lambda block: (block.page, block.bbox[1], block.bbox[0]))


def _title_anchor_region(anchor: TextBlock) -> BBox:
    left, top, right, bottom = anchor.bbox
    width = max(1.0, right - left)
    height = max(1.0, bottom - top)
    if height > width * 2:
        horizontal_extension = 260.0 if re.search(r"Part\s*No|Description|Material|沛城|物料", anchor.text, re.I) else 96.0
        return (max(0.0, left - 24.0), max(0.0, top - 24.0), right + horizontal_extension, bottom + 120.0)
    return (max(0.0, left - 24.0), max(0.0, top - 18.0), right + 260.0, bottom + 42.0)


def _merge_required_part_fields(blocks: list[TextBlock]) -> list[TextBlock]:
    """Keep Peicheng model/material fields together when PDF text is split into label/value blocks."""
    replacements: dict[int, TextBlock] = {}
    consumed: set[int] = set()
    for index, label in enumerate(blocks):
        compact = re.sub(r"\s+", "", label.text)
        if not re.search(r"(?:沛城(?:型号|料号)|PartNo\.?|Description)", compact, re.I):
            continue
        if re.search(r"(?:沛城(?:型号|料号)|PartNo\.?|Description)[^:：]*[:：]\s*\S+", label.text, re.I):
            continue
        candidates = []
        lx = (label.bbox[0] + label.bbox[2]) / 2
        for value_index, value in enumerate(blocks):
            if value_index == index or value_index in consumed or value.page != label.page:
                continue
            vx = (value.bbox[0] + value.bbox[2]) / 2
            vertical_gap = value.bbox[1] - label.bbox[3]
            same_line = abs((value.bbox[1] + value.bbox[3]) / 2 - (label.bbox[1] + label.bbox[3]) / 2) <= max(label.bbox[3] - label.bbox[1], 12)
            if same_line and value.bbox[0] >= label.bbox[2] - 4:
                candidates.append((0, abs(vx - lx), value_index, value))
            elif 0 <= vertical_gap <= 42 and abs(vx - lx) <= 180:
                candidates.append((1, vertical_gap, value_index, value))
        if not candidates:
            continue
        _priority, _distance, value_index, value = min(candidates)
        merged_box = (
            min(label.bbox[0], value.bbox[0]),
            min(label.bbox[1], value.bbox[1]),
            max(label.bbox[2], value.bbox[2]),
            max(label.bbox[3], value.bbox[3]),
        )
        merged = TextBlock(
            normalize_text(f"{label.text} {value.text}"),
            label.page,
            merged_box,
            label.source if label.source == value.source else "pdf_text",
            min(label.confidence, value.confidence),
            label.needs_review or value.needs_review,
        )
        replacements[index] = merged
        consumed.add(value_index)
    return [replacements.get(index, block) for index, block in enumerate(blocks) if index not in consumed]


def _compact_text(text: str) -> str:
    semantic = normalize_text(text).lower()
    # A nearby numbered annotation can be concatenated to this process label
    # by the PDF text layer; it is not part of the process description.
    semantic = re.sub(r"打透明uv胶[1-9]$", "打透明uv胶", semantic, flags=re.I)
    # Common drawing wording for the same wire operation.
    semantic = re.sub(r"(扭锡|绞锡)\s*(\d+(?:\.\d+)?)\s*mm", r"\2mm上锡", semantic)
    semantic = re.sub(r"(\d+(?:\.\d+)?)\s*mm\s*(扭锡|绞锡)", r"\1mm上锡", semantic)
    return re.sub(r"[\s\W_]+", "", semantic, flags=re.UNICODE)


def _needs_ocr(page: pymupdf.Page, blocks: list[TextBlock]) -> bool:
    if len(blocks) < 8:
        return True
    return _text_coverage(page, blocks) < 0.001


def _bbox(value: tuple[float, float, float, float] | list[float]) -> BBox:
    return tuple(float(item) for item in value)  # type: ignore[return-value]


def _text_coverage(page: pymupdf.Page, blocks: list[TextBlock]) -> float:
    page_area = max(1.0, page.rect.width * page.rect.height)
    total = sum(max(0.0, (right - left) * (bottom - top)) for left, top, right, bottom in (block.bbox for block in blocks))
    return min(1.0, total / page_area)


def _extract_pdf_text(document: pymupdf.Document) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    for page_index, page in enumerate(document, start=1):
        payload = page.get_text("dict")
        for block in payload.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                text = normalize_text("".join(span.get("text", "") for span in line.get("spans", [])))
                if text:
                    blocks.append(TextBlock(text, page_index, _bbox(line["bbox"]), "pdf_text", 1.0))
    return blocks


def _filename_part_blocks(path: Path, document: pymupdf.Document, blocks: list[TextBlock]) -> list[TextBlock]:
    """Use the PDF filename as a fallback for title-block part fields."""
    stem = normalize_text(path.stem)
    material_match = FILENAME_MATERIAL_TEXT.search(stem)
    if material_match is None:
        return []
    existing_compact = {_compact_text(block.text) for block in blocks}
    page = document[0]
    rect = page.mediabox if page.rotation else page.rect
    left = max(0.0, rect.width - 190.0)
    top = max(0.0, rect.height - 120.0)
    material = material_match.group(0)
    fallback_blocks: list[TextBlock] = []
    if _compact_text(material) not in existing_compact:
        fallback_blocks.append(TextBlock(material, 1, (left, top, left + 115.0, top + 16.0), "filename", 1.0))
    description = normalize_text(stem[material_match.end():].strip(" -_"))
    description = re.sub(r"(?:[-_\s]*(?:原档|改版|新版|旧版|新图|旧图|改))+$", "", description, flags=re.I)
    if description and _compact_text(description) not in existing_compact:
        fallback_blocks.append(TextBlock(description, 1, (left, top + 18.0, left + 170.0, top + 34.0), "filename", 1.0))
    return fallback_blocks


def extract_text_blocks(path: Path, ocr: OcrAdapter | None = None) -> list[TextBlock]:
    try:
        document = pymupdf.open(path)
    except Exception as exc:
        raise RuntimeError(f"无法读取 PDF: {path.name}") from exc
    try:
        blocks = _extract_pdf_text(document)
        if ocr is None:
            filtered = _filter_title_block_regions(_merge_required_part_fields(blocks))
            return [block for block in filtered if not _is_ignored_text(block.text)]
        page_blocks: dict[int, list[TextBlock]] = {}
        for block in blocks:
            page_blocks.setdefault(block.page, []).append(block)
        merged: list[TextBlock] = []
        for page_index, page in enumerate(document, start=1):
            current = page_blocks.get(page_index, [])
            if current and not _needs_ocr(page, current):
                merged.extend(current)
                continue
            dpi = max(180, int(getattr(settings, "WIRE_HARNESS_COMPARE_OCR_DPI", 300)))
            pixmap = page.get_pixmap(dpi=dpi, alpha=False)
            image = (pixmap.width, pixmap.height, pixmap.samples, dpi)
            try:
                recognized = ocr.recognize(image)
            except Exception as exc:
                raise RuntimeError(f"第 {page_index} 页 OCR 失败: {path.name}") from exc
            for text, box, confidence in recognized:
                cleaned = normalize_text(text)
                if cleaned and confidence >= 0.55:
                    merged.append(TextBlock(cleaned, page_index, _bbox(box), "ocr", float(confidence), float(confidence) < 0.75))
        filtered = _filter_title_block_regions(_merge_required_part_fields(_deduplicate_blocks(merged)))
        return [block for block in filtered if not _is_ignored_text(block.text)]
    finally:
        document.close()


def _deduplicate_blocks(blocks: list[TextBlock]) -> list[TextBlock]:
    result: list[TextBlock] = []
    for block in blocks:
        duplicate = next(
            (
                existing
                for existing in result
                if existing.page == block.page
                and _bbox_iou(existing.bbox, block.bbox) >= 0.25
                and (
                    normalize_text(existing.text) == normalize_text(block.text)
                    or (
                        len(_compact_text(existing.text)) <= 2
                        and len(_compact_text(block.text)) <= 2
                        and _bbox_iou(existing.bbox, block.bbox) >= 0.8
                    )
                )
            ),
            None,
        )
        if duplicate is None:
            result.append(block)
        elif block.confidence > duplicate.confidence:
            result[result.index(duplicate)] = block
    return result


def _fragment_match(left: str, right: str) -> bool:
    left_compact = _compact_text(left)
    right_compact = _compact_text(right)
    if not left_compact or not right_compact or left_compact == right_compact:
        return False
    short, long = sorted((left_compact, right_compact), key=len)
    # PDF text layers often split labels such as "T2 3" or "白色B5" into fragments.
    return len(short) <= 5 and short in long


def _bbox_iou(left: BBox, right: BBox) -> float:
    x1 = max(left[0], right[0])
    y1 = max(left[1], right[1])
    x2 = min(left[2], right[2])
    y2 = min(left[3], right[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    left_area = max(0.0, left[2] - left[0]) * max(0.0, left[3] - left[1])
    right_area = max(0.0, right[2] - right[0]) * max(0.0, right[3] - right[1])
    union = left_area + right_area - intersection
    return intersection / union if union else 0.0


def _center_distance(left: BBox, right: BBox) -> float:
    left_center = ((left[0] + left[2]) / 2, (left[1] + left[3]) / 2)
    right_center = ((right[0] + right[2]) / 2, (right[1] + right[3]) / 2)
    return math.dist(left_center, right_center)


def _is_measurement_text(text: str) -> bool:
    return bool(
        re.search(r"\d+(?:\.\d+)?\s*(?:mm|cm|m|毫米|厘米)", text, re.I)
        or re.search(r"\d+(?:\.\d+)?\s*[±+/-]\s*\d+(?:\.\d+)?", text)
    )


def _is_standalone_measurement(text: str) -> bool:
    return bool(re.fullmatch(r"\s*\d+(?:\.\d+)?\s*[±+/-]\s*\d+(?:\.\d+)?\s*(?:mm|毫米|cm|厘米)?\s*", text, re.I))


def _required_part_key(text: str) -> str | None:
    if re.search(r"HHX[-_]?PC\d+[-_][A-Z0-9-]+|BMU[-_][A-Z0-9_.\-\u4e00-\u9fff]+|沛城\s*型号|^\d+P[-_]", text, re.I):
        return "model"
    if re.search(r"NI[-_]PC[-_][A-Z0-9-]+|YKS[-_][A-Z0-9-]+|物料\s*编号|Material\s*code", text, re.I):
        return "material_code"
    if re.search(r"1\.19\.\d{2}\.\d{6}|沛城\s*料号|Description", text, re.I):
        return "material"
    return None


def _deduplicate_required_records(records: list[DifferenceRecord]) -> list[DifferenceRecord]:
    result: list[DifferenceRecord] = []
    seen: set[tuple[str, str, str]] = set()
    for record in records:
        key_name = _required_part_key(record.old_text or "") or _required_part_key(record.new_text or "")
        if key_name is None:
            result.append(record)
            continue
        key = (key_name, _compact_text(record.old_text or ""), _compact_text(record.new_text or ""))
        if key in seen:
            continue
        seen.add(key)
        result.append(record)
    return result


def _candidate_distance(old: TextBlock, new: TextBlock) -> float:
    if _is_measurement_text(old.text) and _is_measurement_text(new.text):
        old_center_x = (old.bbox[0] + old.bbox[2]) / 2
        new_center_x = (new.bbox[0] + new.bbox[2]) / 2
        if abs(old_center_x - new_center_x) <= 24:
            return 90
    return 36


def _kind(old_text: str | None, new_text: str | None) -> str:
    if old_text is None:
        return "added"
    if new_text is None:
        return "removed"
    combined = f"{old_text} {new_text}"
    if re.search(r"(?:长度|宽度|高度|直径|半径|间距|尺寸)|\b\d+(?:\.\d+)?\s*(?:mm|cm|m|毫米|厘米)", combined, re.I):
        return "dimension_changed"
    if re.search(r"(?:料号|物料|端子|型号|连接器|J[-_]?\d+|[A-Z]{1,4}[-_]\d+)", combined, re.I):
        return "part_number_changed"
    if re.search(r"(?:版本|版次|修订|REV|日期|标题栏)", combined, re.I):
        return "revision_changed"
    return "modified"


def _is_stamp_signature_record(record: DifferenceRecord) -> bool:
    text = record.old_text or record.new_text or ""
    box = record.old_bbox or record.new_bbox
    if record.old_text is not None and record.new_text is not None:
        return False
    if box is None or not STAMP_SIGNATURE_TEXT.fullmatch(normalize_text(text)):
        return False
    width = max(1.0, box[2] - box[0])
    height = max(1.0, box[3] - box[1])
    return height >= width * 3


def _make_record(number: int, old: TextBlock | None, new: TextBlock | None, kind: str | None = None) -> DifferenceRecord:
    confidence = min(old.confidence if old else 1.0, new.confidence if new else 1.0)
    needs_review = bool(old and old.needs_review) or bool(new and new.needs_review)
    return DifferenceRecord(
        number=number,
        kind=kind or _kind(old.text if old else None, new.text if new else None),
        page=(old.page if old else new.page),
        old_text=old.text if old else None,
        new_text=new.text if new else None,
        old_bbox=old.bbox if old else None,
        new_bbox=new.bbox if new else None,
        confidence=confidence,
        needs_review=needs_review,
        reason="文本或数值内容发生变化",
        old_page=old.original_page if old and old.original_page is not None else (old.page if old else None),
        new_page=new.original_page if new and new.original_page is not None else (new.page if new else None),
    )


def _page_similarity(old: list[TextBlock], new: list[TextBlock]) -> float:
    old_tokens = {_compact_text(block.text) for block in old if len(_compact_text(block.text)) > 1}
    new_tokens = {_compact_text(block.text) for block in new if len(_compact_text(block.text)) > 1}
    if not old_tokens or not new_tokens:
        return 0.0
    overlap = len(old_tokens & new_tokens) / max(1, len(old_tokens | new_tokens))
    sequence = SequenceMatcher(None, " ".join(sorted(old_tokens)), " ".join(sorted(new_tokens))).ratio()
    return max(overlap, sequence)


def _align_page_numbers(old: list[TextBlock], new: list[TextBlock]) -> list[TextBlock]:
    """Map new PDF pages to the old page numbers using page text, not physical indexes."""
    old_by_page: dict[int, list[TextBlock]] = {}
    new_by_page: dict[int, list[TextBlock]] = {}
    for block in old:
        old_by_page.setdefault(block.page, []).append(block)
    for block in new:
        new_by_page.setdefault(block.page, []).append(block)
    unused_old = set(old_by_page)
    mapping: dict[int, int] = {}
    ranked: list[tuple[float, int, int]] = []
    for new_page, new_blocks in new_by_page.items():
        for old_page, old_blocks in old_by_page.items():
            ranked.append((_page_similarity(old_blocks, new_blocks), new_page, old_page))
    for score, new_page, old_page in sorted(ranked, reverse=True):
        if new_page in mapping or old_page not in unused_old:
            continue
        if score < 0.08:
            continue
        mapping[new_page] = old_page
        unused_old.remove(old_page)
    for new_page in new_by_page:
        if new_page in mapping:
            continue
        if new_page in old_by_page and new_page in unused_old:
            mapping[new_page] = new_page
            unused_old.remove(new_page)
        else:
            mapping[new_page] = new_page
    return [replace(block, page=mapping[block.page], original_page=block.page) for block in new]


def compare_text_blocks(old: list[TextBlock], new: list[TextBlock]) -> list[DifferenceRecord]:
    old = [block for block in _filter_title_block_regions(_merge_required_part_fields(old)) if not _is_ignored_text(block.text, include_fragments=False)]
    new = [block for block in _filter_title_block_regions(_merge_required_part_fields(new)) if not _is_ignored_text(block.text, include_fragments=False)]
    new = _align_page_numbers(old, new)
    old = _deduplicate_blocks(old)
    new = _deduplicate_blocks(new)
    required_records: list[DifferenceRecord] = []
    consumed_old: set[int] = set()
    consumed_new: set[int] = set()
    # Match tolerance-bearing dimensions before generic text matching. Drawing
    # tables commonly repeat values such as 695±3 and 700±5; text similarity
    # alone can otherwise consume the wrong occurrence or hide the change.
    measurement_records: list[DifferenceRecord] = []
    measurement_old = [index for index, block in enumerate(old) if _is_standalone_measurement(block.text)]
    measurement_new = [index for index, block in enumerate(new) if _is_standalone_measurement(block.text)]
    for old_index in sorted(measurement_old, key=lambda index: (old[index].page, old[index].bbox[0], old[index].bbox[1])):
        candidates = [
            index for index in measurement_new
            if index not in consumed_new
            and new[index].page == old[old_index].page
            and _center_distance(old[old_index].bbox, new[index].bbox) <= 28
        ]
        if not candidates:
            continue
        new_index = min(candidates, key=lambda index: _center_distance(old[old_index].bbox, new[index].bbox))
        consumed_old.add(old_index)
        consumed_new.add(new_index)
        if _compact_text(old[old_index].text) != _compact_text(new[new_index].text):
            measurement_records.append(_make_record(0, old[old_index], new[new_index]))
    for required_key in ("model", "material", "material_code"):
        old_indices = [index for index, block in enumerate(old) if _required_part_key(block.text) == required_key and REQUIRED_PART_VALUE_TEXT.search(block.text)]
        new_indices = [index for index, block in enumerate(new) if _required_part_key(block.text) == required_key and REQUIRED_PART_VALUE_TEXT.search(block.text)]
        for old_index in old_indices:
            candidates = [index for index in new_indices if index not in consumed_new]
            if not candidates:
                continue
            new_index = min(candidates, key=lambda index: _center_distance(old[old_index].bbox, new[index].bbox))
            consumed_old.add(old_index)
            consumed_new.add(new_index)
            if _compact_text(old[old_index].text) != _compact_text(new[new_index].text):
                required_records.append(_make_record(0, old[old_index], new[new_index]))
    old = [block for index, block in enumerate(old) if index not in consumed_old]
    new = [block for index, block in enumerate(new) if index not in consumed_new]
    has_ocr = any(block.source == "ocr" for block in old + new)
    unused_new = set(range(len(new)))
    records: list[DifferenceRecord] = required_records
    number = 1
    for old_block in sorted(old, key=lambda block: (block.page, block.bbox[1], block.bbox[0])):
        process_key = _process_step_key(old_block.text)
        process_candidates = [
            index for index in unused_new
            if new[index].page == old_block.page and process_key and _process_step_key(new[index].text) == process_key
        ]
        if process_candidates:
            new_index = min(process_candidates, key=lambda index: _center_distance(old_block.bbox, new[index].bbox))
            unused_new.remove(new_index)
            if _compact_text(old_block.text) != _compact_text(new[new_index].text):
                records.append(_make_record(number, old_block, new[new_index]))
            number += 1
            continue
        exact = next(
            (
                index
                for index in unused_new
                if new[index].page == old_block.page
                and _compact_text(new[index].text) == _compact_text(old_block.text)
            ),
            None,
        )
        if exact is not None:
            unused_new.remove(exact)
            continue
        fragment_candidates = [
            index for index in unused_new
            if new[index].page == old_block.page
            and _fragment_match(old_block.text, new[index].text)
            and not any(
                other is not old_block
                and other.page == old_block.page
                and len(_compact_text(other.text)) > len(_compact_text(old_block.text))
                and _center_distance(other.bbox, new[index].bbox) <= 36
                and not (
                    len(_compact_text(old_block.text)) == 1
                    and len(_compact_text(other.text)) > 1
                )
                for other in old
            )
        ]
        if fragment_candidates:
            nearest_fragment = min(
                fragment_candidates,
                key=lambda index: (
                    _center_distance(old_block.bbox, new[index].bbox),
                    -len(_compact_text(new[index].text)),
                ),
            )
            unused_new.remove(nearest_fragment)
            continue
        if len(_compact_text(old_block.text)) <= 2 and any(
            new[index].page == old_block.page
            and _fragment_match(old_block.text, new[index].text)
            and any(
                other is not old_block
                and other.page == old_block.page
                and len(_compact_text(other.text)) > len(_compact_text(old_block.text))
                for other in old
            )
            for index in unused_new
        ):
            continue
        candidates = [
            index
            for index in unused_new
            if new[index].page == old_block.page
            and _center_distance(old_block.bbox, new[index].bbox) <= _candidate_distance(old_block, new[index])
        ]
        measurement_candidates = [
            index for index in candidates
            if _is_measurement_text(old_block.text) and _is_measurement_text(new[index].text)
        ]
        if measurement_candidates:
            candidates = measurement_candidates
        required_candidates = [
            index for index in candidates
            if _required_part_key(old_block.text) is not None
            and _required_part_key(old_block.text) == _required_part_key(new[index].text)
        ]
        if required_candidates:
            candidates = required_candidates
        if _required_part_key(old_block.text) is not None:
            required_key = _required_part_key(old_block.text)
            required_global_candidates = [
                index for index in unused_new
                if _required_part_key(new[index].text) == required_key
            ]
            if required_global_candidates:
                candidates = required_global_candidates
        nearest = min(
            candidates,
            key=lambda index: (
                _center_distance(old_block.bbox, new[index].bbox),
                -SequenceMatcher(None, _compact_text(old_block.text), _compact_text(new[index].text)).ratio(),
            ),
            default=None,
        )
        similarity = (
            SequenceMatcher(None, _compact_text(old_block.text), _compact_text(new[nearest].text)).ratio()
            if nearest is not None
            else 0.0
        )
        measurement_pair = nearest is not None and _is_measurement_text(old_block.text) and _is_measurement_text(new[nearest].text)
        threshold = 0.20 if measurement_pair else (0.75 if has_ocr else 0.45)
        if nearest is not None and _center_distance(old_block.bbox, new[nearest].bbox) <= 12:
            threshold = 0.0
        if nearest is not None and similarity >= threshold:
            new_block = new[nearest]
            unused_new.remove(nearest)
            strict_pdf_text = old_block.source == "pdf_text" and new_block.source == "pdf_text"
            if (strict_pdf_text and _compact_text(old_block.text) != _compact_text(new_block.text)) or (
                similarity < 0.80 and not (has_ocr and (old_block.needs_review or new_block.needs_review))
            ):
                records.append(_make_record(number, old_block, new_block))
        else:
            if not has_ocr:
                records.append(_make_record(number, old_block, None))
        number += 1
    for index in sorted(unused_new, key=lambda item: (new[item].page, new[item].bbox[1], new[item].bbox[0])):
        if not has_ocr:
            records.append(_make_record(number, None, new[index]))
        number += 1
    records.extend(measurement_records)
    all_blocks = old + new
    records = [
        record for record in records
        if not (
            (record.old_text is None or _is_ignored_text(record.old_text))
            and (record.new_text is None or _is_ignored_text(record.new_text))
        )
        and not _is_stamp_signature_record(record)
        and not any(
            record_text
            and (record.old_text is None or record.new_text is None)
            and _fragment_match(record_text, other.text)
            and len(_compact_text(record_text)) <= 5
            for record_text in (record.old_text, record.new_text)
            for other in all_blocks
            if other.text not in (record.old_text, record.new_text)
        )
    ]
    records = _deduplicate_required_records(records)
    return [with_number(record, index) for index, record in enumerate(records, start=1)]


def with_number(record: DifferenceRecord, number: int) -> DifferenceRecord:
    return replace(record, number=number)
