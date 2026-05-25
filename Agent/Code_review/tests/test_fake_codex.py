from pathlib import Path

from tools.fake_codex import extract_report_path, write_fake_report


def test_extract_report_path_reads_chinese_prompt_line():
    prompt = """
    - 项目路径：https://example.test/svn/project
    - 报告输出路径：C:\\tmp\\codex-report.md
    """

    assert extract_report_path(prompt) == Path("C:\\tmp\\codex-report.md")


def test_extract_report_path_tolerates_windows_question_mark_mojibake():
    prompt = "- ???????C:\\tmp\\codex-report.md"

    assert extract_report_path(prompt) == Path("C:\\tmp\\codex-report.md")


def test_write_fake_report_creates_parent_directory(tmp_path):
    report_path = tmp_path / "nested" / "report.md"

    write_fake_report(report_path)

    assert report_path.exists()
    assert "# Fake Codex 审查报告" in report_path.read_text(encoding="utf-8")
