import { EventEmitter } from 'node:events'
import type { EventEmitter as EventEmitterType } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDeleteSkillPrompt,
  buildInstallSkillPrompt,
  deleteCodexSkill
} from '../codex-skill-installer'

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

  it('uses the legacy install prompt for package-path-only calls', async () => {
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
    expect(prompt).toContain(
      'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\skill.zip'
    )
    expect(prompt).not.toContain('未提供')
    expect(prompt).toContain('直接读取这个 zip 文件路径，不要修改 zip 内容')
    expect(prompt).toContain('先定位 Codex 当前已安装的同名 Skill')
    expect(prompt).toContain('删除旧的同名 Skill')
    expect(prompt).toContain('再安装这个 zip 包中的最新 Skill')
    expect(prompt).toContain('如果无法确认旧 Skill 已删除或新 Skill 已安装成功')
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

describe('deleteCodexSkill', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('asks Codex to delete only the target Skill name', async () => {
    const child = makeChild()

    const resultPromise = deleteCodexSkill({
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0',
      timeoutMs: 1000
    })
    child.stdout.emit('data', Buffer.from('deleted\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      stdout: 'deleted\n',
      stderr: ''
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        expect.stringContaining('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
      ],
      expect.objectContaining({
        shell: false
      })
    )
    const prompt = spawnMock.mock.calls[0]?.[1]?.[2]
    expect(prompt).toContain('通用-代码变更审查-模板一')
    expect(prompt).toContain('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
  })
})

describe('Codex Skill prompts', () => {
  it('builds an install prompt with server skill metadata and same-name replacement rules', () => {
    const prompt = buildInstallSkillPrompt({
      packagePath: '/tmp/skill.zip',
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0',
      contentHash: 'hash-1'
    })

    expect(prompt).toContain('Skill ID：skill-1')
    expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
    expect(prompt).toContain('Skill 版本：1.0.0')
    expect(prompt).toContain('内容哈希：hash-1')
    expect(prompt).toContain('只能删除同名 Skill，不要删除其他名称的 Skill')
    expect(prompt).toContain('[SKILL_INSTALL_OK] 通用-代码变更审查-模板一@1.0.0')
  })

  it('builds a delete prompt that only removes the target skill name', () => {
    const prompt = buildDeleteSkillPrompt({
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '1.0.0'
    })

    expect(prompt).toContain('Skill 名称：通用-代码变更审查-模板一')
    expect(prompt).toContain('只删除名称为 通用-代码变更审查-模板一 的 Skill')
    expect(prompt).toContain('不要删除其他名称的 Skill')
    expect(prompt).toContain('[SKILL_DELETE_OK] 通用-代码变更审查-模板一')
  })
})
