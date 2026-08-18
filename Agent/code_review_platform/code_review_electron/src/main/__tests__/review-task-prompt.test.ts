import { describe, expect, it } from 'vitest'

import { buildBmsReviewTaskPrompt } from '../review-task-prompt'

describe('buildBmsReviewTaskPrompt', () => {
  it('生成 DS-03 新 Skill 提示词并保持 old revision 0 原样', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '0',
      newRevision: 'r130',
      departmentName: '软件开发部',
      reviewItems: [
        {
          id: 'DS-03',
          name: 'MOS 充放电状态机审查',
          user_extra_rules: '重点检查休眠唤醒状态转换',
          materials: []
        }
      ],
      reportPath: '/runtime/workspaces/task-30/report.md'
    })

    expect(prompt).toMatchSnapshot()
    expect(prompt).toContain('Skill：bms-code-reviewer')
    expect(prompt).toContain('SVN 地址：svn://example.com/bms/trunk')
    expect(prompt).toContain('旧 revision：0')
    expect(prompt).not.toContain('旧 revision：r0')
    expect(prompt).not.toContain('平台全量审查占位')
    expect(prompt).not.toContain('svn diff -r 0')
    expect(prompt).toContain('新 revision：r130')
    expect(prompt).toContain('所属部门：软件开发部')
    expect(prompt).toContain('### DS-03：MOS 充放电状态机审查')
    expect(prompt).toContain('用户额外规则：重点检查休眠唤醒状态转换')
    expect(prompt).toContain('专项材料：无')
    expect(prompt).toContain('Markdown 报告完整路径：/runtime/workspaces/task-30/report.md')
    expect(prompt).not.toContain('新报告正式问题标题合同')
    expect(prompt).not.toContain('PC-BMS-NNN')
    expect(prompt).not.toContain('严重度映射')
    expect(prompt).not.toContain('依次映射')
    expect(prompt).not.toContain('产品开发需求表')
    expect(prompt).not.toContain('重点审查方向')
  })

  it('指定证据工作目录，未提供时不产出该段落', () => {
    const input = {
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '12',
      newRevision: '14',
      reviewItems: [{ id: 'DS-03', name: 'MOS 充放电状态机审查', materials: [] }],
      reportPath: 'C:\\review\\report.md'
    }

    const withEvidenceDir = buildBmsReviewTaskPrompt({
      ...input,
      evidenceDir: 'C:\\crv\\e\\6fcddf8b'
    })
    expect(withEvidenceDir).toContain('证据工作目录：C:\\crv\\e\\6fcddf8b')
    expect(withEvidenceDir).toContain('不得在其他位置新建工作目录')

    // 没有证据目录时保持原提示词，不留空段落。
    expect(buildBmsReviewTaskPrompt(input)).not.toContain('证据工作目录')
  })

  it('空额外规则显示为无且拒绝相对报告路径', () => {
    const input = {
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '12',
      newRevision: '14',
      reviewItems: [{ id: 'DS-03', name: '状态机审核', materials: [] }],
      reportPath: 'relative/report.md'
    }

    expect(() => buildBmsReviewTaskPrompt(input)).toThrow('Markdown 报告输出路径必须是绝对路径。')
    expect(
      buildBmsReviewTaskPrompt({ ...input, reportPath: 'C:\\review\\report.md' })
    ).toContain('用户额外规则：无')

    const prompt = buildBmsReviewTaskPrompt({
      ...input,
      reportPath: '/runtime/workspaces/task-empty-rule/report.md'
    })

    expect(prompt).toMatchSnapshot()
    expect(prompt).toContain('用户额外规则：无')
  })

  it('DS-01 只输出需求表工作区副本路径且材料与额外规则保持逐项归属', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '120',
      newRevision: '130',
      departmentName: 'BMS 软件部',
      reviewItems: [{
          id: 'DS-01',
          name: '需求变更审查',
          user_extra_rules: '仅核对本次协议变更',
          materials: [
          {
            fieldId: 'requirement-sheet', name: '产品开发需求表', required: true,
            multiple: false, allowedExtensions: ['.xlsx', '.xls'],
            filePaths: ['/runtime/workspaces/task-31/materials/DS-01/requirement-sheet/需求表.xlsx']
          }
        ]
      }],
      reportPath: '/runtime/workspaces/task-31/report.md'
    })

    expect(prompt).toMatchSnapshot()
    expect(prompt).toContain('### DS-01：需求变更审查')
    expect(prompt).toContain('用户额外规则：仅核对本次协议变更')
    expect(prompt).toContain('产品开发需求表（requirement-sheet）')
    expect(prompt).toContain('/runtime/workspaces/task-31/materials/DS-01/requirement-sheet/需求表.xlsx')
    expect(prompt).not.toContain('产品规格书（product-spec）')
    expect(prompt).not.toContain('/Users/source')
    expect(prompt).not.toContain('DS-03')
  })

  it('组合提示词逐项隔离 DS-01、DS-04、DS-06 规则和材料，并保持 r0 与新 revision 原样', () => {
    const requirementPath = '/runtime/workspaces/task-32/materials/DS-01/requirement-sheet/需求表.xlsx'
    const afeAPath = '/runtime/workspaces/task-32/materials/DS-04/chip-specs/AFE-A.pdf'
    const afeBPath = '/runtime/workspaces/task-32/materials/DS-04/chip-specs/AFE-B.pdf'
    const specificationPath = '/runtime/workspaces/task-32/materials/DS-06/product-spec/规格书.pdf'
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: 'r0',
      newRevision: 'R130',
      departmentName: 'BMS 软件部',
      reviewItems: [
        {
          id: 'DS-01',
          name: '需求变更审查',
          user_extra_rules: '只核对协议导入',
          materials: [
            {
              fieldId: 'requirement-sheet', name: '产品开发需求表', required: true,
              multiple: false, allowedExtensions: ['.xlsx', '.xls'], filePaths: [requirementPath]
            }
          ]
        },
        {
          id: 'DS-04',
          name: 'AFE 驱动审核',
          user_extra_rules: '只核对 AFE 初始化',
          materials: [
            {
              fieldId: 'chip-specs', name: '芯片规格书', required: true,
              multiple: true, allowedExtensions: ['.pdf'], filePaths: [afeAPath, afeBPath]
            }
          ]
        },
        {
          id: 'DS-06',
          name: '规格书审查',
          user_extra_rules: '只核对第五章配置',
          materials: [
            {
              fieldId: 'product-spec', name: '产品规格书', required: true,
              multiple: false, allowedExtensions: ['.pdf'], filePaths: [specificationPath]
            }
          ]
        }
      ],
      reportPath: '/runtime/workspaces/task-32/report.md'
    })

    const ds01Start = prompt.indexOf('### DS-01：需求变更审查')
    const ds04Start = prompt.indexOf('### DS-04：AFE 驱动审核')
    const ds06Start = prompt.indexOf('### DS-06：规格书审查')
    const itemBoundary = prompt.indexOf('\n\n每项用户额外规则', ds06Start)
    const ds01Section = prompt.slice(ds01Start, ds04Start)
    const ds04Section = prompt.slice(ds04Start, ds06Start)
    const ds06Section = prompt.slice(ds06Start, itemBoundary)

    expect(prompt).toMatchSnapshot()
    expect(prompt).toContain('旧 revision：r0')
    expect(prompt).toContain('新 revision：R130')
    expect(prompt).not.toContain('平台全量审查占位')
    expect(prompt).not.toContain('svn diff -r 0')
    expect(ds01Section).toContain('用户额外规则：只核对协议导入')
    expect(ds01Section).toContain(requirementPath)
    expect(ds01Section).not.toContain('/materials/DS-04/')
    expect(ds01Section).not.toContain('/materials/DS-06/')
    expect(ds04Section).toContain('用户额外规则：只核对 AFE 初始化')
    expect(ds04Section).toContain(afeAPath)
    expect(ds04Section).toContain(afeBPath)
    expect(ds04Section).not.toContain('只核对协议导入')
    expect(ds06Section).toContain('用户额外规则：只核对第五章配置')
    expect(ds06Section).toContain(specificationPath)
    expect(ds06Section).not.toContain('/materials/DS-01/')
  })

  it('同一材料字段的多个工作区路径完整保留且不泄露源路径', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/multiple-materials',
      oldRevision: 'r210',
      newRevision: 'r220',
      departmentName: 'BMS 软件部',
      reviewItems: [
        {
          id: 'DS-01',
          name: '需求变更审查',
          materials: [
            {
              fieldId: 'requirement-sheet',
              name: '产品开发需求表',
              required: true,
              multiple: true,
              allowedExtensions: ['.xlsx', '.xls'],
              filePaths: [
                '/runtime/workspaces/task-multiple/materials/DS-01/requirement-sheet/主需求表.xlsx',
                '/runtime/workspaces/task-multiple/materials/DS-01/requirement-sheet/补充需求表.xls'
              ]
            }
          ]
        }
      ],
      reportPath: '/runtime/workspaces/task-multiple/report.md'
    })

    expect(prompt).toMatchSnapshot()
    expect(prompt).toContain('/requirement-sheet/主需求表.xlsx')
    expect(prompt).toContain('/requirement-sheet/补充需求表.xls')
    expect(prompt).not.toContain('/Users/source')
  })

  it('DS-02 与 DS-03 组合提示词保持原始 revision 和逐项规则且不产生材料', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/ds02-ds03',
      oldRevision: 'r0',
      newRevision: 'R240',
      reviewItems: [
        {
          id: 'DS-02',
          name: '编码规范审查',
          user_extra_rules: '只检查本次新增诊断代码',
          materials: []
        },
        {
          id: 'DS-03',
          name: 'MOS 充放电状态机审查',
          user_extra_rules: '只检查故障恢复状态',
          materials: []
        }
      ],
      reportPath: '/runtime/workspaces/task-33/report.md'
    })

    const ds02Start = prompt.indexOf('### DS-02：编码规范审查')
    const ds03Start = prompt.indexOf('### DS-03：MOS 充放电状态机审查')
    const itemBoundary = prompt.indexOf('\n\n每项用户额外规则', ds03Start)
    const ds02Section = prompt.slice(ds02Start, ds03Start)
    const ds03Section = prompt.slice(ds03Start, itemBoundary)

    expect(prompt).toContain('旧 revision：r0')
    expect(prompt).toContain('新 revision：R240')
    expect(ds02Section).toContain('用户额外规则：只检查本次新增诊断代码')
    expect(ds02Section).toContain('专项材料：无')
    expect(ds02Section).not.toContain('只检查故障恢复状态')
    expect(ds03Section).toContain('用户额外规则：只检查故障恢复状态')
    expect(ds03Section).toContain('专项材料：无')
    expect(ds03Section).not.toContain('只检查本次新增诊断代码')
  })

  it('DS-99 在自身规则中声明模式和材料，并隔离本地工作区文件', () => {
    const materialPath = '/runtime/workspaces/task-ds99/materials/DS-99/pdf-materials/rule.pdf'
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/custom',
      oldRevision: 'r120',
      newRevision: 'r130',
      reviewItems: [
        {
          id: 'DS-99',
          name: '自定义审查',
          user_extra_rules: '保护条件必须具有明确的恢复路径。',
          custom_mode: 'dual_revision',
          materials: [{
            fieldId: 'pdf-materials', name: 'PDF 材料', required: false,
            multiple: true, allowedExtensions: ['.pdf'], filePaths: [materialPath]
          }]
        },
        { id: 'DS-03', name: 'MOS 充放电状态机审查', materials: [] }
      ],
      reportPath: '/runtime/workspaces/task-ds99/report.md'
    })

    const ds99Start = prompt.indexOf('### DS-99：自定义审查')
    const ds03Start = prompt.indexOf('### DS-03：MOS 充放电状态机审查')
    const ds99Section = prompt.slice(ds99Start, ds03Start)
    expect(ds99Section).toContain('模式：dual_revision')
    expect(ds99Section).toContain('材料：PDF 材料')
    expect(ds99Section).toContain('保护条件必须具有明确的恢复路径。')
    expect(ds99Section).toContain(materialPath)
    expect(ds99Section).toContain('上述专项材料只属于 DS-99 自定义审查')
    expect(prompt.slice(ds03Start)).not.toContain(materialPath)
  })
})
