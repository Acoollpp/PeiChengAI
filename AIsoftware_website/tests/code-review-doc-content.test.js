const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/code-review-platform.html");
assert.ok(fs.existsSync(docFile), "code review platform doc should exist");

const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "代码审查平台",
  "软件部试点中的内部代码审查辅助平台",
  "试点中内部平台",
  "平台实际效果",
  "提交前风险提示",
  "审查建议辅助修改",
  "使用情况可统计",
  "适用对象",
  "功能展示",
  "本地客户端使用",
  "代码审查结果",
  "提交前辅助检查",
  "统计看板查看",
  "平台截图",
  "客户端登录界面",
  "客户端审查界面",
  "统计平台用户管理",
  "统计平台任务管理",
  "访问与使用",
  "下载客户端",
  "访问代码审查看板",
  "AI代码审查客户端-v1.3.4.exe.zip",
  "常见问题",
  "建设说明",
  "../assets/code-review-client-login.png",
  "../assets/code-review-client-main.png",
  "../assets/code-review-dashboard-users.png",
  "../assets/code-review-dashboard-tasks.png",
  "../download/AI代码审查客户端-v1.3.4.exe.zip",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required code review doc text: ${text}`);
});

const removedText = ["安装包：待更新", "统计平台地址：待补充", "平台截图展示"];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `placeholder text should not remain: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "code review doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "code review doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "code review doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "code review doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "code review doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "code review doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "code review doc should include screenshot grid");
assert.ok(html.includes(`../data/platform-urls.js?v=20260610-recent-updates-1`), "doc should load URL registry");
assert.ok(html.includes(`../script.js?v=20260610-recent-updates-1`), "doc should run shared scripts");
assert.ok(html.includes('data-platform-url="codeReview"'), "doc should hydrate dashboard URL");

[
  "../frontend/assets/code-review-client-login.png",
  "../frontend/assets/code-review-client-main.png",
  "../frontend/assets/code-review-dashboard-users.png",
  "../frontend/assets/code-review-dashboard-tasks.png",
].forEach((assetPath) => {
  const fullPath = path.join(__dirname, assetPath);
  assert.ok(fs.existsSync(fullPath), `missing code review asset: ${assetPath}`);
  assert.ok(fs.statSync(fullPath).size > 0, `code review asset should not be empty: ${assetPath}`);
});

console.log("code review doc content ok");
