import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  buildVersionCommandOptions,
  checkRuntimeWritable,
  checkSkillPackageReady,
  classifyEnvironment
} from '../environment-checker'
import type { CommandResult, EnvironmentCheckResult } from '../environment-checker'

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

describe('checkEnvironment', () => {
  it('returns missing_codex without checking SVN or Skill when Codex is unavailable', async () => {
    const findVersionCommand = vi.fn(
      async (command: string): Promise<CommandResult> =>
        command === 'codex' ? { ok: false } : { ok: true, output: '1.14.0', path: 'svn' }
    )
    const checkRuntimeWritable = vi.fn(async () => true)
    const checkSkillPackageReady = vi.fn(async () => true)
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
        getRuntimePaths
      })
    ).resolves.toEqual({
      status: 'missing_codex'
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
        getRuntimePaths
      })
    ).resolves.toEqual({
      status: 'missing_svn',
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex',
      svnVersion: undefined,
      svnPath: undefined
    })

    expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
    expect(findVersionCommand).toHaveBeenCalledWith('svn', ['--version', '--quiet'])
    expect(checkSkillPackageReady).toHaveBeenCalledWith(
      '/tmp/code-review-runtime/skill-packages/manifest.json'
    )
  })
})

describe('runtime environment helpers', () => {
  it('returns true when the runtime directory can be created and written', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-writable-${Date.now()}`)

    await expect(checkRuntimeWritable(runtimeRoot)).resolves.toBe(true)
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns true when the Skill package manifest includes both required review Skills with existing packages', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    const templateOnePackagePath = join(skillPackagesDir, 'template-one.zip')
    const templateTwoPackagePath = join(skillPackagesDir, 'template-two.zip')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(templateOnePackagePath, 'template one zip bytes')
    await writeFile(templateTwoPackagePath, 'template two zip bytes')
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: 'hash-1',
            package_path: templateOnePackagePath,
            installed_at: '2026-05-29T10:00:00.000Z'
          },
          {
            id: 'skill-2',
            name: '通用-代码变更审查-模板二',
            version: '2026.05.30',
            content_hash: 'hash-2',
            package_path: templateTwoPackagePath,
            installed_at: '2026-05-30T10:00:00.000Z'
          }
        ]
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      true
    )
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns false when the Skill package manifest is missing one required review Skill', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    const packagePath = join(skillPackagesDir, 'template-one.zip')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(packagePath, 'template one zip bytes')
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: 'hash',
            package_path: packagePath,
            installed_at: '2026-05-29T10:00:00.000Z'
          }
        ]
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
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: 'hash-1',
            package_path: join(skillPackagesDir, 'missing-one.zip'),
            installed_at: '2026-05-29T10:00:00.000Z'
          },
          {
            id: 'skill-2',
            name: '通用-代码变更审查-模板二',
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
