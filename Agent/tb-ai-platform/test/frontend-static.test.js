const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("public/index.html", "utf8");
const js = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /id="loginPanel"/);
assert.match(html, /id="loginKeyInput"/);
assert.match(html, /id="accountName"/);
assert.match(html, /id="logoutBtn"/);
assert.match(html, /id="workspace"/);
assert.match(html, /id="flowSteps"/);
assert.match(html, /id="flowSummary"/);
assert.match(html, /id="historyList"/);
assert.match(html, /id="historyStats"/);
assert.match(html, /id="aiTestBtn"/);
assert.match(html, /id="projectUrlInput"/);
assert.match(html, /id="projectUrlField"/);
assert.match(html, /id="resultPanel"/);
assert.match(html, /id="resultList"/);
assert.match(html, /id="runTimer"/);
assert.match(html, /AI测试创建/);
assert.match(html, /项目地址/);
assert.doesNotMatch(html, /审批查询/);
assert.doesNotMatch(html, /id="output"/);
assert.doesNotMatch(html, /<pre\b/i);

assert.match(cssText(), /\[hidden\][^{]*{[^}]*display:\s*none\s*!important/i);
assert.match(cssText(), /button\.clicked/);
assert.match(cssText(), /@keyframes clickPulse/);
assert.match(cssText(), /\.history-links/);
assert.match(cssText(), /\.run-timer/);
assert.ok(js.includes('fetch("/api/me"'));
assert.ok(js.includes('fetch("/api/login"'));
assert.ok(js.includes('fetch("/api/logout"'));
assert.ok(js.includes('fetch("/api/flows"'));
assert.ok(js.includes('fetch("/api/repair"'));
assert.ok(js.includes('/api/history?mode='));
assert.ok(js.includes("state.activeItems"));
assert.ok(js.includes("resultsByMode"));
assert.ok(js.includes("historyStatsByMode"));
assert.ok(js.includes("aiTest: true"));
assert.ok(js.includes("body: JSON.stringify({ mode: state.mode, message, projectUrl, aiTest })"));
assert.ok(js.includes("continueAfterRepair: true"));
assert.ok(js.includes('el.projectUrlField.hidden = mode === "create"'));
assert.ok(js.includes('event.type === "result" || event.type === "run_error"'));
assert.ok(js.includes("function flashButton"));
assert.ok(js.includes("flashButton(event.currentTarget)"));
assert.ok(js.includes("renderFlowSteps"));
assert.ok(js.includes("consumeNdjson"));
assert.ok(js.includes("formatDuration"));
assert.ok(js.includes("startTimer"));
assert.match(js, /项目变更请粘贴项目地址/);
assert.doesNotMatch(js, /Authorization/);
assert.doesNotMatch(js, /appendOutput/);
assert.doesNotMatch(js, /event\.type === "stdout"/);
assert.doesNotMatch(js, /event\.type === "stderr"/);
assert.ok(!js.includes('localStorage.setItem("tbAiToken"'));

console.log("ok - frontend has login state and flow panel without token or console output storage");

function cssText() {
  return fs.readFileSync("public/styles.css", "utf8");
}
