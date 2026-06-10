const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.join(__dirname, "..");
const repoRoot = path.join(rootDir, "..");
const urlFile = path.join(rootDir, "frontend/data/platform-urls.js");
const dataFile = path.join(rootDir, "frontend/data/site-data.js");
const previewScript = path.join(rootDir, "start-mac-preview.sh");
const gitignoreFile = path.join(repoRoot, ".gitignore");
const healthFile = path.join(rootDir, "frontend/healthz");

assert.ok(fs.existsSync(urlFile), "platform URL registry should exist");
assert.ok(fs.existsSync(previewScript), "portable preview script should exist");
assert.equal(fs.readFileSync(healthFile, "utf8").trim(), "ok", "static health endpoint should exist");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(urlFile, "utf8"), context);
vm.runInContext(fs.readFileSync(dataFile, "utf8"), context);

assert.ok(context.window.platformUrls, "platformUrls should be exposed on window");
assert.equal(context.window.platformUrls.apiManagement, "http://172.23.17.242:8090/");
assert.equal(context.window.platformUrls.openclawDev, "http://172.23.17.79:9181/");
assert.equal(context.window.platformUrls.openclawDepartment, "http://172.23.17.190:9181/");
assert.equal(context.window.platformUrls.aiStatistics, "http://172.24.21.3:8080/");
assert.equal(context.window.platformUrls.gptAccount, "http://172.23.17.242:8080/");

const platforms = context.window.siteData.projects.filter((item) => item.status === "platform");
const openclaw = platforms.find((item) => item.title === "Openclaw 智能体监控平台");
assert.equal(platforms.find((item) => item.title === "API 管理平台").link, context.window.platformUrls.apiManagement);
assert.equal(openclaw.link, context.window.platformUrls.openclawDev);
assert.equal(openclaw.links[0].url, context.window.platformUrls.openclawDev);
assert.equal(openclaw.links[1].url, context.window.platformUrls.openclawDepartment);
assert.equal(platforms.find((item) => item.title === "AI 应用统计管理平台").link, context.window.platformUrls.aiStatistics);
assert.equal(platforms.find((item) => item.title === "GPT 账号管理平台").link, context.window.platformUrls.gptAccount);

const previewScriptText = fs.readFileSync(previewScript, "utf8");
assert.ok(previewScriptText.includes("python3 -m http.server"), "preview script should use portable Python static server");
assert.ok(previewScriptText.includes("frontend"), "preview script should serve the frontend directory");

const gitignore = fs.readFileSync(gitignoreFile, "utf8");
[
  ".DS_Store",
  "AIsoftware_website/check-website-health.sh",
  "AIsoftware_website/sync-and-restart-service.sh",
  "AIsoftware_website/ops/",
].forEach((text) => {
  assert.ok(gitignore.includes(text), `.gitignore should include ${text}`);
});

console.log("maintenance ops ok");
