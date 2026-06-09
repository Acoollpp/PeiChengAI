import { EventEmitter } from 'node:events'
import type { EventEmitter as EventEmitterType } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('../codex-runner', () => ({
  buildCodexCommand: () => 'codex',
  buildCodexExecArgs: (prompt: string) => [
    'exec',
    '--dangerously-bypass-approvals-and-sandbox',
    prompt
  ]
}))

vi.mock('../environment-checker', () => ({
  buildVersionCommandOptions: () => ({ shell: true, env: { PATH: 'test-path' } })
}))

const makeChild = (): EventEmitterType & {
  stdout: EventEmitterType
  stderr: EventEmitterType
  stdin: { end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
} => {
  const child = new EventEmitter() as EventEmitterType & {
    stdout: EventEmitterType
    stderr: EventEmitterType
    stdin: { end: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn() }
  child.kill = vi.fn()
  spawnMock.mockReturnValue(child)
  return child
}

describe('installCodexSkillFromZip', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('asks Codex to install the Skill from the local zip path', async () => {
    const { installCodexSkillFromZip } = await import('../codex-skill-installer')
    const child = makeChild()

    const resultPromise = installCodexSkillFromZip({
      packagePath: 'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\skill.zip',
      timeoutMs: 1000
    })
    child.stdout.emit('data', Buffer.from('installed\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      stdout: 'installed\n',
      stderr: ''
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        expect.stringContaining(
          'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\skill.zip'
        )
      ],
      expect.objectContaining({
        shell: false
      })
    )
    const prompt = spawnMock.mock.calls[0]?.[1]?.[2]
    expect(prompt).toContain('先定位 Codex 当前已安装的同名 Skill')
    expect(prompt).toContain('删除旧的同名 Skill')
    expect(prompt).toContain('再安装这个 zip 包中的最新 Skill')
    expect(prompt).toContain('如果无法确认旧 Skill 已删除或新 Skill 已安装成功，请明确输出失败原因并以失败状态结束')
    expect(child.stdin.end).toHaveBeenCalledWith()
  })

  it('rejects with stderr when Codex install fails', async () => {
    const { installCodexSkillFromZip } = await import('../codex-skill-installer')
    const child = makeChild()

    const resultPromise = installCodexSkillFromZip({
      packagePath: 'D:\\runtime-data\\skill-packages\\bad.zip',
      timeoutMs: 1000
    })
    child.stderr.emit('data', Buffer.from('invalid skill package'))
    child.emit('close', 1)

    await expect(resultPromise).rejects.toThrow(
      'Codex Skill install failed with exit code 1: invalid skill package'
    )
  })
})
