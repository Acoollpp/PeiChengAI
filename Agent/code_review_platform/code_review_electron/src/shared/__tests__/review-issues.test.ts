import { describe, expect, it } from 'vitest'

import { extractReviewIssues, inspectReviewIssues } from '../review-issues'
import {
  bmsCodeReviewerHistoricalDs02ReportFixture,
  bmsCodeReviewerHistoricalPcBmsReportFixture,
  bmsCodeReviewerNoSeverityReportFixture,
  bmsCodeReviewerNoSeverityZeroReportFixture,
  bmsCodeReviewerPcBmsReportFixture,
  bmsCodeReviewerReportRealVariantsFixture,
  bmsCodeReviewerSearchEvidenceReportFixture,
  bmsCodeReviewerReportWithIssuesFixture,
  bmsCodeReviewerZeroIssuesFixture,
  bmsDs03ReportFixture,
  templateOneReportFixture,
  templateTwoConclusionReportFixture,
  templateTwoTableReportFixture
} from './fixtures/review-report-fixtures'

describe('extractReviewIssues', () => {
  it('按最新版证据合同提取完全缺失型与混合证据问题', () => {
    const result = inspectReviewIssues(bmsCodeReviewerSearchEvidenceReportFixture)

    expect(result).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed'
    })
    expect(result.issues).toMatchObject([
      {
        issueText: 'DS-07 休眠路径未恢复运行状态的完全缺失问题',
        descriptionText: '唤醒路径没有恢复运行状态的实现，否定性检索证据表明该功能完全缺失。',
        codeLocations: []
      },
      {
        issueText: 'DS-04 混合证据问题仍保留代码位置',
        codeLocations: [
          { file: 'source/config.c', line: '88', description: '配置读取失败后的默认值分支' }
        ]
      }
    ])
  })

  it('证据表格式异常不阻断标题和描述可识别的问题快照', () => {
    const malformedCodeLocation = bmsCodeReviewerSearchEvidenceReportFixture.replace(
      '| `source/config.c` | 88 | 配置读取失败后的默认值分支 |',
      '| `source/config.c` | 88 | |'
    )
    const malformedSearchEvidence = malformedCodeLocation.replace(
      '| new；source | RestoreRunningState；SLEEP | `rg -n "RestoreRunningState|SLEEP" source` | 无 | not_found：已检查候选范围内没有恢复运行状态的实现。 |',
      '| new；source | RestoreRunningState；SLEEP | `rg -n "RestoreRunningState|SLEEP" source` | | not_found：已检查候选范围内没有恢复运行状态的实现。 |'
    )

    const result = inspectReviewIssues(malformedSearchEvidence)

    expect(result).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed',
      issues: [
        expect.objectContaining({
          issueText: 'DS-07 休眠路径未恢复运行状态的完全缺失问题',
          codeLocations: []
        }),
        expect.objectContaining({
          issueText: 'DS-04 混合证据问题仍保留代码位置',
          codeLocations: []
        })
      ]
    })
  })

  it('按最新无严重度合同提取任意编号问题并排除审查覆盖三级标题', () => {
    const result = inspectReviewIssues(bmsCodeReviewerNoSeverityReportFixture)

    expect(result).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed'
    })
    expect(
      result.issues.map(({ issueText, order, severity }) => ({
        issueText,
        order,
        severity
      }))
    ).toEqual([
      {
        issueText: 'STATE-17 休眠高风险路径仍可打开充电 MOS',
        order: 0,
        severity: undefined
      },
      {
        issueText: '编号-任意-42 建议路径缺少故障恢复一致性校验',
        order: 1,
        severity: undefined
      }
    ])
    expect(result.issues[0]).toMatchObject({
      descriptionText: expect.stringContaining('BmsState_Handle'),
      codeLocations: [
        { file: 'source/bms_state.c', line: '128-141', description: '休眠状态分支的守卫条件' },
        { file: 'source/bms_output.c', line: '76', description: '充电 MOS 最终输出动作' }
      ]
    })
    expect(result.issues[0]?.displaySnapshot).toContain('**材料或生成证据：**')
    expect(result.issues[0]?.displaySnapshot).not.toContain('### 编号-任意-42')
    expect(result.issues[1]?.displaySnapshot).not.toContain('### 范围与材料覆盖')
    expect(result.issues.map((issue) => issue.issueText)).not.toContain('范围与材料覆盖')
    expect(result.issues.map((issue) => issue.issueText)).not.toContain('枚举与判定覆盖')
    expect(result.issues[0]?.location.startOffset).toBe(
      bmsCodeReviewerNoSeverityReportFixture.indexOf('### STATE-17')
    )
    expect(result.issues[0]?.location.feedbackInsertionOffset).toBeLessThan(
      bmsCodeReviewerNoSeverityReportFixture.indexOf('### 编号-任意-42')
    )
    expect(result.issues[1]?.location.feedbackInsertionOffset).toBeLessThan(
      bmsCodeReviewerNoSeverityReportFixture.indexOf('## 四、审查覆盖')
    )
  })

  it('无严重度 BMS 问题快照保留数字与中文章节式任意编号', () => {
    const numberedReport = bmsCodeReviewerNoSeverityReportFixture
      .replace(
        '### STATE-17 休眠高风险路径仍可打开充电 MOS',
        '### 17. 休眠高风险路径仍可打开充电 MOS'
      )
      .replace(
        '### 编号-任意-42 建议路径缺少故障恢复一致性校验',
        '### 一、建议路径缺少故障恢复一致性校验'
      )

    expect(extractReviewIssues(numberedReport).map((issue) => issue.issueText)).toEqual([
      '17. 休眠高风险路径仍可打开充电 MOS',
      '一、建议路径缺少故障恢复一致性校验'
    ])
  })

  it('历史标题保留外层章节序号且按归一化标题识别严重度', () => {
    const numberedReport = bmsCodeReviewerReportWithIssuesFixture
      .replace(
        '### P01 [高风险] 休眠状态仍可打开充电 MOS',
        '### 1. P01 [高风险] 休眠状态仍可打开充电 MOS'
      )
      .replace(
        '### P02 [建议] 补充休眠恢复路径的往返测试',
        '### 一、CR-001 [中] 补充休眠恢复路径的往返测试'
      )

    expect(
      extractReviewIssues(numberedReport).map(({ issueText, severity }) => ({
        issueText,
        severity
      }))
    ).toEqual([
      {
        issueText: '1. P01 [高风险] 休眠状态仍可打开充电 MOS',
        severity: 'high'
      },
      {
        issueText: '一、CR-001 [中] 补充休眠恢复路径的往返测试',
        severity: 'medium'
      }
    ])
  })

  it.each([
    'P01 [高风险]',
    'CR-001 [中]',
    'PC-BMS-001 [严重]',
    'DS-02-001 [低]',
    '1. P01 [高风险]',
    '一、CR-001 [中]'
  ])('历史编号与严重度后缺少问题标题时整节无效：%s', (incompleteHeading) => {
    const malformed = bmsCodeReviewerReportWithIssuesFixture.replace(
      'P01 [高风险] 休眠状态仍可打开充电 MOS',
      incompleteHeading
    )

    expect(inspectReviewIssues(malformed)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'invalid',
      issues: []
    })
  })

  it('按 bms-code-reviewer 固定模板提取问题标题、描述、严重度和代码位置', () => {
    const issues = extractReviewIssues(bmsCodeReviewerReportWithIssuesFixture)

    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({
      issueText: 'P01 [高风险] 休眠状态仍可打开充电 MOS',
      descriptionText: '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      source: 'bms_code_reviewer_heading',
      severity: 'high',
      codeLocations: [
        {
          file: 'source/control.c',
          line: '88',
          description: 'ApplyChargeMos 中的充电 MOS 输出动作'
        },
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
      descriptionText: '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      source: 'bms_code_reviewer_heading',
      severity: 'high',
      codeLocations: [
        {
          file: 'source/control.c',
          line: '88',
          description: 'ApplyChargeMos 中的充电 MOS 输出动作'
        },
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
    expect(
      issues.map(({ issueText, order, severity }) => ({ issueText, order, severity }))
    ).toEqual([
      {
        issueText: 'PC-BMS-001 [重要] 状态处理函数新增分支后圈复杂度继续超限并使文件平均复杂度超限',
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

  it('解析合同固定前的真实 PC-BMS 风险词报告并保留两个问题的完整快照', () => {
    const issues = extractReviewIssues(bmsCodeReviewerHistoricalPcBmsReportFixture)

    expect(
      issues.map(({ issueText, order, severity, anchorId }) => ({
        issueText,
        order,
        severity,
        anchorId
      }))
    ).toEqual([
      {
        issueText:
          'PC-BMS-001 [高] FAULT 分支将 RESET 判断写成赋值表达式，非 RESET 事件会隐式清除故障态',
        order: 0,
        severity: 'high',
        anchorId: expect.stringMatching(/^report-option-\d+$/)
      },
      {
        issueText:
          'PC-BMS-002 [高] 充电超时保护只新增事件枚举，CHARGING 状态未在 1800 秒或 TIMEOUT 事件进入 FAULT',
        order: 1,
        severity: 'high',
        anchorId: expect.stringMatching(/^report-option-\d+$/)
      }
    ])
    expect(issues[0]).toMatchObject({
      descriptionText: expect.stringContaining('if (event = BMS_EVENT_RESET)'),
      codeLocations: [
        { file: 'bms_state.c', line: '36', description: 'BMS_STATE_FAULT 分支入口' },
        { file: 'bms_state.c', line: '37', description: '将复位判断写为 event = BMS_EVENT_RESET' },
        {
          file: 'bms_state.c',
          line: '38',
          description: '条件成立后将 current_state 设置为 BMS_STATE_IDLE'
        },
        {
          file: 'bms_state.h',
          line: '18',
          description: expect.stringContaining('BMS_EVENT_TIMEOUT')
        }
      ]
    })
    expect(issues[0]?.displaySnapshot).toContain('**整改建议：** 将条件恢复为')
    expect(issues[0]?.displaySnapshot).not.toContain('### PC-BMS-002 [高]')
    expect(issues[1]?.displaySnapshot).not.toContain('## 四、审查覆盖')
    expect(issues[0]?.location.startOffset).toBe(
      bmsCodeReviewerHistoricalPcBmsReportFixture.indexOf('### PC-BMS-001 [高]')
    )
  })

  it('解析合同固定前的真实 DS-02 编号报告并保留描述、位置、顺序和锚点', () => {
    const issues = extractReviewIssues(bmsCodeReviewerHistoricalDs02ReportFixture)

    expect(
      issues.map(({ issueText, order, severity }) => ({ issueText, order, severity }))
    ).toEqual([
      {
        issueText: 'DS-02-001 [高] FAULT 分支条件由比较表达式误改为赋值表达式',
        order: 0,
        severity: 'high'
      },
      {
        issueText: 'DS-02-002 [中] 新增 SLEEP 状态分支的 if 缺少 else 分支',
        order: 1,
        severity: 'medium'
      },
      {
        issueText: 'DS-02-003 [低] 新增控制语句未采用 Allman 大括号风格',
        order: 2,
        severity: 'low'
      }
    ])
    expect(issues[0]).toMatchObject({
      descriptionText: expect.stringContaining('if (event = BMS_EVENT_RESET)'),
      codeLocations: [
        {
          file: 'bms_state.c',
          line: '37',
          description: expect.stringContaining('BMS_STATE_FAULT')
        },
        { file: 'bms_state.h', line: '19', description: 'BMS_EVENT_RESET 枚举值定义' }
      ]
    })
    expect(issues.map((issue) => issue.anchorId)).toEqual([
      expect.stringMatching(/^report-option-\d+$/),
      expect.stringMatching(/^report-option-\d+$/),
      expect.stringMatching(/^report-option-\d+$/)
    ])
    expect(new Set(issues.map((issue) => issue.anchorId)).size).toBe(3)
    expect(issues[1]?.displaySnapshot).not.toContain('### DS-02-003 [低]')
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
    ['高风险', 'high'],
    ['高', 'high'],
    ['中风险', 'medium'],
    ['中', 'medium'],
    ['低风险', 'low'],
    ['低', 'low'],
    ['建议', 'suggestion']
  ] as const)('有界兼容 PC-BMS 和 DS-02 历史“%s”级别', (label, severity) => {
    const pcBmsReport = bmsCodeReviewerHistoricalPcBmsReportFixture.replace(
      'PC-BMS-001 [高]',
      `PC-BMS-001 [${label}]`
    )
    const ds02Report = bmsCodeReviewerHistoricalDs02ReportFixture.replace(
      'DS-02-001 [高]',
      `DS-02-001 [${label}]`
    )

    expect(extractReviewIssues(pcBmsReport)[0]?.severity).toBe(severity)
    expect(extractReviewIssues(ds02Report)[0]?.severity).toBe(severity)
  })

  it('兼容合同固定前的非三位 PC-BMS 编号', () => {
    const report = bmsCodeReviewerHistoricalPcBmsReportFixture
      .replace('PC-BMS-001 [高]', 'PC-BMS-1 [高]')
      .replace('PC-BMS-002 [高]', 'PC-BMS-2 [高]')

    expect(inspectReviewIssues(report)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed'
    })
    expect(extractReviewIssues(report).map((issue) => issue.issueText)).toEqual([
      expect.stringContaining('PC-BMS-1 [高]'),
      expect.stringContaining('PC-BMS-2 [高]')
    ])
  })

  it('未识别问题描述时仍保留标题、完整问题块和空描述', () => {
    const report = bmsCodeReviewerNoSeverityReportFixture.replace(
      /^\*\*问题描述：\*\*.*\n/m,
      ''
    )

    expect(inspectReviewIssues(report)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed',
      issues: [
        expect.objectContaining({
          issueText: 'STATE-17 休眠高风险路径仍可打开充电 MOS',
          descriptionText: ''
        }),
        expect.objectContaining({
          issueText: '编号-任意-42 建议路径缺少故障恢复一致性校验'
        })
      ]
    })
  })

  it.each([
    [
      '标题缺少编号',
      (report: string) =>
        report.replace('### STATE-17 休眠高风险路径仍可打开充电 MOS', '### 普通说明')
    ],
    [
      '占位标题',
      (report: string) =>
        report.replace('### STATE-17 休眠高风险路径仍可打开充电 MOS', '### <问题编号> <问题标题>')
    ]
  ])('缺少问题身份时整节无效且不返回部分快照', (_case, mutate) => {
    const malformed = mutate(bmsCodeReviewerNoSeverityReportFixture)

    expect(inspectReviewIssues(malformed)).toEqual({
      format: 'bms_code_reviewer',
      status: 'invalid',
      issues: [],
      message: '“审查问题”章节不符合 bms-code-reviewer 固定模板。'
    })
  })

  it.each([
    ['缺少所属审查项', (report: string) => report.replace(/^\*\*所属审查项：\*\*.*\n/m, '')],
    ['缺少规则章节', (report: string) => report.replace(/^\*\*规则章节：\*\*.*\n/m, '')],
    ['缺少影响风险', (report: string) => report.replace(/^\*\*影响风险：\*\*.*\n/m, '')],
    ['缺少整改建议', (report: string) => report.replace(/^\*\*整改建议：\*\*.*\n/m, '')],
    ['缺少位置表', (report: string) => report.replace('**涉及文件及行号：**', '**相关位置：**')],
    [
      '位置说明为空',
      (report: string) =>
        report.replace(
          '| `source/bms_state.c` | 128-141 | 休眠状态分支的守卫条件 |',
          '| `source/bms_state.c` | 128-141 | |'
        )
    ],
    [
      '位置说明为占位值',
      (report: string) =>
        report.replace(
          '休眠状态分支的守卫条件',
          '<该位置在本问题中的角色，如状态判断、状态写入、输出动作、调用入口>'
        )
    ],
    [
      '第二个位置行无效',
      (report: string) =>
        report.replace(
          '| `source/bms_output.c` | 76 | 充电 MOS 最终输出动作 |',
          '| `<file>` | `<line>` | 充电 MOS 最终输出动作 |'
        )
    ],
    [
      '文件为空',
      (report: string) =>
        report.replace(
          '| `source/bms_state.c` | 128-141 | 休眠状态分支的守卫条件 |',
          '| | 128-141 | 休眠状态分支的守卫条件 |'
        )
    ],
    [
      '行号为空',
      (report: string) =>
        report.replace(
          '| `source/bms_state.c` | 128-141 | 休眠状态分支的守卫条件 |',
          '| `source/bms_state.c` | | 休眠状态分支的守卫条件 |'
        )
    ],
    [
      '文件为占位值',
      (report: string) =>
        report.replace(
          '| `source/bms_state.c` | 128-141 | 休眠状态分支的守卫条件 |',
          '| `<file>` | 128-141 | 休眠状态分支的守卫条件 |'
        )
    ],
    [
      '行号为占位值',
      (report: string) =>
        report.replace(
          '| `source/bms_state.c` | 128-141 | 休眠状态分支的守卫条件 |',
          '| `source/bms_state.c` | `<line>` | 休眠状态分支的守卫条件 |'
        )
    ],
  ])('辅助字段或代码证据异常时仍保留可定位的问题快照：%s', (_case, mutate) => {
    const malformed = mutate(bmsCodeReviewerNoSeverityReportFixture)

    expect(inspectReviewIssues(malformed)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed',
      issues: [
        expect.objectContaining({
          issueText: 'STATE-17 休眠高风险路径仍可打开充电 MOS'
        }),
        expect.objectContaining({
          issueText: '编号-任意-42 建议路径缺少故障恢复一致性校验'
        })
      ]
    })
  })

  it('审查问题章节混入普通三级标题时整节无效', () => {
    const malformed = bmsCodeReviewerNoSeverityReportFixture.replace(
      '## 四、审查覆盖',
      '### 普通说明\n\n这不是合法问题块。\n\n## 四、审查覆盖'
    )

    expect(inspectReviewIssues(malformed)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'invalid',
      issues: []
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

  it.each([
    ['无句号', ''],
    ['中文句号', '。'],
    ['英文句号', '.']
  ])('按最新无严重度合同的零问题原文兼容%s', (_label, punctuation) => {
    const report = bmsCodeReviewerNoSeverityZeroReportFixture.replace(
      '本次未发现能够闭环的问题',
      `本次未发现能够闭环的问题${punctuation}`
    )

    expect(inspectReviewIssues(report)).toEqual({
      format: 'bms_code_reviewer',
      status: 'parsed',
      issues: []
    })
    expect(extractReviewIssues(report)).toEqual([])
  })

  it.each([
    '本次未发现能够闭环的问题！',
    '本次未发现能够闭环的问题，已覆盖全部路径。',
    '本次未发现问题。'
  ])('零问题固定句不接受边界外文本：%s', (zeroIssueText) => {
    const report = bmsCodeReviewerNoSeverityZeroReportFixture.replace(
      '本次未发现能够闭环的问题',
      zeroIssueText
    )

    expect(inspectReviewIssues(report)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'invalid',
      issues: []
    })
  })

  it('历史固定模板的无问题原文仍返回零个问题', () => {
    expect(extractReviewIssues(bmsCodeReviewerZeroIssuesFixture)).toEqual([])
  })

  it('缺少已知问题描述标签时仍提取问题快照且不影响历史模板兜底', () => {
    const reportWithoutDescription = bmsCodeReviewerReportWithIssuesFixture.replace(
      '**问题描述：** 休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      '**影响风险：** 缺少问题描述字段。'
    )

    expect(inspectReviewIssues(reportWithoutDescription)).toMatchObject({
      format: 'bms_code_reviewer',
      status: 'parsed',
      issues: expect.arrayContaining([
        expect.objectContaining({
          issueText: 'P01 [高风险] 休眠状态仍可打开充电 MOS',
          descriptionText: ''
        })
      ])
    })
    expect(inspectReviewIssues(templateOneReportFixture)).toMatchObject({
      format: 'legacy',
      status: 'parsed'
    })
  })

  it('新版 DS-03 固定报告提取正式问题且忽略审查覆盖标题', () => {
    const issues = extractReviewIssues(bmsDs03ReportFixture)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      issueText: 'P01 [高风险] 休眠状态仍可打开充电 MOS',
      descriptionText: '休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
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

    expect(templateOneIssues.map((issue) => issue.issueText)).toEqual(['填写设备编号后页面崩溃'])
    expect(templateTwoIssues.map((issue) => issue.descriptionText)).toEqual([
      '填写设备编号后页面崩溃。',
      '风险级别错误显示高风险/中风险/低风险/建议，用户无法选择。'
    ])
  })
})
