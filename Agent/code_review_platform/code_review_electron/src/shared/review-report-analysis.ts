import {
  inspectReviewIssues,
  type ReviewIssueSeverity,
  type ReviewIssueSnapshot
} from './review-issues'

export type ReportSummarySeverity = ReviewIssueSeverity | 'none'

export interface ReviewReportSummaryInput {
  feedbackProtocolVersion?: number | null
  issueCount?: number
  highestIssueSeverity?: Exclude<ReviewIssueSeverity, 'unknown'> | null
}

export interface ReviewReportSummary {
  issueCount?: number
  highestSeverity: ReportSummarySeverity
  summary: string
}

export type LoadedReviewReportAnalysis = ReviewReportSummary & {
  status: 'ready' | 'parse_error'
  issues: ReviewIssueSnapshot[]
  message?: string
}

const severityLabels: Record<Exclude<ReportSummarySeverity, 'unknown'>, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  suggestion: '建议',
  none: '无'
}

const severityOrder: Record<ReviewIssueSeverity, number> = {
  high: 4,
  medium: 3,
  low: 2,
  suggestion: 1,
  unknown: 0
}

const severityFromIssueText = (issueText: string): ReviewIssueSeverity => {
  if (/\[高风险\]|^(?:\d+[.、]\s*)?高风险|[·：:]\s*高风险/.test(issueText)) return 'high'
  if (/\[中风险\]|^(?:\d+[.、]\s*)?中风险|[·：:]\s*中风险/.test(issueText)) return 'medium'
  if (/\[低风险\]|^(?:\d+[.、]\s*)?低风险|[·：:]\s*低风险/.test(issueText)) return 'low'
  if (/\[建议\]|^(?:\d+[.、]\s*)?建议|[·：:]\s*建议/.test(issueText)) return 'suggestion'
  return 'unknown'
}

const highestSeverityFromIssues = (issues: ReviewIssueSnapshot[]): ReportSummarySeverity => {
  if (issues.length === 0) return 'none'
  return issues.reduce<ReviewIssueSeverity>((highest, issue) => {
    const severity = issue.severity ?? (
      issue.source === 'bms_code_reviewer_heading'
        ? 'unknown'
        : severityFromIssueText(issue.issueText)
    )
    return severityOrder[severity] > severityOrder[highest] ? severity : highest
  }, 'unknown')
}

export const summarizeReviewReport = (
  input: ReviewReportSummaryInput
): ReviewReportSummary => {
  if (input.feedbackProtocolVersion !== 1) {
    return {
      issueCount: undefined,
      highestSeverity: 'unknown',
      summary: '历史任务未记录结构化问题摘要，可查看原始报告。'
    }
  }
  if (input.issueCount === 0) {
    return {
      issueCount: 0,
      highestSeverity: 'none',
      summary: '本次审查未发现能够闭环的问题。'
    }
  }
  const highestSeverity = input.highestIssueSeverity ?? 'unknown'
  if (input.issueCount === undefined) {
    return {
      issueCount: undefined,
      highestSeverity,
      summary: '新版报告未返回问题快照计数，可查看原始报告。'
    }
  }
  return {
    issueCount: input.issueCount,
    highestSeverity,
    summary: highestSeverity === 'unknown'
      ? `报告包含 ${input.issueCount} 个审查问题。`
      : `报告包含 ${input.issueCount} 个审查问题，最高严重度为${severityLabels[highestSeverity]}。`
  }
}

export const analyzeLoadedReviewReport = (
  markdown: string,
  input: ReviewReportSummaryInput
): LoadedReviewReportAnalysis => {
  const extraction = inspectReviewIssues(markdown)
  const initialSummary = summarizeReviewReport(input)

  if (
    extraction.format === 'bms_code_reviewer' &&
    extraction.status === 'invalid'
  ) {
    return {
      ...initialSummary,
      highestSeverity: 'unknown',
      status: 'parse_error',
      issues: extraction.issues,
      message: extraction.message ?? '新版报告结构解析失败。'
    }
  }

  if (
    input.feedbackProtocolVersion === 1 &&
    input.issueCount !== undefined &&
    input.issueCount !== extraction.issues.length
  ) {
    return {
      ...initialSummary,
      highestSeverity: 'unknown',
      status: 'parse_error',
      issues: extraction.issues,
      message:
        `报告正文提取到 ${extraction.issues.length} 个问题，但服务端问题快照记录为 ${input.issueCount} 个。`
    }
  }

  if (extraction.format === 'legacy') {
    if (extraction.issues.length === 0) {
      return { ...initialSummary, status: 'ready', issues: [] }
    }
    const highestSeverity = highestSeverityFromIssues(extraction.issues)
    return {
      issueCount: extraction.issues.length,
      highestSeverity,
      summary: highestSeverity === 'unknown'
        ? `历史报告解析到 ${extraction.issues.length} 个问题。`
        : `历史报告解析到 ${extraction.issues.length} 个问题，最高严重度为${severityLabels[highestSeverity]}。`,
      status: 'ready',
      issues: extraction.issues
    }
  }

  const highestSeverity = highestSeverityFromIssues(extraction.issues)
  return {
    issueCount: extraction.issues.length,
    highestSeverity,
    summary: extraction.issues.length === 0
      ? '本次审查未发现能够闭环的问题。'
      : highestSeverity === 'unknown'
        ? `报告包含 ${extraction.issues.length} 个审查问题。`
        : `报告包含 ${extraction.issues.length} 个审查问题，最高严重度为${severityLabels[highestSeverity]}。`,
    status: 'ready',
    issues: extraction.issues
  }
}
