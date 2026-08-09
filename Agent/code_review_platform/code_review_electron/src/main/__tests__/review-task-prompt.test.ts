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
          name: '状态机审核',
          user_extra_rules: '重点检查休眠唤醒状态转换',
          materials: []
        }
      ],
      reportPath: '/tmp/task-30/BMS_V2_审查报告.md'
    })

    expect(prompt).toContain('Skill：bms-code-reviewer')
    expect(prompt).toContain('SVN 地址：svn://example.com/bms/trunk')
    expect(prompt).toContain('旧 revision：0')
    expect(prompt).not.toContain('旧 revision：r0')
    expect(prompt).not.toContain('平台全量审查占位')
    expect(prompt).not.toContain('svn diff -r 0')
    expect(prompt).toContain('新 revision：r130')
    expect(prompt).toContain('所属部门：软件开发部')
    expect(prompt).toContain('### DS-03：状态机审核')
    expect(prompt).toContain('用户额外规则：重点检查休眠唤醒状态转换')
    expect(prompt).toContain('专项材料：无')
    expect(prompt).toContain('Markdown 报告完整路径：/tmp/task-30/BMS_V2_审查报告.md')
    expect(prompt).not.toContain('新报告正式问题标题合同')
    expect(prompt).not.toContain('PC-BMS-NNN')
    expect(prompt).not.toContain('严重度映射')
    expect(prompt).not.toContain('依次映射')
    expect(prompt).not.toContain('产品开发需求表')
    expect(prompt).not.toContain('重点审查方向')
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
  })

  it('DS-01 只输出工作区副本路径且材料与额外规则保持逐项归属', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '120',
      newRevision: '130',
      departmentName: 'BMS 软件部',
      reviewItems: [{
        id: 'DS-01',
        name: '变更点审查',
        user_extra_rules: '仅核对本次协议变更',
        materials: [
          {
            fieldId: 'requirement-sheet', name: '产品开发需求表', required: true,
            multiple: false, allowedExtensions: ['.xlsx', '.xls'],
            filePaths: ['/runtime/workspaces/task-31/materials/DS-01/requirement-sheet/需求表.xlsx']
          },
          {
            fieldId: 'product-spec', name: '产品规格书', required: true,
            multiple: false, allowedExtensions: ['.pdf'],
            filePaths: ['/runtime/workspaces/task-31/materials/DS-01/product-spec/规格书.pdf']
          }
        ]
      }],
      reportPath: '/runtime/workspaces/task-31/report.md'
    })

    expect(prompt).toContain('### DS-01：变更点审查')
    expect(prompt).toContain('用户额外规则：仅核对本次协议变更')
    expect(prompt).toContain('产品开发需求表（requirement-sheet）')
    expect(prompt).toContain('/runtime/workspaces/task-31/materials/DS-01/requirement-sheet/需求表.xlsx')
    expect(prompt).toContain('/runtime/workspaces/task-31/materials/DS-01/product-spec/规格书.pdf')
    expect(prompt).not.toContain('/Users/source')
    expect(prompt).not.toContain('DS-03')
  })

  it('组合提示词逐项隔离规则和材料，并保持 r0 与新 revision 原样', () => {
    const requirementPath = '/runtime/workspaces/task-32/materials/DS-01/requirement-sheet/需求表.xlsx'
    const specificationPath = '/runtime/workspaces/task-32/materials/DS-01/product-spec/规格书.pdf'
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: 'r0',
      newRevision: 'R130',
      departmentName: 'BMS 软件部',
      reviewItems: [
        {
          id: 'DS-01',
          name: '变更点审查',
          user_extra_rules: '只核对协议导入',
          materials: [
            {
              fieldId: 'requirement-sheet', name: '产品开发需求表', required: true,
              multiple: false, allowedExtensions: ['.xlsx', '.xls'], filePaths: [requirementPath]
            },
            {
              fieldId: 'product-spec', name: '产品规格书', required: true,
              multiple: false, allowedExtensions: ['.pdf'], filePaths: [specificationPath]
            }
          ]
        },
        {
          id: 'DS-03',
          name: '状态机审核',
          materials: []
        }
      ],
      reportPath: '/runtime/workspaces/task-32/report.md'
    })

    const ds01Start = prompt.indexOf('### DS-01：变更点审查')
    const ds03Start = prompt.indexOf('### DS-03：状态机审核')
    const itemBoundary = prompt.indexOf('\n\n每项用户额外规则', ds03Start)
    const ds01Section = prompt.slice(ds01Start, ds03Start)
    const ds03Section = prompt.slice(ds03Start, itemBoundary)

    expect(prompt).toContain('旧 revision：r0')
    expect(prompt).toContain('新 revision：R130')
    expect(ds01Section).toContain('用户额外规则：只核对协议导入')
    expect(ds01Section).toContain(requirementPath)
    expect(ds01Section).toContain(specificationPath)
    expect(ds03Section).toContain('用户额外规则：无')
    expect(ds03Section).toContain('专项材料：无')
    expect(ds03Section).not.toContain('只核对协议导入')
    expect(ds03Section).not.toContain('/materials/DS-01/')
  })

  it('DS-02 与 DS-03 组合提示词保持原始 revision 和逐项规则且不产生材料', () => {
    const prompt = buildBmsReviewTaskPrompt({
      svnUrl: 'svn://example.com/bms/ds02-ds03',
      oldRevision: 'r0',
      newRevision: 'R240',
      reviewItems: [
        {
          id: 'DS-02',
          name: '编码规范审核',
          user_extra_rules: '只检查本次新增诊断代码',
          materials: []
        },
        {
          id: 'DS-03',
          name: '状态机审核',
          user_extra_rules: '只检查故障恢复状态',
          materials: []
        }
      ],
      reportPath: '/runtime/workspaces/task-33/report.md'
    })

    const ds02Start = prompt.indexOf('### DS-02：编码规范审核')
    const ds03Start = prompt.indexOf('### DS-03：状态机审核')
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
})
