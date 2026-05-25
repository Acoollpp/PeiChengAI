import json
import subprocess
import textwrap
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run_render_markdown(markdown: str) -> str:
    script = textwrap.dedent(
        """
        const fs = require("fs");
        const vm = require("vm");

        const source = fs.readFileSync("static/app.js", "utf8");
        const context = {
          document: {
            querySelector() {
              return { addEventListener() {}, classList: { toggle() {} } };
            },
          },
          window: { setTimeout() {}, clearTimeout() {} },
          fetch() {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
          },
          FormData: class {},
          console,
        };
        vm.createContext(context);
        vm.runInContext(source, context);
        const rendered = context.renderMarkdown(JSON.parse(process.argv[1]));
        process.stdout.write(Buffer.from(rendered, "utf8").toString("base64"));
        """
    )
    result = subprocess.run(
        ["node", "-e", script, json.dumps(markdown)],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return __import__("base64").b64decode(result.stdout).decode("utf-8")


def test_markdown_preview_renders_common_report_markdown():
    html = run_render_markdown(
        "# 标题\n\n"
        "| 字段 | 值 |\n"
        "|---|---|\n"
        "| 结果 | **通过** |\n\n"
        "- 第一项\n"
        "- 第二项\n\n"
        "1. 步骤一\n"
        "2. 步骤二\n\n"
        "```python\n"
        "print('ok')\n"
        "```\n\n"
        "`inline`"
    )

    assert "<table>" in html
    assert "<th>字段</th>" in html
    assert "<strong>通过</strong>" in html
    assert "<ul>" in html
    assert "<ol>" in html
    assert "<pre><code" in html
    assert "<code>inline</code>" in html
    assert "| 字段 | 值 |" not in html
    assert "```python" not in html


def test_markdown_preview_uses_fixed_scroll_region():
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    preview_block = css[css.index(".markdown-preview {") : css.index(".markdown-preview h1")]

    assert "height: 100%" in preview_block
    assert "min-height: 0" in preview_block
    assert "overflow: auto" in preview_block
    assert "min-height: 420px" not in preview_block


def test_report_panel_actions_align_to_preview_bottom():
    css = (PROJECT_ROOT / "static" / "styles.css").read_text(encoding="utf-8")
    workbench_block = css[css.index(".review-workbench {") : css.index(".left-rail {")]
    right_stage_block = css[css.index(".right-stage {") : css.index(".panel {")]
    panel_block = css[css.index(".preview-panel {") : css.index(".panel-heading p")]
    preview_block = css[css.index(".markdown-preview {") : css.index(".markdown-preview h1")]
    actions_block = css[css.index(".report-actions {") : css.index("@keyframes panel-enter")]

    assert "align-items: stretch" in workbench_block
    assert "display: grid" in right_stage_block
    assert "  height: calc(100dvh - 190px);" in panel_block
    assert "min-height: calc(100dvh - 190px)" not in panel_block
    assert "grid-template-rows: auto auto minmax(0, 1fr) auto" in panel_block
    assert "align-self: stretch" in preview_block
    assert "align-self: end" in actions_block
