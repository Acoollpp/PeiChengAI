const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../frontend");
const html = fs.readFileSync(path.join(frontendDir, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");

assert.ok(html.includes("将业务需求转化为可评估、可实施、可跟踪的 AI 应用方案"), "request section should use more formal headline");
assert.ok(html.includes("请准备业务场景、流程痛点、涉及系统、用户范围、期望上线时间和衡量指标。"), "request section should use formal preparation copy");
assert.ok(!html.includes("系统集成等。"), "request service copy should avoid orphan ending");
assert.ok(!html.includes("把业务想法转成可评估、可排期的 AI 需求"), "request section should not use casual headline");
assert.ok(html.includes("request-contact-card"), "request section should include refined contact card");
assert.ok(html.includes('href="contact.html"'), "request section should link to contact detail page");
assert.ok(html.includes(">需求对接</a>"), "request section should show demand docking entry");
assert.ok(!html.includes("查看对接人名片"), "request section should not use contact-card wording");
assert.ok(!html.includes('src="assets/contact-card.jpeg"'), "home page should not show DingTalk contact card image directly");

const contactHtml = fs.readFileSync(path.join(frontendDir, "contact.html"), "utf8");
assert.ok(contactHtml.includes('src="assets/contact-card.jpeg"'), "contact page should show DingTalk contact card image");
assert.ok(contactHtml.includes('alt="软件部 AI 对接人钉钉名片"'), "contact card image should have descriptive alt text on contact page");

assert.ok(styles.includes(".request-section::before"), "request section should include refined background layer");
assert.ok(styles.includes("background: #f5f8fb;"), "request section should use a softer background");
assert.ok(styles.includes(".request-contact-card"), "request contact card styles should exist");
assert.ok(styles.includes(".request-contact .button.light"), "request contact entry should have a framed button style");
assert.ok(styles.includes(".contact-page"), "contact page styles should exist");
assert.ok(styles.includes(".contact-card-image"), "DingTalk card image styles should exist");

console.log("request section ok");
