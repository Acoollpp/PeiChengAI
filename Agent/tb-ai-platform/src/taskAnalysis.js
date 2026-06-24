const { detectProjectItems } = require("./projectItems");

function analyzeTask({ mode, message, projectUrl = "" }) {
  const text = String(message || "").trim();
  const suggestedMode = suggestMode(text, mode);
  const items = detectProjectItems(mode, text).map(item => ({
    id: item.id,
    title: item.title,
    fields: extractFields(mode, item.message)
  }));
  const warnings = [];
  const missingFields = requiredFields(mode).filter(field => !items.some(item => item.fields[field]));
  const checks = buildChecks(mode, items);

  if (suggestedMode !== mode) warnings.push(`内容看起来更像${modeLabel(suggestedMode)}任务`);
  if (mode === "change" && !hasProjectUrl(`${text}\n${projectUrl}`) && !hasChangeFields(text, items)) {
    warnings.push("项目变更建议提供项目地址，或至少包含项目名称、原项目编号和新项目编号");
  }
  for (const check of checks) {
    if (!check.ok && check.warning) warnings.push(check.warning);
  }
  if (items.length > 5) warnings.push(`将处理 ${items.length} 个项目，建议确认后再启动`);
  if (missingFields.length) warnings.push(`可能缺少字段：${missingFields.join("、")}`);

  return {
    mode,
    suggestedMode,
    itemCount: items.length,
    requiresConfirmation: items.length > 5,
    items,
    checks,
    missingFields,
    warnings
  };
}

function suggestMode(text, fallback) {
  if (/项目变更申请|原项目编号|新项目编号|变更类别|变更缘由/.test(text)) return "change";
  if (/项目立项开发|项目重要等级|需求开发类别|项目流程类别/.test(text)) return "researchCreate";
  if (/项目启动申请|启动类别|启动原因|项目编号/.test(text)) return "create";
  return fallback;
}

function modeLabel(mode) {
  if (mode === "change") return "变更";
  if (mode === "researchCreate") return "研发创建";
  return "创建";
}

function requiredFields(mode) {
  if (mode === "change") return ["projectName", "oldCode", "newCode"];
  if (mode === "researchCreate") return ["projectName", "projectCode", "projectLevel", "projectCategory"];
  return ["projectName", "projectCode"];
}

function extractFields(mode, text) {
  const submitter = extractSubmitter(text);
  return {
    projectName: fieldAfter(text, "项目名称"),
    projectCode: fieldAfter(text, "项目编号") || fieldAfter(text, "项目号"),
    oldCode: mode === "change" ? fieldAfter(text, "原项目编号") : "",
    newCode: mode === "change" ? fieldAfter(text, "新项目编号") : "",
    pcb: mode === "change" ? extractFullPcb(text) : extractFullPcb(text),
    customer: fieldAfter(text, "客户") || fieldAfter(text, "客户名称"),
    engineer: fieldAfter(text, "项目工程师"),
    submitter,
    presales: mode === "change" ? submitter || fieldAfter(text, "售前工程师") || fieldAfter(text, "售前") : fieldAfter(text, "售前工程师") || fieldAfter(text, "售前"),
    pm: fieldAfter(text, "新能源PM") || fieldAfter(text, "新能源 PM") || fieldAfter(text, "PM"),
    date: fieldAfter(text, "客户要求日期"),
    projectLevel: fieldAfter(text, "项目重要等级"),
    projectCategory: fieldAfter(text, "项目分类"),
    projectOwner: fieldAfter(text, "项目负责人")
  };
}

function buildChecks(mode, items) {
  if (mode !== "change") return [];
  const fields = items[0]?.fields || {};
  return [
    {
      key: "fullPcb",
      label: "完整 PCB 号",
      ok: Boolean(fields.pcb),
      value: fields.pcb || "",
      warning: "项目变更建议提供 PCB/底板信息；审批里有 SST 前缀时必须保留完整 PCB 号"
    },
    {
      key: "presalesSubmitter",
      label: "售前工程师=审批提交人",
      ok: Boolean(fields.presales),
      value: fields.presales || "",
      warning: "项目变更建议包含审批提交人，售前工程师默认取提交人"
    }
  ];
}

function extractSubmitter(text) {
  const match = String(text || "").match(/^\s*([^\s，,。；;：:]{2,8})提交的项目(?:变更|启动|立项)/m);
  return match ? cleanValue(match[1]) : "";
}

function extractFullPcb(text) {
  const value = String(text || "");
  const full = value.match(/\bSST[A-Z0-9]*-\d{3,6}(?:-\d+(?:\.\d+)*)?\b/i);
  if (full) return full[0].toUpperCase();
  const labelled = [
    fieldAfter(value, "更换底板"),
    fieldAfter(value, "底板版本"),
    fieldAfter(value, "PCB版本"),
    fieldAfter(value, "PCB")
  ].find(Boolean);
  if (labelled) {
    const simple = labelled.match(/\b\d{4,6}-\d+(?:\.\d+)*\b/);
    return simple ? simple[0] : labelled;
  }
  const simple = value.match(/\b\d{4,6}-\d+(?:\.\d+)*\b/);
  return simple ? simple[0] : "";
}

function fieldAfter(text, label) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(new RegExp(`^${escapeRegExp(label)}\\s*[：:]\\s*(.+)$`));
    if (inline) return cleanValue(inline[1]);
    if (line === label && lines[index + 1]) return cleanValue(lines[index + 1]);
  }
  return "";
}

function cleanValue(value) {
  return String(value || "").replace(/[、。，.]+$/, "").trim();
}

function hasProjectUrl(message) {
  return /https?:\/\/[^\s，。；;]+/i.test(String(message || ""));
}

function hasChangeFields(message, items = []) {
  if (items.length > 1) return true;
  const text = String(message || "");
  return /项目名称/.test(text) && /原项目编号/.test(text) && /新项目编号/.test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  analyzeTask,
  extractFullPcb,
  extractFields,
  suggestMode
};
