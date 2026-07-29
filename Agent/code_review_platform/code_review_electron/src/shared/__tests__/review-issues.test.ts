import { describe, expect, it } from 'vitest'

import { extractReviewIssues } from '../review-issues'
import {
  templateOneReportFixture,
  templateTwoConclusionReportFixture,
  templateTwoTableReportFixture
} from './fixtures/review-report-fixtures'

describe('extractReviewIssues', () => {
  it('按模板一叶子标题保留问题快照、描述、顺序和重复标题定位', () => {
    const issues = extractReviewIssues(templateOneReportFixture)

    expect(
      issues.map(({ issueText, descriptionText, order, source, anchorId }) => ({
        issueText,
        descriptionText,
        order,
        source,
        anchorId
      }))
    ).toEqual([
      {
        issueText: '高风险：空指针解引用',
        descriptionText: '未校验返回值即解引用，错误分支会触发崩溃。',
        order: 0,
        source: 'template_1_heading',
        anchorId: 'report-option-9'
      },
      {
        issueText: '中风险：重复问题标题',
        descriptionText: '第一个重复标题对应模块 A 的越界写入。',
        order: 1,
        source: 'template_1_heading',
        anchorId: 'report-option-15'
      },
      {
        issueText: '中风险：重复问题标题',
        descriptionText: '第二个重复标题对应模块 B 的越界写入。',
        order: 2,
        source: 'template_1_heading',
        anchorId: 'report-option-19'
      }
    ])
    expect(issues[0]?.displaySnapshot).toContain('![空指针路径](images/null-pointer.png)')
    expect(issues[0]?.displaySnapshot).not.toContain('代码块中的标题不属于审查问题')
    expect(issues[0]?.location.startOffset).toBe(
      templateOneReportFixture.indexOf('### 1. 高风险：空指针解引用')
    )
    expect(issues[2]?.location.feedbackInsertionOffset).toBe(
      templateOneReportFixture.indexOf('---')
    )
  })

  it('模板二优先按有效表格行提取问题并过滤占位行', () => {
    const issues = extractReviewIssues(templateTwoTableReportFixture)

    expect(
      issues.map(({ issueText, descriptionText, displayText, order, source, anchorId }) => ({
        issueText,
        descriptionText,
        displayText,
        order,
        source,
        anchorId
      }))
    ).toEqual([
      {
        issueText: '中风险 · 部门自检项结果',
        descriptionText: '软件版本与工程配置不一致。',
        displayText: '部门自检项结果 · 中风险 · 软件版本与工程配置不一致。',
        order: 0,
        source: 'template_2_table_row',
        anchorId: 'report-option-8'
      },
      {
        issueText: '高风险 · SOH 容量映射',
        descriptionText: 'SOH 字段映射缺失。',
        displayText: '部门专项风险检查 · 高风险 · SOH 容量映射 · SOH 字段映射缺失。',
        order: 1,
        source: 'template_2_table_row',
        anchorId: 'report-option-15'
      }
    ])
    expect(issues[1]?.displaySnapshot).toContain('![映射](images/soh.png)')
    expect(issues.every((issue) => issue.source === 'template_2_table_row')).toBe(true)
  })

  it('模板二没有有效表格行时使用结论列表项兜底', () => {
    const issues = extractReviewIssues(templateTwoConclusionReportFixture)

    expect(
      issues.map(({ issueText, descriptionText, displayText, order, source, anchorId }) => ({
        issueText,
        descriptionText,
        displayText,
        order,
        source,
        anchorId
      }))
    ).toEqual([
      {
        issueText: '高风险项总结 · 未校验数组下标，可能发生越界访问。',
        descriptionText: '未校验数组下标，可能发生越界访问。',
        displayText: '高风险项总结 · 未校验数组下标，可能发生越界访问。',
        order: 0,
        source: 'template_2_conclusion_item',
        anchorId: 'report-option-14'
      },
      {
        issueText: '中低风险及建议项 · 建议补充协议字段的边界值测试。',
        descriptionText: '建议补充协议字段的边界值测试。',
        displayText: '中低风险及建议项 · 建议补充协议字段的边界值测试。',
        order: 1,
        source: 'template_2_conclusion_item',
        anchorId: 'report-option-18'
      }
    ])
  })

  it('零问题报告和仅含占位内容的报告不创建虚假问题', () => {
    expect(
      extractReviewIssues(
        [
          '# 代码审查报告-模版一',
          '## 五、代码质量问题',
          '本次未发现明确代码质量问题。',
          '```markdown',
          '### 高风险：代码块示例',
          '- **问题描述：** 示例内容。',
          '```'
        ].join('\n')
      )
    ).toEqual([])
    expect(extractReviewIssues('')).toEqual([])
  })
})
