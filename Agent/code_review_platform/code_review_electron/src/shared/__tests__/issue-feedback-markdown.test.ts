import { describe, expect, it } from 'vitest'

import { composeIssueFeedbackMarkdown } from '../issue-feedback-markdown'
import { extractReviewIssues } from '../review-issues'
import type { ReviewTaskIssue } from '../types'
import {
  bmsCodeReviewerReportWithIssuesFixture,
  templateOneReportFixture,
  templateTwoConclusionReportFixture,
  templateTwoTableReportFixture
} from './fixtures/review-report-fixtures'

const toServerIssue = (
  markdown: string,
  order: number,
  helpful: boolean,
  feedbackText?: string
): ReviewTaskIssue => {
  const issue = extractReviewIssues(markdown)[order]
  return {
    id: `issue-${order}`,
    task_id: 'task-1',
    issue_text: issue.issueText,
    description_text: issue.descriptionText,
    display_snapshot: issue.displaySnapshot,
    order: issue.order,
    source: issue.source,
    location: {
      start_offset: issue.location.startOffset,
      end_offset: issue.location.endOffset,
      feedback_insertion_offset: issue.location.feedbackInsertionOffset,
      anchor_line: issue.location.anchorLine,
      heading_level: issue.location.headingLevel
    },
    helpful,
    feedback_text: feedbackText
  }
}

const countTableDelimiters = (row: string): number => {
  let count = 0
  let codeDelimiter = ''
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '`') {
      let end = index
      while (row[end] === '`') end += 1
      const delimiter = row.slice(index, end)
      codeDelimiter = codeDelimiter === delimiter ? '' : delimiter
      index = end - 1
    } else if (row[index] === '|' && !codeDelimiter) {
      count += 1
    }
  }
  return count
}

describe('composeIssueFeedbackMarkdown', () => {
  it('新版固定模板把多问题反馈插入对应问题下方且不串位', () => {
    const original = bmsCodeReviewerReportWithIssuesFixture
    const issues = [
      toServerIssue(original, 0, false, '休眠保护路径需要统一收口'),
      toServerIssue(original, 1, true, '往返测试建议已纳入用例')
    ]

    const composed = composeIssueFeedbackMarkdown(original, issues)
    const firstFeedbackOffset = composed.indexOf('休眠保护路径需要统一收口')
    const secondIssueOffset = composed.indexOf('### P02 [建议]')
    const secondFeedbackOffset = composed.indexOf('往返测试建议已纳入用例')
    const coverageOffset = composed.indexOf('## 四、审查覆盖')

    expect(firstFeedbackOffset).toBeGreaterThan(composed.indexOf('### P01 [高风险]'))
    expect(firstFeedbackOffset).toBeLessThan(secondIssueOffset)
    expect(secondFeedbackOffset).toBeGreaterThan(secondIssueOffset)
    expect(secondFeedbackOffset).toBeLessThan(coverageOffset)
    expect(composed.match(/> 是否有效：/g)).toHaveLength(2)
  })

  it('CRLF 报告保持问题快照定位并生成反馈 Markdown', () => {
    const original = templateOneReportFixture.replaceAll('\n', '\r\n')
    const issue = toServerIssue(original, 0, true, '已确认并修复')

    const composed = composeIssueFeedbackMarkdown(original, [issue])

    expect(composed).toContain('> 是否有效：有效')
    expect(composed).toContain('> 用户反馈：`已确认并修复`')
    expect(composed.indexOf('> 是否有效：有效')).toBeLessThan(
      composed.indexOf('### 2. 中风险：重复问题标题')
    )
    expect(original).toContain('\r\n')
  })

  it('模板一把多问题反馈插入各自内容末尾且不改变原始内容', () => {
    const original = templateOneReportFixture
    const issues = [
      toServerIssue(original, 0, true, '定位很准确\n已补充空值判断'),
      toServerIssue(original, 1, false),
      toServerIssue(original, 2, true, '修复时参考了 `size` 与 ![示例](missing.png)')
    ]

    const composed = composeIssueFeedbackMarkdown(original, issues)

    expect(original).toBe(templateOneReportFixture)
    expect(composed).toContain(
      '> 是否有效：有效\n>\n> 用户反馈：`定位很准确`\n> `已补充空值判断`'
    )
    expect(composed).toContain('> 是否有效：无效\n>\n> 用户反馈：未填写')
    expect(composed).toContain(
      '> 用户反馈：``修复时参考了 `size` 与 ![示例](missing.png)``'
    )
    expect(composed.indexOf('> 是否有效：有效')).toBeLessThan(
      composed.indexOf('### 2. 中风险：重复问题标题')
    )
    expect(composed.lastIndexOf('> 是否有效：有效')).toBeLessThan(
      composed.indexOf('---')
    )
  })

  it('模板二把反馈追加到原表格最后一格且不增加列', () => {
    const original = templateTwoTableReportFixture
    const issues = [
      toServerIssue(original, 0, true, '已修复 | 并验证'),
      toServerIssue(original, 1, false)
    ]

    const composed = composeIssueFeedbackMarkdown(original, issues)
    const feedbackRows = composed
      .split('\n')
      .filter((line) => line.includes('是否有效：'))

    expect(feedbackRows).toHaveLength(2)
    expect(feedbackRows[0]).toContain(
      '<br />是否有效：有效<br />用户反馈：`已修复 | 并验证` |'
    )
    expect(feedbackRows[1]).toContain(
      '<br />是否有效：无效<br />用户反馈：未填写 |'
    )
    const originalIssueRows = original
      .split('\n')
      .filter((line) => line.includes('配置项未填写') || line.includes('SOH 字段映射缺失'))
    expect(feedbackRows.map(countTableDelimiters)).toEqual(
      originalIssueRows.map(countTableDelimiters)
    )
    expect(original).toBe(templateTwoTableReportFixture)
  })

  it('模板二结论兜底问题在原列表项后插入反馈', () => {
    const original = templateTwoConclusionReportFixture
    const issue = toServerIssue(original, 0, true, '补充了数组边界校验')

    const composed = composeIssueFeedbackMarkdown(original, [issue])

    expect(composed).toContain(
      '- 未校验数组下标，可能发生越界访问。\n\n> 是否有效：有效'
    )
    expect(composed).toContain('> 用户反馈：`补充了数组边界校验`')
  })

  it('拒绝未评价或与原始报告不一致的问题快照', () => {
    const original = templateOneReportFixture
    const issue = toServerIssue(original, 0, true)

    expect(() =>
      composeIssueFeedbackMarkdown(original, [{ ...issue, helpful: null }])
    ).toThrow('尚未评价')
    expect(() =>
      composeIssueFeedbackMarkdown(original, [
        { ...issue, display_snapshot: '### 已被替换的问题' }
      ])
    ).toThrow('原始报告内容不一致')
  })
})
