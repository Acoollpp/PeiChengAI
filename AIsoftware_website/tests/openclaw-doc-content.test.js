const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docFile = path.join(__dirname, "../frontend/docs/openclaw-dingtalk.html");
const html = fs.readFileSync(docFile, "utf8");

const requiredText = [
  "Openclaw 智能体监控平台",
  "软件部围绕钉钉智能体建设的内部运行看板",
  "基于 Openclaw 开发了钉钉智能体能力",
  "平台实际效果",
  "运行状态集中观测",
  "Agent 状态",
  "使用中 / 空闲中",
  "扫码登录",
  "dws token",
  "每 60 秒刷新一次状态",
  "常用指令",
  "平台截图",
  "软件部专用看板",
  "其他部门专用看板",
  "钉钉端机器人",
  "钉钉端对话效果",
  "文档写作",
  "数据分析",
  "消息邮件",
  "会议日程",
  "信息查询",
  "任务管理",
  "部署情况",
  "软件部",
  "其他部门",
  "5 个（主控、助理、AI应用、主任助理、CPA监控）",
  "14 个（龚总监助理、张经理助理等）",
  "适用对象",
  "功能概览",
  "任务状态看板",
  "钉钉智能体运行复盘",
  "访问与使用",
  "开发专用平台",
  'data-platform-url="openclawDev"',
  "其他部门专用平台",
  'data-platform-url="openclawDepartment"',
  "常见问题",
  "建设说明",
  "Openclaw",
  "钉钉智能体",
  "../assets/openclaw-monitor-dev.jpg",
  "../assets/openclaw-monitor-department.jpg",
  "../assets/openclaw-dingtalk-bot.png",
  "../assets/openclaw-dingtalk-effect.png",
];

requiredText.forEach((text) => {
  assert.ok(html.includes(text), `missing required Openclaw doc text: ${text}`);
});

const removedText = [
  "这不是普通展示页",
  "看板定位",
  "该平台不是单纯的展示页",
  "以下截图用于展示平台主要功能区域",
  "图片已按文档布局压缩展示",
  "本机 Mac",
  "远端 Mac",
  "两台 Mac",
  "稳定可用",
  "软件部 AI 对接人排查",
  "常用指令复制后效果不符合预期",
  "支撑钉钉智能体的运行管理和持续优化",
  "运行状态管理",
  "智能问答等场景",
  "故障排查",
  "确认网络、端口、服务进程",
  "先区分入口",
  "http://172.23.17.108:9181/",
  "http://172.23.17.169:9181/",
];

removedText.forEach((text) => {
  assert.ok(!html.includes(text), `removed ops-heavy Openclaw doc text should not appear: ${text}`);
});

assert.ok(html.includes('class="docs-shell"'), "Openclaw doc should use docs-shell layout");
assert.ok(html.includes('class="docs-sidebar"'), "Openclaw doc should include sidebar navigation");
assert.ok(html.includes('class="docs-toc"'), "Openclaw doc should include page toc");
assert.ok(html.includes('class="doc-callout"'), "Openclaw doc should include callouts");
assert.ok(html.includes('class="doc-flow"'), "Openclaw doc should include flow cards");
assert.ok(html.includes('class="doc-grid-3"'), "Openclaw doc should include outcome cards");
assert.ok(html.includes('class="doc-screenshot-grid"'), "Openclaw doc should include screenshot grid");

[
  "../frontend/assets/openclaw-monitor-dev.jpg",
  "../frontend/assets/openclaw-monitor-department.jpg",
  "../frontend/assets/openclaw-dingtalk-bot.png",
  "../frontend/assets/openclaw-dingtalk-effect.png",
].forEach((assetPath) => {
  assert.ok(fs.existsSync(path.join(__dirname, assetPath)), `missing Openclaw screenshot asset: ${assetPath}`);
});

console.log("openclaw doc content ok");
