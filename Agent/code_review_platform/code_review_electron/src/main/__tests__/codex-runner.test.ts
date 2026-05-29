import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventEmitter as EventEmitterType } from 'node:events'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => path.endsWith('codex.exe'))
}))

vi.mock('../environment-checker', () => ({
  buildVersionCommandOptions: () => ({ shell: true, env: { PATH: 'test-path' } })
}))

describe('runCodexReview', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('emits stdout and stderr chunks while Codex is running', async () => {
    const { EventEmitter } = await import('node:events')
    const { runCodexReview } = await import('../codex-runner')
    const child = new EventEmitter() as EventEmitterType & {
      stdout: EventEmitterType
      stderr: EventEmitterType
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    spawnMock.mockReturnValue(child)
    const chunks: Array<{ stream: string; text: string }> = []

    const resultPromise = runCodexReview({
      cwd: '/tmp/workspace',
      prompt: 'prompt text',
      timeoutMs: 1000,
      onOutput: (event) => chunks.push({ stream: event.stream, text: event.text })
    })

    child.stdout.emit('data', Buffer.from('reading skill\n'))
    child.stderr.emit('data', Buffer.from('svn warning\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toMatchObject({
      stdout: 'reading skill\n',
      stderr: 'svn warning\n'
    })
    expect(chunks).toEqual([
      { stream: 'stdout', text: 'reading skill\n' },
      { stream: 'stderr', text: 'svn warning\n' }
    ])
    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/codex(\.exe)?$/),
      ['exec', '--dangerously-bypass-approvals-and-sandbox', 'prompt text'],
      expect.objectContaining({
        cwd: '/tmp/workspace',
        shell: false
      })
    )
  })
})

import { buildCodexCommand, buildCodexExecArgs, buildReviewPrompt } from '../codex-runner'

describe('buildCodexCommand', () => {
  it('uses the real Codex exe on Windows so prompt stays a single argv without shell parsing', () => {
    expect(buildCodexCommand('win32')).toContain('codex.exe')
  })

  it('uses codex on non-Windows platforms', () => {
    expect(buildCodexCommand('darwin')).toBe('codex')
  })
})

describe('buildReviewPrompt', () => {
  it('includes readable Chinese prompt text and interpolated task values', () => {
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
    expect(prompt).toContain('报告输出路径：/tmp/review/report.md')
    expect(prompt).toContain('SVN 获取策略')
    expect(prompt).not.toContain('{svnUrl}')
    expect(prompt).not.toContain('{oldRevision}')
    expect(prompt).not.toContain('{newRevision}')
    expect(prompt).not.toContain('閫氱敤')
  })

  it('does not ask Codex to run a hard-coded svn diff command outside the skill', () => {
    const prompt = buildReviewPrompt({
      svnUrl: 'svn://example.com/repo/project',
      oldRevision: '123',
      newRevision: '130',
      reportPath: '/tmp/review/report.md'
    })

    expect(prompt).not.toContain('svn diff')
  })
})

describe('buildCodexExecArgs', () => {
  it('runs Codex in exec mode with full access and rendered prompt input', () => {
    expect(buildCodexExecArgs('rendered prompt')).toEqual([
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      'rendered prompt'
    ])
  })
})
