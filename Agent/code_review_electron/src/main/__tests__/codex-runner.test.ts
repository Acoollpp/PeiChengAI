import { describe, expect, it } from 'vitest'

import { buildReviewPrompt } from '../codex-runner'

describe('buildReviewPrompt', () => {
  it('includes the review skill path, project path, revisions, and SVN fetch strategy', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/report.md'
    })

    expect(prompt).toContain('skills/通用-代码变更审查')
    expect(prompt).toContain('项目路径：svn://example.com/repo/project')
    expect(prompt).toContain('旧版本号：123')
    expect(prompt).toContain('新版本号：130')
    expect(prompt).toContain('SVN 获取策略')
  })

  it('does not ask Codex to run svn diff directly', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/report.md'
    })

    expect(prompt).not.toContain('svn diff')
  })
})
