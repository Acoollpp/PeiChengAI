import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
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

export const codexSkillDir = (
  codexHomePath = process.env.CODEX_HOME ?? join(homedir(), '.codex')
): string => join(codexHomePath, 'skills', REVIEW_SKILL_NAME)

export class SkillSyncService {
  private readonly api: SkillSyncApi
  private readonly userDataPath: string
  private readonly codexHomePath: string

  constructor(api: SkillSyncApi | ApiClient, userDataPath?: string, codexHomePath?: string) {
    this.api = api
    this.userDataPath = userDataPath ?? ''
    this.codexHomePath = codexHomePath ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
  }

  async sync(token: string): Promise<SkillSyncResult> {
    const activeSkill = await this.api.getActiveSkill(token)
    const packagePath = this.packagePath()
    const codexSkillPath = join(this.codexSkillDir(), 'SKILL.md')
    const manifestPath = this.manifestPath()
    const manifest = this.toManifest(activeSkill)
    const currentManifest = await this.readManifest(manifestPath)

    if (
      this.manifestMatches(currentManifest, manifest) &&
      (await this.fileExists(packagePath)) &&
      (await this.fileExists(codexSkillPath))
    ) {
      return { status: 'current', skillPath: codexSkillPath }
    }

    const packageBytes = await this.api.downloadActiveSkill(token)
    this.assertPackageHash(packageBytes, manifest)

    await mkdir(dirname(packagePath), { recursive: true })
    await writeFile(packagePath, Buffer.from(packageBytes))
    await installSkillPackage(packagePath, this.codexSkillDir())
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    return { status: 'synced', skillPath: codexSkillPath }
  }

  private packagePath(): string {
    return join(this.cacheDir(), 'skill.zip')
  }

  private manifestPath(): string {
    return join(this.cacheDir(), 'manifest.json')
  }

  private cacheDir(): string {
    return join(this.userData(), 'skill-packages', REVIEW_SKILL_NAME)
  }

  private codexSkillDir(): string {
    return codexSkillDir(this.codexHomePath)
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

  private assertPackageHash(packageBytes: ArrayBuffer, manifest: SkillManifest): void {
    const expectedHash = manifest.content_hash ?? manifest.hash
    if (!expectedHash) {
      return
    }

    const receivedHash = createHash('sha256').update(Buffer.from(packageBytes)).digest('hex')
    if (receivedHash !== expectedHash) {
      throw new Error(
        `Skill package hash mismatch: expected ${expectedHash}, received ${receivedHash}`
      )
    }
  }
}

export const createSkillSyncService = async (api: ApiClient): Promise<SkillSyncService> => {
  const { app } = await import('electron')
  return new SkillSyncService(api, app.getPath('userData'))
}

export const installSkillPackage = async (zipPath: string, skillDir: string): Promise<void> => {
  const tempDir = await mkdtemp(join(tmpdir(), 'code-review-skill-'))

  try {
    await unzipPackage(zipPath, tempDir)
    const extractedSkillDir = await findExtractedSkillDir(tempDir)

    await rm(skillDir, { recursive: true, force: true })
    await mkdir(skillDir, { recursive: true })
    await cp(extractedSkillDir, skillDir, { recursive: true })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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

const findExtractedSkillDir = async (tempDir: string): Promise<string> => {
  const rootSkillPath = join(tempDir, 'SKILL.md')
  if (await fileExists(rootSkillPath)) {
    return tempDir
  }

  const entries = await readdir(tempDir, { withFileTypes: true })
  const topLevelDirs = entries.filter((entry) => entry.isDirectory())

  for (const entry of topLevelDirs) {
    const skillDir = join(tempDir, entry.name)
    if (await fileExists(join(skillDir, 'SKILL.md'))) {
      return skillDir
    }
  }

  throw new Error('Skill package must contain SKILL.md')
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export const isInsideDirectory = (parentDir: string, childPath: string): boolean => {
  const normalizedParent = resolve(parentDir)
  const normalizedChild = resolve(childPath)
  const relativePath = relative(normalizedParent, normalizedChild)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}
