import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  buildDirectCommandOptions,
  buildVersionCommandOptions,
  checkRuntimeWritable,
  checkSkillPackageReady,
  classifyEnvironment
} from '../environment-checker'
import type { CommandResult, EnvironmentCheckResult } from '../environment-checker'

const readyCodeGraph = {
  status: 'ready' as const,
  requiredVersion: '1.4.1',
  version: '1.4.1',
  commandPath: 'C:\\Program Files\\AI代码审查客户端\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd',
  commandDirectory:
    'C:\\Program Files\\AI代码审查客户端\\resources\\codegraph\\win32-x64\\bin'
}

describe('classifyEnvironment', () => {
  it('returns ready when Codex, SVN, and the review skill are available', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: true, skillOk: true })).toBe('ready')
  })

  it('prioritizes missing_codex when Codex is unavailable', () => {
    expect(classifyEnvironment({ codexOk: false, svnOk: false, skillOk: false })).toBe(
      'missing_codex'
    )
  })

  it('prioritizes missing_svn after Codex is available', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: false, skillOk: false })).toBe(
      'missing_svn'
    )
  })

  it('returns missing_skill when only the review skill is unavailable', () => {
    expect(classifyEnvironment({ codexOk: true, svnOk: true, skillOk: false })).toBe(
      'missing_skill'
    )
  })

  it('can carry skill sync failure details for the renderer', () => {
    const result: EnvironmentCheckResult = {
      status: 'missing_skill',
      skillError: 'No active skill'
    }

    expect(result.skillError).toBe('No active skill')
  })
})

describe('buildVersionCommandOptions', () => {
  it('runs Codex through the shell on Windows so app execution aliases can resolve', () => {
    const options = buildVersionCommandOptions('win32')

    expect(options.shell).toBe(true)
  })
})

describe('buildDirectCommandOptions', () => {
  it('在 Windows 复用命令环境但固定禁用 shell', () => {
    const versionOptions = buildVersionCommandOptions('win32')
    const directOptions = buildDirectCommandOptions('win32')

    expect(directOptions).toEqual({
      env: versionOptions.env,
      shell: false,
      windowsHide: true
    })
  })
})

describe('checkEnvironment', () => {
  it('returns missing_codex without checking SVN or Skill when Codex is unavailable', async () => {
    const findVersionCommand = vi.fn(
      async (command: string): Promise<CommandResult> =>
        command === 'codex' ? { ok: false } : { ok: true, output: '1.14.0', path: 'svn' }
    )
    const checkRuntimeWritable = vi.fn(async () => true)
    const checkSkillPackageReady = vi.fn(async () => true)
    const readSyncedSkills = vi.fn(async () => [])
    const inspectCodeGraphRuntime = vi.fn(async () => readyCodeGraph)
    const getRuntimePaths = vi.fn(async () => ({
      runtimeRoot: '/tmp/code-review-runtime',
      skillPackagesDir: '/tmp/code-review-runtime/skill-packages',
      skillManifestPath: '/tmp/code-review-runtime/skill-packages/manifest.json',
      workspacesDir: '/tmp/code-review-runtime/workspaces',
      workspaceForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}`,
      reportPathForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/report.md`,
      imagesDirForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/images`
    }))
    const { checkEnvironment } = await import('../environment-checker')

    await expect(
      checkEnvironment({
        findVersionCommand,
        checkRuntimeWritable,
        checkSkillPackageReady,
        readSyncedSkills,
        inspectCodeGraphRuntime,
        getRuntimePaths
      })
    ).resolves.toEqual({
      status: 'missing_codex',
      codegraphStatus: 'ready',
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath: readyCodeGraph.commandPath,
      codegraphError: undefined
    })

    expect(findVersionCommand).toHaveBeenCalledTimes(1)
    expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
    expect(checkRuntimeWritable).toHaveBeenCalledWith('/tmp/code-review-runtime')
    expect(checkSkillPackageReady).not.toHaveBeenCalled()
  })

  it('checks SVN and Skill after Codex is available', async () => {
    const findVersionCommand = vi.fn(
      async (command: string): Promise<CommandResult> =>
        command === 'codex'
          ? { ok: true, output: 'codex-cli 0.130.0', path: 'codex' }
          : { ok: false }
    )
    const checkRuntimeWritable = vi.fn(async () => true)
    const checkSkillPackageReady = vi.fn(async () => true)
    const readSyncedSkills = vi.fn(async () => [])
    const inspectCodeGraphRuntime = vi.fn(async () => readyCodeGraph)
    const getRuntimePaths = vi.fn(async () => ({
      runtimeRoot: '/tmp/code-review-runtime',
      skillPackagesDir: '/tmp/code-review-runtime/skill-packages',
      skillManifestPath: '/tmp/code-review-runtime/skill-packages/manifest.json',
      workspacesDir: '/tmp/code-review-runtime/workspaces',
      workspaceForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}`,
      reportPathForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/report.md`,
      imagesDirForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/images`
    }))
    const { checkEnvironment } = await import('../environment-checker')

    await expect(
      checkEnvironment({
        findVersionCommand,
        checkRuntimeWritable,
        checkSkillPackageReady,
        readSyncedSkills,
        inspectCodeGraphRuntime,
        getRuntimePaths
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex',
      svnVersion: undefined,
      svnPath: undefined,
      codegraphStatus: 'ready',
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath: readyCodeGraph.commandPath,
      codegraphError: undefined,
      skills: []
    })

    expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
    expect(findVersionCommand).toHaveBeenCalledWith('svn', ['--version', '--quiet'])
    expect(checkSkillPackageReady).toHaveBeenCalledWith(
      '/tmp/code-review-runtime/skill-packages/manifest.json'
    )
  })

  it('内置 CodeGraph 损坏时返回明确状态且不检查 SVN 或 Skill', async () => {
    const findVersionCommand = vi.fn(async () => ({
      ok: true,
      output: 'codex-cli 0.130.0',
      path: 'codex'
    }))
    const checkSkillPackageReady = vi.fn(async () => true)
    const readSyncedSkills = vi.fn(async () => [])
    const { checkEnvironment } = await import('../environment-checker')

    await expect(
      checkEnvironment({
        findVersionCommand,
        checkRuntimeWritable: vi.fn(async () => true),
        checkSkillPackageReady,
        readSyncedSkills,
        inspectCodeGraphRuntime: vi.fn(async () => ({
          status: 'corrupt' as const,
          requiredVersion: '1.4.1',
          version: '1.4.1',
          commandPath: readyCodeGraph.commandPath,
          commandDirectory: readyCodeGraph.commandDirectory,
          error: '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
        })),
        getRuntimePaths: vi.fn(async () => ({
          runtimeRoot: '/tmp/code-review-runtime',
          skillPackagesDir: '/tmp/code-review-runtime/skill-packages',
          skillManifestPath: '/tmp/code-review-runtime/skill-packages/manifest.json',
          workspacesDir: '/tmp/code-review-runtime/workspaces',
          workspaceForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}`,
          reportPathForTask: (taskId: string) =>
            `/tmp/code-review-runtime/workspaces/${taskId}/report.md`,
          imagesDirForTask: (taskId: string) =>
            `/tmp/code-review-runtime/workspaces/${taskId}/images`
        }))
      })
    ).resolves.toMatchObject({
      status: 'failed',
      codegraphStatus: 'corrupt',
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath: readyCodeGraph.commandPath,
      codegraphError: '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
    })

    expect(findVersionCommand).toHaveBeenCalledTimes(1)
    expect(checkSkillPackageReady).not.toHaveBeenCalled()
    expect(readSyncedSkills).not.toHaveBeenCalled()
  })
})

describe('runtime environment helpers', () => {
  it('returns true when the runtime directory can be created and written', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-writable-${Date.now()}`)

    await expect(checkRuntimeWritable(runtimeRoot)).resolves.toBe(true)
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns true when the Skill package manifest includes synced active review Skills with existing packages', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    const templateOnePackagePath = join(skillPackagesDir, 'template-one.zip')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(templateOnePackagePath, 'template one zip bytes')
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码审查-模版一',
            version: '2026.05.29',
            content_hash: 'hash-1',
            package_path: templateOnePackagePath,
            installed_at: '2026-05-29T10:00:00.000Z'
          }
        ]
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      true
    )
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns false when the Skill package manifest has no synced active Skills', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        skills: []
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      false
    )
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns false when the Skill package manifest points at a missing package', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码审查-模版一',
            version: '2026.05.29',
            content_hash: 'hash-1',
            package_path: join(skillPackagesDir, 'missing-one.zip'),
            installed_at: '2026-05-29T10:00:00.000Z'
          },
          {
            id: 'skill-2',
            name: '通用-代码审查-模版二',
            version: '2026.05.30',
            content_hash: 'hash-2',
            package_path: join(skillPackagesDir, 'missing-two.zip'),
            installed_at: '2026-05-30T10:00:00.000Z'
          }
        ]
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      false
    )
    await rm(runtimeRoot, { recursive: true, force: true })
  })
})
