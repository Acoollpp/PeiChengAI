const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dataFile = path.join(__dirname, "../frontend/data/site-data.js");
const urlFile = path.join(__dirname, "../frontend/data/platform-urls.js");
const context = { window: {} };

vm.createContext(context);
vm.runInContext(fs.readFileSync(urlFile, "utf8"), context);
vm.runInContext(fs.readFileSync(dataFile, "utf8"), context);

const platforms = Array.from(context.window.siteData.projects).filter((item) => item.status === "platform");
const platformTitles = Array.from(platforms.map((item) => item.title));

assert.deepEqual(platformTitles, [
  "API 管理平台",
  "Openclaw 智能体监控平台",
  "代码审查平台",
  "AI 应用统计管理平台",
  "GPT 账号管理平台",
]);

assert.equal(platforms.length, 5);
assert.deepEqual(platformTitles.slice(0, 2), ["API 管理平台", "Openclaw 智能体监控平台"]);
assert.ok(platforms.every((item) => item.statusText === "智能体应用"));
assert.deepEqual(
  platforms.map((item) => [item.title, item.stage]),
  [
    ["API 管理平台", "已上线"],
    ["Openclaw 智能体监控平台", "已上线"],
    ["代码审查平台", "试点中"],
    ["AI 应用统计管理平台", "已上线"],
    ["GPT 账号管理平台", "已上线"],
  ],
);
assert.equal(platforms[0].link, "http://172.23.17.242:8090/");

const openclawPlatform = platforms.find((item) => item.title === "Openclaw 智能体监控平台");
assert.ok(openclawPlatform, "Openclaw 智能体监控平台 should exist");
assert.deepEqual(
  Array.from(openclawPlatform.links || []).map((item) => [item.label, item.url]),
  [
    ["开发专用平台", "http://172.23.17.79:9181/"],
    ["其他部门专用平台", "http://172.23.17.190:9181/"],
  ],
);

const statisticsPlatform = platforms.find((item) => item.title === "AI 应用统计管理平台");
assert.ok(statisticsPlatform, "AI 应用统计管理平台 should exist");
assert.equal(statisticsPlatform.link, "http://172.24.21.3:8080/");
assert.equal(statisticsPlatform.docLink, "docs/ai-app-statistics.html");

const codeReviewPlatform = platforms.find((item) => item.title === "代码审查平台");
assert.ok(codeReviewPlatform, "代码审查平台 should exist");
assert.equal(codeReviewPlatform.link, "http://172.23.17.242:5174/");
assert.equal(codeReviewPlatform.docLink, "docs/code-review-platform.html");
assert.deepEqual(
  Array.from(codeReviewPlatform.links || []).map((item) => [item.label, item.url]),
  [
    ["看板平台", "http://172.23.17.242:5174/"],
    ["客户端下载", "download/AI代码审查客户端-v1.3.4.exe.zip"],
  ],
);

const gptAccountPlatform = platforms.find((item) => item.title === "GPT 账号管理平台");
assert.ok(gptAccountPlatform, "GPT 账号管理平台 should exist");
assert.equal(gptAccountPlatform.link, "http://172.23.17.242:8080/");
assert.equal(gptAccountPlatform.docLink, "docs/gpt-account-platform.html");

const awkwardWrapPhrases = ["运行质量监控", "代码评审效率", "资源分配"];
platforms.forEach((item) => {
  const cardText = [item.description, item.entry, item.result].join(" ");
  awkwardWrapPhrases.forEach((phrase) => {
    assert.ok(!cardText.includes(phrase), `${item.title} card copy should avoid likely orphan phrase: ${phrase}`);
  });
});

console.log("platform data ok");
