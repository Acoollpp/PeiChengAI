import { describe, expect, it, vi } from 'vitest'

import type { CommandResult } from '../environment-checker'

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
