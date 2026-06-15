const fs = require("fs");
const os = require("os");
const path = require("path");

const fallbackFlows = {
  create: [
    "获取创建源数据",
    "提取项目字段",
    "判断项目集、模板和项目类别",
    "创建项目空间",
    "创建项目文件夹",
    "规划任务到迭代",
    "裁剪模板任务",
    "任务标题加前缀",
    "填写任务项目工程师",
    "设置需求资料任务",
    "邀请和设置售前",
    "设置项目角色",
    "填写项目概览",
    "回读验收",
    "记录结果"
  ],
  change: [
    "提取项目变更单关键信息",
    "搜索并定位已存在项目",
    "读取项目当前概览字段",
    "解析新项目编号版本号",
    "确认 PCB 沿用或变更",
    "创建新的 PLM 迭代",
    "处理文件夹、任务和项目概览收尾",
    "统一任务标识为 TZ一类审批任务",
    "回查迭代创建结果"
  ]
};

const modeSections = {
  create: ["必须自动执行的步骤", "审批到项目一键流程"],
  change: ["项目变更主流程"]
};

function defaultSkillRoot() {
  return path.join(os.homedir(), ".codex", "skills");
}

function buildModeFlow(modeKey, mode, options = {}) {
  const skillRootDir = options.skillRootDir || defaultSkillRoot();
  const skillNames = mode.skills || [mode.skill].filter(Boolean);
  const steps = [];

  for (const skillName of skillNames) {
    const text = readSkillText(skillRootDir, skillName);
    const parsed = text ? parseSkillSteps(text, { sectionNames: modeSections[modeKey] || [] }) : [];
    const sourceSteps = parsed.length ? parsed : fallbackFlows[modeKey] || [];
    sourceSteps.forEach((label, index) => {
      const cleanLabel = normalizeLabel(label);
      if (!cleanLabel) return;
      steps.push({
        id: makeStepId(skillName, cleanLabel, index + 1),
        label: cleanLabel,
        skill: skillName,
        order: steps.length + 1,
        repairable: true
      });
    });
  }

  return dedupeSteps(steps);
}

function readSkillText(skillRootDir, skillName) {
  const file = path.join(skillRootDir, skillName, "SKILL.md");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function parseSkillSteps(markdown, options = {}) {
  const lines = markdown.split(/\r?\n/);
  const sectionNames = options.sectionNames || [];
  const scoped = collectSectionLines(lines, sectionNames);
  const steps = extractNumberedSteps(scoped.length ? scoped : lines);
  if (steps.length) return steps;
  return extractChecklistSteps(scoped.length ? scoped : lines);
}

function collectSectionLines(lines, sectionNames) {
  if (!sectionNames.length) return [];
  const collected = [];
  let active = false;
  let activeLevel = 0;

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/[#`]/g, "").trim();
      if (active && level <= activeLevel) active = false;
      if (sectionNames.some(name => title.includes(name))) {
        active = true;
        activeLevel = level;
        continue;
      }
    }
    if (active) collected.push(line);
  }

  return collected;
}

function extractNumberedSteps(lines) {
  return lines
    .map(line => line.match(/^\s*(?:\d+\.|第[一二三四五六七八九十百]+步[：:])\s*(.+?)\s*$/))
    .filter(Boolean)
    .map(match => match[1])
    .filter(line => !line.startsWith("例如") && !line.startsWith("示例"));
}

function extractChecklistSteps(lines) {
  return lines
    .map(line => line.match(/^\s*[-*]\s+\[[ xX]\]\s*(.+?)\s*$/))
    .filter(Boolean)
    .map(match => match[1]);
}

function normalizeLabel(label) {
  return String(label || "")
    .replace(/[`*_]/g, "")
    .replace(/[。；;]\s*$/, "")
    .replace(/：.*$/, "")
    .trim()
    .slice(0, 80);
}

function makeStepId(skillName, label, index) {
  const ascii = `${skillName}-${label}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "_")
    .toLowerCase();
  return ascii || `step_${index}`;
}

function dedupeSteps(steps) {
  const seen = new Map();
  return steps.map(step => {
    const count = seen.get(step.id) || 0;
    seen.set(step.id, count + 1);
    return count ? { ...step, id: `${step.id}_${count + 1}` } : step;
  });
}

module.exports = {
  buildModeFlow,
  parseSkillSteps,
  readSkillText
};
