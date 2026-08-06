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
          user_extra_rules: '重点检查休眠唤醒状态转换'
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
    expect(prompt).not.toContain('产品开发需求表')
    expect(prompt).not.toContain('重点审查方向')
  })

  it('空额外规则显示为无且拒绝相对报告路径', () => {
    const input = {
      svnUrl: 'svn://example.com/bms/trunk',
      oldRevision: '12',
      newRevision: '14',
      reviewItems: [{ id: 'DS-03', name: '状态机审核' }],
      reportPath: 'relative/report.md'
    }

    expect(() => buildBmsReviewTaskPrompt(input)).toThrow('Markdown 报告输出路径必须是绝对路径。')
    expect(
      buildBmsReviewTaskPrompt({ ...input, reportPath: 'C:\\review\\report.md' })
    ).toContain('用户额外规则：无')
  })
})
