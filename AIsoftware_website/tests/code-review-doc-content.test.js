const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/code-review-platform.html");
const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "代码审查平台",
  "软件部试点中的内部代码审查辅助平台",
  "后续代码审查平台会根据试点反馈进行更新推送",
  "平台实际效果",
  "提交前风险提示",
  "审查建议辅助修改",
  "使用情况可统计",
  "适用对象",
  "功能展示",
  "平台截图",
  "客户端登录",
  "客户端审查界面",
  "统计平台用户管理",
  "统计平台任务管理",
  "下载客户端",
  "AI代码审查客户端-v1.3.4.exe.zip",
  "../download/AI代码审查客户端-v1.3.4.exe.zip",
  "访问与使用",
  "常见问题",
  "建设说明",
  'data-platform-url="codeReview"',
  "../assets/code-review-client-login.png",
  "../assets/code-review-client-main.png",
  "../assets/code-review-dashboard-users.png",
  "../assets/code-review-dashboard-tasks.png",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required code review doc text: ${text}`);
});

const removedText = ["看板尚未部署", "后续补充正式内网地址", "故障排查"];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `removed code review doc text should not appear: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "code review doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "code review doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "code review doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "code review doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "code review doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "code review doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "code review doc should include screenshot grid");

[
  "../frontend/assets/code-review-client-login.png",
  "../frontend/assets/code-review-client-main.png",
  "../frontend/assets/code-review-dashboard-users.png",
  "../frontend/assets/code-review-dashboard-tasks.png",
].forEach((assetPath) => {
  assert.ok(fs.existsSync(path.join(__dirname, assetPath)), `missing code review screenshot asset: ${assetPath}`);
});

console.log("code review doc content ok");
