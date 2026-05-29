import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isInsideDirectory, SkillSyncService } from '../skill-sync'

const execFileAsync = promisify(execFile)

describe('SkillSyncService', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  const createSkillZip = async (): Promise<ArrayBuffer> => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'skill-package-source-'))
    tempDirs.push(sourceDir)
    await writeFile(join(sourceDir, 'SKILL.md'), '# Review Skill\n![diagram](image/SKILL/diagram.png)\n')
    await execFileAsync('mkdir', ['-p', join(sourceDir, 'image', 'SKILL')])
    await writeFile(join(sourceDir, 'image', 'SKILL', 'diagram.png'), 'png bytes')
    await execFileAsync('zip', ['-qr', join(sourceDir, 'skill.zip'), 'SKILL.md', 'image'], {
      cwd: sourceDir
    })
    const bytes = await readFile(join(sourceDir, 'skill.zip'))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  const createNestedSkillZip = async (): Promise<ArrayBuffer> => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'skill-package-source-'))
    tempDirs.push(sourceDir)
    await execFileAsync('mkdir', ['-p', join(sourceDir, '通用-代码变更审查', 'image', 'SKILL')])
    await writeFile(
      join(sourceDir, '通用-代码变更审查', 'SKILL.md'),
      '# Review Skill\n![diagram](image/SKILL/diagram.png)\n'
    )
    await writeFile(join(sourceDir, '通用-代码变更审查', 'image', 'SKILL', 'diagram.png'), 'png bytes')
    await execFileAsync('zip', ['-qr', join(sourceDir, 'skill.zip'), '通用-代码变更审查'], {
      cwd: sourceDir
    })
    const bytes = await readFile(join(sourceDir, 'skill.zip'))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }

  const sha256 = (bytes: ArrayBuffer): string =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex')

  it('downloads the active skill package and writes the full directory plus manifest.json', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'skill-sync-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    tempDirs.push(userData)
    tempDirs.push(codexHome)
    const skillZip = await createSkillZip()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: sha256(skillZip)
      })),
      downloadActiveSkill: vi.fn(async () => skillZip)
    }
    const service = new SkillSyncService(api, userData, codexHome)

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'synced',
      skillPath: join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md')
    })

    await expect(
      readFile(join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md'), 'utf8')
    ).resolves.toBe('# Review Skill\n![diagram](image/SKILL/diagram.png)\n')
    await expect(
      readFile(join(codexHome, 'skills', '通用-代码变更审查', 'image', 'SKILL', 'diagram.png'), 'utf8')
    ).resolves.toBe('png bytes')
    await expect(
      readFile(join(userData, 'skill-packages', '通用-代码变更审查', 'skill.zip'))
    ).resolves.toEqual(Buffer.from(skillZip))
    await expect(
      readFile(join(userData, 'skill-packages', '通用-代码变更审查', 'manifest.json'), 'utf8')
    ).resolves.toBe(
      `${JSON.stringify(
        {
          id: 'skill-1',
          version: '2026.05.28',
          content_hash: sha256(skillZip),
          hash: sha256(skillZip)
        },
        null,
        2
      )}\n`
    )
    expect(api.downloadActiveSkill).toHaveBeenCalledWith('token-123')
  })

  it('skips downloading when local manifest already matches active skill', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'skill-sync-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    tempDirs.push(userData)
    tempDirs.push(codexHome)
    const skillZip = await createSkillZip()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: sha256(skillZip)
      })),
      downloadActiveSkill: vi.fn(async () => skillZip)
    }
    const service = new SkillSyncService(api, userData, codexHome)

    await service.sync('token-123')
    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'current',
      skillPath: join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md')
    })

    expect(api.downloadActiveSkill).toHaveBeenCalledTimes(1)
  })

  it('downloads again when manifest matches but SKILL.md is missing', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'skill-sync-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    tempDirs.push(userData)
    tempDirs.push(codexHome)
    const skillZip = await createSkillZip()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: sha256(skillZip)
      })),
      downloadActiveSkill: vi.fn(async () => skillZip)
    }
    const service = new SkillSyncService(api, userData, codexHome)

    await service.sync('token-123')
    await unlink(join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md'))

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'synced',
      skillPath: join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md')
    })

    expect(api.downloadActiveSkill).toHaveBeenCalledTimes(2)
  })

  it('installs a package that contains the skill inside a single top-level directory', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'skill-sync-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    tempDirs.push(userData)
    tempDirs.push(codexHome)
    const skillZip = await createNestedSkillZip()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: sha256(skillZip)
      })),
      downloadActiveSkill: vi.fn(async () => skillZip)
    }
    const service = new SkillSyncService(api, userData, codexHome)

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'synced',
      skillPath: join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md')
    })

    await expect(
      readFile(join(codexHome, 'skills', '通用-代码变更审查', 'SKILL.md'), 'utf8')
    ).resolves.toBe('# Review Skill\n![diagram](image/SKILL/diagram.png)\n')
    await expect(
      readFile(join(codexHome, 'skills', '通用-代码变更审查', 'image', 'SKILL', 'diagram.png'), 'utf8')
    ).resolves.toBe('png bytes')
  })

  it('rejects a downloaded package when its hash does not match active skill metadata', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'skill-sync-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'codex-home-'))
    tempDirs.push(userData)
    tempDirs.push(codexHome)
    const skillZip = await createSkillZip()
    const api = {
      getActiveSkill: vi.fn(async () => ({
        id: 'skill-1',
        version: '2026.05.28',
        content_hash: 'expected-hash'
      })),
      downloadActiveSkill: vi.fn(async () => skillZip)
    }
    const service = new SkillSyncService(api, userData, codexHome)

    await expect(service.sync('token-123')).rejects.toThrow('Skill package hash mismatch')
  })

  it('allows root package files and rejects parent traversal paths', () => {
    const parentDir = join(tmpdir(), 'skill-target')

    expect(isInsideDirectory(parentDir, join(parentDir, 'SKILL.md'))).toBe(true)
    expect(isInsideDirectory(parentDir, join(parentDir, 'image', 'SKILL', 'diagram.png'))).toBe(
      true
    )
    expect(isInsideDirectory(parentDir, join(parentDir, '..', 'SKILL.md'))).toBe(false)
  })
})
