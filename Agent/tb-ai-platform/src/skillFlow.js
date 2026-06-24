const fs = require("fs");
const os = require("os");
const path = require("path");

const fallbackFlows = {
  create: [
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
    "从用户提供的项目地址定位项目",
    "读取项目当前概览字段",
    "解析新项目编号版本号",
    "确认 PCB 沿用或变更",
    "创建新的 PLM 迭代",
    "处理文件夹、任务和项目概览收尾",
    "统一任务标识为 TZ一类审批任务",
    "回查迭代创建结果"
  ],
  researchCreate: [
    "提取研发项目字段",
    "提取基础项目信息和规格需求",
    "派生项目编号参数",
    "判断研发项目集、模板和项目类别",
    "创建研发项目空间",
    "创建研发项目迭代",
    "创建研发项目文件夹",
    "创建和规划研发任务",
    "设置研发任务标题前缀",
    "设置项目成员和角色",
    "填写项目概览",
    "回读验收",
    "记录结果"
  ]
};

const platformGuardFlows = {
  change: [
    "校验完整 PCB 号优先保留",
    "校验售前工程师等于审批提交人",
    "校验原迭代任务截止时间不早于 2025-10-01",
    "校验任务标识为 TZ一类审批任务",
    "校验需求资料时间和计划工时",
    "回查完整 PCB 迭代、文件夹、概览、任务标识和任务字段"
  ]
};

const modeSections = {
  create: ["必须自动执行的步骤", "审批到项目一键流程"],
  change: ["项目变更主流程"],
  researchCreate: ["必须自动执行的步骤"]
};

const skipPatterns = {
  create: [/获取创建源数据/, /审批.*查找/, /截图.*字段/, /回查审批详情/],
  change: [/截图/, /审批.*查找/],
  researchCreate: [/获取研发立项源数据/, /回查钉钉审批详情/]
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
      const cleanLabel = normalizeLabel(adaptStepLabel(modeKey, label));
      if (!cleanLabel) return;
      if (shouldSkipStep(modeKey, cleanLabel)) return;
      steps.push({
        id: makeStepId(skillName, cleanLabel, index + 1),
        label: cleanLabel,
        skill: skillName,
        order: steps.length + 1,
        repairable: true
      });
    });
  }

  for (const label of platformGuardFlows[modeKey] || []) {
    if (steps.some(step => step.label === label || isSemanticDuplicate(modeKey, step.label, label))) continue;
    steps.push({
      id: makeStepId("platform", label, steps.length + 1),
      label,
      skill: "平台流程校验",
      order: steps.length + 1,
      repairable: true
    });
  }

  return dedupeSteps(steps);
}

function isSemanticDuplicate(modeKey, existingLabel, guardLabel) {
  if (modeKey !== "change") return false;
  const existing = String(existingLabel || "");
  const guard = String(guardLabel || "");
  if (guard.includes("原迭代任务截止时间") && existing.includes("原迭代任务截止时间") && existing.includes("2025-10-01")) return true;
  if (guard.includes("任务标识") && existing.includes("任务标识必须统一") && existing.includes("TZ一类审批任务")) return true;
  return false;
}

function adaptStepLabel(modeKey, label) {
  const value = String(label || "");
  if (modeKey === "change" && /搜索.*项目|项目名称.*搜索|定位已存在项目/.test(value)) {
    return "从用户提供的项目地址定位项目";
  }
  return value;
}

function shouldSkipStep(modeKey, label) {
  return (skipPatterns[modeKey] || []).some(pattern => pattern.test(label));
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
