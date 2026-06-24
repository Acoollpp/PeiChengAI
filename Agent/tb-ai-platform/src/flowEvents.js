const STEP_MARKER_RE = /\[\[TB_STEP:([A-Za-z0-9_-]+):(running|done|failed)\]\]/g;

function parseCodexEvents(chunk) {
  const text = String(chunk || "");
  const events = [];
  let match;

  STEP_MARKER_RE.lastIndex = 0;
  while ((match = STEP_MARKER_RE.exec(text))) {
    events.push({ type: "step", stepId: match[1], status: match[2] });
  }

  return {
    events,
    text: extractLogText(text)
  };
}

function parseSkillSteps(text) {
  const lines = String(text || "").split(/\r?\n/);
  const listTitles = [];
  const headingTitles = [];

  for (const line of lines) {
    const numbered = line.match(/^\s*(?:\d+[.)、]|第[一二三四五六七八九十百]+步[：:])\s*(.+?)\s*$/);
    if (numbered) {
      listTitles.push(cleanStepTitle(numbered[1]));
      continue;
    }

    const checkbox = line.match(/^\s*[-*+]\s+\[[ xX]\]\s*(.+?)\s*$/);
    if (checkbox) {
      listTitles.push(cleanStepTitle(checkbox[1]));
      continue;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) headingTitles.push(cleanStepTitle(heading[1]));
  }

  const titles = listTitles.length ? listTitles : headingTitles.filter(isStepLikeHeading);
  const fallbackTitles = titles.length ? titles : headingTitles;
  return fallbackTitles.filter(Boolean).map((title, index) => ({
    id: `step-${index + 1}`,
    title
  }));
}

function extractLogText(text) {
  const lines = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const matches = [...line.matchAll(new RegExp(STEP_MARKER_RE.source, "g"))];
    if (!matches.length) continue;
    const last = matches[matches.length - 1];
    const afterMarker = line.slice(last.index + last[0].length).trim();
    if (afterMarker) lines.push(afterMarker);
  }
  return lines.join("\n");
}

function cleanStepTitle(value) {
  return String(value || "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。；;]\s*$/, "");
}

function isStepLikeHeading(title) {
  return /^(步骤|Step|阶段|Phase)\s*\d*/i.test(title);
}

module.exports = {
  parseCodexEvents,
  parseSkillSteps
};
