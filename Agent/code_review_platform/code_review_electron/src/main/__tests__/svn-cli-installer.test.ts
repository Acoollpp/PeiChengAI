import { describe, expect, it, vi } from 'vitest'

import type { CommandResult } from '../environment-checker'

describe('installSvnCli', () => {
  it('returns a SVN error when winget is unavailable on Windows', async () => {
    const findVersionCommand = vi.fn(async (): Promise<CommandResult> => ({ ok: false }))
    const runInstallCommand = vi.fn()
    const checkEnvironment = vi.fn()
    const { installSvnCli, MissingWingetMessage } = await import('../svn-cli-installer')

    await expect(
      installSvnCli({
        platform: 'win32',
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      svnError: MissingWingetMessage
    })

    expect(findVersionCommand).toHaveBeenCalledWith('winget', ['--version'])
    expect(runInstallCommand).not.toHaveBeenCalled()
    expect(checkEnvironment).not.toHaveBeenCalled()
  })

  it('installs SVN CLI through winget on Windows', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> => {
      if (command === 'winget') {
        return { ok: true, output: 'v1.9.0', path: 'winget' }
      }
      return { ok: true, output: '1.14.5', path: 'svn' }
    })
    const runInstallCommand = vi.fn(async () => ({
      ok: true,
      stdout: 'Successfully installed',
      stderr: ''
    }))
    const checkEnvironment = vi.fn(async () => ({
      status: 'ready' as const,
      codexVersion: 'codex-cli 0.130.0',
      svnVersion: '1.14.5'
    }))
    const { installSvnCli } = await import('../svn-cli-installer')

    await expect(
      installSvnCli({
        platform: 'win32',
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'ready',
      codexVersion: 'codex-cli 0.130.0',
      svnVersion: '1.14.5'
    })

    expect(runInstallCommand).toHaveBeenCalledWith('winget', [
      'install',
      '-e',
      '--id',
      'Slik.Subversion',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ])
    expect(findVersionCommand).toHaveBeenCalledWith('svn', ['--version', '--quiet'])
    expect(checkEnvironment).toHaveBeenCalled()
  })

  it('returns winget output when installing SVN CLI fails on Windows', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
      command === 'winget' ? { ok: true, output: 'v1.9.0', path: 'winget' } : { ok: false }
    )
    const runInstallCommand = vi.fn(async () => ({
      ok: false,
      stdout: '',
      stderr: 'Installer failed with exit code: 1603'
    }))
    const checkEnvironment = vi.fn()
    const { installSvnCli } = await import('../svn-cli-installer')

    await expect(
      installSvnCli({
        platform: 'win32',
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      svnError: '通过 winget 安装 SVN CLI 失败：Installer failed with exit code: 1603'
    })

    expect(checkEnvironment).not.toHaveBeenCalled()
  })

  it('uses Homebrew to install SVN CLI on macOS', async () => {
    const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> => {
      if (command === 'brew') {
        return { ok: true, output: '4.4.0', path: 'brew' }
      }
      return { ok: false }
    })
    const runInstallCommand = vi.fn(async () => ({ ok: true, stdout: '', stderr: '' }))
    const checkEnvironment = vi.fn()
    const { installSvnCli, SvnNotDetectedAfterInstallMessage } = await import('../svn-cli-installer')

    await expect(
      installSvnCli({
        platform: 'darwin',
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      svnError: SvnNotDetectedAfterInstallMessage
    })

    expect(runInstallCommand).toHaveBeenCalledWith('brew', ['install', 'subversion'])
    expect(checkEnvironment).not.toHaveBeenCalled()
  })
})
