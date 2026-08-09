import { describe, expect, it } from 'vitest'

import { extractReviewIssues, inspectReviewIssues } from '../review-issues'
import { REVIEW_TEMPLATE_PREVIEWS } from '../review-template-previews'
import {
  bmsCodeReviewerPcBmsReportFixture,
  bmsCodeReviewerReportRealVariantsFixture,
  bmsCodeReviewerReportWithIssuesFixture,
  bmsCodeReviewerZeroIssuesFixture,
  bmsDs03ReportFixture,
  templateOneReportFixture,
  templateTwoConclusionReportFixture,
  templateTwoTableReportFixture
} from './fixtures/review-report-fixtures'

describe('extractReviewIssues', () => {
  it('按 bms-code-reviewer 固定模板提取问题标题、描述、严重度和代码位置', () => {
    const issues = extractReviewIssues(bmsCodeReviewerReportWithIssuesFixture)

    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({
      issueText: 'P01 [高风险] 休眠状态仍可打开充电 MOS',
      descriptionText:
        '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      source: 'bms_code_reviewer_heading',
      severity: 'high',
      codeLocations: [
        { file: 'source/control.c', line: '88', description: 'ApplyChargeMos 中的充电 MOS 输出动作' },
        { file: 'source/state.c', line: '120-135', description: '休眠状态的守卫条件' }
      ]
    })
    expect(issues[1]).toMatchObject({
      issueText: 'P02 [建议] 补充休眠恢复路径的往返测试',
      severity: 'suggestion',
      codeLocations: [
        { file: 'tests/state_test.c', line: '42', description: '现有休眠恢复测试入口' }
      ]
    })
  })

  it('兼容真实服务端 CR 编号与短严重度且保持审查问题章节边界', () => {
    const issues = extractReviewIssues(bmsCodeReviewerReportRealVariantsFixture)

    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({
      issueText: 'CR-001 [高] 休眠状态仍可打开充电 MOS',
      descriptionText:
        '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      source: 'bms_code_reviewer_heading',
      severity: 'high',
      codeLocations: [
        { file: 'source/control.c', line: '88', description: 'ApplyChargeMos 中的充电 MOS 输出动作' },
        { file: 'source/state.c', line: '120-135', description: '休眠状态的守卫条件' }
      ]
    })
    expect(issues[1]).toMatchObject({
      issueText: 'CR-004 [中] 故障恢复路径缺少状态一致性校验',
      descriptionText: '故障清除后直接切换运行状态，未校验受控输出与目标状态是否一致。',
      source: 'bms_code_reviewer_heading',
      severity: 'medium',
      codeLocations: [
        { file: 'source/state.c', line: '166-174', description: '故障恢复后的状态切换入口' }
      ]
    })
    expect(issues.map((issue) => issue.issueText)).not.toContain(
      'CR-999 [高] 覆盖统计标题不得识别为问题'
    )
    expect(issues.map((issue) => issue.issueText)).not.toContain(
      'CR-998 [低] 非问题章节标题不得识别为问题'
    )
    const lowSeverityIssues = extractReviewIssues(
      bmsCodeReviewerReportRealVariantsFixture.replace(
        'CR-004 [中] 故障恢复路径缺少状态一致性校验',
        'CR-004 [低] 故障恢复路径缺少状态一致性校验'
      )
    )
    expect(lowSeverityIssues[1]?.severity).toBe('low')
  })

  it('按真实 PC-BMS 报告结构提取三个问题并完整保留顺序、描述、位置和快照', () => {
    const issues = extractReviewIssues(bmsCodeReviewerPcBmsReportFixture)

    expect(issues).toHaveLength(3)
    expect(issues.map(({ issueText, order, severity }) => ({ issueText, order, severity }))).toEqual([
      {
        issueText:
          'PC-BMS-001 [重要] 状态处理函数新增分支后圈复杂度继续超限并使文件平均复杂度超限',
        order: 0,
        severity: 'medium'
      },
      {
        issueText: 'PC-BMS-002 [一般] 新增分支未按 Allman 风格换行放置大括号',
        order: 1,
        severity: 'low'
      },
      {
        issueText: 'PC-BMS-003 [一般] 新增 SLEEP 状态判断缺少 else 分支',
        order: 2,
        severity: 'low'
      }
    ])
    expect(issues[0]).toMatchObject({
      descriptionText:
        'BmsState_Handle 在 r2 中按公司编码规范口径计算的圈复杂度为 14，超过单函数不超过 9 的要求；文件平均复杂度约 5.33，也超过不超过 5 的要求。',
      source: 'bms_code_reviewer_heading',
      codeLocations: [
        { file: 'bms_state.c', line: '12', description: 'BmsState_Handle 状态处理入口' },
        { file: 'bms_state.c', line: '30', description: '本次新增的 BMS_STATE_SLEEP 状态分支' }
      ]
    })
    expect(issues[0]?.location.startOffset).toBe(
      bmsCodeReviewerPcBmsReportFixture.indexOf('### PC-BMS-001 [重要]')
    )
    expect(issues[0]?.displaySnapshot).toContain('**整改建议：** 将状态处理拆分')
    expect(issues[0]?.displaySnapshot).not.toContain('### PC-BMS-002 [一般]')
    expect(issues[2]?.displaySnapshot).not.toContain('\n---')
  })

  it.each([
    ['严重', 'high'],
    ['重要', 'medium'],
    ['一般', 'low'],
    ['建议', 'suggestion']
  ] as const)('将 PC-BMS 的“%s”级别映射为 %s', (label, severity) => {
    const report = bmsCodeReviewerPcBmsReportFixture.replace(
      'PC-BMS-001 [重要]',
      `PC-BMS-001 [${label}]`
    )

    expect(extractReviewIssues(report)[0]?.severity).toBe(severity)
  })

  it.each([
    ['缺少编号', '### [重要] 状态处理函数复杂度超限'],
    ['缺少风险级别', '### PC-BMS-001 状态处理函数复杂度超限'],
    ['风险级别未知', '### PC-BMS-001 [紧急] 状态处理函数复杂度超限']
  ])('拒绝 PC-BMS 固定标题%s的三级标题', (_case, replacement) => {
    const malformed = bmsCodeReviewerPcBmsReportFixture.replace(
      /^### PC-BMS-001 \[重要\].*$/m,
      replacement
    )

    expect(inspectReviewIssues(malformed)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'invalid',
      message: '“审查问题”章节不符合 bms-code-reviewer 固定模板。'
    })
  })

  it('只识别审查问题章节，排除审查覆盖及其他章节的三级标题', () => {
    const reportWithUnexpectedNonIssueHeadings = `${bmsCodeReviewerReportWithIssuesFixture}

## 五、非协议附加内容

### 风险分级口径

此段模拟异常报告中的额外三级标题，用于验证结构隔离。`
    const issueTexts = extractReviewIssues(reportWithUnexpectedNonIssueHeadings).map(
      (issue) => issue.issueText
    )

    expect(issueTexts).toEqual([
      'P01 [高风险] 休眠状态仍可打开充电 MOS',
      'P02 [建议] 补充休眠恢复路径的往返测试'
    ])
    expect(issueTexts).not.toContain('风险分级口径')
  })

  it('按固定模板的无问题原文返回零个问题', () => {
    expect(extractReviewIssues(bmsCodeReviewerZeroIssuesFixture)).toEqual([])
  })

  it('明确报告固定模板结构损坏且不影响历史模板兜底', () => {
    const malformed = bmsCodeReviewerReportWithIssuesFixture.replace(
      '**问题描述：** 休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      '**影响风险：** 缺少问题描述字段。'
    )

    expect(inspectReviewIssues(malformed)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'invalid',
      message: '“审查问题”章节不符合 bms-code-reviewer 固定模板。'
    })
    expect(inspectReviewIssues(templateOneReportFixture)).toMatchObject({
      format: 'legacy',
      status: 'parsed'
    })
  })

  it('新版 DS-03 固定报告只提取含问题描述的正式问题且忽略审查覆盖标题', () => {
    const issues = extractReviewIssues(bmsDs03ReportFixture)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      issueText: 'P01 [高风险] 休眠状态仍可打开充电 MOS',
      descriptionText:
        '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      source: 'bms_code_reviewer_heading'
    })
    expect(issues[0].displaySnapshot).toContain(
      '| `source/control.c` | 88 | `ApplyChargeMos` 中的充电 MOS 输出动作 |'
    )
    expect(issues[0].displaySnapshot).not.toContain('## 二、审查覆盖')
    expect(issues[0].displaySnapshot).not.toContain('受控输出写入点')
  })

  it('精确排除审查覆盖子标题但保留旧报告“未覆盖”章节中的正式问题', () => {
    const issues = extractReviewIssues(
      [
        '# 旧版代码审查报告',
        '## 六、未覆盖保护路径问题',
        '### 中风险：异常恢复路径未关闭输出',
        '**问题描述：** 异常恢复分支未关闭受控输出。',
        '## 七、审查覆盖',
        '### DS-03 状态机审核覆盖',
        '已判定 12 个写入点。'
      ].join('\n')
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      issueText: '中风险：异常恢复路径未关闭输出',
      descriptionText: '异常恢复分支未关闭受控输出。'
    })
  })

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
