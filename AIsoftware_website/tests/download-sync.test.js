const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.join(__dirname, "..");
const legacyApiConfigFile = path.join(projectDir, "frontend/download/一键配置api.rar");
const legacyCodeReviewClientFile = path.join(projectDir, "frontend/download/代码审查-v1.0.0-beat4.exe.zip");
const repoRoot = path.join(projectDir, "..");
const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const siteData = fs.readFileSync(path.join(projectDir, "frontend/data/site-data.js"), "utf8");
const codeReviewDoc = fs.readFileSync(path.join(projectDir, "frontend/docs/code-review-platform.html"), "utf8");
const quickStartDoc = fs.readFileSync(path.join(projectDir, "frontend/docs/quick-start.html"), "utf8");
const utf8ToolDoc = fs.readFileSync(path.join(projectDir, "frontend/docs/utf8-encoding-tool.html"), "utf8");

assert.ok(!fs.existsSync(legacyApiConfigFile), "legacy one-click API config archive should be cleaned from frontend/download/");
assert.ok(!fs.existsSync(legacyCodeReviewClientFile), "legacy code review client archive should be cleaned from frontend/download/");
assert.ok(gitignore.includes("AIsoftware_website/frontend/download/*.rar"), "RAR download archives should stay local-only");
assert.ok(gitignore.includes("AIsoftware_website/frontend/download/*.zip"), "ZIP download archives should stay local-only");
assert.ok(siteData.includes("download/一键配置api_v2.rar"), "site data should keep one-click API download link");
assert.ok(siteData.includes("download/AI代码审查客户端-v1.3.4.exe.zip"), "site data should keep code review client download link");
assert.ok(siteData.includes("download/文件编码格式转UTF-8工具.rar"), "site data should keep UTF-8 tool download link");
assert.ok(codeReviewDoc.includes("../download/AI代码审查客户端-v1.3.4.exe.zip"), "code review doc should keep client download link");
assert.ok(quickStartDoc.includes("../download/一键配置api_v2.rar"), "quick start doc should keep one-click API download link");
assert.ok(utf8ToolDoc.includes("../download/文件编码格式转UTF-8工具.rar"), "UTF-8 doc should keep tool download link");

console.log("download sync ok");
