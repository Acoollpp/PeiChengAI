import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { delimiter, dirname, join, relative, sep } from 'node:path'

import { app } from 'electron'
import log from 'electron-log/main'

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

type IntegrityOperationStage = 'package_json' | 'readdir' | 'stat' | 'read_file'

export type CodeGraphRuntimeDiagnostic =
  | {
      event: 'access_retry' | 'access_failed'
      code: string
      stage: IntegrityOperationStage
      path: string
    }
  | {
      event: 'integrity_failed'
      code: string
      stage: IntegrityOperationStage
      path: string
    }
  | {
      event: 'integrity_mismatch'
      stage: 'tree_digest'
      expected: RuntimeTreeDigest
      actual: RuntimeTreeDigest
    }

interface CodeGraphRuntimeDiagnosticLogger {
  warn(diagnostic: CodeGraphRuntimeDiagnostic): void
}

interface RuntimeTreeDigest {
  fileCount: number
  unpackedBytes: number
  treeSha256: string
}

interface CreateBundledCodeGraphRuntimeOptions {
  platform?: NodeJS.Platform
  arch?: string
  runtimeRoot?: string | (() => string)
  metadata?: RuntimeMetadata
  adapter?: CodeGraphRuntimeAdapter
  delay?: (milliseconds: number) => Promise<void>
  diagnosticLogger?: CodeGraphRuntimeDiagnosticLogger
}

const DEFAULT_VERSION_TIMEOUT_MS = 10_000
const INTEGRITY_RETRY_DELAY_MS = 100
const RETRYABLE_ACCESS_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

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

const productionDiagnosticLogger: CodeGraphRuntimeDiagnosticLogger = {
  warn(diagnostic) {
    log.warn('[CodeGraph 运行时校验]', diagnostic)
  }
}

const defaultDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const defaultRuntimeRoot = (): string => {
  if (app.isPackaged) {
    return join(process.resourcesPath, ...metadata.runtimeDirectory.split('/'))
  }
  return join(app.getAppPath(), 'build', 'codegraph-runtime', 'win32-x64')
}

const pathFromMetadata = (root: string, relativePath: string): string =>
  join(root, ...relativePath.split('/'))

const getErrorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'

class RuntimeAccessError extends Error {
  readonly code: string
  readonly stage: IntegrityOperationStage
  readonly path: string

  constructor(error: unknown, stage: IntegrityOperationStage, path: string) {
    super('CodeGraph 运行时资源访问失败', { cause: error })
    this.name = 'RuntimeAccessError'
    this.code = getErrorCode(error)
    this.stage = stage
    this.path = path
  }
}

class RuntimeIntegrityError extends Error {
  readonly code: string
  readonly stage: IntegrityOperationStage
  readonly path: string

  constructor(code: string, stage: IntegrityOperationStage, path: string) {
    super('CodeGraph 运行时资源结构异常')
    this.name = 'RuntimeIntegrityError'
    this.code = code
    this.stage = stage
    this.path = path
  }
}

const unavailableMessage = (status: Exclude<CodeGraphRuntimeStatus, 'ready'>): string => {
  switch (status) {
    case 'missing':
      return '内置 CodeGraph 1.4.1 缺失，请重新安装客户端。'
    case 'unreadable':
      return '内置 CodeGraph 1.4.1 暂时无法完成校验，请重新检查；如持续失败，请联系管理员检查安全软件。'
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
  const delay = options.delay ?? defaultDelay
  const diagnosticLogger = options.diagnosticLogger ?? productionDiagnosticLogger
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

  const diagnosticPath = (root: string, path: string): string =>
    relative(root, path).split(sep).join('/') || '.'

  const runFileOperation = async <T>(
    root: string,
    stage: IntegrityOperationStage,
    path: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      const code = getErrorCode(error)
      const pathForLog = diagnosticPath(root, path)
      if (!RETRYABLE_ACCESS_ERROR_CODES.has(code)) {
        throw new RuntimeAccessError(error, stage, pathForLog)
      }

      diagnosticLogger.warn({ event: 'access_retry', code, stage, path: pathForLog })
      await delay(INTEGRITY_RETRY_DELAY_MS)
      try {
        return await operation()
      } catch (retryError) {
        throw new RuntimeAccessError(retryError, stage, pathForLog)
      }
    }
  }

  const inspectionForError = (
    error: unknown,
    root: string,
    version?: string
  ): CodeGraphRuntimeInspection => {
    if (error instanceof RuntimeIntegrityError) {
      diagnosticLogger.warn({
        event: 'integrity_failed',
        code: error.code,
        stage: error.stage,
        path: error.path
      })
      return makeInspection('corrupt', root, { version })
    }
    const accessError =
      error instanceof RuntimeAccessError
        ? error
        : new RuntimeAccessError(error, 'read_file', '.')
    diagnosticLogger.warn({
      event: 'access_failed',
      code: accessError.code,
      stage: accessError.stage,
      path: accessError.path
    })
    return makeInspection(accessError.code === 'ENOENT' ? 'missing' : 'unreadable', root, {
      version
    })
  }

  const reportIntegrityMismatch = (actual: RuntimeTreeDigest): void => {
    diagnosticLogger.warn({
      event: 'integrity_mismatch',
      stage: 'tree_digest',
      expected: {
        fileCount: runtimeMetadata.runtime.fileCount,
        unpackedBytes: runtimeMetadata.runtime.unpackedBytes,
        treeSha256: runtimeMetadata.runtime.treeSha256
      },
      actual
    })
  }

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
      const entries = await runFileOperation(root, 'readdir', directory, () =>
        adapter.readdir(directory)
      )
      for (const entry of entries) {
        const entryPath = join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else if (entry.isFile()) {
          files.push({
            filePath: entryPath,
            relativePath: relative(root, entryPath).split(sep).join('/')
          })
        } else {
          throw new RuntimeIntegrityError(
            'UNSUPPORTED_FILE_TYPE',
            'readdir',
            diagnosticPath(root, entryPath)
          )
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
      const fileStat = await runFileOperation(root, 'stat', file.filePath, () =>
        adapter.stat(file.filePath)
      )
      if (!fileStat.isFile()) {
        throw new RuntimeIntegrityError('NOT_REGULAR_FILE', 'stat', file.relativePath)
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
        const content = await runFileOperation(root, 'read_file', file.filePath, () =>
          adapter.readFile(file.filePath)
        )
        if (content.length !== fileStat.size) {
          throw new RuntimeIntegrityError('FILE_CHANGED_DURING_SCAN', 'read_file', file.relativePath)
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

    const packageJsonPath = pathFromMetadata(root, runtimeMetadata.runtime.packageJson)
    let packageJsonContent: Buffer
    try {
      packageJsonContent = await runFileOperation(root, 'package_json', packageJsonPath, () =>
        adapter.readFile(packageJsonPath)
      )
    } catch (error) {
      return inspectionForError(error, root)
    }
    let packageJson: { version?: unknown }
    try {
      packageJson = JSON.parse(packageJsonContent.toString('utf8')) as { version?: unknown }
    } catch {
      return inspectionForError(
        new RuntimeIntegrityError(
          'INVALID_PACKAGE_JSON',
          'package_json',
          runtimeMetadata.runtime.packageJson
        ),
        root
      )
    }
    const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : ''
    if (packageVersion !== runtimeMetadata.version) {
      return makeInspection('version_mismatch', root, { version: packageVersion || undefined })
    }

    let runtimeTree: Awaited<ReturnType<typeof inspectRuntimeTree>>
    try {
      runtimeTree = await inspectRuntimeTree(root)
    } catch (error) {
      return inspectionForError(error, root, packageVersion)
    }
    if (runtimeTree.fileCount < runtimeMetadata.runtime.fileCount) {
      reportIntegrityMismatch(runtimeTree)
      return makeInspection('missing', root, { version: packageVersion })
    }
    if (
      runtimeTree.fileCount !== runtimeMetadata.runtime.fileCount ||
      runtimeTree.unpackedBytes !== runtimeMetadata.runtime.unpackedBytes ||
      runtimeTree.treeSha256 !== runtimeMetadata.runtime.treeSha256
    ) {
      reportIntegrityMismatch(runtimeTree)
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
