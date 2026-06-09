import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillSyncService } from '../skill-sync'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const toArrayBuffer = (bytes: Buffer): ArrayBuffer => {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  return arrayBuffer
}

const runtimePathsFor = (runtimeRoot: string) => ({
  runtimeRoot,
  skillPackagesDir: join(runtimeRoot, 'skill-packages'),
  skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
  workspacesDir: join(runtimeRoot, 'workspaces'),
  workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
  reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md'),
  imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
})

describe('SkillSyncService', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('syncs multiple active Skills, installs each with metadata, and writes a multi Skill manifest', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const templateOneZip = Buffer.from('template one zip bytes')
    const templateTwoZip = Buffer.from('template two zip bytes')
    const templateOneHash = sha256(templateOneZip)
    const templateTwoHash = sha256(templateTwoZip)
    const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: templateOneHash,
            file_size: templateOneZip.byteLength
          },
          {
            id: 'skill-2',
            name: '通用-代码变更审查-模板二',
            version: '2026.05.30',
            content_hash: templateTwoHash,
            file_size: templateTwoZip.byteLength
          }
        ],
        count: 2
      })),
      downloadSkill: vi.fn(async (_token: string, skillId: string) =>
        toArrayBuffer(skillId === 'skill-1' ? templateOneZip : templateTwoZip)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill
    })

    const result = await service.sync('token-123')

    const firstPackagePath = join(
      runtimeRoot,
      'skill-packages',
      `skill-1-2026.05.29-${templateOneHash}.zip`
    )
    const secondPackagePath = join(
      runtimeRoot,
      'skill-packages',
      `skill-2-2026.05.30-${templateTwoHash}.zip`
    )
    expect(result).toEqual({
      status: 'synced',
      skills: [
        expect.objectContaining({
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '2026.05.29',
          content_hash: templateOneHash,
          hash: templateOneHash,
          file_size: templateOneZip.byteLength,
          package_path: firstPackagePath
        }),
        expect.objectContaining({
          id: 'skill-2',
          name: '通用-代码变更审查-模板二',
          version: '2026.05.30',
          content_hash: templateTwoHash,
          hash: templateTwoHash,
          file_size: templateTwoZip.byteLength,
          package_path: secondPackagePath
        })
      ]
    })
    await expect(readFile(firstPackagePath)).resolves.toEqual(templateOneZip)
    await expect(readFile(secondPackagePath)).resolves.toEqual(templateTwoZip)
    const manifest = JSON.parse(
      await readFile(join(runtimeRoot, 'skill-packages', 'manifest.json'), 'utf8')
    ) as { skills: Array<{ id: string; package_path: string }> }
    expect(manifest.skills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2'])
    expect(installSkill).toHaveBeenCalledWith({
      packagePath: firstPackagePath,
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '2026.05.29',
      contentHash: templateOneHash
    })
    expect(installSkill).toHaveBeenCalledWith({
      packagePath: secondPackagePath,
      skillId: 'skill-2',
      skillName: '通用-代码变更审查-模板二',
      version: '2026.05.30',
      contentHash: templateTwoHash
    })
  })

  it('skips download and install when every active Skill cached package matches', async () => {
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
          skills: [
            {
              id: 'skill-1',
              name: '通用-代码变更审查-模板一',
              version: '2026.05.29',
              content_hash: contentHash,
              hash: contentHash,
              file_size: zipBytes.byteLength,
              package_path: packagePath,
              installed_at: '2026-05-29T10:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`
    )
    const installSkill = vi.fn()
    const deleteSkill = vi.fn()
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: contentHash,
            file_size: zipBytes.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill,
      deleteSkill
    })

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'current',
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '2026.05.29',
          content_hash: contentHash,
          hash: contentHash,
          file_size: zipBytes.byteLength,
          package_path: packagePath,
          installed_at: '2026-05-29T10:00:00.000Z'
        }
      ]
    })
    expect(api.downloadSkill).not.toHaveBeenCalled()
    expect(installSkill).not.toHaveBeenCalled()
    expect(deleteSkill).not.toHaveBeenCalled()
  })

  it('uses the cached package when active Skill metadata has no hash but the local manifest hash matches', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('cached zip bytes without server hash')
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
          skills: [
            {
              id: 'skill-1',
              name: '通用-代码变更审查-模板一',
              version: '2026.05.29',
              content_hash: contentHash,
              hash: contentHash,
              file_size: zipBytes.byteLength,
              package_path: packagePath,
              installed_at: '2026-05-29T10:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`
    )
    const installSkill = vi.fn()
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            file_size: zipBytes.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'current',
      skills: [expect.objectContaining({ id: 'skill-1', content_hash: contentHash })]
    })
    expect(api.downloadSkill).not.toHaveBeenCalled()
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('deletes local manifest entries that are no longer active on the server', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const activeZip = Buffer.from('active zip bytes')
    const staleZip = Buffer.from('stale zip bytes')
    const activeHash = sha256(activeZip)
    const staleHash = sha256(staleZip)
    const activePackagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-1-2026.05.29-${activeHash}.zip`
    )
    const stalePackagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-old-2026.05.01-${staleHash}.zip`
    )
    await writeFile(activePackagePath, activeZip)
    await writeFile(stalePackagePath, staleZip)
    await writeFile(
      runtimePaths.skillManifestPath,
      `${JSON.stringify(
        {
          skills: [
            {
              id: 'skill-1',
              name: '通用-代码变更审查-模板一',
              version: '2026.05.29',
              content_hash: activeHash,
              hash: activeHash,
              file_size: activeZip.byteLength,
              package_path: activePackagePath,
              installed_at: '2026-05-29T10:00:00.000Z'
            },
            {
              id: 'skill-old',
              name: '旧审查Skill',
              version: '2026.05.01',
              content_hash: staleHash,
              hash: staleHash,
              file_size: staleZip.byteLength,
              package_path: stalePackagePath,
              installed_at: '2026-05-01T10:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`
    )
    const deleteSkill = vi.fn(async () => ({ stdout: 'deleted', stderr: '' }))
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: activeHash,
            file_size: activeZip.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill: vi.fn(),
      deleteSkill
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'synced',
      skills: [{ id: 'skill-1' }]
    })
    expect(deleteSkill).toHaveBeenCalledWith({
      skillId: 'skill-old',
      skillName: '旧审查Skill',
      version: '2026.05.01'
    })
    const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
      skills: Array<{ id: string }>
    }
    expect(manifest.skills).toEqual([expect.objectContaining({ id: 'skill-1' })])
  })

  it('deletes every local manifest entry when the server has no active Skills', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const stalePackagePath = join(runtimePaths.skillPackagesDir, 'stale.zip')
    await writeFile(stalePackagePath, 'stale zip bytes')
    await writeFile(
      runtimePaths.skillManifestPath,
      JSON.stringify({
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: 'hash-1',
            package_path: stalePackagePath,
            installed_at: '2026-05-29T10:00:00.000Z'
          }
        ]
      })
    )
    const deleteSkill = vi.fn()
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [],
        count: 0
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      deleteSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('No active skill is configured')

    expect(deleteSkill).toHaveBeenCalledWith({
      skillId: 'skill-1',
      skillName: '通用-代码变更审查-模板一',
      version: '2026.05.29'
    })
    await expect(readFile(runtimePaths.skillManifestPath, 'utf8')).resolves.toBe(
      `${JSON.stringify({ skills: [] }, null, 2)}\n`
    )
  })

  it('drops a stale legacy manifest entry without a Skill name and continues active Skill sync', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const staleZip = Buffer.from('legacy stale zip bytes')
    const staleHash = sha256(staleZip)
    const stalePackagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-old-2026.05.01-${staleHash}.zip`
    )
    const originalManifest = {
      id: 'skill-old',
      version: '2026.05.01',
      content_hash: staleHash,
      hash: staleHash,
      file_size: staleZip.byteLength,
      package_path: stalePackagePath,
      installed_at: '2026-05-01T10:00:00.000Z'
    }
    await writeFile(stalePackagePath, staleZip)
    await writeFile(runtimePaths.skillManifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`)
    const activeZip = Buffer.from('active zip bytes')
    const activeHash = sha256(activeZip)
    const deleteSkill = vi.fn()
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: activeHash,
            file_size: activeZip.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn(async () => toArrayBuffer(activeZip))
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill: vi.fn(),
      deleteSkill
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'synced',
      skills: [expect.objectContaining({ id: 'skill-1', name: '通用-代码变更审查-模板一' })]
    })
    expect(deleteSkill).not.toHaveBeenCalled()
    const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
      skills: Array<{ id: string }>
    }
    expect(manifest.skills).toEqual([expect.objectContaining({ id: 'skill-1' })])
  })

  it('rejects when stale Skill deletion fails and keeps the existing manifest unchanged', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const activeZip = Buffer.from('active zip bytes')
    const staleZip = Buffer.from('stale zip bytes')
    const activeHash = sha256(activeZip)
    const staleHash = sha256(staleZip)
    const activePackagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-1-2026.05.29-${activeHash}.zip`
    )
    const stalePackagePath = join(
      runtimePaths.skillPackagesDir,
      `skill-old-2026.05.01-${staleHash}.zip`
    )
    const originalManifest = {
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码变更审查-模板一',
          version: '2026.05.29',
          content_hash: activeHash,
          hash: activeHash,
          file_size: activeZip.byteLength,
          package_path: activePackagePath,
          installed_at: '2026-05-29T10:00:00.000Z'
        },
        {
          id: 'skill-old',
          name: '旧审查Skill',
          version: '2026.05.01',
          content_hash: staleHash,
          hash: staleHash,
          file_size: staleZip.byteLength,
          package_path: stalePackagePath,
          installed_at: '2026-05-01T10:00:00.000Z'
        }
      ]
    }
    await writeFile(activePackagePath, activeZip)
    await writeFile(stalePackagePath, staleZip)
    await writeFile(runtimePaths.skillManifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`)
    const deleteSkill = vi.fn(async () => {
      throw new Error('delete failed')
    })
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: activeHash,
            file_size: activeZip.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill: vi.fn(),
      deleteSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('delete failed')
    expect(deleteSkill).toHaveBeenCalledWith({
      skillId: 'skill-old',
      skillName: '旧审查Skill',
      version: '2026.05.01'
    })
    await expect(readFile(runtimePaths.skillManifestPath, 'utf8')).resolves.toBe(
      `${JSON.stringify(originalManifest, null, 2)}\n`
    )
  })

  it('downloads and installs when cached package file_size does not match the active Skill metadata', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const staleZip = Buffer.from('stale zip bytes')
    const freshZip = Buffer.from('fresh zip bytes')
    const freshHash = sha256(freshZip)
    const packagePath = join(runtimePaths.skillPackagesDir, `skill-1-2026.05.29-${freshHash}.zip`)
    await writeFile(packagePath, staleZip)
    await writeFile(
      runtimePaths.skillManifestPath,
      `${JSON.stringify(
        {
          skills: [
            {
              id: 'skill-1',
              name: '通用-代码变更审查-模板一',
              version: '2026.05.29',
              content_hash: freshHash,
              hash: freshHash,
              file_size: freshZip.byteLength,
              package_path: packagePath,
              installed_at: '2026-05-29T10:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`
    )
    const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: freshHash,
            file_size: freshZip.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn(async () => toArrayBuffer(freshZip))
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'synced',
      skills: [expect.objectContaining({ id: 'skill-1', package_path: packagePath })]
    })
    expect(api.downloadSkill).toHaveBeenCalledWith('token-123', 'skill-1')
    await expect(readFile(packagePath)).resolves.toEqual(freshZip)
  })

  it('reads legacy single Skill manifests and rewrites them as multi Skill manifests when current', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('legacy cached zip bytes')
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
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: contentHash,
            file_size: zipBytes.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill: vi.fn()
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'current',
      skills: [expect.objectContaining({ id: 'skill-1' })]
    })
    const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
      skills: Array<{ id: string }>
    }
    expect(manifest).toEqual({
      skills: [expect.objectContaining({ id: 'skill-1', name: '通用-代码变更审查-模板一' })]
    })
    expect(api.downloadSkill).not.toHaveBeenCalled()
  })

  it('drops stale legacy manifest entries without names instead of blocking active Skill sync', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = runtimePathsFor(runtimeRoot)
    await mkdir(runtimePaths.skillPackagesDir, { recursive: true })
    const freshZip = Buffer.from('fresh active zip bytes')
    const freshHash = sha256(freshZip)
    const packagePath = join(runtimePaths.skillPackagesDir, `skill-new-2026.06.09-${freshHash}.zip`)
    await writeFile(
      runtimePaths.skillManifestPath,
      `${JSON.stringify(
        {
          id: 'skill-stale',
          version: '2026.05.01',
          package_path: join(runtimePaths.skillPackagesDir, 'stale.zip'),
          installed_at: '2026-05-01T10:00:00.000Z'
        },
        null,
        2
      )}\n`
    )
    const deleteSkill = vi.fn()
    const installSkill = vi.fn(async () => ({ stdout: 'installed', stderr: '' }))
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-new',
            name: '通用-代码审查-模版一',
            version: '2026.06.09',
            content_hash: freshHash,
            file_size: freshZip.byteLength
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn(async () => toArrayBuffer(freshZip))
    }
    const service = new SkillSyncService(api, {
      runtimePaths,
      installSkill,
      deleteSkill
    })

    await expect(service.sync('token-123')).resolves.toMatchObject({
      status: 'synced',
      skills: [expect.objectContaining({ id: 'skill-new', name: '通用-代码审查-模版一' })]
    })
    expect(deleteSkill).not.toHaveBeenCalled()
    expect(api.downloadSkill).toHaveBeenCalledWith('token-123', 'skill-new')
    await expect(readFile(packagePath)).resolves.toEqual(freshZip)
    const manifest = JSON.parse(await readFile(runtimePaths.skillManifestPath, 'utf8')) as {
      skills: Array<{ id: string }>
    }
    expect(manifest.skills).toEqual([expect.objectContaining({ id: 'skill-new' })])
  })

  it('rejects a sync when the server has no active Skills configured', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const api = {
      getActiveSkills: vi.fn(async () => ({ data: [], count: 0 })),
      downloadSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill: vi.fn()
    })

    await expect(service.sync('token-123')).rejects.toThrow('No active skill is configured')
    expect(api.downloadSkill).not.toHaveBeenCalled()
  })

  it('rejects a downloaded package when hash does not match active Skill metadata', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const zipBytes = Buffer.from('tampered zip bytes')
    const installSkill = vi.fn()
    const api = {
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: 'expected-hash'
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn(async () => toArrayBuffer(zipBytes))
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
      getActiveSkills: vi.fn(async () => ({
        data: [
          {
            id: 'skill-1',
            name: '通用-代码变更审查-模板一',
            version: '2026.05.29',
            content_hash: contentHash,
            file_size: zipBytes.byteLength + 1
          }
        ],
        count: 1
      })),
      downloadSkill: vi.fn(async () => toArrayBuffer(zipBytes))
    }
    const service = new SkillSyncService(api, {
      runtimePaths: runtimePathsFor(runtimeRoot),
      installSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('Skill package size mismatch')
    expect(installSkill).not.toHaveBeenCalled()
  })
})
