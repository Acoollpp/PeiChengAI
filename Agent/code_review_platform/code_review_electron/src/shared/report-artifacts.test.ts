import { describe, expect, it } from 'vitest'

import {
  REVIEW_REPORT_FILE_NAME,
  buildReviewReportFileName,
  normalizeRevisionForReportName
} from './report-artifacts'

describe('report artifacts', () => {
  it('builds a dynamic report file name with normalized revisions and local timestamp', () => {
    const fileName = buildReviewReportFileName({
      oldRevision: '123',
      newRevision: '456',
      generatedAt: new Date(2026, 5, 10, 14, 25, 30)
    })

    expect(fileName).toBe('r123_r456审查报告_20260610_142530.md')
  })

  it('does not duplicate r prefixes in report file names', () => {
    expect(normalizeRevisionForReportName('r123')).toBe('r123')
    expect(normalizeRevisionForReportName('R456')).toBe('r456')
    expect(
      buildReviewReportFileName({
        oldRevision: 'r123',
        newRevision: 'R456',
        generatedAt: new Date(2026, 5, 10, 14, 25, 30)
      })
    ).toBe('r123_r456审查报告_20260610_142530.md')
  })

  it('keeps the historical fallback report file name available', () => {
    expect(REVIEW_REPORT_FILE_NAME).toBe('代码审查报告.md')
  })
})
