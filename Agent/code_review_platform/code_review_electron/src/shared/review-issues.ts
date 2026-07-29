export type ReviewIssueSource =
  | 'template_1_heading'
  | 'template_2_table_row'
  | 'template_2_conclusion_item'

export type ReviewIssueLocation = {
  startOffset: number
  endOffset: number
  feedbackInsertionOffset: number
  anchorLine: number
  headingLevel: number
}

export type ReviewIssueSnapshot = {
  id: string
  order: number
  source: ReviewIssueSource
  issueText: string
  descriptionText: string
  displayText: string
  displaySnapshot: string
  anchorId: string
  location: ReviewIssueLocation
}

type MarkdownLine = {
  index: number
  text: string
  startOffset: number
  endOffset: number
  fullEndOffset: number
  inCodeBlock: boolean
}

type MarkdownHeading = {
  line: MarkdownLine
  level: number
  text: string
}

const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/
const horizontalRulePattern = /^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/
const tableSeparatorPattern = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/
const descriptionFieldPattern =
  /^\s*(?:[-*+]\s*)?(?:\*\*|__)?(?:问题描述|缺陷描述(?:\s*\(Root Cause\))?|不合规现象描述)\s*[：:](?:\*\*|__)?\s*(.*?)\s*$/i

const stripMarkerListPrefix = (value: string): string =>
  value
    .replace(/^\s*(?:\d+[\.)、]|[一二三四五六七八九十]+[、.．\)])\s*/, '')
    .trim()

const stripMarkdownInline = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

const normalizeCellText = (value: string | undefined): string =>
  stripMarkdownInline(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim()

const isPlaceholderText = (value: string): boolean => {
  const normalized = normalizeCellText(value)
  return (
    !normalized ||
    normalized === '无' ||
    normalized === '待填写' ||
    normalized === '待填写。' ||
    normalized.includes('填写') ||
    normalized.includes('高风险/中风险/低风险/建议')
  )
}

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let backslashCount = 0

  for (const character of trimmed) {
    if (character === '\\') {
      backslashCount += 1
      cell += character
      continue
    }
    if (character === '|' && backslashCount % 2 === 0) {
      cells.push(normalizeCellText(cell))
      cell = ''
    } else {
      cell += character
    }
    backslashCount = 0
  }
  cells.push(normalizeCellText(cell))
  return cells
}

const getHeaderIndex = (headers: string[], names: string[]): number =>
  headers.findIndex((header) => names.some((name) => header.includes(name)))

const splitMarkdownLines = (markdown: string): MarkdownLine[] => {
  const lines: MarkdownLine[] = []
  let offset = 0
  let fence: { marker: '`' | '~'; length: number } | null = null

  while (offset < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', offset)
    const fullEndOffset = newlineIndex === -1 ? markdown.length : newlineIndex + 1
    const rawLine = markdown.slice(offset, newlineIndex === -1 ? markdown.length : newlineIndex)
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    const inCodeBlock = fence !== null || fenceMatch !== null

    lines.push({
      index: lines.length,
      text,
      startOffset: offset,
      endOffset: offset + text.length,
      fullEndOffset,
      inCodeBlock
    })

    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ''
      ) {
        fence = null
      }
    } else if (fenceMatch) {
      fence = {
        marker: fenceMatch[1][0] as '`' | '~',
        length: fenceMatch[1].length
      }
    }

    offset = fullEndOffset
  }

  return lines
}

const collectHeadings = (lines: MarkdownLine[]): MarkdownHeading[] =>
  lines.flatMap((line) => {
    if (line.inCodeBlock) {
      return []
    }
    const match = headingLinePattern.exec(line.text)
    if (!match) {
      return []
    }
    const text = stripMarkerListPrefix(stripMarkdownInline(match[2]))
    return text ? [{ line, level: match[1].length, text }] : []
  })

const findDescriptionText = (lines: MarkdownLine[]): string => {
  for (const line of lines) {
    if (line.inCodeBlock) {
      continue
    }
    const match = descriptionFieldPattern.exec(line.text)
    if (match) {
      return stripMarkdownInline(match[1])
    }
  }
  return ''
}

const findTemplateOneBoundary = (
  lines: MarkdownLine[],
  headings: MarkdownHeading[],
  headingIndex: number
): MarkdownLine | undefined => {
  const heading = headings[headingIndex]
  const nextHeading = headings
    .slice(headingIndex + 1)
    .find((candidate) => candidate.level <= heading.level)?.line
  const horizontalRule = lines
    .slice(heading.line.index + 1, nextHeading?.index)
    .find((line) => !line.inCodeBlock && horizontalRulePattern.test(line.text))

  if (!nextHeading) {
    return horizontalRule
  }
  if (!horizontalRule) {
    return nextHeading
  }
  return horizontalRule.index < nextHeading.index ? horizontalRule : nextHeading
}

const extractTemplateOneIssues = (markdown: string, lines: MarkdownLine[]): ReviewIssueSnapshot[] => {
  const headings = collectHeadings(lines)
  const leafHeadings = headings.filter((heading, index) => {
    const boundary = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level)
    const children = headings.slice(index + 1, boundary ? headings.indexOf(boundary) : headings.length)
    return children.length === 0
  })
  const issueHeadings = leafHeadings.filter((heading) => heading.level >= 3)

  return issueHeadings.map((heading, order) => {
    const headingIndex = headings.indexOf(heading)
    const boundary = findTemplateOneBoundary(lines, headings, headingIndex)
    const endOffset = boundary?.startOffset ?? markdown.length
    const issueLines = lines.slice(heading.line.index + 1, boundary?.index)
    const anchorId = `report-option-${heading.line.index}`

    return {
      id: `review-issue-${heading.line.index}`,
      order,
      source: 'template_1_heading',
      issueText: heading.text,
      descriptionText: findDescriptionText(issueLines),
      displayText: heading.text,
      displaySnapshot: markdown.slice(heading.line.startOffset, endOffset).trimEnd(),
      anchorId,
      location: {
        startOffset: heading.line.startOffset,
        endOffset,
        feedbackInsertionOffset: endOffset,
        anchorLine: heading.line.index,
        headingLevel: heading.level
      }
    }
  })
}

const extractTemplateTwoTableIssues = (
  markdown: string,
  lines: MarkdownLine[]
): ReviewIssueSnapshot[] => {
  const issues: ReviewIssueSnapshot[] = []
  let currentSection = ''
  let currentHeaders: string[] | null = null

  for (const line of lines) {
    if (line.inCodeBlock) {
      continue
    }

    const headingMatch = headingLinePattern.exec(line.text)
    if (headingMatch) {
      currentSection = stripMarkerListPrefix(stripMarkdownInline(headingMatch[2]))
      currentHeaders = null
      continue
    }

    if (!line.text.trim().startsWith('|')) {
      currentHeaders = null
      continue
    }
    if (tableSeparatorPattern.test(line.text)) {
      continue
    }

    const cells = splitTableRow(line.text)
    if (currentHeaders === null) {
      currentHeaders = cells
      continue
    }

    const risk = cells[getHeaderIndex(currentHeaders, ['风险级别'])] ?? ''
    const direction =
      cells[getHeaderIndex(currentHeaders, ['专项检查方向', '规范违反条目'])] ?? ''
    const description =
      cells[
        getHeaderIndex(currentHeaders, [
          '触发规则/缺陷描述',
          '缺陷描述',
          '不合规现象描述'
        ])
      ] ?? ''

    if (isPlaceholderText(risk) || isPlaceholderText(description)) {
      continue
    }

    const issueContext = isPlaceholderText(direction) ? currentSection : direction
    const issueText = [risk, issueContext]
      .filter((part) => !isPlaceholderText(part))
      .join(' · ')
    if (!issueText) {
      continue
    }

    const displayText = [currentSection, risk, direction, description]
      .filter((part) => !isPlaceholderText(part))
      .join(' · ')
    const anchorId = `report-option-${line.index}`
    issues.push({
      id: `review-issue-${line.index}`,
      order: issues.length,
      source: 'template_2_table_row',
      issueText,
      descriptionText: normalizeCellText(description),
      displayText,
      displaySnapshot: markdown.slice(line.startOffset, line.endOffset),
      anchorId,
      location: {
        startOffset: line.startOffset,
        endOffset: line.fullEndOffset,
        feedbackInsertionOffset: line.endOffset,
        anchorLine: line.index,
        headingLevel: 4
      }
    })
  }

  return issues
}

const extractTemplateTwoConclusionIssues = (
  markdown: string,
  lines: MarkdownLine[]
): ReviewIssueSnapshot[] => {
  const issues: ReviewIssueSnapshot[] = []
  let inConclusion = false
  let currentSection = ''

  for (const line of lines) {
    if (line.inCodeBlock) {
      continue
    }

    const headingMatch = headingLinePattern.exec(line.text)
    if (headingMatch) {
      const headingText = stripMarkerListPrefix(stripMarkdownInline(headingMatch[2]))
      const level = headingMatch[1].length
      if (level === 2) {
        inConclusion = headingText === '结论'
        currentSection = ''
      } else if (inConclusion && level >= 3) {
        currentSection = headingText
      }
      continue
    }

    if (!inConclusion || !currentSection) {
      continue
    }
    const itemMatch = /^\s*[-*+]\s+(.+?)\s*$/.exec(line.text)
    if (!itemMatch) {
      continue
    }

    const descriptionText = stripMarkdownInline(itemMatch[1])
    if (isPlaceholderText(descriptionText)) {
      continue
    }

    const issueText = `${currentSection} · ${descriptionText}`
    const anchorId = `report-option-${line.index}`
    issues.push({
      id: `review-issue-${line.index}`,
      order: issues.length,
      source: 'template_2_conclusion_item',
      issueText,
      descriptionText,
      displayText: issueText,
      displaySnapshot: markdown.slice(line.startOffset, line.endOffset),
      anchorId,
      location: {
        startOffset: line.startOffset,
        endOffset: line.fullEndOffset,
        feedbackInsertionOffset: line.fullEndOffset,
        anchorLine: line.index,
        headingLevel: 4
      }
    })
  }

  return issues
}

export const extractReviewIssues = (markdown: string): ReviewIssueSnapshot[] => {
  if (!markdown.trim()) {
    return []
  }

  const lines = splitMarkdownLines(markdown)
  if (/代码审查报告模?板二/.test(markdown)) {
    const tableIssues = extractTemplateTwoTableIssues(markdown, lines)
    return tableIssues.length > 0
      ? tableIssues
      : extractTemplateTwoConclusionIssues(markdown, lines)
  }
  return extractTemplateOneIssues(markdown, lines)
}
