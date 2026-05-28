import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

import type { ActiveSkill, ApiClient } from './api-client'

const REVIEW_SKILL_NAME = '通用-代码变更审查'

export interface SkillSyncApi {
  getActiveSkill(token: string): Promise<ActiveSkill>
  downloadActiveSkill(token: string): Promise<ArrayBuffer>
}

export interface SkillManifest {
  id: string
  version: string
  content_hash?: string
  hash?: string
}

export interface SkillSyncResult {
  status: 'current' | 'synced'
  skillPath: string
}

export class SkillSyncService {
  private readonly api: SkillSyncApi
  private readonly userDataPath: string

  constructor(api: SkillSyncApi | ApiClient, userDataPath?: string) {
    this.api = api
    this.userDataPath = userDataPath ?? ''
  }

  async sync(token: string): Promise<SkillSyncResult> {
    const activeSkill = await this.api.getActiveSkill(token)
    const skillDir = this.skillDir()
    const skillPath = join(skillDir, 'SKILL.md')
    const manifestPath = join(skillDir, 'manifest.json')
    const manifest = this.toManifest(activeSkill)
    const currentManifest = await this.readManifest(manifestPath)

    if (this.manifestMatches(currentManifest, manifest) && (await this.fileExists(skillPath))) {
      return { status: 'current', skillPath }
    }

    const packageBytes = await this.api.downloadActiveSkill(token)

    await this.replaceSkillDir(skillDir, packageBytes)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    return { status: 'synced', skillPath }
  }

  private skillDir(): string {
    return join(this.userData(), 'skills', REVIEW_SKILL_NAME)
  }

  private userData(): string {
    if (this.userDataPath) {
      return this.userDataPath
    }

    throw new Error('SkillSyncService requires a userData path')
  }

  private toManifest(activeSkill: ActiveSkill): SkillManifest {
    const contentHash = activeSkill.content_hash ?? activeSkill.hash

    return {
      id: activeSkill.id,
      version: activeSkill.version,
      ...(contentHash ? { content_hash: contentHash, hash: contentHash } : {})
    }
  }

  private async readManifest(manifestPath: string): Promise<SkillManifest | null> {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown

      if (this.isManifest(parsed)) {
        return parsed
      }
    } catch {
      return null
    }

    return null
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async replaceSkillDir(skillDir: string, packageBytes: ArrayBuffer): Promise<void> {
    const tempDir = await mkdtemp(join(tmpdir(), 'code-review-skill-'))
    const zipPath = join(tempDir, 'skill.zip')

    try {
      await writeFile(zipPath, Buffer.from(packageBytes))
      await unzipPackage(zipPath, tempDir)

      const extractedSkillPath = join(tempDir, 'SKILL.md')
      await access(extractedSkillPath)

      await rm(skillDir, { recursive: true, force: true })
      await mkdir(skillDir, { recursive: true })
      await unzipPackage(zipPath, skillDir)
      await rm(join(skillDir, 'skill.zip'), { force: true })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private manifestMatches(current: SkillManifest | null, expected: SkillManifest): boolean {
    if (!current) {
      return false
    }

    return (
      current.id === expected.id &&
      current.version === expected.version &&
      (current.content_hash ?? current.hash) === (expected.content_hash ?? expected.hash)
    )
  }

  private isManifest(value: unknown): value is SkillManifest {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'version' in value &&
      typeof value.id === 'string' &&
      typeof value.version === 'string'
    )
  }
}

export const createSkillSyncService = async (api: ApiClient): Promise<SkillSyncService> => {
  const { app } = await import('electron')
  return new SkillSyncService(api, app.getPath('userData'))
}

const unzipPackage = (zipPath: string, targetDir: string): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        rejectPromise(openError ?? new Error('Failed to open skill package'))
        return
      }

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        const targetPath = resolve(targetDir, entry.fileName)

        if (!isInsideDirectory(targetDir, targetPath)) {
          zipfile.close()
          rejectPromise(new Error(`Invalid skill package path: ${entry.fileName}`))
          return
        }

        if (/\/$/.test(entry.fileName)) {
          mkdir(targetPath, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch((error: unknown) => {
              zipfile.close()
              rejectPromise(error)
            })
          return
        }

        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            zipfile.close()
            rejectPromise(streamError ?? new Error(`Failed to read ${entry.fileName}`))
            return
          }

          mkdir(dirname(targetPath), { recursive: true })
            .then(() => pipeline(readStream, createWriteStream(targetPath)))
            .then(() => zipfile.readEntry())
            .catch((error: unknown) => {
              zipfile.close()
              rejectPromise(error)
            })
        })
      })
      zipfile.on('end', () => resolvePromise())
      zipfile.on('error', rejectPromise)
    })
  })

export const isInsideDirectory = (parentDir: string, childPath: string): boolean => {
  const normalizedParent = resolve(parentDir)
  const normalizedChild = resolve(childPath)
  const relativePath = relative(normalizedParent, normalizedChild)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}
