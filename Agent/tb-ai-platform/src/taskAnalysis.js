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

  if (suggestedMode !== mode) warnings.push(`内容看起来更像${suggestedMode === "change" ? "变更" : "创建"}任务`);
  if (mode === "change" && !hasProjectUrl(`${text}\n${projectUrl}`) && !hasChangeFields(text, items)) {
    warnings.push("项目变更建议提供项目地址，或至少包含项目名称、原项目编号和新项目编号");
  }
  if (items.length > 5) warnings.push(`将处理 ${items.length} 个项目，建议确认后再启动`);
  if (missingFields.length) warnings.push(`可能缺少字段：${missingFields.join("、")}`);

  return {
    mode,
    suggestedMode,
    itemCount: items.length,
    requiresConfirmation: items.length > 5,
    items,
    missingFields,
    warnings
  };
}

function suggestMode(text, fallback) {
  if (/项目变更申请|原项目编号|新项目编号|变更类别|变更缘由/.test(text)) return "change";
  if (/项目启动申请|启动类别|启动原因|项目编号/.test(text)) return "create";
  return fallback;
}

function requiredFields(mode) {
  return mode === "change"
    ? ["projectName", "oldCode", "newCode"]
    : ["projectName", "projectCode"];
}

function extractFields(mode, text) {
  return {
    projectName: fieldAfter(text, "项目名称"),
    projectCode: fieldAfter(text, "项目编号") || fieldAfter(text, "项目号"),
    oldCode: mode === "change" ? fieldAfter(text, "原项目编号") : "",
    newCode: mode === "change" ? fieldAfter(text, "新项目编号") : "",
    customer: fieldAfter(text, "客户") || fieldAfter(text, "客户名称"),
    engineer: fieldAfter(text, "项目工程师"),
    date: fieldAfter(text, "客户要求日期")
  };
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
  extractFields,
  suggestMode
};
