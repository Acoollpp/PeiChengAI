import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ActiveSkill, ActiveSkillsResponse, ApiClient } from './api-client'
import { deleteCodexSkill, installCodexSkillFromZip } from './codex-skill-installer'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'

export interface SkillSyncApi {
  getActiveSkills(token: string): Promise<ActiveSkillsResponse>
  downloadSkill(token: string, skillId: string): Promise<ArrayBuffer>
}

export interface SkillManifestEntry {
  id: string
  name: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
  package_path: string
  installed_at: string
}

export interface SkillManifest {
  skills: SkillManifestEntry[]
}

export interface SkillSyncResult {
  status: 'current' | 'synced'
  skills: SkillManifestEntry[]
}

interface ExpectedSkillManifest {
  id: string
  name: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
}

interface SkillSyncOptions {
  runtimePaths: RuntimePaths
  installSkill?: (input: {
    packagePath: string
    skillId: string
    skillName: string
    version: string
    contentHash?: string
  }) => Promise<unknown>
  deleteSkill?: (input: { skillId: string; skillName: string; version: string }) => Promise<unknown>
}

export class SkillSyncService {
  private readonly api: SkillSyncApi
  private readonly runtimePaths: RuntimePaths
  private readonly installSkill: NonNullable<SkillSyncOptions['installSkill']>
  private readonly deleteSkill: NonNullable<SkillSyncOptions['deleteSkill']>

  constructor(api: SkillSyncApi | ApiClient, options: SkillSyncOptions) {
    this.api = api
    this.runtimePaths = options.runtimePaths
    this.installSkill = options.installSkill ?? installCodexSkillFromZip
    this.deleteSkill = options.deleteSkill ?? deleteCodexSkill
  }

  async sync(token: string): Promise<SkillSyncResult> {
    const activeSkills = (await this.api.getActiveSkills(token)).data
    const currentManifest = await this.readManifest()
    const currentEntries = currentManifest?.skills ?? []
    const nextEntries: SkillManifestEntry[] = []
    let didChange = false

    for (const staleEntry of currentEntries.filter(
      (entry) => !activeSkills.some((skill) => skill.id === entry.id)
    )) {
      const staleSkillName = staleEntry.name.trim()
      if (!staleSkillName) {
        didChange = true
        continue
      }

      await this.deleteSkill({
        skillId: staleEntry.id,
        skillName: staleSkillName,
        version: staleEntry.version
      })
      didChange = true
    }

    if (activeSkills.length === 0) {
      await this.writeManifest({ skills: [] })
      throw new Error('No active skill is configured')
    }

    for (const activeSkill of activeSkills) {
      const expected = this.toManifest(activeSkill)
      const current = currentEntries.find((entry) => entry.id === expected.id)
      if (current && (await this.cachedPackageMatches(current, expected))) {
        const normalizedEntry = { ...current, name: expected.name }
        nextEntries.push(normalizedEntry)
        continue
      }

      const installed = await this.downloadAndInstall(token, expected)
      nextEntries.push(installed)
      didChange = true
    }

    await this.writeManifest({ skills: nextEntries })

    return { status: didChange ? 'synced' : 'current', skills: nextEntries }
  }

  private async downloadAndInstall(
    token: string,
    manifest: ExpectedSkillManifest
  ): Promise<SkillManifestEntry> {
    const packageBytes = Buffer.from(await this.api.downloadSkill(token, manifest.id))
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

    const installedHash = expectedHash ?? contentHash
    await mkdir(this.runtimePaths.skillPackagesDir, { recursive: true })
    const packagePath = join(
      this.runtimePaths.skillPackagesDir,
      `${sanitizePathSegment(manifest.id)}-${sanitizePathSegment(manifest.version)}-${sanitizePathSegment(
        installedHash
      )}.zip`
    )
    await writeFile(packagePath, packageBytes)
    await this.installSkill?.({
      packagePath,
      skillId: manifest.id,
      skillName: manifest.name,
      version: manifest.version,
      contentHash: installedHash
    })

    return {
      ...manifest,
      content_hash: installedHash,
      hash: installedHash,
      file_size: manifest.file_size ?? packageBytes.byteLength,
      package_path: packagePath,
      installed_at: new Date().toISOString()
    }
  }

  private toManifest(activeSkill: ActiveSkill): ExpectedSkillManifest {
    const contentHash = activeSkill.content_hash ?? activeSkill.hash

    return {
      id: activeSkill.id,
      name: activeSkill.name,
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

      const legacyEntry = this.toLegacyManifestEntry(parsed)
      if (legacyEntry) {
        return { skills: [legacyEntry] }
      }
    } catch {
      return null
    }

    return null
  }

  private async cachedPackageMatches(
    current: SkillManifestEntry,
    expected: ExpectedSkillManifest
  ): Promise<boolean> {
    const expectedHash = expected.content_hash ?? expected.hash
    const currentHash = current.content_hash ?? current.hash
    const hashToVerify = expectedHash ?? currentHash

    if (
      current.id !== expected.id ||
      (current.name.length > 0 && current.name !== expected.name) ||
      current.version !== expected.version ||
      (expectedHash !== undefined && currentHash !== expectedHash)
    ) {
      return false
    }

    try {
      await access(current.package_path)
      const packageStat = await stat(current.package_path)
      if (expected.file_size !== undefined && packageStat.size !== expected.file_size) {
        return false
      }
      if (hashToVerify && (await hashFile(current.package_path)) !== hashToVerify) {
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
      'skills' in value &&
      Array.isArray(value.skills) &&
      value.skills.every((entry) => this.isManifestEntry(entry))
    )
  }

  private isManifestEntry(value: unknown): value is SkillManifestEntry {
    return (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'name' in value &&
      'version' in value &&
      'package_path' in value &&
      'installed_at' in value &&
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.version === 'string' &&
      typeof value.package_path === 'string' &&
      typeof value.installed_at === 'string'
    )
  }

  private toLegacyManifestEntry(value: unknown): SkillManifestEntry | null {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      !('version' in value) ||
      !('package_path' in value) ||
      !('installed_at' in value) ||
      typeof value.id !== 'string' ||
      typeof value.version !== 'string' ||
      typeof value.package_path !== 'string' ||
      typeof value.installed_at !== 'string'
    ) {
      return null
    }

    const entry: SkillManifestEntry = {
      id: value.id,
      name: 'name' in value && typeof value.name === 'string' ? value.name : '',
      version: value.version,
      package_path: value.package_path,
      installed_at: value.installed_at
    }

    if ('content_hash' in value && typeof value.content_hash === 'string') {
      entry.content_hash = value.content_hash
    }
    if ('hash' in value && typeof value.hash === 'string') {
      entry.hash = value.hash
    }
    if ('file_size' in value && typeof value.file_size === 'number') {
      entry.file_size = value.file_size
    }

    return entry
  }

  private async writeManifest(manifest: SkillManifest): Promise<void> {
    await mkdir(this.runtimePaths.skillPackagesDir, { recursive: true })
    await writeFile(this.runtimePaths.skillManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

export const createSkillSyncService = async (api: ApiClient): Promise<SkillSyncService> =>
  new SkillSyncService(api, {
    runtimePaths: await getRuntimePaths()
  })

const hashBuffer = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

const hashFile = async (filePath: string): Promise<string> => hashBuffer(await readFile(filePath))

const sanitizePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_')
