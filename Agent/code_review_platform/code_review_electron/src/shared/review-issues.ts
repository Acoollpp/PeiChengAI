export type ReviewIssueSource =
  | 'bms_code_reviewer_heading'
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
  severity?: ReviewIssueSeverity
  codeLocations?: ReviewIssueCodeLocation[]
  anchorId: string
  location: ReviewIssueLocation
}

export type ReviewIssueSeverity = 'high' | 'medium' | 'low' | 'suggestion' | 'unknown'

export type ReviewIssueCodeLocation = {
  file: string
  line: string
  description: string
}

export type ReviewIssueExtractionResult = {
  format: 'bms_code_reviewer' | 'legacy'
  status: 'parsed' | 'invalid'
  issues: ReviewIssueSnapshot[]
  message?: string
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
const codeLocationFieldPattern =
  /^\s*(?:[-*+]\s*)?(?:\*\*|__)?涉及文件及行号\s*[：:](?:\*\*|__)?\s*$/
const bmsIssueHeadingPattern =
  /^(?:P\d+|CR-\d+)\s+\[(高风险|高|中风险|中|低风险|低|建议)\]\s+\S.*$/
const bmsZeroIssueStatementPattern = /^本次未发现能够闭环的问题[。.]?$/

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

const templatePlaceholderTexts = new Set([
  '填写检查方向',
  '填写规范编号、规范名称或通用建议项',
  '填写自检规则、失败项摘要或检查结论。',
  '填写问题根因和触发条件。',
  '填写不符合规范的具体现象。'
])

const isPlaceholderText = (value: string): boolean => {
  const normalized = normalizeCellText(value)
  return (
    !normalized ||
    normalized === '无' ||
    normalized === '待填写' ||
    normalized === '待填写。' ||
    templatePlaceholderTexts.has(normalized) ||
    normalized === '问题标题' ||
    normalized === '风险级别：问题标题' ||
    normalized === '高风险/中风险/低风险/建议'
  )
}

const isNoIssueConclusion = (value: string): boolean =>
  /^(?:本次)?未发现明确(?:高风险项|中低风险及建议项|代码质量问题|编码规范问题|问题|缺陷)[。.]?$/.test(
    normalizeCellText(value)
  )

const isConclusionIssueSection = (value: string): boolean =>
  value === '高风险项总结' || value === '中低风险及建议项'

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

const severityByLabel: Record<string, ReviewIssueSeverity> = {
  高风险: 'high',
  高: 'high',
  中风险: 'medium',
  中: 'medium',
  低风险: 'low',
  低: 'low',
  建议: 'suggestion'
}

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

const findCodeLocations = (lines: MarkdownLine[]): ReviewIssueCodeLocation[] => {
  const fieldIndex = lines.findIndex(
    (line) => !line.inCodeBlock && codeLocationFieldPattern.test(line.text)
  )
  if (fieldIndex === -1) return []

  const tableLines = lines.slice(fieldIndex + 1)
  const headerLineIndex = tableLines.findIndex(
    (line) => !line.inCodeBlock && line.text.trim().startsWith('|')
  )
  if (headerLineIndex === -1) return []
  const headers = splitTableRow(tableLines[headerLineIndex].text)
  const fileIndex = getHeaderIndex(headers, ['文件'])
  const lineIndex = getHeaderIndex(headers, ['行号'])
  const descriptionIndex = getHeaderIndex(headers, ['位置说明'])
  if (fileIndex === -1 || lineIndex === -1 || descriptionIndex === -1) return []

  const locations: ReviewIssueCodeLocation[] = []
  for (const line of tableLines.slice(headerLineIndex + 1)) {
    if (line.inCodeBlock || !line.text.trim().startsWith('|')) break
    if (tableSeparatorPattern.test(line.text)) continue
    const cells = splitTableRow(line.text)
    const file = cells[fileIndex] ?? ''
    const codeLine = cells[lineIndex] ?? ''
    const description = cells[descriptionIndex] ?? ''
    if (file && codeLine) locations.push({ file, line: codeLine, description })
  }
  return locations
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

const reviewCoverageSectionPattern =
  /^(?:(?:[一二三四五六七八九十百]+|\d+)[、.．:：\s]+)?审查覆盖$/
const reviewIssuesSectionPattern =
  /^(?:(?:[一二三四五六七八九十百]+|\d+)[、.．:：\s]+)?审查问题$/

const extractBmsCodeReviewerIssues = (
  markdown: string,
  lines: MarkdownLine[]
): ReviewIssueExtractionResult | undefined => {
  const headings = collectHeadings(lines)
  const sectionIndex = headings.findIndex(
    (heading) => heading.level === 2 && reviewIssuesSectionPattern.test(heading.text.trim())
  )
  if (sectionIndex === -1) return undefined

  const section = headings[sectionIndex]
  const nextSection = headings
    .slice(sectionIndex + 1)
    .find((heading) => heading.level <= section.level)
  const candidates = headings.slice(
    sectionIndex + 1,
    nextSection ? headings.indexOf(nextSection) : headings.length
  )
  const directHeadings = candidates.filter((heading) => heading.level === 3)
  const issueHeadings = directHeadings.filter(
    (heading) => heading.level === 3 && bmsIssueHeadingPattern.test(heading.text)
  )

  const issues = issueHeadings.flatMap((heading) => {
    const headingIndex = headings.indexOf(heading)
    const boundary = findTemplateOneBoundary(lines, headings, headingIndex)
    const endOffset = boundary?.startOffset ?? markdown.length
    const issueLines = lines.slice(heading.line.index + 1, boundary?.index)
    const descriptionText = findDescriptionText(issueLines)
    if (!descriptionText) return []
    const severityLabel = bmsIssueHeadingPattern.exec(heading.text)?.[1] ?? ''
    const anchorId = `report-option-${heading.line.index}`
    return [{
      id: `review-issue-${heading.line.index}`,
      order: 0,
      source: 'bms_code_reviewer_heading' as const,
      issueText: heading.text,
      descriptionText,
      displayText: heading.text,
      displaySnapshot: markdown.slice(heading.line.startOffset, endOffset).trimEnd(),
      severity: severityByLabel[severityLabel] ?? 'unknown',
      codeLocations: findCodeLocations(issueLines),
      anchorId,
      location: {
        startOffset: heading.line.startOffset,
        endOffset,
        feedbackInsertionOffset: endOffset,
        anchorLine: heading.line.index,
        headingLevel: heading.level
      }
    }]
  }).map((issue, order) => ({ ...issue, order }))
  const sectionLines = lines.slice(
    section.line.index + 1,
    nextSection?.line.index
  )
  const hasZeroIssueStatement = sectionLines.some(
    (line) => !line.inCodeBlock && bmsZeroIssueStatementPattern.test(line.text.trim())
  )
  const valid =
    (directHeadings.length > 0 &&
      directHeadings.length === issueHeadings.length &&
      issues.length === issueHeadings.length) ||
    (directHeadings.length === 0 && hasZeroIssueStatement)

  return {
    format: 'bms_code_reviewer',
    status: valid ? 'parsed' : 'invalid',
    issues,
    ...(!valid ? { message: '“审查问题”章节不符合 bms-code-reviewer 固定模板。' } : {})
  }
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
  const issueHeadings = leafHeadings.filter((heading) => {
    if (heading.level < 3 || isPlaceholderText(heading.text)) {
      return false
    }
    const headingIndex = headings.indexOf(heading)
    const parentSection = headings
      .slice(0, headingIndex)
      .reverse()
      .find((candidate) => candidate.level <= 2)
    return !parentSection || !reviewCoverageSectionPattern.test(parentSection.text.trim())
  })

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

    if (!inConclusion || !isConclusionIssueSection(currentSection)) {
      continue
    }
    const itemMatch = /^\s*[-*+]\s+(.+?)\s*$/.exec(line.text)
    if (!itemMatch) {
      continue
    }

    const descriptionText = stripMarkdownInline(itemMatch[1])
    if (isPlaceholderText(descriptionText) || isNoIssueConclusion(descriptionText)) {
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

export const inspectReviewIssues = (markdown: string): ReviewIssueExtractionResult => {
  if (!markdown.trim()) {
    return { format: 'legacy', status: 'invalid', issues: [], message: '报告正文为空。' }
  }

  const lines = splitMarkdownLines(markdown)
  const bmsCodeReviewerIssues = extractBmsCodeReviewerIssues(markdown, lines)
  if (bmsCodeReviewerIssues !== undefined) return bmsCodeReviewerIssues
  if (/代码审查报告模?板二/.test(markdown)) {
    const tableIssues = extractTemplateTwoTableIssues(markdown, lines)
    return {
      format: 'legacy',
      status: 'parsed',
      issues: tableIssues.length > 0
        ? tableIssues
        : extractTemplateTwoConclusionIssues(markdown, lines)
    }
  }
  return {
    format: 'legacy',
    status: 'parsed',
    issues: extractTemplateOneIssues(markdown, lines)
  }
}

export const extractReviewIssues = (markdown: string): ReviewIssueSnapshot[] =>
  inspectReviewIssues(markdown).issues
