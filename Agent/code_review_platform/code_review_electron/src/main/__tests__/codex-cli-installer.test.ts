import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandResult } from '../environment-checker'
import type { InstallCommandResult } from '../codex-cli-installer'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

interface MockSpawnChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

const createMockSpawnChild = (): MockSpawnChild => {
  const child = new EventEmitter() as MockSpawnChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('installCodexCli', () => {
  it('returns a Codex error when npm is unavailable', async () => {
    const findVersionCommand = vi.fn(async (): Promise<CommandResult> => ({ ok: false }))
    const runInstallCommand = vi.fn()
    const checkEnvironment = vi.fn()
    const { installCodexCli } = await import('../codex-cli-installer')

    await expect(
      installCodexCli({
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_codex',
      codexError: '未检测到 npm，请先安装 Node.js 后重试或联系管理员。'
    })

    expect(findVersionCommand).toHaveBeenCalledWith('npm', ['--version'])
    expect(runInstallCommand).not.toHaveBeenCalled()
    expect(checkEnvironment).not.toHaveBeenCalled()
  })

  it('returns npm output when installing Codex CLI fails', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
      command === 'npm' ? { ok: true, output: '10.0.0', path: 'npm' } : { ok: false }
    )
    const runInstallCommand = vi.fn(async () => ({
      ok: false,
      stdout: '',
      stderr: 'npm ERR! code EACCES\nnpm ERR! permission denied'
    }))
    const checkEnvironment = vi.fn()
    const { installCodexCli } = await import('../codex-cli-installer')

    await expect(
      installCodexCli({
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_codex',
      codexError: '通过 npm 安装 Codex CLI 失败：npm ERR! code EACCES\nnpm ERR! permission denied'
    })

    expect(runInstallCommand).toHaveBeenCalledWith('npm', ['install', '-g', '@openai/codex'])
    expect(checkEnvironment).not.toHaveBeenCalled()
  })

  it('returns a restart hint when install succeeds but Codex is not detected', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
      command === 'npm' ? { ok: true, output: '10.0.0', path: 'npm' } : { ok: false }
    )
    const runInstallCommand = vi.fn(async () => ({
      ok: true,
      stdout: 'added 1 package',
      stderr: ''
    }))
    const checkEnvironment = vi.fn()
    const { installCodexCli, CodexNotDetectedAfterInstallMessage } = await import(
      '../codex-cli-installer'
    )

    await expect(
      installCodexCli({
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_codex',
      codexError: CodexNotDetectedAfterInstallMessage
    })

    expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
    expect(checkEnvironment).not.toHaveBeenCalled()
  })

  it('refreshes the environment after Codex CLI is installed and detected', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
      command === 'npm'
        ? { ok: true, output: '10.0.0', path: 'npm' }
        : { ok: true, output: 'codex-cli 0.130.0', path: 'codex' }
    )
    const runInstallCommand = vi.fn(async () => ({
      ok: true,
      stdout: 'added 1 package',
      stderr: ''
    }))
    const checkEnvironment = vi.fn(async () => ({
      status: 'missing_svn' as const,
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex'
    }))
    const { installCodexCli } = await import('../codex-cli-installer')

    await expect(
      installCodexCli({
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex'
    })

    expect(checkEnvironment).toHaveBeenCalled()
  })
})

describe('summarizeInstallError', () => {
  it('redacts paths and URL credentials while keeping actionable npm errors', async () => {
    const { summarizeInstallError } = await import('../codex-cli-installer')

    const summary = summarizeInstallError({
      ok: false,
      stdout: 'npm ERR! registry https://user:secret@registry.example.com/',
      stderr:
        'npm ERR! code EACCES\n' +
        'npm ERR! permission denied while opening /Users/alice/.npm/_logs/install.log'
    })

    expect(summary).toContain('npm ERR! code EACCES')
    expect(summary).toContain('npm ERR! permission denied')
    expect(summary).toContain('https://***@registry.example.com/')
    expect(summary).not.toContain('alice')
    expect(summary).not.toContain('secret')
    expect(summary).not.toContain('/Users/alice')
  })

  it('returns a fallback when npm output has no actionable error details', async () => {
    const { summarizeInstallError } = await import('../codex-cli-installer')

    expect(
      summarizeInstallError({
        ok: false,
        stdout: 'running package script\n/Users/alice/project/build.js',
        stderr: ''
      })
    ).toBe('npm 未返回错误详情')
  })
})

describe('runInstallCommand', () => {
  it('returns ok true and captures stdout and stderr when close code is 0', async () => {
    const child = createMockSpawnChild()
    spawnMock.mockReturnValue(child)
    const { runInstallCommand } = await import('../codex-cli-installer')

    const resultPromise = runInstallCommand('npm', ['install'])
    child.stdout.emit('data', Buffer.from('added 1 package'))
    child.stderr.emit('data', Buffer.from('npm notice'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      stdout: 'added 1 package',
      stderr: 'npm notice'
    })
  })

  it('returns ok false when close code is non-zero', async () => {
    const child = createMockSpawnChild()
    spawnMock.mockReturnValue(child)
    const { runInstallCommand } = await import('../codex-cli-installer')

    const resultPromise = runInstallCommand('npm', ['install'])
    child.stderr.emit('data', Buffer.from('npm ERR! code EACCES'))
    child.emit('close', 1)

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      stdout: '',
      stderr: 'npm ERR! code EACCES'
    })
  })

  it('returns ok false and keeps stderr when spawn emits an error', async () => {
    const child = createMockSpawnChild()
    spawnMock.mockReturnValue(child)
    const { runInstallCommand } = await import('../codex-cli-installer')

    const resultPromise = runInstallCommand('npm', ['install'])
    child.stdout.emit('data', Buffer.from('partial stdout'))
    child.stderr.emit('data', Buffer.from('partial stderr'))
    child.emit('error', new Error('spawn failed'))

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      stdout: 'partial stdout',
      stderr: 'partial stderr\nspawn failed'
    })
  })

  it('resolves once when error and close both fire', async () => {
    const child = createMockSpawnChild()
    spawnMock.mockReturnValue(child)
    const { runInstallCommand } = await import('../codex-cli-installer')

    const results: InstallCommandResult[] = []
    const resultPromise = runInstallCommand('npm', ['install'])
    resultPromise.then((result) => results.push(result))
    child.stderr.emit('data', Buffer.from('partial stderr'))
    child.emit('error', new Error('spawn failed'))
    child.emit('close', 0)
    await resultPromise
    await Promise.resolve()

    expect(results).toEqual([
      {
        ok: false,
        stdout: '',
        stderr: 'partial stderr\nspawn failed'
      }
    ])
  })
})
