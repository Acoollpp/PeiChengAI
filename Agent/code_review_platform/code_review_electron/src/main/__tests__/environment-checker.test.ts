import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildVersionCommandOptions,
  checkRuntimeWritable,
  checkSkillPackageReady,
  classifyEnvironment
} from '../environment-checker'
import type { EnvironmentCheckResult } from '../environment-checker'

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

describe('runtime environment helpers', () => {
  it('returns true when the runtime directory can be created and written', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-writable-${Date.now()}`)

    await expect(checkRuntimeWritable(runtimeRoot)).resolves.toBe(true)
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('returns true when the Skill package manifest points at an existing package', async () => {
    const runtimeRoot = join(tmpdir(), `runtime-skill-${Date.now()}`)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    const packagePath = join(skillPackagesDir, 'skill.zip')
    await mkdir(skillPackagesDir, { recursive: true })
    await writeFile(packagePath, 'zip bytes')
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      JSON.stringify({
        id: 'skill-1',
        version: '2026.05.29',
        content_hash: 'hash',
        package_path: packagePath,
        installed_at: '2026-05-29T10:00:00.000Z'
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      true
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
        id: 'skill-1',
        version: '2026.05.29',
        content_hash: 'hash',
        package_path: join(skillPackagesDir, 'missing.zip'),
        installed_at: '2026-05-29T10:00:00.000Z'
      })
    )

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(
      false
    )
    await rm(runtimeRoot, { recursive: true, force: true })
  })
})
