const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");

const contactHtml = fs.readFileSync(path.join(frontendDir, "contact.html"), "utf8");

assert.ok(contactHtml.includes("<h1>联系软件部 AI 对接人</h1>"), "contact page should return to static DingTalk contact title");
assert.ok(
  contactHtml.includes("如需确认 AI 应用场景、方案边界、评估流程或排期方式，请通过钉钉名片发起沟通。"),
  "contact page should use static contact guidance"
);
assert.ok(contactHtml.includes("contact-page-grid"), "contact page should use the static two-column contact layout");
assert.ok(contactHtml.includes('src="assets/contact-card.jpeg"'), "contact page should show DingTalk contact card");
assert.ok(contactHtml.includes('alt="软件部 AI 对接人钉钉名片"'), "contact card image should keep descriptive alt text");
assert.ok(contactHtml.includes('href="tools.html"'), "contact page should keep current efficiency tools navigation");
assert.ok(contactHtml.includes(">提效工具库</a>"), "contact page should keep current efficiency tools nav label");

[
  'id="feedbackForm"',
  "admin-feedback.html",
  "查看需求统计",
  "提交需求",
  "填写需求信息",
  "feedback.js",
  "contact-submit-grid",
  "imageUploadZone",
  "feedbackMessage",
].forEach((text) => {
  assert.ok(!contactHtml.includes(text), `contact page should not include website feedback backend UI: ${text}`);
});

assert.ok(!fs.existsSync(path.join(frontendDir, "admin-feedback.html")), "admin feedback page should not be published with the static website");
assert.ok(!fs.existsSync(path.join(frontendDir, "feedback.js")), "feedback backend script should not be published with the static website");

console.log("contact static page ok");
