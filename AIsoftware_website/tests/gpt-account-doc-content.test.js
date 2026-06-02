const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/gpt-account-platform.html");
const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "GPT 账号管理平台",
  'data-platform-url="gptAccount"',
  "基于 Sub2API 搭建的内部 GPT 能力接入与账号治理平台",
  "平台实际效果",
  "订阅能力统一接入",
  "API Key 分发更清晰",
  "用量统计支撑治理",
  "适用对象",
  "功能展示",
  "账号池管理",
  "API Key 管理",
  "额度与用量追踪",
  "调度与访问控制",
  "平台截图",
  "仪表盘总览",
  "使用记录分析",
  "分组管理",
  "运维监控",
  "gpt-account-dashboard.jpg",
  "gpt-account-usage.jpg",
  "gpt-account-groups.jpg",
  "gpt-account-ops.jpg",
  "访问与使用",
  "常见问题",
  "建设说明",
  "Wei-Shaw/sub2api",
  "AI API 网关平台",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required GPT account doc text: ${text}`);
});

const removedText = [
  "核心概念",
  "故障排查",
  "确认网络、端口和平台服务是否正常",
  "账号治理的重点是可见、可控、可追溯",
];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `removed GPT account doc text should not appear: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "GPT account doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "GPT account doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "GPT account doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "GPT account doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "GPT account doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "GPT account doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "GPT account doc should include screenshot grid");

console.log("gpt account doc content ok");
