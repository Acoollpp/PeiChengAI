import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'

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
  }
}

interface VersionCommandResult {
  ok: boolean
  output?: string
  failureReason?: 'timeout' | 'spawn_error' | 'exit_code'
  exitCode?: number
}

interface FileStat {
  isFile(): boolean
}

interface CodeGraphRuntimeAdapter {
  stat(path: string): Promise<FileStat>
  runVersionCommand(nodePath: string, entrypointPath: string): Promise<VersionCommandResult>
}

export type CodeGraphRuntimeDiagnostic =
  | {
      event: 'command_entry_failed'
      stage: 'command_entry'
      code: string
      path: string
    }
  | {
      event: 'version_command_failed'
      stage: 'version_command'
      reason: 'timeout' | 'spawn_error' | 'exit_code' | 'unknown'
      exitCode?: number
    }

interface CodeGraphRuntimeDiagnosticLogger {
  warn(diagnostic: CodeGraphRuntimeDiagnostic): void
}

interface CreateBundledCodeGraphRuntimeOptions {
  platform?: NodeJS.Platform
  arch?: string
  runtimeRoot?: string | (() => string)
  metadata?: RuntimeMetadata
  adapter?: CodeGraphRuntimeAdapter
  diagnosticLogger?: CodeGraphRuntimeDiagnosticLogger
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
      settle({ ok: false, failureReason: 'timeout' })
    }, DEFAULT_VERSION_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.on('error', () => settle({ ok: false, failureReason: 'spawn_error' }))
    child.on('close', (code) => {
      settle({
        ok: code === 0,
        output: code === 0 ? Buffer.concat(stdout).toString('utf8').trim() : undefined,
        ...(code === 0
          ? {}
          : { failureReason: 'exit_code' as const, exitCode: code ?? undefined })
      })
    })
  })

const productionAdapter: CodeGraphRuntimeAdapter = {
  stat,
  runVersionCommand
}

const productionDiagnosticLogger: CodeGraphRuntimeDiagnosticLogger = {
  warn(diagnostic) {
    log.warn('[CodeGraph 功能检查]', diagnostic)
  }
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

const getErrorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'

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
  const diagnosticLogger = options.diagnosticLogger ?? productionDiagnosticLogger
  let resolveRuntimeRoot: () => string
  if (typeof options.runtimeRoot === 'function') {
    resolveRuntimeRoot = options.runtimeRoot
  } else {
    const configuredRuntimeRoot = options.runtimeRoot
    resolveRuntimeRoot = () => configuredRuntimeRoot ?? defaultRuntimeRoot()
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

  const inspect = async (): Promise<CodeGraphRuntimeInspection> => {
    const root = resolveRuntimeRoot()
    if (platform !== 'win32' || arch !== 'x64') {
      return makeInspection('unsupported', root)
    }

    const commandPath = pathFromMetadata(root, runtimeMetadata.runtime.command)
    try {
      const commandStat = await adapter.stat(commandPath)
      if (!commandStat.isFile()) {
        diagnosticLogger.warn({
          event: 'command_entry_failed',
          stage: 'command_entry',
          code: 'NOT_FILE',
          path: runtimeMetadata.runtime.command
        })
        return makeInspection('not_executable', root)
      }
    } catch (error) {
      diagnosticLogger.warn({
        event: 'command_entry_failed',
        stage: 'command_entry',
        code: getErrorCode(error),
        path: runtimeMetadata.runtime.command
      })
      return makeInspection(isMissingFileError(error) ? 'missing' : 'not_executable', root)
    }

    let versionResult: VersionCommandResult
    try {
      versionResult = await adapter.runVersionCommand(
        pathFromMetadata(root, runtimeMetadata.runtime.node),
        pathFromMetadata(root, runtimeMetadata.runtime.entrypoint)
      )
    } catch {
      diagnosticLogger.warn({
        event: 'version_command_failed',
        stage: 'version_command',
        reason: 'spawn_error'
      })
      return makeInspection('not_executable', root)
    }
    if (!versionResult.ok) {
      diagnosticLogger.warn({
        event: 'version_command_failed',
        stage: 'version_command',
        reason: versionResult.failureReason ?? 'unknown',
        ...(versionResult.exitCode === undefined ? {} : { exitCode: versionResult.exitCode })
      })
      return makeInspection('not_executable', root)
    }
    if (versionResult.output !== runtimeMetadata.version) {
      return makeInspection('version_mismatch', root, {
        version: versionResult.output || undefined
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
