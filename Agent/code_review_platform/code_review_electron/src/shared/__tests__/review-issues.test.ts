import { describe, expect, it } from 'vitest'

import { extractReviewIssues } from '../review-issues'
import { REVIEW_TEMPLATE_PREVIEWS } from '../review-template-previews'
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
        descriptionText: '配置项未填写导致软件版本与工程配置不一致。',
        displayText: '部门自检项结果 · 中风险 · 配置项未填写导致软件版本与工程配置不一致。',
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
    expect(extractReviewIssues(REVIEW_TEMPLATE_PREVIEWS.template_1)).toEqual([])
    expect(extractReviewIssues(REVIEW_TEMPLATE_PREVIEWS.template_2)).toEqual([])
  })

  it('保留以“填写”开头的真实问题', () => {
    const templateOneIssues = extractReviewIssues(
      [
        '# 代码审查报告-模版一',
        '## 五、代码质量问题',
        '### 填写设备编号后页面崩溃',
        '- **问题描述：** 输入超长设备编号时发生越界访问。'
      ].join('\n')
    )
    const templateTwoIssues = extractReviewIssues(
      [
        '# 代码审查报告模板二',
        '## 二、流程节点详细审查报告',
        '### 1. 部门专项风险检查',
        '| 风险级别 | 专项检查方向 | 缺陷描述 |',
        '|---|---|---|',
        '| 高风险 | 设备编号 | 填写设备编号后页面崩溃。 |',
        '| 中风险 | 风险选项 | 风险级别错误显示高风险/中风险/低风险/建议，用户无法选择。 |'
      ].join('\n')
    )

    expect(templateOneIssues.map((issue) => issue.issueText)).toEqual([
      '填写设备编号后页面崩溃'
    ])
    expect(templateTwoIssues.map((issue) => issue.descriptionText)).toEqual([
      '填写设备编号后页面崩溃。',
      '风险级别错误显示高风险/中风险/低风险/建议，用户无法选择。'
    ])
  })
})
