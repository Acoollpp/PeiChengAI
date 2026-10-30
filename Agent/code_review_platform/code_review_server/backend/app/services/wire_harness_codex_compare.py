from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pymupdf

from app.core.config import settings
from app.services.codex_command import resolve_codex_command as _resolve_configured_codex_command
from app.services.wire_harness_semantic_compare import (
    BBox,
    DifferenceRecord,
    TextBlock,
    _compact_text,
    _filter_title_block_regions,
    _is_ignored_text,
    _is_stamp_signature_record,
    _merge_required_part_fields,
)

CODEX_INPUT_DIR = "codex_input"
CODEX_OUTPUT_NAME = "codex_differences.json"
CODEX_LAST_MESSAGE_NAME = "codex-last-message.txt"
TITLE_REQUIRED_COMPARE_TEXT = re.compile(r"(?:沛城\s*(?:料号|型号)|Part\s*No\.?|Description)", re.I)
TITLE_IGNORED_TEXT = re.compile(
    r"(?:Material\s*code|物料\s*编号|Date|Sheet|Ver\.?|Unit|"
    r"Drawn(?:\s*BY)?|Checke?d(?:\s*BY)?|Approved(?:\s*BY)?|"
    r"Supplier\s*Acknowledgement|Customer\s*acknowledges)",
    re.I,
)
UPPER_RIGHT_LINE_TABLE_TEXT = re.compile(r"(?:P1\s*=|NTC[1-5]\s*:|NT_B-\s*:|\u5c3e\u90e8\u5217)", re.I)


def _codex_home_dir() -> Path:
    configured = settings.CODEX_HOME_DIR.strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".codex"


def compare_drawings_with_codex(
    *,
    task_root: Path,
    old_pdf: Path,
    new_pdf: Path,
    output_folder: Path,
    old_blocks: list[TextBlock],
    new_blocks: list[TextBlock],
    script_differences: list[DifferenceRecord],
) -> list[DifferenceRecord]:
    """Use local Codex as the primary visual judge for drawing differences."""
    codex_dir = output_folder / CODEX_INPUT_DIR
    codex_dir.mkdir(parents=True, exist_ok=True)
    render_pages = _render_pair_pages(old_pdf, new_pdf, codex_dir)
    input_payload = {
        "rules": _business_rules(),
        "pages": render_pages,
        "old_text_blocks": [_text_block_json(block) for block in old_blocks],
        "new_text_blocks": [_text_block_json(block) for block in new_blocks],
        "script_candidate_differences": [_difference_json(record) for record in script_differences],
    }
    (codex_dir / "input_evidence.json").write_text(
        json.dumps(input_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    result_path = codex_dir / CODEX_OUTPUT_NAME
    last_message_path = codex_dir / CODEX_LAST_MESSAGE_NAME
    prompt = _build_codex_prompt(codex_dir=codex_dir, evidence=input_payload)
    command = [
        _resolve_codex_command(settings.WIRE_HARNESS_COMPARE_CODEX_COMMAND),
        "exec",
        "-m",
        settings.WIRE_HARNESS_COMPARE_CODEX_MODEL,
        "--skip-git-repo-check",
        "-C",
        str(task_root),
        "-o",
        str(last_message_path),
    ]
    for page in render_pages:
        command.extend(["-i", str(page["old_image"])])
        command.extend(["-i", str(page["new_image"])])
    command.append("-")
    _write_invocation_log(codex_dir, command=command, result_path=result_path)
    completed: subprocess.CompletedProcess[str] | None = None
    retry_count = max(1, int(settings.WIRE_HARNESS_COMPARE_CODEX_TRANSIENT_RETRIES))
    try:
        for attempt in range(retry_count):
            try:
                completed = _run_codex_process(
                    command,
                    prompt=prompt,
                    cwd=task_root,
                    timeout_seconds=settings.WIRE_HARNESS_COMPARE_CODEX_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired as exc:
                (codex_dir / "codex-stdout.log").write_text(_process_output_text(exc.stdout), encoding="utf-8")
                (codex_dir / "codex-stderr.log").write_text(_process_output_text(exc.stderr), encoding="utf-8")
                raise RuntimeError("\u7ebf\u675f\u56fe Codex AI \u5bf9\u6bd4\u8d85\u65f6\uff0c\u8bf7\u51cf\u5c11\u5355\u6b21\u56fe\u7eb8\u6570\u91cf\u6216\u7a0d\u540e\u91cd\u8bd5\u3002") from exc
            if completed.returncode == 0 or attempt + 1 >= retry_count or not _is_transient_codex_failure(completed):
                break
            time.sleep(5 * (attempt + 1))
        assert completed is not None
    except FileNotFoundError as exc:
        raise RuntimeError("服务端未找到 codex 命令，无法执行线束图 AI 对比。") from exc
    except subprocess.TimeoutExpired as exc:
        (codex_dir / "codex-stdout.log").write_text(_process_output_text(exc.stdout), encoding="utf-8")
        (codex_dir / "codex-stderr.log").write_text(_process_output_text(exc.stderr), encoding="utf-8")
        raise RuntimeError("线束图 Codex AI 对比超时，请减少单次图纸数量或稍后重试。") from exc
    (codex_dir / "codex-stdout.log").write_text(completed.stdout or "", encoding="utf-8")
    (codex_dir / "codex-stderr.log").write_text(completed.stderr or "", encoding="utf-8")
    if completed.returncode != 0:
        detail = _format_codex_error("\n".join([completed.stderr or "", completed.stdout or ""]))
        raise RuntimeError(f"Codex 执行线束图 AI 对比失败：{detail or '未知错误'}")
    _write_json_from_codex_message(last_message_path, result_path, completed.stdout or "")
    if not result_path.is_file() or result_path.stat().st_size == 0:
        raise RuntimeError("Codex 未生成线束图差异 JSON，请查看任务日志。")
    records = _load_codex_records(result_path, render_pages)
    filtered_records = _post_filter_records(records, render_pages)
    filtered_records = _merge_pdf_required_title_records(filtered_records, old_pdf, new_pdf)
    return _merge_unmatched_numeric_dimensions(filtered_records, script_differences)


def _render_pair_pages(old_pdf: Path, new_pdf: Path, codex_dir: Path) -> list[dict[str, Any]]:
    old_document = pymupdf.open(old_pdf)
    new_document = pymupdf.open(new_pdf)
    dpi = max(96, int(settings.WIRE_HARNESS_COMPARE_RENDER_DPI))
    pages: list[dict[str, Any]] = []
    try:
        page_count = min(old_document.page_count, new_document.page_count)
        for index in range(page_count):
            old_page = old_document[index]
            new_page = new_document[index]
            old_pixmap = old_page.get_pixmap(dpi=dpi, alpha=False)
            new_pixmap = new_page.get_pixmap(dpi=dpi, alpha=False)
            old_name = f"old_page_{index + 1}.png"
            new_name = f"new_page_{index + 1}.png"
            old_pixmap.save(codex_dir / old_name)
            new_pixmap.save(codex_dir / new_name)
            pages.append({
                "page": index + 1,
                "old_image": str((codex_dir / old_name).resolve()),
                "new_image": str((codex_dir / new_name).resolve()),
                "old_pixel_size": [old_pixmap.width, old_pixmap.height],
                "new_pixel_size": [new_pixmap.width, new_pixmap.height],
        "old_page_size": [float(old_page.rect.width), float(old_page.rect.height)],
        "new_page_size": [float(new_page.rect.width), float(new_page.rect.height)],
            })
    finally:
        old_document.close()
        new_document.close()
    return pages


def _build_codex_prompt(*, codex_dir: Path, evidence: dict[str, object]) -> str:
    evidence_json = json.dumps(evidence, ensure_ascii=False)
    return f"""你是线束图纸视觉差异审查员。当前消息已按顺序附加旧图/新图 PNG 图片：old_page_1、new_page_1、old_page_2、new_page_2……请直接看附加图片判断，不要调用工具浏览文件。

辅助证据目录：
{codex_dir}

PDF文字层、OCR文本和脚本候选差异只作为辅助线索；如果辅助证据和图片冲突，以图片为准。

辅助证据 JSON：
{evidence_json}

必须严格遵守这些业务规则：
- 对比图纸主体区域文字，包括工艺流程说明、物料表、线束图中蓝色/黑色文字标注、正文区域签名/日期/确认人文字。
- 右下角/底部标题栏只允许对比两项：Part No./沛城料号、Description/沛城型号。标题栏里的 Material code/物料编号、Date、Sheet、Ver.、Unit、Drawn BY、Checked BY、Approved BY、Supplier Acknowledgement、Customer acknowledges 全部忽略。
- 图纸右上方区域全部忽略，不识别、不输出差异；右上方修订记录、版次、修订日期、Revision Note、New drawing 等都不要输出。
- 公章、印章、工程部章、签章类内容忽略。
- 空格、换行、OCR 多余空格不作为差异。
- “4mm上锡”和“扭锡4mm”视为同义，不作为差异。
- 如果同一差异在表格和图中重复出现，应优先保留更贴近图纸主体标注的位置；确实是两处独立位置才输出两条。
- 不要因为 PDF 文字层顺序、旋转文字顺序、OCR 粘连而误判。

输出要求：
- 最终回复必须只包含 JSON，不要 Markdown，不要代码围栏，不要解释。
- JSON 格式必须为：
{{
  "differences": [
    {{
      "kind": "modified|added|removed",
      "page": 1,
      "old_page": 1,
      "new_page": 1,
      "old_text": "旧图文字，没有则为 null",
      "new_text": "新图文字，没有则为 null",
      "old_bbox_px": [x0, y0, x1, y1],
      "new_bbox_px": [x0, y0, x1, y1],
      "confidence": 0.0,
      "needs_review": false,
      "reason": "简短说明"
    }}
  ]
}}
- bbox 必须使用对应 PNG 图片上的像素坐标。旧图没有该内容时 old_bbox_px 为 null；新图没有该内容时 new_bbox_px 为 null。
- 如果你判断没有差异，输出 {{"differences":[]}}，但只有在逐项检查主体区域后才能这样输出。
"""


def _load_codex_records(result_path: Path, pages: list[dict[str, Any]]) -> list[DifferenceRecord]:
    try:
        payload = json.loads(result_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Codex 输出的线束图差异 JSON 格式无效") from exc
    differences = payload.get("differences") if isinstance(payload, dict) else None
    if not isinstance(differences, list):
        raise RuntimeError("Codex 输出缺少 differences 数组")
    page_map = {int(page["page"]): page for page in pages}
    records: list[DifferenceRecord] = []
    for index, item in enumerate(differences, start=1):
        if not isinstance(item, dict):
            continue
        page_number = int(item.get("page") or item.get("new_page") or item.get("old_page") or 1)
        page = page_map.get(page_number)
        if page is None:
            continue
        old_bbox = _pixel_box_to_page_box(item.get("old_bbox_px"), page["old_pixel_size"], page["old_page_size"])
        new_bbox = _pixel_box_to_page_box(item.get("new_bbox_px"), page["new_pixel_size"], page["new_page_size"])
        records.append(DifferenceRecord(
            number=index,
            kind=str(item.get("kind") or "modified"),
            page=page_number,
            old_text=_optional_text(item.get("old_text")),
            new_text=_optional_text(item.get("new_text")),
            old_bbox=old_bbox,
            new_bbox=new_bbox,
            confidence=_bounded_float(item.get("confidence"), default=0.85),
            needs_review=bool(item.get("needs_review", False)),
            reason=str(item.get("reason") or "Codex视觉对比判断为差异"),
            old_page=int(item.get("old_page") or page_number) if item.get("old_page") is not None else None,
            new_page=int(item.get("new_page") or page_number) if item.get("new_page") is not None else None,
        ))
    return [replace(record, number=index) for index, record in enumerate(records, start=1)]


def _write_json_from_codex_message(last_message_path: Path, result_path: Path, stdout: str) -> None:
    content = last_message_path.read_text(encoding="utf-8", errors="replace") if last_message_path.is_file() else stdout
    payload = _extract_json_payload(content)
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_json_payload(content: str) -> dict[str, object]:
    text = content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S | re.I)
    if fenced:
        text = fenced.group(1).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Codex 最终回复不是有效的线束图差异 JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("differences"), list):
        raise RuntimeError("Codex 最终回复缺少 differences 数组")
    return payload


def _pixel_box_to_page_box(value: object, pixel_size: list[int], page_size: list[float]) -> BBox | None:
    if not isinstance(value, list | tuple) or len(value) != 4:
        return None
    try:
        x0, y0, x1, y1 = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    pixel_width, pixel_height = float(pixel_size[0]), float(pixel_size[1])
    page_width, page_height = float(page_size[0]), float(page_size[1])
    if pixel_width <= 0 or pixel_height <= 0:
        return None
    left = max(0.0, min(page_width, x0 * page_width / pixel_width))
    top = max(0.0, min(page_height, y0 * page_height / pixel_height))
    right = max(0.0, min(page_width, x1 * page_width / pixel_width))
    bottom = max(0.0, min(page_height, y1 * page_height / pixel_height))
    if right <= left or bottom <= top:
        return None
    return (round(left, 3), round(top, 3), round(right, 3), round(bottom, 3))


def _post_filter_records(records: list[DifferenceRecord], pages: list[dict[str, Any]] | None = None) -> list[DifferenceRecord]:
    page_sizes = _page_size_lookup(pages or [])
    filtered: list[DifferenceRecord] = []
    for record in records:
        if _record_text_content_same(record):
            continue
        if _is_stamp_signature_record(record):
            continue
        if _record_is_top_right(record, page_sizes):
            continue
        if _record_is_ignored_title_field(record):
            continue
        if _record_is_unchanged_required_title_field(record):
            continue
        if _record_is_title_block(record) and not _record_has_required_title_field(record):
            continue
        if (
            (record.old_text is None or _is_ignored_text(record.old_text))
            and (record.new_text is None or _is_ignored_text(record.new_text))
        ):
            continue
        filtered.append(record)
    return [replace(record, number=index) for index, record in enumerate(filtered, start=1)]


NUMERIC_TOKEN_PATTERN = re.compile(r"\d+(?:\.\d+)?")


def _numeric_template(text: str) -> str:
    return NUMERIC_TOKEN_PATTERN.sub("{#}", _compact_text(text))


def _normalized_text_equal(left: str | None, right: str | None) -> bool:
    return bool(left and right and _compact_text(left) == _compact_text(right))


def _record_covers_script_candidate(
    record: DifferenceRecord,
    candidate: DifferenceRecord,
    *,
    side: str,
) -> bool:
    record_text = record.old_text if side == "old" else record.new_text
    candidate_text = candidate.old_text if side == "old" else candidate.new_text
    return _normalized_text_equal(record_text, candidate_text)


TITLE_FIELD_LABELS = {
    "part_no": "\u6c9b\u57ce\u6599\u53f7 (Part No.)",
    "description": "\u6c9b\u57ce\u578b\u53f7 (Description)",
}
TITLE_FIELD_LABEL_TEXT = re.compile(
    r"(?:\u6c9b\u57ce\u6599\u53f7|\u6c9b\u57ce\u578b\u53f7|Part\s*No\.?|Description)",
    re.I,
)
TITLE_VALUE_EXCLUDE_TEXT = re.compile(
    r"(?:Material\s*code\.?|\u7269\u6599\u7f16\u53f7|\u6c9b\u57ce\u6599\u53f7|\u6c9b\u57ce\u578b\u53f7|"
    r"Part\s*No\.?|Description|Date|Sheet|Ver\.?|Unit|Drawn|Checked|Approved)",
    re.I,
)


def _required_title_key(text: str) -> str | None:
    if re.search(r"(?:\u6c9b\u57ce\u6599\u53f7|Part\s*No\.?)(?!\w)", text, re.I):
        return "part_no"
    if re.search(r"(?:\u6c9b\u57ce\u578b\u53f7|Description)(?!\w)", text, re.I):
        return "description"
    return None


def _required_title_fields(pdf_path: Path) -> dict[str, TextBlock]:
    """Extract only the two title fields that business rules require comparing."""
    fields: dict[str, TextBlock] = {}
    document = pymupdf.open(pdf_path)
    try:
        for page_index, page in enumerate(document, start=1):
            lines: list[tuple[tuple[float, float, float, float], str]] = []
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
                    if text:
                        box = tuple(float(value) for value in line["bbox"])
                        lines.append((box, text))  # type: ignore[arg-type]

            labeled_lines = [
                (box, text, key)
                for box, text in lines
                if (key := _required_title_key(text)) and TITLE_FIELD_LABEL_TEXT.search(text)
            ]
            used_values: set[int] = set()
            for label_box, label_text, key in labeled_lines:
                if key in fields:
                    continue
                candidates: list[tuple[float, int, tuple[float, float, float, float], str]] = []
                for value_index, (value_box, value_text) in enumerate(lines):
                    if (
                        value_index in used_values
                        or value_text == label_text
                        or _required_title_key(value_text)
                        or TITLE_VALUE_EXCLUDE_TEXT.search(value_text)
                    ):
                        continue
                    if page.rotation % 180 == 0:
                        same_line = abs((value_box[1] + value_box[3]) / 2 - (label_box[1] + label_box[3]) / 2) <= max(12.0, label_box[3] - label_box[1])
                        gap = value_box[0] - label_box[2]
                        if same_line and -24.0 <= gap <= 24.0:
                            candidates.append((abs(gap), value_index, value_box, value_text))
                    else:
                        center_gap = abs((value_box[0] + value_box[2]) / 2 - (label_box[0] + label_box[2]) / 2)
                        gap = value_box[1] - label_box[3]
                        if center_gap <= max(18.0, (label_box[3] - label_box[1]) / 2) and -24.0 <= gap <= 24.0:
                            candidates.append((abs(gap), value_index, value_box, value_text))
                if not candidates:
                    continue
                _gap, value_index, value_box, value_text = min(candidates)
                used_values.add(value_index)
                combined_box = (
                    min(label_box[0], value_box[0]),
                    min(label_box[1], value_box[1]),
                    max(label_box[2], value_box[2]),
                    max(label_box[3], value_box[3]),
                )
                fields[key] = TextBlock(
                    f"{TITLE_FIELD_LABELS[key]}\uff1a{value_text}",
                    page_index,
                    combined_box,
                    "pdf_text",
                    1.0,
                )
    finally:
        document.close()
    return fields


def _field_value(block: TextBlock) -> str:
    return block.text.split("\uff1a", 1)[-1]


def _merge_pdf_required_title_records(
    records: list[DifferenceRecord],
    old_pdf: Path,
    new_pdf: Path,
) -> list[DifferenceRecord]:
    """PDF title fields are authoritative for the two business-required cells."""
    old_fields = _required_title_fields(old_pdf)
    new_fields = _required_title_fields(new_pdf)
    required_records: list[DifferenceRecord] = []
    for key in ("part_no", "description"):
        old_field = old_fields.get(key)
        new_field = new_fields.get(key)
        if not old_field or not new_field:
            continue
        if _compact_text(_field_value(old_field)) == _compact_text(_field_value(new_field)):
            continue
        required_records.append(DifferenceRecord(
            number=len(required_records) + 1,
            kind="modified",
            page=1,
            old_text=old_field.text,
            new_text=new_field.text,
            old_bbox=old_field.bbox,
            new_bbox=new_field.bbox,
            confidence=1.0,
            needs_review=False,
            reason="\u6807\u9898\u680f\u5fc5\u6bd4\u5bf9\u9879\u53d8\u5316",
            old_page=old_field.page,
            new_page=new_field.page,
        ))

    if not required_records:
        return records

    required_values = {
        (key, _compact_text(_field_value(field)))
        for key, fields in (("old", old_fields), ("new", new_fields))
        for field in fields.values()
    }
    filtered = []
    for record in records:
        record_values = {
            (side, _compact_text(text))
            for side, text in (("old", record.old_text), ("new", record.new_text))
            if text
        }
        is_partial_ai_title = bool(record_values & required_values) or bool(
            TITLE_REQUIRED_COMPARE_TEXT.search(_record_text(record))
            and _record_is_title_block(record)
        )
        if not is_partial_ai_title:
            filtered.append(record)
    return required_records + filtered


def _merge_unmatched_numeric_dimensions(
    records: list[DifferenceRecord],
    script_differences: list[DifferenceRecord],
) -> list[DifferenceRecord]:
    """Pair matching removed/added dimensions that the visual pass omitted."""
    covered_script_indices: set[int] = set()
    for index, candidate in enumerate(script_differences):
        side = "old" if candidate.kind == "removed" else "new"
        if (
            candidate.kind in {"removed", "added"}
            and not (candidate.old_text if side == "old" else candidate.new_text)
        ):
            continue
        if any(_record_covers_script_candidate(record, candidate, side=side) for record in records):
            covered_script_indices.add(index)

    removed_candidates = [
        (index, candidate)
        for index, candidate in enumerate(script_differences)
        if candidate.kind == "removed"
        and candidate.old_text
        and candidate.old_bbox
        and index not in covered_script_indices
    ]
    added_candidates = [
        (index, candidate)
        for index, candidate in enumerate(script_differences)
        if candidate.kind == "added"
        and candidate.new_text
        and candidate.new_bbox
        and index not in covered_script_indices
    ]

    used_added: set[int] = set()
    used_script_indices: set[int] = set(covered_script_indices)
    merged = list(records)
    for removed_index, removed in removed_candidates:
        removed_template = _numeric_template(removed.old_text or "")
        if "{#}" not in removed_template:
            continue
        matches = [
            (index, candidate)
            for index, candidate in added_candidates
            if index not in used_added
            and (candidate.new_page or candidate.page) == (removed.old_page or removed.page)
            and _numeric_template(candidate.new_text or "") == removed_template
        ]
        if not matches:
            continue
        added_index, added = min(
            matches,
            key=lambda item: _bbox_center_distance_squared(item[1].new_bbox, removed.old_bbox),
        )
        used_added.add(added_index)
        used_script_indices.update((removed_index, added_index))
        merged.append(DifferenceRecord(
            number=len(merged) + 1,
            kind="modified",
            page=removed.page,
            old_text=removed.old_text,
            new_text=added.new_text,
            old_bbox=removed.old_bbox,
            new_bbox=added.new_bbox,
            confidence=min(removed.confidence, added.confidence, 0.98),
            needs_review=removed.needs_review or added.needs_review,
            reason="\u0050\u0044\u0046\u6587\u5b57\u5c42\u8f85\u52a9\u8bc6\u522b\uff1a\u540c\u9875\u540c\u683c\u5f0f\u5c3a\u5bf8\u5220\u9664\u4e0e\u65b0\u589e\u5408\u5e76\u4e3a\u4fee\u6539",
            old_page=removed.old_page,
            new_page=added.new_page,
        ))

    return [replace(record, number=index) for index, record in enumerate(merged, start=1)]


def _bbox_center_distance_squared(left: BBox | None, right: BBox | None) -> float:
    if left is None or right is None:
        return float("inf")
    left_center = ((left[0] + left[2]) / 2, (left[1] + left[3]) / 2)
    right_center = ((right[0] + right[2]) / 2, (right[1] + right[3]) / 2)
    return (left_center[0] - right_center[0]) ** 2 + (left_center[1] - right_center[1]) ** 2


def _record_text_content_same(record: DifferenceRecord) -> bool:
    return bool(
        record.old_text is not None
        and record.new_text is not None
        and _compact_text(record.old_text) == _compact_text(record.new_text)
    )


def _page_size_lookup(pages: list[dict[str, Any]]) -> dict[tuple[str, int], tuple[float, float]]:
    result: dict[tuple[str, int], tuple[float, float]] = {}
    for page in pages:
        number = int(page.get("page") or 1)
        old_size = page.get("old_page_size")
        new_size = page.get("new_page_size")
        if isinstance(old_size, list | tuple) and len(old_size) == 2:
            result[("old", number)] = (float(old_size[0]), float(old_size[1]))
        if isinstance(new_size, list | tuple) and len(new_size) == 2:
            result[("new", number)] = (float(new_size[0]), float(new_size[1]))
    return result


def _record_is_top_right(record: DifferenceRecord, page_sizes: dict[tuple[str, int], tuple[float, float]]) -> bool:
    if UPPER_RIGHT_LINE_TABLE_TEXT.search(_record_text(record)):
        return False
    boxes: list[tuple[str, int, BBox]] = []
    if record.old_bbox:
        boxes.append(("old", record.old_page or record.page, record.old_bbox))
    if record.new_bbox:
        boxes.append(("new", record.new_page or record.page, record.new_bbox))
    if not boxes:
        return False
    for side, page, box in boxes:
        size = page_sizes.get((side, page))
        if size is None:
            continue
        width, height = size
        center_x = (box[0] + box[2]) / 2
        center_y = (box[1] + box[3]) / 2
        if center_x >= width * 0.55 and center_y <= height * 0.22:
            return True
    return False


def _record_has_required_title_field(record: DifferenceRecord) -> bool:
    return bool(TITLE_REQUIRED_COMPARE_TEXT.search(_record_text(record)))


def _record_is_ignored_title_field(record: DifferenceRecord) -> bool:
    text = _record_text(record)
    return bool(TITLE_IGNORED_TEXT.search(text) and not TITLE_REQUIRED_COMPARE_TEXT.search(text))


def _record_is_unchanged_required_title_field(record: DifferenceRecord) -> bool:
    if not _record_has_required_title_field(record):
        return False
    if record.old_text is None or record.new_text is None:
        return False
    old_value = TITLE_REQUIRED_COMPARE_TEXT.sub("", record.old_text)
    new_value = TITLE_REQUIRED_COMPARE_TEXT.sub("", record.new_text)
    old_value = re.sub(r"[:：/()\s]+", "", old_value)
    new_value = re.sub(r"[:：/()\s]+", "", new_value)
    return bool(old_value and new_value and _compact_text(old_value) == _compact_text(new_value))


def _record_text(record: DifferenceRecord) -> str:
    return " ".join(text for text in (record.old_text, record.new_text) if text)


def _record_is_title_block(record: DifferenceRecord) -> bool:
    blocks: list[TextBlock] = []
    if record.old_text and record.old_bbox:
        blocks.append(TextBlock(record.old_text, record.old_page or record.page, record.old_bbox, "codex", record.confidence))
    if record.new_text and record.new_bbox:
        blocks.append(TextBlock(record.new_text, record.new_page or record.page, record.new_bbox, "codex", record.confidence))
    if not blocks:
        return False
    kept = _filter_title_block_regions(_merge_required_part_fields(blocks))
    return len(kept) == 0


def _text_block_json(block: TextBlock) -> dict[str, object]:
    return {
        "text": block.text,
        "page": block.page,
        "bbox": block.bbox,
        "source": block.source,
        "confidence": block.confidence,
        "needs_review": block.needs_review,
    }


def _difference_json(record: DifferenceRecord) -> dict[str, object]:
    return {
        "number": record.number,
        "kind": record.kind,
        "page": record.page,
        "old_page": record.old_page,
        "new_page": record.new_page,
        "old_text": record.old_text,
        "new_text": record.new_text,
        "old_bbox": record.old_bbox,
        "new_bbox": record.new_bbox,
        "confidence": record.confidence,
        "needs_review": record.needs_review,
        "reason": record.reason,
    }


def _business_rules() -> list[str]:
    return [
        "图纸主体文字为主。",
        "右下标题栏只对比 Part No./沛城料号、Description/沛城型号。",
        "右上方区域全部忽略。",
        "公章、印章、工程部章、签章类内容忽略。",
        "PDF文字层和OCR只作辅助，最终以渲染图视觉判断为准。",
        "空格、换行、OCR粘连、旋转文字顺序不作为差异。",
        "保留旧图红色、新图蓝色批注和点击定位所需坐标。",
    ]


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
    # HOME/PATH。显式传入 Codex 主目录，确保认证、插件和技能目录一致。
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
    return subprocess.CompletedProcess(command, process.returncode or 0, stdout, stderr)


def _kill_process_tree(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False, capture_output=True, text=True)


def _resolve_codex_command(command: str) -> str:
    return _resolve_configured_codex_command(command, user_profile=_codex_home_dir().parent, which=shutil.which)

def _is_transient_codex_failure(completed: subprocess.CompletedProcess[str]) -> bool:
    detail = "\n".join([completed.stderr or "", completed.stdout or ""]).lower()
    return any(
        marker in detail
        for marker in (
            "unexpected status 503",
            "service temporarily unavailable",
            "service unavailable",
            "stream disconnected",
            "connection reset",
            "concurrency limit exceeded",
        )
    )


def _write_invocation_log(codex_dir: Path, *, command: list[str], result_path: Path) -> None:
    payload = {
        "command": command,
        "result_path": str(result_path),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": "codex_visual_primary",
    }
    (codex_dir / "codex-invocation.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _process_output_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _format_codex_error(detail: str) -> str:
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    important = [line for line in lines if line.startswith("ERROR:") or "error" in line.lower() or "failed" in line.lower()]
    return "\n".join((important or lines)[-6:])


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "无"}:
        return None
    return text


def _bounded_float(value: object, *, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(0.0, min(1.0, number))
