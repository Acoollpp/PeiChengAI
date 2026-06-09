import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillSyncService } from '../skill-sync'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const runtimePathsFor = (runtimeRoot: string) => ({
  runtimeRoot,
  skillPackagesDir: join(runtimeRoot, 'skill-packages'),
  skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
  workspacesDir: join(runtimeRoot, 'workspaces'),
  workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
  reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
})

describe('SkillSyncService', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('downloads the active Skill zip, verifies hash, installs through Codex, and writes manifest', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const zipBytes = Buffer.from('original zip bytes')
    const contentHash = sha256(zipBytes)
    const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        name: '通用-代码变更审查-模板一',
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill
    })

    const result = await service.sync('token-123')

    expect(result).toEqual({
      status: 'synced',
      packagePath: join(runtimeRoot, 'skill-packages', `skill-1-2026.05.29-${contentHash}.zip`)
    })
    await expect(readFile(result.packagePath)).resolves.toEqual(zipBytes)
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, 'skill-packages', 'manifest.json'), 'utf8')
    ) as { content_hash: string; package_path: string }
    expect(manifest.content_hash).toBe(contentHash)
    expect(manifest.package_path).toBe(result.packagePath)
    expect(installSkill).toHaveBeenCalledWith({
      packagePath: result.packagePath
    })
  })

  it('skips download and install when manifest and cached zip hash match', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('cached zip bytes')
    const contentHash = sha256(zipBytes)
    const packagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-1-2026.05.29-${contentHash}.zip`
    )
    await writeFile(packagePath, zipBytes)
    await writeFile(
      runtimePaths.skillManifestPath,
      `${JSON.stringify(
        {
          id: 'skill-1',
          version: '2026.05.29',
          content_hash: contentHash,
          hash: contentHash,
          file_size: zipBytes.byteLength,
          package_path: packagePath,
          installed_at: '2026-05-29T10:00:00.000Z'
        },
        null,
        2
      )}\n`
    )
    const installSkill = vi.fn()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        name: '通用-代码变更审查-模板一',
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength
      })),
      downloadActiveSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill
    })

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'current',
      packagePath
    })
    expect(api.downloadActiveSkill).not.toHaveBeenCalled()
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('downloads and installs when cached manifest points at a missing package', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('fresh zip bytes')
    const contentHash = sha256(zipBytes)
    await writeFile(
      runtimePaths.skillManifestPath,
      `${JSON.stringify(
        {
          id: 'skill-1',
          version: '2026.05.29',
          content_hash: contentHash,
          package_path: join(runtimePaths.skillPackagesDir, 'missing.zip'),
          installed_at: '2026-05-29T10:00:00.000Z'
        },
        null,
        2
      )}\n`
    )
    const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        name: '通用-代码变更审查-模板一',
        version: '2026.05.29',
        content_hash: contentHash
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill
    })

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'synced',
      packagePath: join(runtimePaths.skillPackagesDir, `skill-1-2026.05.29-${contentHash}.zip`)
    })
    expect(api.downloadActiveSkill).toHaveBeenCalledWith('token-123')
    expect(installSkill).toHaveBeenCalledOnce()
  })

  it('rejects a downloaded package when hash does not match active Skill metadata', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const zipBytes = Buffer.from('tampered zip bytes')
    const installSkill = vi.fn()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        name: '通用-代码变更审查-模板一',
        version: '2026.05.29',
        content_hash: 'expected-hash'
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('Skill package hash mismatch')
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('rejects a downloaded package when file_size does not match active Skill metadata', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const zipBytes = Buffer.from('original zip bytes')
    const contentHash = sha256(zipBytes)
    const installSkill = vi.fn()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        name: '通用-代码变更审查-模板一',
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength + 1
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('Skill package size mismatch')
    expect(installSkill).not.toHaveBeenCalled()
  })
})
