import subprocess
import uuid
from pathlib import Path
from zipfile import ZipFile

import pymupdf

from app.api.routes import wire_harness_compare_tasks
from app.services.wire_harness_annotation import (
    RenderedTextBox,
    _apply_extra_display_rotation,
    _select_rendered_box,
    build_interactive_report,
    relocate_difference_locations,
    relocate_difference_locations_on_rendered_pages,
)
from app.services.wire_harness_codex_compare import (
    _extract_json_payload,
    _is_transient_codex_failure,
    _load_codex_records,
    _merge_pdf_required_title_records,
    _merge_unmatched_numeric_dimensions,
    _pixel_box_to_page_box,
    _post_filter_records,
    _required_title_fields,
    _resolve_codex_command,
    _run_codex_process,
)
from app.services.wire_harness_compare_task_service import (
    _align_image_to_reference,
    _archive_suffix,
    _difference_boxes,
    _extract_zip,
    _find_pdf_pairs,
    _side_by_side,
)
from app.services.wire_harness_semantic_compare import (
    DifferenceRecord,
    TextBlock,
    compare_text_blocks,
    extract_text_blocks,
    normalize_text,
)


def test_accepts_zip_and_rar_archives() -> None:
    assert _archive_suffix("drawings.zip") == ".zip"
    assert _archive_suffix("drawings.RAR") == ".rar"


def test_rejects_unsupported_archive_format() -> None:
    assert _archive_suffix("drawings.7z") is None


def test_read_html_report_regenerates_corrupted_report(monkeypatch, tmp_path: Path) -> None:
    report = tmp_path / "差异报告.html"
    report.write_bytes(b"%TSD-Header-###%not-html")

    def fake_refresh(path: Path) -> Path:
        path.write_text("<!doctype html><html><body>ok</body></html>", encoding="utf-8")
        return path

    monkeypatch.setattr(wire_harness_compare_tasks, "refresh_legacy_interactive_report", fake_refresh)

    assert "ok" in wire_harness_compare_tasks._read_html_report(report, task_id=uuid.uuid4())


def test_resolve_codex_command_checks_user_npm_dir(monkeypatch, tmp_path: Path) -> None:
    npm_dir = tmp_path / "AppData" / "Roaming" / "npm"
    npm_dir.mkdir(parents=True)
    codex_cmd = npm_dir / "codex.cmd"
    codex_cmd.write_text("@echo off\n", encoding="utf-8")
    monkeypatch.setattr("app.services.wire_harness_codex_compare.settings.CODEX_HOME_DIR", str(tmp_path / ".codex"))
    monkeypatch.setattr("app.services.wire_harness_codex_compare.shutil.which", lambda _candidate: None)

    assert _resolve_codex_command("codex") == str(codex_cmd)


def test_post_filter_keeps_upper_right_line_table_but_ignores_revision() -> None:
    pages = [{"page": 1, "old_page_size": [1000, 600], "new_page_size": [1000, 600]}]
    records = [
        DifferenceRecord(
            1,
            "modified",
            1,
            "NTC1: 1512?5 / 1500?10",
            "NTC1: 615?3 / 600?5",
            (650, 70, 730, 85),
            (660, 68, 740, 84),
            0.95,
            False,
            "NTC line table length changed",
        ),
        DifferenceRecord(
            2,
            "modified",
            1,
            "New drawing A",
            "New drawing B",
            (650, 10, 730, 25),
            (660, 10, 740, 25),
            0.90,
            False,
            "revision header",
        ),
    ]

    filtered = _post_filter_records(records, pages)

    assert [record.old_text for record in filtered] == ["NTC1: 1512?5 / 1500?10"]


def test_run_codex_process_passes_configured_codex_home(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr("app.services.wire_harness_codex_compare.settings.CODEX_HOME_DIR", str(tmp_path / ".codex"))

    class FakeProcess:
        pid = 123
        returncode = 0

        def communicate(self, prompt: str, timeout: int) -> tuple[str, str]:
            captured["prompt"] = prompt
            captured["timeout"] = timeout
            return "ok", ""

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["env"] = kwargs["env"]
        return FakeProcess()

    monkeypatch.setattr("app.services.wire_harness_codex_compare.subprocess.Popen", fake_popen)

    result = _run_codex_process(["codex", "exec"], prompt="hello", cwd=tmp_path, timeout_seconds=7)

    env = captured["env"]
    assert result.stdout == "ok"
    assert env["CODEX_HOME"] == str(tmp_path / ".codex")
    assert env["USERPROFILE"] == str(tmp_path)
    assert env["HOME"] == str(tmp_path)


def test_identifies_transient_codex_upstream_failure() -> None:
    failed = subprocess.CompletedProcess(["codex"], 1, "", "ERROR: unexpected status 503 Service Unavailable")
    succeeded = subprocess.CompletedProcess(["codex"], 0, "ok", "")

    assert _is_transient_codex_failure(failed) is True
    assert _is_transient_codex_failure(succeeded) is False


def test_merge_unmatched_numeric_removed_and_added_candidates() -> None:
    visual = [
        DifferenceRecord(1, "modified", 1, "Part No.: A", "Part No.: B", (10, 10, 20, 20), (10, 10, 20, 20), 0.98, False, "part"),
    ]
    script = [
        DifferenceRecord(1, "removed", 1, "300?5mm", None, (100, 50, 150, 62), None, 1.0, False, "text"),
        DifferenceRecord(2, "added", 1, None, "450?5mm", None, (105, 400, 155, 412), 1.0, False, "text"),
        DifferenceRecord(3, "removed", 1, "unrelated", None, (200, 50, 250, 62), None, 1.0, False, "text"),
    ]

    merged = _merge_unmatched_numeric_dimensions(visual, script)

    assert [(record.kind, record.old_text, record.new_text) for record in merged] == [
        ("modified", "Part No.: A", "Part No.: B"),
        ("modified", "300?5mm", "450?5mm"),
    ]
    assert merged[1].old_bbox == (100, 50, 150, 62)
    assert merged[1].new_bbox == (105, 400, 155, 412)


def test_merge_does_not_duplicate_numeric_candidate_already_seen_by_codex() -> None:
    visual = [
        DifferenceRecord(1, "modified", 1, "300?5mm", "450?5mm", (100, 50, 150, 62), (105, 400, 155, 412), 0.99, False, "visual"),
    ]
    script = [
        DifferenceRecord(1, "removed", 1, "300?5mm", None, (100, 50, 150, 62), None, 1.0, False, "text"),
        DifferenceRecord(2, "added", 1, None, "450?5mm", None, (105, 400, 155, 412), 1.0, False, "text"),
    ]

    assert _merge_unmatched_numeric_dimensions(visual, script) == visual


def test_required_title_fields_extracts_part_number_and_description(tmp_path: Path) -> None:
    pdf_path = tmp_path / "title.pdf"
    document = pymupdf.open()
    page = document.new_page(width=842, height=595)
    page.insert_text((500, 450), "\u6c9b\u57ce\u6599\u53f7 (Part No.)\uff1a", fontname="china-s")
    page.insert_text((690, 450), "1.19.04.000277")
    page.insert_text((500, 470), "\u6c9b\u57ce\u578b\u53f7 (Description)\uff1a", fontname="china-s")
    page.insert_text((700, 470), "XT30UF-300mm")
    document.save(pdf_path)
    document.close()

    fields = _required_title_fields(pdf_path)

    assert set(fields) == {"part_no", "description"}
    assert "1.19.04.000277" in fields["part_no"].text
    assert "XT30UF-300mm" in fields["description"].text


def test_merge_pdf_required_title_records_replaces_partial_ai_title(tmp_path: Path) -> None:
    paths = []
    values = [("1.19.04.000277", "XT30UF-300mm"), ("1.19.04.000350", "XT30UF-450mm")]
    for index, (part, description) in enumerate(values):
        pdf_path = tmp_path / f"title-{index}.pdf"
        document = pymupdf.open()
        page = document.new_page(width=842, height=595)
        page.insert_text((500, 450), "\u6c9b\u57ce\u6599\u53f7 (Part No.)\uff1a", fontname="china-s")
        page.insert_text((690, 450), part)
        page.insert_text((500, 470), "\u6c9b\u57ce\u578b\u53f7 (Description)\uff1a", fontname="china-s")
        page.insert_text((700, 470), description)
        document.save(pdf_path)
        document.close()
        paths.append(pdf_path)
    ai_records = [
        DifferenceRecord(1, "modified", 1, "1.19.04.000277", "1.19.04.000350", (582, 420, 652, 438), (582, 420, 652, 438), 0.98, False, "part"),
    ]

    merged = _merge_pdf_required_title_records(ai_records, paths[0], paths[1])

    assert len(merged) == 2
    assert "1.19.04.000277" in merged[0].old_text and "1.19.04.000350" in merged[0].new_text
    assert "XT30UF-300mm" in merged[1].old_text and "XT30UF-450mm" in merged[1].new_text
    assert merged[0].old_bbox[1] > 430
    assert merged[1].old_bbox[1] > 450


def test_codex_pixel_box_is_converted_to_page_coordinates() -> None:
    assert _pixel_box_to_page_box([160, 80, 320, 240], [1600, 800], [720.0, 360.0]) == (72.0, 36.0, 144.0, 108.0)


def test_loads_codex_difference_json_with_page_bboxes(tmp_path: Path) -> None:
    result = tmp_path / "codex_differences.json"
    result.write_text(
        """
{
  "differences": [
    {
      "kind": "added",
      "page": 1,
      "old_text": null,
      "new_text": "4 打透明UV胶",
      "old_bbox_px": null,
      "new_bbox_px": [100, 50, 200, 100],
      "confidence": 0.92,
      "reason": "新图新增主体标注"
    }
  ]
}
""",
        encoding="utf-8",
    )
    records = _load_codex_records(
        result,
        [{
            "page": 1,
            "old_pixel_size": [1000, 1000],
            "new_pixel_size": [1000, 500],
            "old_page_size": [500.0, 500.0],
            "new_page_size": [500.0, 250.0],
        }],
    )

    assert len(records) == 1
    assert records[0].new_text == "4 打透明UV胶"
    assert records[0].new_bbox == (50.0, 25.0, 100.0, 50.0)
    assert records[0].confidence == 0.92


def test_extracts_codex_json_from_markdown_fence() -> None:
    payload = _extract_json_payload('说明\n```json\n{"differences":[]}\n```')

    assert payload == {"differences": []}


def test_codex_records_still_ignore_stamp_signatures() -> None:
    records = [
        DifferenceRecord(
            1,
            "added",
            1,
            None,
            "罗昌群 2026/9/3",
            None,
            (100, 100, 110, 180),
            0.9,
            False,
            "stamp",
        ),
        DifferenceRecord(
            2,
            "added",
            1,
            None,
            "4 打透明UV胶",
            None,
            (200, 100, 260, 120),
            0.9,
            False,
            "body label",
        ),
    ]

    filtered = _post_filter_records(records)

    assert [record.new_text for record in filtered] == ["4 打透明UV胶"]
    assert filtered[0].number == 1


def test_codex_records_ignore_top_right_revision_area() -> None:
    records = [
        DifferenceRecord(
            1,
            "modified",
            1,
            "A",
            "A0",
            (620, 40, 650, 55),
            (620, 40, 650, 55),
            0.95,
            False,
            "top revision",
        ),
        DifferenceRecord(
            2,
            "modified",
            1,
            "811±3",
            "812±3",
            (350, 260, 390, 280),
            (350, 260, 390, 280),
            0.95,
            False,
            "body length",
        ),
    ]

    filtered = _post_filter_records(records, [{"page": 1, "old_page_size": [800.0, 600.0], "new_page_size": [800.0, 600.0]}])

    assert [record.new_text for record in filtered] == ["812±3"]


def test_codex_title_block_only_keeps_peicheng_part_and_model() -> None:
    records = [
        DifferenceRecord(
            1,
            "modified",
            1,
            "Date: 2026/07/30",
            "Date: 2026/08/01",
            (600, 520, 720, 535),
            (600, 520, 720, 535),
            0.9,
            False,
            "title date",
        ),
        DifferenceRecord(
            2,
            "modified",
            1,
            "Part No./沛城料号: HHX-PC02-001293",
            "Part No./沛城料号: HHX-PC02-001309",
            (600, 540, 760, 555),
            (600, 540, 760, 555),
            0.98,
            False,
            "peicheng part number",
        ),
        DifferenceRecord(
            3,
            "modified",
            1,
            "Description/沛城型号: A",
            "Description/沛城型号: B",
            (600, 560, 760, 575),
            (600, 560, 760, 575),
            0.98,
            False,
            "peicheng model",
        ),
    ]

    filtered = _post_filter_records(records, [{"page": 1, "old_page_size": [800.0, 600.0], "new_page_size": [800.0, 600.0]}])

    assert [record.number for record in filtered] == [1, 2]
    assert [record.reason for record in filtered] == ["peicheng part number", "peicheng model"]


def test_codex_records_ignore_same_text_layout_changes() -> None:
    records = [
        DifferenceRecord(
            1,
            "modified",
            1,
            "1.19.02.001233",
            "1.19.02.001233",
            (600, 540, 760, 555),
            (580, 540, 740, 555),
            0.9,
            False,
            "layout only",
        ),
    ]

    assert _post_filter_records(records) == []


def _make_pdf(path: Path, text: str) -> None:
    document = pymupdf.open()
    page = document.new_page(width=200, height=120)
    page.insert_text((20, 40), text)
    document.save(path)
    document.close()


def test_extracts_multiple_harness_folders_and_pairs_pdfs(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    _make_pdf(source / "old.pdf", "old")
    _make_pdf(source / "new.pdf", "new")
    archive = tmp_path / "input.zip"
    with ZipFile(archive, "w") as zipped:
        zipped.write(source / "old.pdf", "set-a/old.pdf")
        zipped.write(source / "new.pdf", "set-a/new.pdf")
        zipped.write(source / "old.pdf", "set-b/原档.pdf")
        zipped.write(source / "new.pdf", "set-b/改版.pdf")

    extracted = tmp_path / "extracted"
    _extract_zip(archive, extracted)
    pairs = _find_pdf_pairs(extracted)

    assert [pair[2] for pair in pairs] == ["set-a", "set-b"]
    assert all(old.name in {"old.pdf", "原档.pdf"} for old, _, _ in pairs)


def test_pairs_unmarked_pdf_before_modified_pdf(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    _make_pdf(source / "drawing.pdf", "old")
    _make_pdf(source / "drawing_改.pdf", "new")

    pairs = _find_pdf_pairs(source)

    assert pairs[0][0].name == "drawing.pdf"
    assert pairs[0][1].name == "drawing_改.pdf"


def test_side_by_side_image_has_two_page_widths() -> None:
    old = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.Rect(0, 0, 100, 60), False)
    old.clear_with(0xFFFFFF)
    new = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.Rect(0, 0, 100, 60), False)
    new.clear_with(0xFFFFFF)
    from PIL import Image

    result = _side_by_side(Image.frombytes("RGB", (100, 60), old.samples), Image.frombytes("RGB", (100, 60), new.samples))
    assert result.width == 200
    assert result.height > 60


def test_alignment_removes_small_export_translation_before_image_diff() -> None:
    from PIL import Image, ImageDraw

    reference = Image.new("RGB", (120, 80), "white")
    ImageDraw.Draw(reference).rectangle((35, 25, 75, 55), outline="black", width=3)
    shifted = Image.new("RGB", reference.size, "white")
    shifted.paste(reference.crop((0, 0, 116, 76)), (4, 4))

    aligned = _align_image_to_reference(reference, shifted)
    assert len(_difference_boxes(reference, aligned)) == 0


def test_ignores_stamp_text_and_single_frame_markers() -> None:
    old = [
        TextBlock("A", 1, (10, 10, 20, 20), "pdf_text", 1.0),
        TextBlock("工程部发行章", 1, (30, 30, 80, 45), "pdf_text", 1.0),
        TextBlock("900±5", 1, (100, 100, 150, 115), "pdf_text", 1.0),
    ]
    new = [TextBlock("900±5", 1, (100, 100, 150, 115), "ocr", 0.9)]

    assert compare_text_blocks(old, new) == []


def test_ignores_whitespace_only_text_changes() -> None:
    old = [TextBlock("端子:A2006-TPE 闭口镀锡母端子", 1, (10, 10, 180, 25), "pdf_text", 1.0)]
    new = [TextBlock("端子: A2006-TPE 闭口 镀锡 母端子", 1, (10, 10, 180, 25), "ocr", 0.9)]

    assert compare_text_blocks(old, new) == []


def test_treats_equivalent_tinning_wording_as_same() -> None:
    old = [TextBlock("线尾 4mm上锡", 1, (10, 10, 150, 25), "pdf_text", 1.0)]
    new = [TextBlock("线尾 扭锡4mm", 1, (10, 10, 150, 25), "pdf_text", 1.0)]

    assert compare_text_blocks(old, new) == []


def test_strictly_compares_part_description_even_when_similarity_is_high() -> None:
    old = [TextBlock("500mm-4P-2.0S-tin-2.2-1.1", 1, (100, 100, 220, 120), "pdf_text", 1.0)]
    new = [TextBlock("500mm-4P-2.0S-tin-2.2", 1, (100, 100, 220, 120), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text.endswith("-1.1")


def test_matches_semantically_same_page_when_page_numbers_shift() -> None:
    old = [
        TextBlock("工艺流程步骤如下", 2, (10, 10, 120, 22), "pdf_text", 1.0),
        TextBlock("孔座:HY-6Y(PHS-6Y) 间距=2.0mm 白色带扣", 2, (100, 100, 300, 120), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("工艺流程步骤如下", 1, (10, 10, 120, 22), "pdf_text", 1.0),
        TextBlock("孔座:HY-7Y(PHS-7Y) 间距=2.0mm 白色带扣", 1, (100, 100, 300, 120), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text and "HY-6Y" in differences[0].old_text
    assert differences[0].new_text and "HY-7Y" in differences[0].new_text
    assert differences[0].old_page == 2
    assert differences[0].new_page == 1


def test_compares_split_peicheng_model_and_material_fields() -> None:
    old = [
        TextBlock("沛城 型号", 1, (10, 10, 70, 20), "pdf_text", 1.0),
        TextBlock("PC-OLD", 1, (10, 26, 80, 36), "pdf_text", 1.0),
        TextBlock("沛城 料号", 1, (10, 50, 70, 60), "pdf_text", 1.0),
        TextBlock("MAT-001", 1, (10, 66, 80, 76), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("沛城型号", 1, (10, 10, 70, 20), "pdf_text", 1.0),
        TextBlock("PC-NEW", 1, (10, 26, 80, 36), "pdf_text", 1.0),
        TextBlock("沛城料号", 1, (10, 50, 70, 60), "pdf_text", 1.0),
        TextBlock("MAT-002", 1, (10, 66, 80, 76), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert differences == []


def test_compares_title_description_and_material_code_values() -> None:
    old = [
        TextBlock("BMU-36161C-YY50310-采样线1-1.1", 1, (100, 100, 120, 240), "pdf_text", 1.0),
        TextBlock("NI-PC-3658A-4944-32P", 1, (130, 100, 150, 240), "pdf_text", 1.0),
        TextBlock("BMU-36161C-YY50310-采样线1-1.1", 2, (100, 100, 120, 240), "pdf_text", 1.0),
        TextBlock("NI-PC-3658A-4944-32P", 2, (130, 100, 150, 240), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("BMU-36161C-YY50310-采样线1-1.2", 1, (100, 100, 120, 240), "pdf_text", 1.0),
        TextBlock("YKS-20260803-001", 1, (130, 100, 150, 240), "pdf_text", 1.0),
        TextBlock("BMU-36161C-YY50310-采样线1-1.2", 2, (100, 100, 120, 240), "pdf_text", 1.0),
        TextBlock("YKS-20260803-001", 2, (130, 100, 150, 240), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert sum(1 for item in differences if item.old_text and item.old_text.startswith("BMU-")) == 1
    assert sum(1 for item in differences if item.old_text and item.old_text.startswith("NI-PC-")) == 1
    assert any(item.new_text and item.new_text.startswith("YKS-") for item in differences)


def test_keeps_peicheng_part_values_after_title_block_filtering() -> None:
    old = [TextBlock("HHX-PC02-001293", 1, (100, 100, 180, 120), "pdf_text", 1.0)]
    new = [TextBlock("HHX-PC02-001309", 1, (100, 100, 180, 120), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text == "HHX-PC02-001293"
    assert differences[0].new_text == "HHX-PC02-001309"


def test_does_not_append_next_text_to_peicheng_value_already_on_label_line() -> None:
    old = [TextBlock("Description): 1.19.02.001293", 1, (100, 100, 220, 120), "pdf_text", 1.0)]
    new = [TextBlock("Description): 1.19.02.001309", 1, (100, 100, 220, 120), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert differences == []


def test_compares_signature_name_when_date_is_in_same_text_block() -> None:
    old = [TextBlock("张三 2026/07/11", 1, (10, 10, 80, 22), "pdf_text", 1.0)]
    new = [TextBlock("李四 2026/08/05", 1, (10, 10, 80, 22), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)
    assert len(differences) == 1
    assert differences[0].old_text == "张三 2026/07/11"
    assert differences[0].new_text == "李四 2026/08/05"


def test_ignores_concatenated_process_marker_number() -> None:
    old = [TextBlock("打透明UV胶5", 1, (10, 10, 80, 30), "pdf_text", 1.0)]
    new = [TextBlock("打透明UV胶", 1, (10, 10, 80, 30), "pdf_text", 1.0)]

    assert compare_text_blocks(old, new) == []


def test_recovers_truncated_white_color_text() -> None:
    old = [TextBlock("黄色", 1, (10, 10, 40, 20), "pdf_text", 1.0)]
    new = [TextBlock(normalize_text("颜色"), 1, (10, 10, 40, 20), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].new_text == "白色"


def test_compares_standalone_signature_name_and_date_block() -> None:
    old = [TextBlock("罗昌群 2026/8/20", 1, (200, 300, 220, 430), "pdf_text", 1.0)]
    new = [TextBlock("罗昌群 2026/8/25", 1, (200, 300, 220, 430), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)
    assert len(differences) == 1
    assert differences[0].old_text == "罗昌群 2026/8/20"
    assert differences[0].new_text == "罗昌群 2026/8/25"


def test_matches_dimension_text_after_small_layout_shift() -> None:
    old = [TextBlock("170±5mm", 1, (500, 300, 515, 340), "pdf_text", 1.0)]
    new = [TextBlock("220±5mm", 1, (500, 345, 515, 385), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text == "170±5mm"
    assert differences[0].new_text == "220±5mm"


def test_compares_repeated_finished_length_values_without_mm_unit() -> None:
    old = [
        TextBlock("695\u00b13", 1, (315, 126, 325, 146), "pdf_text", 1.0),
        TextBlock("685\u00b15", 1, (304, 166, 312, 189), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("695\u00b13", 1, (315, 126, 325, 147), "pdf_text", 1.0),
        TextBlock("700\u00b15", 1, (304, 166, 312, 191), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text == "685\u00b15"
    assert differences[0].new_text == "700\u00b15"


def test_relocates_duplicate_value_to_nearest_pdf_occurrence(tmp_path: Path) -> None:
    old_path = tmp_path / "old.pdf"
    new_path = tmp_path / "new.pdf"
    for path in (old_path, new_path):
        document = pymupdf.open()
        page = document.new_page(width=300, height=300)
        page.insert_text((20, 40), "350±5")
        page.insert_text((20, 240), "350±5")
        document.save(path)
        document.close()
    difference = DifferenceRecord(1, "modified", 1, "350±5", "350±5", (20, 30, 60, 45), (20, 30, 60, 45), 1.0, False, "test")

    relocated = relocate_difference_locations(old_path, new_path, [difference])[0]
    assert relocated.old_bbox is not None
    assert relocated.old_bbox[1] < 60


def test_relocates_difference_bbox_into_rotated_page_display_coordinates(tmp_path: Path) -> None:
    path = tmp_path / "rotated.pdf"
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((100, 200), "旧值")
    page.set_rotation(270)
    document.save(path)
    document.close()

    difference = DifferenceRecord(1, "modified", 1, "旧值", "旧值", (100, 185, 120, 205), (100, 185, 120, 205), 1.0, False, "test")
    relocated = relocate_difference_locations(path, path, [difference])[0]

    assert relocated.old_bbox is not None
    assert relocated.old_bbox == (185.0, 475, 205.0, 495)


def test_rendered_locator_uses_distinct_matching_text_boxes() -> None:
    candidates = [
        RenderedTextBox("4 打透明UV胶", 1, (100, 40, 170, 56), 0.91),
        RenderedTextBox("4 打透明UV胶", 1, (420, 80, 490, 96), 0.92),
    ]
    used: set[int] = set()

    first = _select_rendered_box("4 打透明UV胶", candidates, used, (95, 40, 165, 56))
    second = _select_rendered_box("4 打透明UV胶", candidates, used, (415, 80, 485, 96))

    assert first == (100, 40, 170, 56)
    assert second == (420, 80, 490, 96)


def test_rendered_locator_returns_none_when_text_is_not_found() -> None:
    candidates = [RenderedTextBox("4 打透明UV胶", 1, (100, 40, 170, 56), 0.91)]

    assert _select_rendered_box("HY-7Y(PHS-7Y)", candidates, set(), (220, 80, 280, 96)) == (220, 80, 280, 96)


def test_rendered_locator_prefers_candidate_near_semantic_bbox() -> None:
    candidates = [
        RenderedTextBox("透明UV胶水", 1, (600, 200, 680, 250), 0.55),
        RenderedTextBox("透明UV胶水", 1, (100, 490, 150, 505), 0.91),
    ]

    selected = _select_rendered_box("透明UV胶水", candidates, set(), (105, 492, 145, 503))

    assert selected == (100, 490, 150, 505)


def test_rendered_locator_keeps_tight_numeric_fallback_when_ocr_box_is_too_large() -> None:
    candidates = [
        RenderedTextBox("607±3 透明UV胶水 1.红520→", 1, (88, 165, 620, 205), 0.84),
    ]

    selected = _select_rendered_box("607±3", candidates, set(), (132, 84, 162, 94))

    assert selected == (132, 84, 162, 94)


def test_rendered_locator_rejects_exact_numeric_match_when_box_is_too_large() -> None:
    candidates = [
        RenderedTextBox("3.红780→", 1, (35, 80, 748, 99), 0.84),
    ]

    selected = _select_rendered_box("3.红780→", candidates, set(), (331, 112, 377, 121))

    assert selected == (331, 112, 377, 121)


def test_rendered_relocation_preserves_existing_visual_ai_boxes(tmp_path: Path, monkeypatch) -> None:
    old_pages = [{"page": 1, "image": "old.png", "display_rotation": 0}]
    new_pages = [{"page": 1, "image": "new.png", "display_rotation": 0}]
    differences = [
        DifferenceRecord(1, "modified", 1, "old value 1", "new value 1", (10, 10, 60, 22), (12, 10, 58, 22), 0.98, False, "test"),
        DifferenceRecord(2, "modified", 1, "old value 2", "new value 2", (10, 30, 60, 42), (12, 30, 58, 42), 0.98, False, "test"),
    ]
    calls = []

    def fail_if_called(image_path, _page, _ocr):
        calls.append(image_path)
        return [RenderedTextBox("old value 1", 1, (500, 500, 900, 520), 0.99)]

    monkeypatch.setattr(
        "app.services.wire_harness_annotation._rendered_ocr_boxes",
        fail_if_called,
    )

    relocated = relocate_difference_locations_on_rendered_pages(old_pages, new_pages, tmp_path, differences, object())

    assert calls == []
    assert [difference.old_bbox for difference in relocated] == [(10, 10, 60, 22), (10, 30, 60, 42)]
    assert [difference.new_bbox for difference in relocated] == [(12, 10, 58, 22), (12, 30, 58, 42)]


def test_extra_display_rotation_maps_portrait_page_bbox_to_landscape_view() -> None:
    rotated = _apply_extra_display_rotation((100, 185, 120, 205), 90, 595, 842)

    assert rotated == (185, 475, 205, 495)


def test_extra_display_rotation_270_uses_unrotated_page_height() -> None:
    rotated = _apply_extra_display_rotation((359.34, 576.84, 374.685, 663.72), 270, 595.276, 841.89)

    assert rotated == (178.17, 359.34, 265.05, 374.685)


def test_ignores_title_block_region_but_compares_revision_table() -> None:
    old = [
        TextBlock("修订内容/Revision Note New drawing", 1, (500, 20, 700, 40), "pdf_text", 1.0),
        TextBlock("Drawn BY:", 1, (520, 500, 580, 520), "pdf_text", 1.0),
        TextBlock("Zhang", 1, (520, 525, 580, 545), "pdf_text", 1.0),
        TextBlock("Part No.:", 1, (420, 430, 500, 450), "pdf_text", 1.0),
        TextBlock("1.19.02.000238", 1, (540, 430, 650, 450), "pdf_text", 1.0),
        TextBlock("线材 UL1430 20AWG", 1, (10, 100, 150, 115), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("修订内容/Revision Note Changed", 1, (500, 20, 700, 40), "pdf_text", 1.0),
        TextBlock("Drawn BY:", 1, (520, 500, 580, 520), "pdf_text", 1.0),
        TextBlock("Li", 1, (520, 525, 580, 545), "pdf_text", 1.0),
        TextBlock("Part No.:", 1, (420, 430, 500, 450), "pdf_text", 1.0),
        TextBlock("1.19.02.001326", 1, (540, 430, 650, 450), "pdf_text", 1.0),
        TextBlock("连接器 MX3.0-9P", 1, (10, 100, 150, 115), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)
    assert all("Drawn" not in (item.old_text or "") for item in differences)
    assert all("1.19.02" not in (item.old_text or "") + (item.new_text or "") for item in differences)
    assert any("修订内容" in (item.old_text or "") for item in differences)
    assert any(item.old_text == "线材 UL1430 20AWG" for item in differences)


def test_ignores_model_value_inside_title_block_region() -> None:
    old = [
        TextBlock("Description:", 1, (90, 585, 110, 650), "pdf_text", 1.0),
        TextBlock("P15S100A-ZT31569-采样线1-1.1", 1, (110, 600, 125, 750), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("Description:", 1, (90, 585, 110, 650), "pdf_text", 1.0),
        TextBlock("P15S150A-ZT60709-采样线1-1.0", 1, (110, 600, 125, 750), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert differences == []


def test_ignores_title_block_values_when_anchor_labels_are_present() -> None:
    old = [
        TextBlock("Description:", 1, (420, 520, 510, 540), "pdf_text", 1.0),
        TextBlock("6P-700mm-6P-2.5X-1.0", 1, (540, 520, 700, 540), "pdf_text", 1.0),
        TextBlock("Material code:", 1, (420, 550, 520, 570), "pdf_text", 1.0),
        TextBlock("JCL1.19.02.000238", 1, (540, 550, 700, 570), "pdf_text", 1.0),
        TextBlock("4.第四步:全检。", 1, (60, 330, 180, 350), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("Description:", 1, (420, 520, 510, 540), "pdf_text", 1.0),
        TextBlock("6P-700mm-6P-2.5X-1.2", 1, (540, 520, 700, 540), "pdf_text", 1.0),
        TextBlock("Material code:", 1, (420, 550, 520, 570), "pdf_text", 1.0),
        TextBlock("JCL1.19.02.001326", 1, (540, 550, 700, 570), "pdf_text", 1.0),
        TextBlock("4.第四步:打UV胶。", 1, (60, 330, 180, 350), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert [(item.old_text, item.new_text) for item in differences] == [("4.第四步:全检。", "4.第四步:打UV胶。")]


def test_compares_wire_color_table_values_instead_of_treating_them_as_steps() -> None:
    old = [
        TextBlock("1.蓝色460", 1, (500, 338, 512, 377), "pdf_text", 1.0),
        TextBlock("2.棕色555", 1, (490, 338, 501, 377), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("1.蓝色1100", 1, (500, 333, 512, 376), "pdf_text", 1.0),
        TextBlock("2.棕色1150", 1, (490, 334, 501, 376), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert sorted((item.old_text, item.new_text) for item in differences) == [
        ("1.蓝色460", "1.蓝色1100"),
        ("2.棕色555", "2.棕色1150"),
    ]


def test_ignores_signature_values_and_aligns_same_process_step() -> None:
    old = [
        TextBlock("Drawn BY:", 1, (10, 10, 60, 20), "pdf_text", 1.0),
        TextBlock("Zhang Jun", 1, (10, 24, 70, 34), "pdf_text", 1.0),
        TextBlock("1.第一步: 裁线&打端子&上锡", 1, (10, 100, 180, 115), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("Drawn BY:", 1, (10, 10, 60, 20), "pdf_text", 1.0),
        TextBlock("Kris", 1, (10, 24, 70, 34), "pdf_text", 1.0),
        TextBlock("1.第一步: 裁线、打端子、上锡", 1, (10, 100, 180, 115), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)
    assert len(differences) == 1
    assert differences[0].old_text == "Zhang Jun"
    assert differences[0].new_text == "Kris"


def test_title_acknowledgement_region_does_not_hide_wire_uv_annotation() -> None:
    old = [
        TextBlock("Supplier Acknowledgement", 1, (63, 495, 75, 640), "pdf_text", 1.0),
        TextBlock("Customer acknowledges", 1, (63, 667, 75, 795), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("Supplier Acknowledgement", 1, (63, 495, 75, 640), "pdf_text", 1.0),
        TextBlock("Customer acknowledges", 1, (63, 667, 75, 795), "pdf_text", 1.0),
        TextBlock("4 打透明UV胶", 1, (358, 221, 374, 309), "pdf_text", 1.0),
        TextBlock("4 打透明UV胶", 1, (359, 576, 375, 664), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert [item.new_text for item in differences] == ["4 打透明UV胶", "4 打透明UV胶"]


def test_ignores_added_vertical_stamp_signature_date() -> None:
    old: list[TextBlock] = []
    new = [TextBlock("罗昌群 2026/9/3", 1, (260, 307, 272, 397), "pdf_text", 1.0)]

    assert compare_text_blocks(old, new) == []


def test_compares_same_number_process_step_when_content_changes() -> None:
    old = [TextBlock("4.第四步:全检。", 1, (10, 10, 80, 22), "pdf_text", 1.0)]
    new = [TextBlock("4.第四步:打UV胶:透明UV胶水打两面需填充满", 1, (10, 10, 220, 22), "pdf_text", 1.0)]

    differences = compare_text_blocks(old, new)

    assert len(differences) == 1
    assert differences[0].old_text == "4.第四步:全检。"
    assert differences[0].new_text and "打UV胶" in differences[0].new_text


def test_ignores_standalone_title_and_signature_label_fragments() -> None:
    old = [
        TextBlock("Drawn", 1, (10, 10, 40, 20), "pdf_text", 1.0),
        TextBlock("Supplier Acknowledgement", 1, (10, 30, 120, 40), "pdf_text", 1.0),
        TextBlock("Customer acknowledges", 1, (10, 50, 120, 60), "pdf_text", 1.0),
        TextBlock("由 Autodesk 教育版产品制作", 1, (10, 70, 160, 80), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("Approved", 1, (10, 10, 60, 20), "pdf_text", 1.0),
        TextBlock("Checke", 1, (10, 30, 60, 40), "pdf_text", 1.0),
        TextBlock("Supplier Acknowledgement", 1, (10, 50, 120, 60), "pdf_text", 1.0),
        TextBlock("由 Autodesk 教育版产品制作", 1, (10, 70, 160, 80), "pdf_text", 1.0),
    ]

    assert compare_text_blocks(old, new) == []


def test_does_not_extract_title_block_part_values_from_filename(tmp_path: Path) -> None:
    old_path = tmp_path / "1.19.02.000238  6P-700mm-6P-2.5X-1.0.JCL.pdf"
    new_path = tmp_path / "1.19.02.001326  6P-700mm-6P-2.5X-1.2.pdf"
    _make_pdf(old_path, "线束图")
    _make_pdf(new_path, "线束图")

    differences = compare_text_blocks(
        extract_text_blocks(old_path, ocr=None),
        extract_text_blocks(new_path, ocr=None),
    )

    assert differences == []


def test_does_not_cascade_when_text_order_changes() -> None:
    old = [
        TextBlock("线材 UL1430 20AWG", 1, (100, 100, 220, 115), "pdf_text", 1.0),
        TextBlock("长度 900±5", 1, (100, 140, 180, 155), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("长度 900±5", 1, (100, 140, 180, 155), "ocr", 0.9),
        TextBlock("线材 UL1430 20AWG", 1, (100, 100, 220, 115), "ocr", 0.9),
    ]

    assert compare_text_blocks(old, new) == []


def test_difference_numbers_are_contiguous_after_unchanged_process_steps() -> None:
    old = [
        TextBlock("1.第一步: 裁线", 1, (10, 10, 80, 22), "pdf_text", 1.0),
        TextBlock("线材 长度 900±5", 1, (10, 40, 110, 52), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("1.第一步: 裁线", 1, (10, 10, 80, 22), "pdf_text", 1.0),
        TextBlock("连接器 MX3.0", 1, (10, 40, 110, 52), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert [difference.number for difference in differences] == [1]
    assert differences[0].old_text == "线材 长度 900±5"
    assert differences[0].new_text == "连接器 MX3.0"


def test_ignores_pdf_split_fragments_from_same_label() -> None:
    old = [
        TextBlock("紫色", 1, (10, 10, 30, 20), "pdf_text", 1.0),
        TextBlock("700±5", 1, (10, 40, 40, 50), "pdf_text", 1.0),
        TextBlock("T2 3", 1, (100, 100, 130, 110), "pdf_text", 1.0),
        TextBlock(".黄", 1, (100, 120, 130, 130), "pdf_text", 1.0),
    ]
    new = [
        TextBlock("蓝色", 1, (10, 10, 30, 20), "pdf_text", 1.0),
        TextBlock("650±5", 1, (10, 40, 40, 50), "pdf_text", 1.0),
        TextBlock("T2", 1, (300, 300, 320, 310), "pdf_text", 1.0),
        TextBlock("3.黄色B6", 1, (300, 320, 340, 330), "pdf_text", 1.0),
        TextBlock("4.白色B5", 1, (300, 340, 340, 350), "pdf_text", 1.0),
    ]

    differences = compare_text_blocks(old, new)

    assert [(item.old_text, item.new_text) for item in differences] == [("紫色", "蓝色"), ("700±5", "650±5")]


def test_ignores_punctuation_and_isolated_color_fragments() -> None:
    old = [TextBlock(".", 1, (10, 10, 15, 15), "pdf_text", 1.0), TextBlock("色", 1, (20, 10, 30, 20), "pdf_text", 1.0)]
    new: list[TextBlock] = []

    differences = compare_text_blocks(old, new)

    assert differences == []


def test_ocr_uncertain_unmatched_text_is_not_marked_as_difference() -> None:
    old = [TextBlock("UL1430 20AWG 蓝色 L=907±3mm", 1, (10, 10, 180, 25), "pdf_text", 1.0)]
    new = [TextBlock("UL1430 20AWG Lan se L=907±3mm", 1, (10, 10, 180, 25), "ocr", 0.6, True)]

    assert compare_text_blocks(old, new) == []


def test_interactive_report_hides_markers_until_a_difference_is_selected(tmp_path: Path) -> None:
    from PIL import Image

    image_path = tmp_path / "page.png"
    Image.new("RGB", (20, 20), "white").save(image_path)
    report_path = tmp_path / "report.html"
    difference = DifferenceRecord(1, "modified", 1, "旧值", "新值", (10, 10, 30, 30), (10, 10, 30, 30), 1.0, True, "test")

    build_interactive_report(
        report_path,
        "测试图纸",
        [{"page": 1, "image": image_path.name, "width": 40, "height": 40}],
        [{"page": 1, "image": image_path.name, "width": 40, "height": 40}],
        [difference],
    )

    html = report_path.read_text(encoding="utf-8")
    assert ".marker { display: none;" in html
    assert ".highlight { display: none;" in html
    assert "page.bbox_space === 'display'" in html
    assert "background: rgba(254, 202, 202, .18)" in html
    assert "background: rgba(191, 219, 254, .18)" in html
    assert "review-badge" in html
    assert "button.dataset.review" in html
    assert "selectDifference(differences[0].number)" not in html
    assert "classList.add('visible')" in html
    assert "diff-text" not in html
    assert "zoomIn('old')" in html
    assert "pointermove" in html
    assert "wheel" in html
    assert 'class="panel viewer-panel" id="old-panel"' in html
    assert "pointer-events: none;" in html
    assert "event.preventDefault(); dragging = true" in html
    assert "if (!event.ctrlKey) return" in html


def test_interactive_report_navigates_each_side_using_its_own_marker(tmp_path: Path) -> None:
    from PIL import Image

    image_path = tmp_path / "page.png"
    Image.new("RGB", (20, 20), "white").save(image_path)
    report_path = tmp_path / "report.html"
    difference = DifferenceRecord(
        7,
        "modified",
        1,
        "旧位置",
        "新位置",
        (10, 12, 20, 22),
        (70, 82, 90, 92),
        1.0,
        False,
        "test",
    )

    build_interactive_report(
        report_path,
        "左右定位测试",
        [{"page": 1, "image": image_path.name, "width": 40, "height": 40}],
        [{"page": 1, "image": image_path.name, "width": 120, "height": 120}],
        [difference],
    )

    html = report_path.read_text(encoding="utf-8")
    assert "function scrollDifferenceIntoView(side, diff)" in html
    assert "const sideRoot = document.getElementById(side + '-pages')" in html
    assert "['old', 'new'].forEach(side =>" in html
    assert "scrollDifferenceIntoView(side, diff)" in html
    assert "sideRoot.querySelector('.' + side + '-marker[data-number=\"' + diff.number + '\"]')" in html
