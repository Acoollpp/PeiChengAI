import type { ReviewTaskIssue } from './types'

const supportedSources = new Set<ReviewTaskIssue['source']>([
  'bms_code_reviewer_heading',
  'template_1_heading',
  'template_2_table_row',
  'template_2_conclusion_item'
])

const toInlineCode = (value: string): string => {
  const longestDelimiter = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length)
  )
  const delimiter = '`'.repeat(longestDelimiter + 1)
  return `${delimiter}${value}${delimiter}`
}

const feedbackTextForBlock = (value: string | null | undefined): string[] => {
  const normalized = value?.trim()
  if (!normalized) {
    return ['未填写']
  }
  return normalized.replaceAll('\r\n', '\n').split('\n').map(toInlineCode)
}

const feedbackTextForTable = (value: string | null | undefined): string => {
  const normalized = value?.trim()
  if (!normalized) {
    return '未填写'
  }
  return toInlineCode(normalized.replace(/\r?\n/g, ' / '))
}

const buildFeedbackBlock = (issue: ReviewTaskIssue): string => {
  const feedbackLines = feedbackTextForBlock(issue.feedback_text)
  return [
    '',
    `> 是否有效：${issue.helpful ? '有效' : '无效'}`,
    '>',
    `> 用户反馈：${feedbackLines[0]}`,
    ...feedbackLines.slice(1).map((line) => `> ${line}`),
    '',
    ''
  ].join('\n')
}

const findTableCellInsertionOffset = (markdown: string, requestedOffset: number): number => {
  let cursor = requestedOffset
  while (cursor > 0 && /[\t ]/.test(markdown[cursor - 1])) {
    cursor -= 1
  }
  return markdown[cursor - 1] === '|' ? cursor - 1 : requestedOffset
}

const buildTableFeedback = (issue: ReviewTaskIssue): string =>
  ` <br />是否有效：${issue.helpful ? '有效' : '无效'}` +
  `<br />用户反馈：${feedbackTextForTable(issue.feedback_text)} `

const validateIssueLocation = (markdown: string, issue: ReviewTaskIssue): void => {
  const location = issue.location
  const offsets = [
    location.start_offset,
    location.end_offset,
    location.feedback_insertion_offset
  ]
  if (
    !supportedSources.has(issue.source) ||
    offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > markdown.length) ||
    location.start_offset > location.feedback_insertion_offset ||
    location.feedback_insertion_offset > location.end_offset
  ) {
    throw new Error(`审查问题 ${issue.order + 1} 的反馈定位信息无效`)
  }
  if (issue.helpful == null) {
    throw new Error(`审查问题 ${issue.order + 1} 尚未评价`)
  }
  if (
    issue.display_snapshot &&
    !markdown
      .slice(location.start_offset, location.end_offset)
      .startsWith(issue.display_snapshot)
  ) {
    throw new Error(`审查问题 ${issue.order + 1} 与原始报告内容不一致`)
  }
}

type MarkdownInsertion = {
  offset: number
  content: string
  order: number
}

export const composeIssueFeedbackMarkdown = (
  markdown: string,
  issues: ReviewTaskIssue[]
): string => {
  const insertions = issues.map<MarkdownInsertion>((issue) => {
    validateIssueLocation(markdown, issue)
    const requestedOffset = issue.location.feedback_insertion_offset
    return {
      offset:
        issue.source === 'template_2_table_row'
          ? findTableCellInsertionOffset(markdown, requestedOffset)
          : requestedOffset,
      content:
        issue.source === 'template_2_table_row'
          ? buildTableFeedback(issue)
          : buildFeedbackBlock(issue),
      order: issue.order
    }
  })

  const uniqueOffsets = new Set(insertions.map((insertion) => insertion.offset))
  if (uniqueOffsets.size !== insertions.length) {
    throw new Error('审查问题反馈定位位置重复')
  }

  return insertions
    .sort((left, right) => right.offset - left.offset || right.order - left.order)
    .reduce(
      (result, insertion) =>
        `${result.slice(0, insertion.offset)}${insertion.content}${result.slice(insertion.offset)}`,
      markdown
    )
}
