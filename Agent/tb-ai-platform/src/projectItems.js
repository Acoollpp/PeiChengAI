function detectProjectItems(modeKey, message) {
  const text = String(message || "").trim();
  if (!text) return [singleItem(text)];

  if (modeKey === "change") {
    const listItems = detectChangeListItems(text);
    if (listItems.length > 1) return listItems;
    return [singleItem(text)];
  }

  if (modeKey !== "create") return [singleItem(text)];

  const blocks = splitBlocks(text).filter(block => looksLikeProject(block));
  if (blocks.length > 1) return blocks.slice(0, 8).map((block, index) => itemFromBlock(block, index));

  const codeMatches = [...text.matchAll(/\b\d{5,6}[-_][A-Za-z0-9][A-Za-z0-9_-]{3,}\b/g)];
  if (codeMatches.length > 1) {
    return splitByMatchPositions(text, codeMatches.map(match => match.index))
      .filter(block => looksLikeProject(block))
      .slice(0, 8)
      .map((block, index) => itemFromBlock(block, index));
  }

  return [singleItem(text)];
}

function detectChangeListItems(text) {
  const names = extractSectionList(text, "项目名称", ["原项目编号", "新项目编号", "阶段属性"]);
  const originalCodes = extractSectionList(text, "原项目编号", ["新项目编号", "阶段属性"]);
  const newCodes = extractSectionList(text, "新项目编号", ["阶段属性", "优先级", "客户要求日期"]);
  const count = Math.min(names.length, originalCodes.length, newCodes.length);
  if (count <= 1) return [];

  const shared = extractSharedChangeFields(text);
  return Array.from({ length: count }, (_, index) => {
    const message = [
      shared.header,
      `项目名称：${names[index]}`,
      `原项目编号：${originalCodes[index]}`,
      `新项目编号：${newCodes[index]}`,
      shared.footer
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: `item-${index + 1}`,
      title: names[index],
      message
    };
  });
}

function extractSectionList(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);
  if (start < 0) return [];
  const afterStart = text.slice(start + startLabel.length);
  const endPositions = endLabels
    .map(label => afterStart.indexOf(label))
    .filter(position => position >= 0);
  const section = afterStart.slice(0, endPositions.length ? Math.min(...endPositions) : afterStart.length);
  return section
    .split(/[、。，\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => !/^\d+$/.test(item));
}

function extractSharedChangeFields(text) {
  const headerMatch = text.match(/^[\s\S]*?(?=项目名称)/);
  const footerStart = text.search(/阶段属性|优先级|客户要求日期|新能源PM|商务|变更类别|变更缘由|变更详情|应用场合|项目工程师/);
  return {
    header: headerMatch ? headerMatch[0].trim() : "",
    footer: footerStart >= 0 ? text.slice(footerStart).trim() : ""
  };
}

function splitBlocks(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const byBlank = normalized.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;

  const lines = normalized.split("\n");
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const startsProject = /^(项目名称|项目编号|项目号|客户|PCB|应用场合)\s*[：:]/.test(line.trim());
    if (startsProject && current.some(item => /^项目名称\s*[：:]/.test(item.trim()))) {
      blocks.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n").trim());
  return blocks;
}

function splitByMatchPositions(text, positions) {
  const blocks = [];
  positions.forEach((position, index) => {
    const next = positions[index + 1] ?? text.length;
    const start = index === 0 ? 0 : position;
    blocks.push(text.slice(start, next).trim());
  });
  return blocks;
}

function looksLikeProject(block) {
  return /(项目名称|项目编号|项目号|客户|PCB|应用场合|项目工程师)/.test(block);
}

function itemFromBlock(block, index) {
  return {
    id: `item-${index + 1}`,
    title: extractTitle(block, index),
    message: block
  };
}

function singleItem(message) {
  return { id: "item-1", title: "项目 1", message };
}

function extractTitle(block, index) {
  const projectName = block.match(/项目名称\s*[：:]\s*([^\n]+)/);
  if (projectName) return projectName[1].trim().slice(0, 48);
  const projectCode = block.match(/(?:项目编号|项目号)\s*[：:]\s*([^\n]+)/);
  if (projectCode) return projectCode[1].trim().slice(0, 48);
  const compactCode = block.match(/\b\d{5,6}[-_][A-Za-z0-9][A-Za-z0-9_-]{3,}\b/);
  if (compactCode) return compactCode[0];
  return `项目 ${index + 1}`;
}

module.exports = {
  detectProjectItems
};
