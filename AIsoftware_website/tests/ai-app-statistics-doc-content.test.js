const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/ai-app-statistics.html");
const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "AI 应用统计管理平台",
  "软件部已上线的内部 AI 应用运营看板",
  "平台实际效果",
  "应用使用情况可视化",
  "部门覆盖一目了然",
  "运营复盘有数据支撑",
  "适用对象",
  "功能展示",
  "平台截图",
  "应用总览",
  "使用趋势分析",
  "部门覆盖分析",
  "运营报表沉淀",
  "GPT 额度总览",
  "可用性与延迟健康状态",
  "使用统计",
  "访问与使用",
  "常见问题",
  "建设说明",
  'data-platform-url="aiStatistics"',
  "../assets/ai-statistics-overview.jpg",
  "../assets/ai-statistics-gpt-quota.jpg",
  "../assets/ai-statistics-health.jpg",
  "../assets/ai-statistics-usage.jpg",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required statistics doc text: ${text}`);
});

const removedText = [
  "故障排查",
  "确认网络、端口和平台服务是否正常",
  "它解决的是",
];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `removed ops-heavy statistics doc text should not appear: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "statistics doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "statistics doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "statistics doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "statistics doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "statistics doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "statistics doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "statistics doc should include screenshot grid");

[
  "../frontend/assets/ai-statistics-overview.jpg",
  "../frontend/assets/ai-statistics-gpt-quota.jpg",
  "../frontend/assets/ai-statistics-health.jpg",
  "../frontend/assets/ai-statistics-usage.jpg",
].forEach((assetPath) => {
  assert.ok(fs.existsSync(path.join(__dirname, assetPath)), `missing statistics screenshot asset: ${assetPath}`);
});

console.log("ai app statistics doc content ok");
