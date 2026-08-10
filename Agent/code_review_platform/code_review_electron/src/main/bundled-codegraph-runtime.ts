import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { delimiter, dirname, join, relative, sep } from 'node:path'

import { app } from 'electron'

import metadata from '../../resources/codegraph/metadata.json'
import type { CodeGraphRuntimeStatus } from '../shared/types'

export type { CodeGraphRuntimeStatus } from '../shared/types'

export interface CodeGraphRuntimeInspection {
  status: CodeGraphRuntimeStatus
  requiredVersion: string
  version?: string
  commandPath: string
  commandDirectory: string
  error?: string
}

export interface BundledCodeGraphRuntime {
  inspect(): Promise<CodeGraphRuntimeInspection>
  buildCodexEnvironment(baseEnvironment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>
}

interface RuntimeMetadata {
  version: string
  runtimeDirectory: string
  runtime: {
    command: string
    node: string
    entrypoint: string
    packageJson: string
    requiredFiles: Array<{ path: string; sha256: string }>
    fileCount: number
    unpackedBytes: number
    treeSha256: string
  }
}

interface VersionCommandResult {
  ok: boolean
  output?: string
}

interface FileStat {
  isFile(): boolean
  size: number
  mtimeMs: number
  ctimeMs: number
}

interface DirectoryEntry {
  name: string
  isDirectory(): boolean
  isFile(): boolean
}

interface CodeGraphRuntimeAdapter {
  readFile(path: string): Promise<Buffer>
  readdir(path: string): Promise<DirectoryEntry[]>
  stat(path: string): Promise<FileStat>
  runVersionCommand(nodePath: string, entrypointPath: string): Promise<VersionCommandResult>
}

interface CreateBundledCodeGraphRuntimeOptions {
  platform?: NodeJS.Platform
  arch?: string
  runtimeRoot?: string | (() => string)
  metadata?: RuntimeMetadata
  adapter?: CodeGraphRuntimeAdapter
}

const DEFAULT_VERSION_TIMEOUT_MS = 10_000

const runVersionCommand = (
  nodePath: string,
  entrypointPath: string
): Promise<VersionCommandResult> =>
  new Promise((resolve) => {
    const child = spawn(nodePath, ['--liftoff-only', entrypointPath, '--version'], {
      shell: false,
      windowsHide: true,
      env: process.env
    })
    const stdout: Buffer[] = []
    let settled = false

    const settle = (result: VersionCommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill()
      settle({ ok: false })
    }, DEFAULT_VERSION_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.on('error', () => settle({ ok: false }))
    child.on('close', (code) => {
      settle({
        ok: code === 0,
        output: code === 0 ? Buffer.concat(stdout).toString('utf8').trim() : undefined
      })
    })
  })

const productionAdapter: CodeGraphRuntimeAdapter = {
  readFile,
  readdir: (path) => readdir(path, { withFileTypes: true }),
  stat,
  runVersionCommand
}

const defaultRuntimeRoot = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...metadata.runtimeDirectory.split('/'))
  }
  return join(app.getAppPath(), 'build', 'codegraph-runtime', 'win32-x64')
}

const pathFromMetadata = (root: string, relativePath: string): string =>
  join(root, ...relativePath.split('/'))

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const unavailableMessage = (status: Exclude<CodeGraphRuntimeStatus, 'ready'>): string => {
  switch (status) {
    case 'missing':
      return '内置 CodeGraph 1.4.1 缺失，请重新安装客户端。'
    case 'corrupt':
      return '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
    case 'version_mismatch':
      return '内置 CodeGraph 版本不符，应为 1.4.1，请重新安装客户端。'
    case 'not_executable':
      return '内置 CodeGraph 1.4.1 无法执行，请重新安装客户端或联系管理员检查安全软件。'
    case 'unsupported':
      return '内置 CodeGraph 1.4.1 仅支持 Windows x64 客户端。'
  }
}

export class BundledCodeGraphUnavailableError extends Error {
  readonly inspection: CodeGraphRuntimeInspection

  constructor(inspection: CodeGraphRuntimeInspection) {
    super(inspection.error ?? '内置 CodeGraph 不可用')
    this.name = 'BundledCodeGraphUnavailableError'
    this.inspection = inspection
  }
}

export const createBundledCodeGraphRuntime = (
  options: CreateBundledCodeGraphRuntimeOptions = {}
): BundledCodeGraphRuntime => {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const runtimeMetadata = options.metadata ?? metadata
  const adapter = options.adapter ?? productionAdapter
  let resolveRuntimeRoot: () => string
  if (typeof options.runtimeRoot === 'function') {
    resolveRuntimeRoot = options.runtimeRoot
  } else {
    const configuredRuntimeRoot = options.runtimeRoot
    resolveRuntimeRoot = () => configuredRuntimeRoot ?? defaultRuntimeRoot()
  }
  const integrityCache = new Map<
    string,
    { size: number; mtimeMs: number; ctimeMs: number; sha256: string }
  >()

  const makeInspection = (
    status: CodeGraphRuntimeStatus,
    root: string,
    overrides: Partial<CodeGraphRuntimeInspection> = {}
  ): CodeGraphRuntimeInspection => {
    const commandPath = pathFromMetadata(root, runtimeMetadata.runtime.command)
    return {
      status,
      requiredVersion: runtimeMetadata.version,
      commandPath,
      commandDirectory: dirname(commandPath),
      ...(status === 'ready' ? {} : { error: unavailableMessage(status) }),
      ...overrides
    }
  }

  const inspectRuntimeTree = async (root: string) => {
    const files: Array<{ filePath: string; relativePath: string }> = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await adapter.readdir(directory)) {
        const entryPath = join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else if (entry.isFile()) {
          files.push({
            filePath: entryPath,
            relativePath: relative(root, entryPath).split(sep).join('/')
          })
        } else {
          throw new Error(`CodeGraph 运行时包含不支持的文件类型：${entryPath}`)
        }
      }
    }
    await walk(root)
    files.sort((left, right) =>
      left.relativePath < right.relativePath
        ? -1
        : left.relativePath > right.relativePath
          ? 1
          : 0
    )

    const treeHash = createHash('sha256')
    const observedPaths = new Set<string>()
    let unpackedBytes = 0
    for (const file of files) {
      observedPaths.add(file.filePath)
      const fileStat = await adapter.stat(file.filePath)
      if (!fileStat.isFile()) {
        throw new Error(`CodeGraph 运行时条目不是普通文件：${file.relativePath}`)
      }
      const cached = integrityCache.get(file.filePath)
      let fileHash: string
      if (
        cached &&
        cached.size === fileStat.size &&
        cached.mtimeMs === fileStat.mtimeMs &&
        cached.ctimeMs === fileStat.ctimeMs
      ) {
        fileHash = cached.sha256
      } else {
        const content = await adapter.readFile(file.filePath)
        if (content.length !== fileStat.size) {
          throw new Error(`CodeGraph 运行时文件在校验期间发生变化：${file.relativePath}`)
        }
        fileHash = createHash('sha256').update(content).digest('hex')
        integrityCache.set(file.filePath, {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          ctimeMs: fileStat.ctimeMs,
          sha256: fileHash
        })
      }
      unpackedBytes += fileStat.size
      treeHash.update(`${file.relativePath}\0${fileStat.size}\0${fileHash}\n`)
    }
    for (const cachedPath of integrityCache.keys()) {
      if (!observedPaths.has(cachedPath)) {
        integrityCache.delete(cachedPath)
      }
    }

    return {
      fileCount: files.length,
      unpackedBytes,
      treeSha256: treeHash.digest('hex')
    }
  }

  const inspect = async (): Promise<CodeGraphRuntimeInspection> => {
    const root = resolveRuntimeRoot()
    if (platform !== 'win32' || arch !== 'x64') {
      return makeInspection('unsupported', root)
    }

    let packageVersion: string
    try {
      const packageJson = JSON.parse(
        (await adapter.readFile(pathFromMetadata(root, runtimeMetadata.runtime.packageJson))).toString(
          'utf8'
        )
      ) as { version?: unknown }
      packageVersion = typeof packageJson.version === 'string' ? packageJson.version : ''
    } catch (error) {
      return makeInspection(isMissingFileError(error) ? 'missing' : 'corrupt', root)
    }
    if (packageVersion !== runtimeMetadata.version) {
      return makeInspection('version_mismatch', root, { version: packageVersion || undefined })
    }

    let runtimeTree: Awaited<ReturnType<typeof inspectRuntimeTree>>
    try {
      runtimeTree = await inspectRuntimeTree(root)
    } catch (error) {
      return makeInspection(isMissingFileError(error) ? 'missing' : 'corrupt', root, {
        version: packageVersion
      })
    }
    if (runtimeTree.fileCount < runtimeMetadata.runtime.fileCount) {
      return makeInspection('missing', root, { version: packageVersion })
    }
    if (
      runtimeTree.fileCount !== runtimeMetadata.runtime.fileCount ||
      runtimeTree.unpackedBytes !== runtimeMetadata.runtime.unpackedBytes ||
      runtimeTree.treeSha256 !== runtimeMetadata.runtime.treeSha256
    ) {
      return makeInspection('corrupt', root, { version: packageVersion })
    }

    const versionResult = await adapter.runVersionCommand(
      pathFromMetadata(root, runtimeMetadata.runtime.node),
      pathFromMetadata(root, runtimeMetadata.runtime.entrypoint)
    )
    if (!versionResult.ok) {
      return makeInspection('not_executable', root, { version: packageVersion })
    }
    if (versionResult.output !== runtimeMetadata.version) {
      return makeInspection('version_mismatch', root, {
        version: versionResult.output || packageVersion
      })
    }

    return makeInspection('ready', root, { version: versionResult.output })
  }

  return {
    inspect,
    async buildCodexEnvironment(baseEnvironment) {
      const inspection = await inspect()
      if (inspection.status !== 'ready') {
        throw new BundledCodeGraphUnavailableError(inspection)
      }

      const currentPath = baseEnvironment.PATH ?? baseEnvironment.Path ?? ''
      const environment: NodeJS.ProcessEnv = {
        ...baseEnvironment,
        PATH: [inspection.commandDirectory, currentPath].filter(Boolean).join(
          platform === 'win32' ? ';' : delimiter
        )
      }
      delete environment.Path
      return environment
    }
  }
}

export const bundledCodeGraphRuntime = createBundledCodeGraphRuntime()
