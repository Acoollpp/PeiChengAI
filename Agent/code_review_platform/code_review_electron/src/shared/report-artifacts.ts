export const REVIEW_REPORT_FILE_NAME = '代码审查报告.md'
export const REVIEW_REPORT_IMAGES_DIR_NAME = 'images'

export interface BuildReviewReportFileNameInput {
  oldRevision: string
  newRevision: string
  generatedAt?: Date
}

export const buildReviewReportFileName = ({
  oldRevision,
  newRevision,
  generatedAt = new Date()
}: BuildReviewReportFileNameInput): string => {
  const timestamp = formatReportTimestamp(generatedAt)

  if (isFullReviewOldRevision(oldRevision)) {
    return `全量审查_${normalizeRevisionForReportName(newRevision)}_${timestamp}.md`
  }

  return `${normalizeRevisionForReportName(oldRevision)}_${normalizeRevisionForReportName(
    newRevision
  )}审查报告_${timestamp}.md`
}

export const isFullReviewOldRevision = (revision: string): boolean =>
  normalizeRevisionForReportName(revision) === 'r0'

export const normalizeRevisionForReportName = (revision: string): string => {
  const trimmed = revision.trim()
  const withoutPrefix = trimmed.replace(/^[rR]+/, '')

  return `r${withoutPrefix}`
}

const formatReportTimestamp = (value: Date): string => {
  const year = value.getFullYear()
  const month = padDatePart(value.getMonth() + 1)
  const day = padDatePart(value.getDate())
  const hours = padDatePart(value.getHours())
  const minutes = padDatePart(value.getMinutes())
  const seconds = padDatePart(value.getSeconds())

  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

const padDatePart = (value: number): string => value.toString().padStart(2, '0')
