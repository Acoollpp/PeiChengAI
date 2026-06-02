const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.join(__dirname, "..");
const repoRoot = path.join(rootDir, "..");
const urlFile = path.join(rootDir, "frontend/data/platform-urls.js");
const dataFile = path.join(rootDir, "frontend/data/site-data.js");
const healthScript = path.join(rootDir, "check-website-health.sh");
const opsDoc = path.join(rootDir, "docs/网站维护与运维说明.md");
const nginxTemplate = path.join(rootDir, "ops/nginx-software-website.conf");
const gitignoreFile = path.join(repoRoot, ".gitignore");
const healthFile = path.join(rootDir, "frontend/healthz");

assert.ok(fs.existsSync(urlFile), "platform URL registry should exist");
assert.ok(fs.existsSync(healthScript), "website health check script should exist");
assert.ok(fs.existsSync(opsDoc), "maintenance operation doc should exist");
assert.ok(fs.existsSync(nginxTemplate), "nginx config template should exist");
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

const health = fs.readFileSync(healthScript, "utf8");
assert.ok(health.includes("platform-urls.js"), "health check should load central URL registry");
assert.ok(health.includes("5174"), "health check should verify website service");
assert.ok(health.includes("nginx"), "health check should report nginx status");

const opsDocText = fs.readFileSync(opsDoc, "utf8");
["正式发布目录", "Nginx", "单点风险", "Git 基线", "平台地址集中维护"].forEach((text) => {
  assert.ok(opsDocText.includes(text), `ops doc should include ${text}`);
});

const nginxTemplateText = fs.readFileSync(nginxTemplate, "utf8");
assert.ok(nginxTemplateText.includes("listen 5174"), "nginx template should keep current public port");
assert.ok(nginxTemplateText.includes("try_files $uri"), "nginx template should serve static health endpoint");
assert.ok(nginxTemplateText.includes("Cache-Control"), "nginx template should include cache policy");
assert.ok(nginxTemplateText.includes("worker_connections 1024"), "nginx template should support higher local concurrency");
assert.ok(!nginxTemplateText.includes("gzip on"), "nginx template should not enable gzip when current nginx was built without gzip module");

const gitignore = fs.readFileSync(gitignoreFile, "utf8");
["software_website/backups/", "software_website/logs/", ".DS_Store"].forEach((text) => {
  assert.ok(gitignore.includes(text), `.gitignore should include ${text}`);
});

console.log("maintenance ops ok");
