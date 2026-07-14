import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'

export const SVN_PREFLIGHT_TIMEOUT_MS = 30_000
export const SVN_DIAGNOSTIC_MAX_BYTES = 64 * 1024

const truncatedDiagnosticMarker = Buffer.from('\n[诊断已截断]')
const ignoreLateChildError = (): void => {}

export interface SvnPreflightInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  svnCommand: string
  commandOptions: SpawnOptionsWithoutStdio
  signal?: AbortSignal
}

export type SvnPreflightErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_REVISION_ORDER'
  | 'NEW_REVISION_UNAVAILABLE'
  | 'OLD_REVISION_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_FAILED'
  | 'TIMEOUT'
  | 'CLI_START_FAILED'
  | 'CANCELLED'

export class SvnPreflightError extends Error {
  constructor(readonly code: SvnPreflightErrorCode) {
    super(errorMessages[code])
    this.name = 'SvnPreflightError'
  }
}

export type SvnSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export interface SvnPreflightDependencies {
  spawn?: SvnSpawn
  logger?: (diagnostic: string) => void
}

type RevisionTarget = 'new' | 'old'

interface ParsedRevision {
  normalized: string
  value: bigint
}

const revisionPattern = /^[rR]?\d+$/

const errorMessages: Record<SvnPreflightErrorCode, string> = {
  INVALID_ARGUMENT: 'SVN 地址、命令或版本格式无效。',
  INVALID_REVISION_ORDER: 'SVN 新旧版本范围无效。',
  NEW_REVISION_UNAVAILABLE: 'SVN 新版本不存在或不可访问。',
  OLD_REVISION_UNAVAILABLE: 'SVN 旧版本不存在或不可访问。',
  AUTHENTICATION_FAILED: 'SVN 认证失败。',
  PERMISSION_DENIED: '当前账号无权访问该 SVN 地址或版本。',
  NETWORK_FAILED: '连接 SVN 服务失败。',
  TIMEOUT: 'SVN 地址或版本校验超时。',
  CLI_START_FAILED: 'SVN 命令启动失败。',
  CANCELLED: 'SVN 地址或版本校验已取消。'
}

export const runSvnPreflight = async (
  input: SvnPreflightInput,
  dependencies: SvnPreflightDependencies = {}
): Promise<void> => {
  const svnUrl = input.svnUrl.trim()
  const svnCommand = input.svnCommand.trim()
  if (!svnUrl || !svnCommand) {
    throw new SvnPreflightError('INVALID_ARGUMENT')
  }

  const oldRevision = parseRevision(input.oldRevision)
  const newRevision = parseRevision(input.newRevision)
  if (
    newRevision.value === 0n ||
    (oldRevision.value !== 0n && oldRevision.value >= newRevision.value)
  ) {
    throw new SvnPreflightError('INVALID_REVISION_ORDER')
  }

  throwIfCancelled(input.signal)

  const runInput = {
    svnUrl,
    svnCommand,
    commandOptions: input.commandOptions,
    signal: input.signal,
    dependencies
  }
  await runSvnInfo({ ...runInput, revision: newRevision.normalized, target: 'new' })

  if (oldRevision.value !== 0n) {
    throwIfCancelled(input.signal)
    await runSvnInfo({ ...runInput, revision: oldRevision.normalized, target: 'old' })
  }
}

export const buildSvnInfoArgs = (svnUrl: string, revision: string): string[] => [
  'info',
  '--non-interactive',
  '-r',
  parseRevision(revision).normalized,
  svnUrl.trim()
]

export const sanitizeSvnDiagnostic = (diagnostic: string): string =>
  diagnostic
    .replace(
      /((?:["']?)\b[\w.-]*(?:username|password|token)[\w.-]*\b(?:["']?)\s*(?:=|:)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[已脱敏]'
    )
    .replace(
      /(\b(?:username|password|token)\b\s+)(?:"[^"]*"|'[^']*')/gi,
      '$1[已脱敏]'
    )
    .replace(
      /(--[\w.-]*(?:username|password|token)[\w.-]*\s+)(?![=:])(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[已脱敏]'
    )
    .replace(
      /(\b(?=[\w.-]*[_.-])[\w.-]*(?:username|password|token)[\w.-]*\b\s+)(?![=:])(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[已脱敏]'
    )
    .replace(/\b(?:https?|svn(?:\+ssh)?|file):\/\/[^\s"'<>]+/gi, '[已脱敏URL]')
    .replace(/(["'])\b[A-Za-z]:\\[^"'\r\n]*\1/g, '[已脱敏路径]')
    .replace(/(["'])\/[^"'\r\n]*\1/g, '[已脱敏路径]')
    .replace(/\\\\[^\s\\]+\\[^\s"'<>]+/g, '[已脱敏路径]')
    .replace(/\b[A-Za-z]:\\(?:[^\\\r\n]+\\)*[^\\\s\r\n]*/g, '[已脱敏路径]')
    .replace(/(^|[\s"'(=])\/(?:[^/\s"'<>]+\/)*[^/\s"'<>]*/gm, '$1[已脱敏路径]')
    .trim()

interface RunSvnInfoInput {
  svnUrl: string
  revision: string
  target: RevisionTarget
  svnCommand: string
  commandOptions: SpawnOptionsWithoutStdio
  signal?: AbortSignal
  dependencies: SvnPreflightDependencies
}

const runSvnInfo = ({
  svnUrl,
  revision,
  target,
  svnCommand,
  commandOptions,
  signal,
  dependencies
}: RunSvnInfoInput): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SvnPreflightError('CANCELLED'))
      return
    }

    let child: ChildProcessWithoutNullStreams
    try {
      const spawnCommand = dependencies.spawn ?? (spawn as SvnSpawn)
      child = spawnCommand(
        svnCommand,
        buildSvnInfoArgs(svnUrl, revision),
        { ...commandOptions, shell: false }
      )
    } catch (error) {
      logSanitizedDiagnostic(errorToDiagnostic(error), dependencies.logger)
      reject(new SvnPreflightError('CLI_START_FAILED'))
      return
    }

    const stderrBuffer = Buffer.allocUnsafe(SVN_DIAGNOSTIC_MAX_BYTES)
    let stderrBytes = 0
    let stderrTruncated = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const cleanup = (): void => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      signal?.removeEventListener('abort', onAbort)
      child.stderr.off('data', onStderrData)
      child.off('close', onChildClose)
      child.off('error', onChildError)
      if (child.listenerCount('error') === 0) {
        child.on('error', ignoreLateChildError)
      }
    }

    const settle = (error?: SvnPreflightError): boolean => {
      if (settled) {
        return false
      }

      settled = true
      cleanup()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
      return true
    }

    const settleAndKill = (code: 'TIMEOUT' | 'CANCELLED'): void => {
      if (!settle(new SvnPreflightError(code))) {
        return
      }

      try {
        child.kill()
      } catch {
        // 终止失败不应覆盖更具体的超时或取消结果。
      }
    }

    function onAbort(): void {
      settleAndKill('CANCELLED')
    }

    function onStderrData(chunk: Buffer | string): void {
      if (settled) {
        return
      }

      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = SVN_DIAGNOSTIC_MAX_BYTES - stderrBytes
      const bytesToCopy = Math.min(remaining, data.length)
      if (bytesToCopy > 0) {
        data.copy(stderrBuffer, stderrBytes, 0, bytesToCopy)
        stderrBytes += bytesToCopy
      }
      if (data.length > bytesToCopy) {
        stderrTruncated = true
      }
    }

    function onChildError(error: Error): void {
      if (settled) {
        return
      }

      if (settle(new SvnPreflightError('CLI_START_FAILED'))) {
        logSanitizedDiagnostic(errorToDiagnostic(error), dependencies.logger)
      }
    }

    function onChildClose(code: number | null): void {
      if (settled) {
        return
      }

      if (code === 0) {
        settle()
        return
      }

      const diagnostic = readStderrDiagnostic(stderrBuffer, stderrBytes, stderrTruncated)
      if (settle(new SvnPreflightError(classifySvnDiagnostic(diagnostic, target)))) {
        logSanitizedDiagnostic(diagnostic, dependencies.logger)
      }
    }

    child.stderr.on('data', onStderrData)
    child.on('error', onChildError)
    child.on('close', onChildClose)
    child.stdout.resume()

    timeout = setTimeout(() => settleAndKill('TIMEOUT'), SVN_PREFLIGHT_TIMEOUT_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
    }
  })

const readStderrDiagnostic = (
  buffer: Buffer,
  bytesWritten: number,
  truncated: boolean
): string => {
  if (!truncated) {
    return buffer.subarray(0, bytesWritten).toString('utf8')
  }

  const contentBytes = Math.max(0, SVN_DIAGNOSTIC_MAX_BYTES - truncatedDiagnosticMarker.length)
  return Buffer.concat([
    buffer.subarray(0, Math.min(bytesWritten, contentBytes)),
    truncatedDiagnosticMarker
  ]).toString('utf8')
}

const parseRevision = (revision: string): ParsedRevision => {
  const trimmed = revision.trim()
  if (!revisionPattern.test(trimmed)) {
    throw new SvnPreflightError('INVALID_ARGUMENT')
  }

  const normalized = trimmed.replace(/^[rR]/, '')
  return {
    normalized,
    value: BigInt(normalized)
  }
}

const classifySvnDiagnostic = (
  diagnostic: string,
  target: RevisionTarget
): SvnPreflightErrorCode => {
  if (
    /permission denied|forbidden|not authorized|authorization failed|http status 403|\b(?:E175013|E220004)\b/i.test(
      diagnostic
    )
  ) {
    return 'PERMISSION_DENIED'
  }

  if (/\b(?:E170001|E215004)\b|authentication failed|no more credentials/i.test(diagnostic)) {
    return 'AUTHENTICATION_FAILED'
  }

  if (
    /\b(?:E170013|E670002|E7300\d+)\b|unable to connect|could not resolve|name or service not known|connection (?:refused|reset|timed out)|network (?:is )?unreachable/i.test(
      diagnostic
    )
  ) {
    return 'NETWORK_FAILED'
  }

  return target === 'new' ? 'NEW_REVISION_UNAVAILABLE' : 'OLD_REVISION_UNAVAILABLE'
}

const throwIfCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new SvnPreflightError('CANCELLED')
  }
}

const logSanitizedDiagnostic = (
  diagnostic: string,
  logger: SvnPreflightDependencies['logger']
): void => {
  const sanitized = sanitizeSvnDiagnostic(diagnostic)
  if (!logger || !sanitized) {
    return
  }

  try {
    logger(sanitized)
  } catch {
    // 诊断日志失败不能改变预检结果。
  }
}

const errorToDiagnostic = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
