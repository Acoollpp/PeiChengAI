import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ActiveSkill, ApiClient } from './api-client'
import { installCodexSkillFromZip } from './codex-skill-installer'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'

export interface SkillSyncApi {
  getActiveSkill(token: string): Promise<ActiveSkill>
  downloadActiveSkill(token: string): Promise<ArrayBuffer>
}

export interface SkillManifest {
  id: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
  package_path: string
  installed_at: string
}

export interface SkillSyncResult {
  status: 'current' | 'synced'
  packagePath: string
}

interface ExpectedSkillManifest {
  id: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
}

interface SkillSyncOptions {
  runtimePaths: RuntimePaths
  installSkill?: (input: { packagePath: string }) => Promise<unknown>
}

export class SkillSyncService {
  private readonly api: SkillSyncApi
  private readonly runtimePaths: RuntimePaths
  private readonly installSkill: (input: { packagePath: string }) => Promise<unknown>

  constructor(api: SkillSyncApi | ApiClient, options: SkillSyncOptions) {
    this.api = api
    this.runtimePaths = options.runtimePaths
    this.installSkill = options.installSkill ?? installCodexSkillFromZip
  }

  async sync(token: string): Promise<SkillSyncResult> {
    const activeSkill = await this.api.getActiveSkill(token)
    const manifest = this.toManifest(activeSkill)
    const currentManifest = await this.readManifest()

    if (currentManifest && (await this.cachedPackageMatches(currentManifest, manifest))) {
      return { status: 'current', packagePath: currentManifest.package_path }
    }

    const packageBytes = Buffer.from(await this.api.downloadActiveSkill(token))
    const contentHash = hashBuffer(packageBytes)
    const expectedHash = manifest.content_hash ?? manifest.hash

    if (expectedHash && contentHash !== expectedHash) {
      throw new Error(`Skill package hash mismatch: expected ${expectedHash}, received ${contentHash}`)
    }

    if (manifest.file_size !== undefined && packageBytes.byteLength !== manifest.file_size) {
      throw new Error(
        `Skill package size mismatch: expected ${manifest.file_size}, received ${packageBytes.byteLength}`
      )
    }

    await mkdir(this.runtimePaths.skillPackagesDir, { recursive: true })
    const packagePath = join(
      this.runtimePaths.skillPackagesDir,
      `${sanitizePathSegment(manifest.id)}-${sanitizePathSegment(manifest.version)}-${sanitizePathSegment(
        expectedHash ?? contentHash
      )}.zip`
    )
    await writeFile(packagePath, packageBytes)
    await this.installSkill({ packagePath })

    const installedManifest: SkillManifest = {
      ...manifest,
      content_hash: expectedHash ?? contentHash,
      hash: expectedHash ?? contentHash,
      file_size: manifest.file_size ?? packageBytes.byteLength,
      package_path: packagePath,
      installed_at: new Date().toISOString()
    }
    await writeFile(this.runtimePaths.skillManifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`)

    return { status: 'synced', packagePath }
  }

  private toManifest(activeSkill: ActiveSkill): ExpectedSkillManifest {
    const contentHash = activeSkill.content_hash ?? activeSkill.hash

    return {
      id: activeSkill.id,
      version: activeSkill.version,
      ...(contentHash ? { content_hash: contentHash, hash: contentHash } : {}),
      ...(activeSkill.file_size !== undefined ? { file_size: activeSkill.file_size } : {})
    }
  }

  private async readManifest(): Promise<SkillManifest | null> {
    try {
      const parsed = JSON.parse(await readFile(this.runtimePaths.skillManifestPath, 'utf8')) as unknown

      if (this.isManifest(parsed)) {
        return parsed
      }
    } catch {
      return null
    }

    return null
  }

  private async cachedPackageMatches(
    current: SkillManifest,
    expected: ExpectedSkillManifest
  ): Promise<boolean> {
    const expectedHash = expected.content_hash ?? expected.hash
    const currentHash = current.content_hash ?? current.hash

    if (current.id !== expected.id || current.version !== expected.version || currentHash !== expectedHash) {
      return false
    }

    try {
      await access(current.package_path)
      const packageStat = await stat(current.package_path)
      if (expected.file_size !== undefined && packageStat.size !== expected.file_size) {
        return false
      }
      if (expectedHash && (await hashFile(current.package_path)) !== expectedHash) {
        return false
      }
      return true
    } catch {
      return false
    }
  }

  private isManifest(value: unknown): value is SkillManifest {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'version' in value &&
      'package_path' in value &&
      'installed_at' in value &&
      typeof value.id === 'string' &&
      typeof value.version === 'string' &&
      typeof value.package_path === 'string' &&
      typeof value.installed_at === 'string'
    )
  }
}

export const createSkillSyncService = async (api: ApiClient): Promise<SkillSyncService> =>
  new SkillSyncService(api, {
    runtimePaths: await getRuntimePaths()
  })

const hashBuffer = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

const hashFile = async (filePath: string): Promise<string> => hashBuffer(await readFile(filePath))

const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_')
