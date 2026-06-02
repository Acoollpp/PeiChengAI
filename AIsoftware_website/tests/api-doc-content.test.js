const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/ai-account-platform.html");
const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "API 管理平台",
  "软件部已部署的内部 API 资源管理入口",
  "平台实际效果",
  "账号资源集中管理",
  "API 调用情况可视化",
  "使用数据支撑治理",
  "适用对象",
  "功能展示",
  "平台截图",
  "仪表盘总览",
  "账号与凭证管理",
  "供应商与模型管理",
  "调用统计与趋势",
  "系统设置",
  "可用性监控",
  "访问与使用",
  "常见问题",
  "建设说明",
  "ding113/claude-code-hub",
  "https://github.com/ding113/claude-code-hub",
  "Next.js 15",
  "Hono",
  "PostgreSQL",
  "Redis",
  "Docker Compose",
  'data-platform-url="apiManagement"',
  "../assets/api-management-dashboard.jpg",
  "../assets/api-management-provider.jpg",
  "../assets/api-management-availability.jpg",
  "../assets/api-management-settings.jpg",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required doc text: ${text}`);
});

const removedText = [
  "部署指南",
  "一键脚本部署",
  "Docker Compose 部署",
  "docker compose up -d",
  "docker compose logs -f app",
  "Admin Token",
  "以下截图用于展示平台主要功能区域",
  "图片已按文档布局压缩展示",
];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `removed deployment-oriented doc text should not appear: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "doc should include a sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "doc should include an on-page toc");
assert.ok(html.includes('class="doc-callout"'), "doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "doc should include flow cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "doc should include screenshot grid");

[
  "../frontend/assets/api-management-dashboard.jpg",
  "../frontend/assets/api-management-provider.jpg",
  "../frontend/assets/api-management-availability.jpg",
  "../frontend/assets/api-management-settings.jpg",
].forEach((assetPath) => {
  assert.ok(fs.existsSync(path.join(__dirname, assetPath)), `missing screenshot asset: ${assetPath}`);
});

console.log("api doc content ok");
