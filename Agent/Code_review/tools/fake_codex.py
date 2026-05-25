from __future__ import annotations

import sys
from pathlib import Path


REPORT_PATH_PREFIX = "- 报告输出路径："
WINDOWS_MOJIBAKE_PREFIX = "- ???????"


def extract_report_path(prompt: str) -> Path:
    for line in prompt.splitlines():
        stripped = line.strip()
        if stripped.startswith(REPORT_PATH_PREFIX):
            value = stripped.removeprefix(REPORT_PATH_PREFIX).strip()
            if value:
                return Path(value)
        if stripped.startswith(WINDOWS_MOJIBAKE_PREFIX):
            value = stripped.removeprefix(WINDOWS_MOJIBAKE_PREFIX).strip()
            if value:
                return Path(value)
    raise ValueError(f"prompt must contain '{REPORT_PATH_PREFIX}<path>'")


def write_fake_report(report_path: Path) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        "\n".join(
            [
                "# Fake Codex 审查报告",
                "",
                "本报告由 `tools/fake_codex.py` 生成，用于本地冒烟验证。",
                "",
                "- 结果：通过",
                "- 说明：未连接真实 Codex 或 SVN。",
                "",
            ]
        ),
        encoding="utf-8",
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print('Usage: python tools/fake_codex.py "- 报告输出路径：<path>"', file=sys.stderr)
        return 2

    try:
        report_path = extract_report_path(argv[1])
        write_fake_report(report_path)
    except Exception as exc:
        print(f"fake codex failed: {exc}", file=sys.stderr)
        return 1

    print(f"fake codex wrote report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
