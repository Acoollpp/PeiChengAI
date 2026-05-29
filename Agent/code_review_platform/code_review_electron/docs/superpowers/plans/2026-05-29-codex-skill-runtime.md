# Codex Skill Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Electron-managed Skill package caching and Codex task workspaces under the packaged client directory, while installing Skills through Codex from the original server zip.

**Architecture:** Add a focused runtime path module, a Codex Skill installer adapter, and a zip-only Skill sync flow. Existing task execution keeps using Codex `exec`, but workspace preparation no longer copies Skill files and prompts refer to the Codex-installed Skill by name.

**Tech Stack:** Electron main process, TypeScript, Node `fs/promises`, Node `crypto`, Vitest, existing `ApiClient`, existing Codex runner helpers.

---

## File Structure

- Create `src/main/runtime-paths.ts`: owns runtime directory derivation and task workspace paths.
- Create `src/main/__tests__/runtime-paths.test.ts`: verifies packaged and development runtime roots.
- Create `src/main/codex-skill-installer.ts`: wraps the Codex command used to install a Skill from a local zip path.
- Create `src/main/__tests__/codex-skill-installer.test.ts`: verifies installer command, stdout/stderr capture, and failure behavior.
- Modify `src/main/api-client.ts`: allow active Skill metadata to include optional `file_size`.
- Modify `src/main/skill-sync.ts`: replace unzip-and-copy behavior with zip cache, hash/size validation, and Codex install call.
- Modify `src/main/__tests__/skill-sync.test.ts`: replace unzip assertions with zip cache, manifest, hash, size, and installer assertions.
- Modify `src/main/task-agent.ts`: create workspaces under runtime paths and stop copying Skill directories.
- Modify `src/main/__tests__/task-agent.test.ts`: update workspace tests.
- Modify `src/main/codex-runner.ts`: change prompt to refer to installed Skill name instead of `skills/...`.
- Modify `src/main/__tests__/codex-runner.test.ts`: update prompt assertions.
- Modify `src/main/environment-checker.ts`: check runtime directory writability and package manifest instead of `userData/skills/SKILL.md`.
- Modify `src/main/__tests__/environment-checker.test.ts`: add runtime failure and Skill manifest behavior tests.
- Modify `src/main/ipc.ts` and `src/main/__tests__/ipc.test.ts`: adjust `SkillSyncResult` expectations from `skillPath` to `packagePath`.

### Task 1: Runtime Path Module

**Files:**
- Create: `src/main/runtime-paths.ts`
- Create: `src/main/__tests__/runtime-paths.test.ts`

- [ ] **Step 1: Write failing tests for packaged and development runtime roots**

Add `src/main/__tests__/runtime-paths.test.ts`:

```ts
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

describe('runtime paths', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('uses the exe directory when Electron is packaged', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: true,
        getPath: vi.fn((name: string) => {
          if (name === 'exe') return 'D:\\SoftWare\\CodeReviewClient\\CodeReview.exe'
          throw new Error(`unexpected path request ${name}`)
        })
      }
    }))

    const { getRuntimePaths } = await import('../runtime-paths')
    const paths = await getRuntimePaths()

    expect(paths.runtimeRoot).toBe('D:\\SoftWare\\CodeReviewClient\\runtime-data')
    expect(paths.skillPackagesDir).toBe(
      'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages'
    )
    expect(paths.skillManifestPath).toBe(
      'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\manifest.json'
    )
    expect(paths.workspacesDir).toBe('D:\\SoftWare\\CodeReviewClient\\runtime-data\\workspaces')
    expect(paths.workspaceForTask('task-1')).toBe(
      'D:\\SoftWare\\CodeReviewClient\\runtime-data\\workspaces\\task-1'
    )
    expect(paths.reportPathForTask('task-1')).toBe(
      'D:\\SoftWare\\CodeReviewClient\\runtime-data\\workspaces\\task-1\\report.md'
    )
  })

  it('uses a local .runtime-data directory when Electron is not packaged', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => 'D:\\repo\\code_review_electron')
      }
    }))

    const { getRuntimePaths } = await import('../runtime-paths')
    const paths = await getRuntimePaths()

    expect(paths.runtimeRoot).toBe(join('D:\\repo\\code_review_electron', '.runtime-data'))
    expect(paths.workspaceForTask('task-2')).toBe(
      join('D:\\repo\\code_review_electron', '.runtime-data', 'workspaces', 'task-2')
    )
  })
})
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npm test -- src/main/__tests__/runtime-paths.test.ts`

Expected: FAIL with an import error for `../runtime-paths`.

- [ ] **Step 3: Implement `runtime-paths.ts`**

Create `src/main/runtime-paths.ts`:

```ts
import { dirname, join } from 'node:path'

export interface RuntimePaths {
  runtimeRoot: string
  skillPackagesDir: string
  skillManifestPath: string
  workspacesDir: string
  workspaceForTask(taskId: string): string
  reportPathForTask(taskId: string): string
}

export const RUNTIME_DATA_DIR = 'runtime-data'
export const DEV_RUNTIME_DATA_DIR = '.runtime-data'

export const getRuntimePaths = async (): Promise<RuntimePaths> => {
  const { app } = await import('electron')
  const appRoot = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
  const runtimeRoot = join(appRoot, app.isPackaged ? RUNTIME_DATA_DIR : DEV_RUNTIME_DATA_DIR)
  const skillPackagesDir = join(runtimeRoot, 'skill-packages')
  const workspacesDir = join(runtimeRoot, 'workspaces')

  return {
    runtimeRoot,
    skillPackagesDir,
    skillManifestPath: join(skillPackagesDir, 'manifest.json'),
    workspacesDir,
    workspaceForTask: (taskId: string) => join(workspacesDir, taskId),
    reportPathForTask: (taskId: string) => join(workspacesDir, taskId, 'report.md')
  }
}
```

- [ ] **Step 4: Run the runtime path tests and verify they pass**

Run: `npm test -- src/main/__tests__/runtime-paths.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit runtime path module**

```bash
git add src/main/runtime-paths.ts src/main/__tests__/runtime-paths.test.ts
git commit -m "Add Electron runtime path module"
```

### Task 2: Codex Skill Installer Adapter

**Files:**
- Create: `src/main/codex-skill-installer.ts`
- Create: `src/main/__tests__/codex-skill-installer.test.ts`

- [ ] **Step 1: Write failing installer tests**

Add `src/main/__tests__/codex-skill-installer.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import type { EventEmitter as EventEmitterType } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

vi.mock('../codex-runner', () => ({
  buildCodexCommand: () => 'codex',
  buildCodexExecArgs: (prompt: string) => ['exec', '--dangerously-bypass-approvals-and-sandbox', prompt]
}))

vi.mock('../environment-checker', () => ({
  buildVersionCommandOptions: () => ({ shell: true, env: { PATH: 'test-path' } })
}))

const makeChild = () => {
  const child = new EventEmitter() as EventEmitterType & {
    stdout: EventEmitterType
    stderr: EventEmitterType
    stdin: { end: ReturnType<typeof vi.fn> }
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn() }
  child.kill = vi.fn()
  spawnMock.mockReturnValue(child)
  return child
}

describe('installCodexSkillFromZip', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('asks Codex to install the Skill from the local zip path', async () => {
    const { installCodexSkillFromZip } = await import('../codex-skill-installer')
    const child = makeChild()

    const resultPromise = installCodexSkillFromZip({
      packagePath: 'D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\skill.zip',
      timeoutMs: 1000
    })
    child.stdout.emit('data', Buffer.from('installed\n'))
    child.emit('close', 0)

    await expect(resultPromise).resolves.toEqual({
      stdout: 'installed\n',
      stderr: ''
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        expect.stringContaining('D:\\SoftWare\\CodeReviewClient\\runtime-data\\skill-packages\\skill.zip')
      ],
      expect.objectContaining({
        shell: false
      })
    )
    expect(child.stdin.end).toHaveBeenCalledWith()
  })

  it('rejects with stderr when Codex install fails', async () => {
    const { installCodexSkillFromZip } = await import('../codex-skill-installer')
    const child = makeChild()

    const resultPromise = installCodexSkillFromZip({
      packagePath: 'D:\\runtime-data\\skill-packages\\bad.zip',
      timeoutMs: 1000
    })
    child.stderr.emit('data', Buffer.from('invalid skill package'))
    child.emit('close', 1)

    await expect(resultPromise).rejects.toThrow('Codex Skill install failed with exit code 1: invalid skill package')
  })
})
```

- [ ] **Step 2: Run installer tests and verify they fail**

Run: `npm test -- src/main/__tests__/codex-skill-installer.test.ts`

Expected: FAIL with an import error for `../codex-skill-installer`.

- [ ] **Step 3: Implement the installer adapter**

Create `src/main/codex-skill-installer.ts`:

```ts
import { spawn } from 'node:child_process'

import { buildVersionCommandOptions } from './environment-checker'
import { buildCodexCommand, buildCodexExecArgs } from './codex-runner'

export interface InstallCodexSkillInput {
  packagePath: string
  timeoutMs?: number
}

export interface InstallCodexSkillResult {
  stdout: string
  stderr: string
}

export const buildInstallSkillPrompt = (packagePath: string): string =>
  [
    '请将下面这个本地 Skill zip 包安装到 Codex 自己的 Skill 目录中。',
    '要求：',
    '1. 直接读取这个 zip 文件路径，不要修改 zip 内容。',
    '2. 如果 Codex 已经安装了同名 Skill，请用这个 zip 包中的版本覆盖更新。',
    '3. 安装完成后只输出简短成功信息。',
    '',
    `Skill zip 路径：${packagePath}`
  ].join('\n')

export const installCodexSkillFromZip = ({
  packagePath,
  timeoutMs = 5 * 60 * 1000
}: InstallCodexSkillInput): Promise<InstallCodexSkillResult> =>
  new Promise((resolve, reject) => {
    const commandOptions = buildVersionCommandOptions()
    const child = spawn(buildCodexCommand(), buildCodexExecArgs(buildInstallSkillPrompt(packagePath)), {
      ...commandOptions,
      shell: false,
      env: {
        ...commandOptions.env,
        CODEX_UNSAFE_ALLOW_NO_SANDBOX: '1'
      }
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const settle = (callback: () => void): void => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        callback()
      }
    }

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(new Error(`Codex Skill install timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.stdin.end()

    child.on('error', (error) => {
      settle(() => reject(error))
    })

    child.on('close', (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (code !== 0) {
          reject(new Error(`Codex Skill install failed with exit code ${code}: ${stderr}`))
          return
        }

        resolve({ stdout, stderr })
      })
    })
  })
```

- [ ] **Step 4: Run installer tests and verify they pass**

Run: `npm test -- src/main/__tests__/codex-skill-installer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit installer adapter**

```bash
git add src/main/codex-skill-installer.ts src/main/__tests__/codex-skill-installer.test.ts
git commit -m "Add Codex Skill installer adapter"
```

### Task 3: Zip-Only Skill Sync

**Files:**
- Modify: `src/main/api-client.ts`
- Modify: `src/main/skill-sync.ts`
- Modify: `src/main/__tests__/skill-sync.test.ts`

- [ ] **Step 1: Replace Skill sync tests with zip cache behavior**

Replace `src/main/__tests__/skill-sync.test.ts` with:

```ts
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SkillSyncService } from '../skill-sync'

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

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
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      },
      installSkill
    })

    const result = await service.sync('token-123')

    expect(result).toEqual({
      status: 'synced',
      packagePath: join(runtimeRoot, 'skill-packages', `skill-1-2026.05.29-${contentHash}.zip`)
    })
    await expect(readFile(result.packagePath)).resolves.toEqual(zipBytes)
    await expect(readFile(join(runtimeRoot, 'skill-packages', 'manifest.json'), 'utf8')).resolves.toContain(
      contentHash
    )
    expect(installSkill).toHaveBeenCalledWith({
      packagePath: result.packagePath
    })
  })

  it('skips download and install when manifest and cached zip hash match', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'skill-sync-runtime-'))
    tempDirs.push(runtimeRoot)
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    await mkdir(skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('cached zip bytes')
    const contentHash = sha256(zipBytes)
    const packagePath = join(skillPackagesDir, `skill-1-2026.05.29-${contentHash}.zip`)
    await writeFile(packagePath, zipBytes)
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      `${JSON.stringify(
        {
          id: 'skill-1',
          version: '2026.05.29',
          content_hash: contentHash,
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
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength
      })),
      downloadActiveSkill: vi.fn()
    }
    const service = new SkillSyncService(api, {
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir,
        skillManifestPath: join(skillPackagesDir, 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      },
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
    const skillPackagesDir = join(runtimeRoot, 'skill-packages')
    await mkdir(skillPackagesDir, { recursive: true })
    const zipBytes = Buffer.from('fresh zip bytes')
    const contentHash = sha256(zipBytes)
    await writeFile(
      join(skillPackagesDir, 'manifest.json'),
      `${JSON.stringify(
        {
          id: 'skill-1',
          version: '2026.05.29',
          content_hash: contentHash,
          package_path: join(skillPackagesDir, 'missing.zip'),
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
        version: '2026.05.29',
        content_hash: contentHash
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir,
        skillManifestPath: join(skillPackagesDir, 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      },
      installSkill
    })

    await expect(service.sync('token-123')).resolves.toEqual({
      status: 'synced',
      packagePath: join(skillPackagesDir, `skill-1-2026.05.29-${contentHash}.zip`)
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
        version: '2026.05.29',
        content_hash: 'expected-hash'
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      },
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
        version: '2026.05.29',
        content_hash: contentHash,
        file_size: zipBytes.byteLength + 1
      })),
      downloadActiveSkill: vi.fn(async () =>
        zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
      )
    }
    const service = new SkillSyncService(api, {
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      },
      installSkill
    })

    await expect(service.sync('token-123')).rejects.toThrow('Skill package size mismatch')
    expect(installSkill).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run Skill sync tests and verify they fail**

Run: `npm test -- src/main/__tests__/skill-sync.test.ts`

Expected: FAIL because `SkillSyncService` still expects a `userDataPath`, returns `skillPath`, and unzips packages.

- [ ] **Step 3: Update API metadata type**

Modify `src/main/api-client.ts`:

```ts
export interface ActiveSkill {
  id: string
  version: string
  content_hash?: string
  hash?: string
  file_size?: number
}
```

- [ ] **Step 4: Replace `skill-sync.ts` with zip cache implementation**

Replace the body of `src/main/skill-sync.ts` with:

```ts
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ActiveSkill, ApiClient } from './api-client'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'
import { installCodexSkillFromZip } from './codex-skill-installer'

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

    if (await this.cachedPackageMatches(currentManifest, manifest)) {
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

  private toManifest(activeSkill: ActiveSkill): Omit<SkillManifest, 'package_path' | 'installed_at'> {
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
    current: SkillManifest | null,
    expected: Omit<SkillManifest, 'package_path' | 'installed_at'>
  ): Promise<current is SkillManifest> {
    if (!current) return false
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
```

- [ ] **Step 5: Run Skill sync tests and fix compile issues**

Run: `npm test -- src/main/__tests__/skill-sync.test.ts`

Expected: PASS after removing any stale `isInsideDirectory` imports or zip helper code from the test file.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL because IPC tests and types still expect `skillPath`. Leave the failures for Task 6, but confirm there are no `skill-sync.ts` syntax errors.

- [ ] **Step 7: Commit zip-only Skill sync**

```bash
git add src/main/api-client.ts src/main/skill-sync.ts src/main/__tests__/skill-sync.test.ts
git commit -m "Cache Skill packages as original zip files"
```

### Task 4: Workspace Preparation and Prompt Update

**Files:**
- Modify: `src/main/task-agent.ts`
- Modify: `src/main/__tests__/task-agent.test.ts`
- Modify: `src/main/codex-runner.ts`
- Modify: `src/main/__tests__/codex-runner.test.ts`

- [ ] **Step 1: Update task-agent workspace tests**

In `src/main/__tests__/task-agent.test.ts`, replace the `defaultPrepareWorkspace` describe block with:

```ts
describe('defaultPrepareWorkspace', () => {
  const runtimeRoot = join(tmpdir(), `code-review-runtime-${Date.now()}`)

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('creates the task workspace under runtime-data workspaces without copying Skill files', async () => {
    vi.doMock('../runtime-paths', () => ({
      getRuntimePaths: vi.fn(async () => ({
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'report.md')
      }))
    }))

    const { defaultPrepareWorkspace } = await import('../task-agent')
    const workspace = await defaultPrepareWorkspace('task-runtime-workspace')

    expect(workspace).toEqual({
      cwd: join(runtimeRoot, 'workspaces', 'task-runtime-workspace'),
      reportPath: join(runtimeRoot, 'workspaces', 'task-runtime-workspace', 'report.md')
    })
    await expect(readFile(join(workspace.cwd, 'skills', '通用-代码变更审查', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Update prompt tests**

In `src/main/__tests__/codex-runner.test.ts`, change the prompt assertions:

```ts
expect(prompt).toContain('请使用本机 Codex 已安装的 skill：通用-代码变更审查')
expect(prompt).not.toContain('skills/通用-代码变更审查')
```

Keep the existing task value and `svn diff` assertions.

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `npm test -- src/main/__tests__/task-agent.test.ts src/main/__tests__/codex-runner.test.ts`

Expected: FAIL because `defaultPrepareWorkspace` still uses `app.getPath('userData')` and prompt still references `skills/...`.

- [ ] **Step 4: Update `defaultPrepareWorkspace`**

In `src/main/task-agent.ts`, remove `cp` from imports and import `getRuntimePaths`:

```ts
import { mkdir, readFile } from 'node:fs/promises'
import { getRuntimePaths } from './runtime-paths'
```

Replace `defaultPrepareWorkspace` with:

```ts
export const defaultPrepareWorkspace = async (taskId: string): Promise<PreparedWorkspace> => {
  const runtimePaths = await getRuntimePaths()
  const cwd = runtimePaths.workspaceForTask(taskId)

  await mkdir(cwd, { recursive: true })

  return {
    cwd,
    reportPath: runtimePaths.reportPathForTask(taskId)
  }
}
```

- [ ] **Step 5: Update `buildReviewPrompt`**

In `src/main/codex-runner.ts`, change the first prompt line to:

```ts
export const buildReviewPrompt = ({
  svnUrl,
  oldRevision,
  newRevision,
  reportPath
}: ReviewPromptInput): string => `请使用本机 Codex 已安装的 skill：通用-代码变更审查
```

Leave the rest of the prompt structure intact.

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `npm test -- src/main/__tests__/task-agent.test.ts src/main/__tests__/codex-runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit workspace and prompt changes**

```bash
git add src/main/task-agent.ts src/main/__tests__/task-agent.test.ts src/main/codex-runner.ts src/main/__tests__/codex-runner.test.ts
git commit -m "Use runtime workspaces and installed Codex Skill prompt"
```

### Task 5: Environment Checker Runtime Validation

**Files:**
- Modify: `src/main/environment-checker.ts`
- Modify: `src/main/__tests__/environment-checker.test.ts`

- [ ] **Step 1: Add tests for Skill manifest and runtime writability helpers**

Append to `src/main/__tests__/environment-checker.test.ts`:

```ts
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  checkRuntimeWritable,
  checkSkillPackageReady,
  buildVersionCommandOptions,
  classifyEnvironment
} from '../environment-checker'

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

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(true)
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

    await expect(checkSkillPackageReady(join(skillPackagesDir, 'manifest.json'))).resolves.toBe(false)
    await rm(runtimeRoot, { recursive: true, force: true })
  })
})
```

If this creates duplicate imports, merge them into the existing import block.

- [ ] **Step 2: Run environment tests and verify they fail**

Run: `npm test -- src/main/__tests__/environment-checker.test.ts`

Expected: FAIL because `checkRuntimeWritable` and `checkSkillPackageReady` are not exported.

- [ ] **Step 3: Implement helper exports and runtime-aware check**

In `src/main/environment-checker.ts`, add imports:

```ts
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getRuntimePaths } from './runtime-paths'
```

Replace the old `checkSkillExists` with:

```ts
export const checkRuntimeWritable = async (runtimeRoot: string): Promise<boolean> => {
  const probePath = join(runtimeRoot, `.write-check-${randomUUID()}`)

  try {
    await mkdir(runtimeRoot, { recursive: true })
    await writeFile(probePath, 'ok')
    await rm(probePath, { force: true })
    return true
  } catch {
    return false
  }
}

export const checkSkillPackageReady = async (manifestPath: string): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('package_path' in manifest) ||
      typeof manifest.package_path !== 'string'
    ) {
      return false
    }

    await access(manifest.package_path)
    return true
  } catch {
    return false
  }
}
```

Update `checkEnvironment`:

```ts
export const checkEnvironment = async (): Promise<EnvironmentCheckResult> => {
  try {
    const runtimePaths = await getRuntimePaths()
    const [codexResult, svnResult, runtimeWritable, skillOk] = await Promise.all([
      findVersionCommand('codex', ['--version']),
      findVersionCommand('svn', ['--version', '--quiet']),
      checkRuntimeWritable(runtimePaths.runtimeRoot),
      checkSkillPackageReady(runtimePaths.skillManifestPath)
    ])

    return {
      status: runtimeWritable
        ? classifyEnvironment({
            codexOk: codexResult.ok,
            svnOk: svnResult.ok,
            skillOk
          })
        : 'failed',
      codexVersion: codexResult.output,
      svnVersion: svnResult.output,
      codexPath: codexResult.path,
      svnPath: svnResult.path,
      ...(runtimeWritable ? {} : { skillError: `客户端运行目录不可写：${runtimePaths.runtimeRoot}` })
    }
  } catch (error) {
    return {
      status: 'failed',
      skillError: error instanceof Error ? error.message : String(error)
    }
  }
}
```

- [ ] **Step 4: Run environment tests**

Run: `npm test -- src/main/__tests__/environment-checker.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit environment checker changes**

```bash
git add src/main/environment-checker.ts src/main/__tests__/environment-checker.test.ts
git commit -m "Check runtime Skill package readiness"
```

### Task 6: IPC Type and Test Alignment

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: Update IPC test Skill sync result objects**

In `src/main/__tests__/ipc.test.ts`, replace test objects like:

```ts
{
  status: 'synced' as const,
  skillPath: '/tmp/code-review-user-data/skills/通用-代码变更审查/SKILL.md'
}
```

with:

```ts
{
  status: 'synced' as const,
  packagePath: '/tmp/code-review-runtime/skill-packages/skill.zip'
}
```

Apply the same update in both `environment:check` and `skill:install` tests.

- [ ] **Step 2: Run IPC tests and typecheck**

Run: `npm test -- src/main/__tests__/ipc.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS, or FAIL only on import ordering/unused values introduced in prior tasks. Fix those before continuing.

- [ ] **Step 3: Commit IPC alignment**

```bash
git add src/main/ipc.ts src/main/__tests__/ipc.test.ts
git commit -m "Align IPC Skill sync result with package cache"
```

### Task 7: Full Verification

**Files:**
- No source changes expected unless verification reveals a bug.

- [ ] **Step 1: Run all Electron tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run Electron build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: no uncommitted source changes except intentional generated files. If generated `out/` artifacts appear and are ignored by git, no action is needed.

- [ ] **Step 5: Final commit if verification required fixes**

If verification required code fixes, commit them:

```bash
git add src/main docs/superpowers/plans/2026-05-29-codex-skill-runtime.md
git commit -m "Verify Codex Skill runtime flow"
```

If no fixes were needed, only commit the plan document:

```bash
git add docs/superpowers/plans/2026-05-29-codex-skill-runtime.md
git commit -m "Add Codex Skill runtime implementation plan"
```

## Self-Review

- Spec coverage: runtime directory, zip-only Skill cache, Codex install handoff, workspace relocation, prompt update, optional `file_size`, and tests are all covered.
- Placeholder scan: the plan has no TBD/TODO placeholders. The Codex install command is intentionally isolated because the current CLI exposes no dedicated `skill install` command in `codex --help`; replacing that adapter later does not affect the rest of the flow.
- Type consistency: `SkillSyncResult` changes from `skillPath` to `packagePath`, `ActiveSkill.file_size` is optional, and `RuntimePaths` method names are consistent across tasks.
