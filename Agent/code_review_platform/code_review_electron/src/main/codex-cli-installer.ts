import { spawn } from 'node:child_process'

import {
  buildVersionCommandOptions,
  checkEnvironment,
  findVersionCommand,
  type CommandResult,
  type EnvironmentCheckResult
} from './environment-checker'

export interface InstallCommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export interface InstallCodexCliDependencies {
  findVersionCommand?: (command: string, args: string[]) => Promise<CommandResult>
  runInstallCommand?: (command: string, args: string[]) => Promise<InstallCommandResult>
  checkEnvironment?: typeof checkEnvironment
}

export const MissingNpmMessage = '未检测到 npm，请先安装 Node.js 后重试或联系管理员。'
export const CodexNotDetectedAfterInstallMessage =
  'Codex CLI 已安装但当前客户端暂未检测到，请重启客户端或检查 npm 全局路径。'

export const installCodexCli = async (
  dependencies: InstallCodexCliDependencies = {}
): Promise<EnvironmentCheckResult> => {
  const findCommand = dependencies.findVersionCommand ?? findVersionCommand
  const runInstall = dependencies.runInstallCommand ?? runInstallCommand
  const refreshEnvironment = dependencies.checkEnvironment ?? checkEnvironment

  const npmResult = await findCommand('npm', ['--version'])
  if (!npmResult.ok) {
    return {
      status: 'missing_codex',
      codexError: MissingNpmMessage
    }
  }

  const installResult = await runInstall(npmResult.path ?? 'npm', [
    'install',
    '-g',
    '@openai/codex'
  ])

  if (!installResult.ok) {
    return {
      status: 'missing_codex',
      codexError: `通过 npm 安装 Codex CLI 失败：${summarizeInstallError(installResult)}`
    }
  }

  const codexResult = await findCommand('codex', ['--version'])
  if (!codexResult.ok) {
    return {
      status: 'missing_codex',
      codexError: CodexNotDetectedAfterInstallMessage
    }
  }

  return refreshEnvironment()
}

export const summarizeInstallError = ({ stdout, stderr }: InstallCommandResult): string => {
  const output = `${stderr}\n${stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(isActionableInstallErrorLine)
    .map(redactSensitiveInstallOutput)
    .slice(-8)
    .join('\n')

  return output || 'npm 未返回错误详情'
}

const actionableInstallErrorPatterns = [
  /\bnpm ERR!/i,
  /\bcode\s+[A-Z][A-Z0-9_-]+\b/i,
  /\bEACCES\b/i,
  /\bEPERM\b/i,
  /\bENOENT\b/i,
  /\bpermission\b/i,
  /\bdenied\b/i,
  /\bnetwork\b/i,
  /\bregistry\b/i,
  /\bcertificate\b/i,
  /\bcert\b/i,
  /\bproxy\b/i,
  /\btimeout\b/i,
  /\bfetch\b/i,
  /\bconnect\b/i,
  /\bECONNRESET\b/i,
  /\bENOTFOUND\b/i,
  /\bSELF_SIGNED_CERT\b/i,
  /\bUNABLE_TO_VERIFY_LEAF_SIGNATURE\b/i,
  /\b401\b/,
  /\b403\b/,
  /\b404\b/
]

const isActionableInstallErrorLine = (line: string): boolean =>
  line.length > 0 && actionableInstallErrorPatterns.some((pattern) => pattern.test(line))

const sensitiveInstallParameterPattern =
  /([?&#:;]?(?:_authToken|authToken|access_token|refresh_token|id_token|token|password|passwd|pwd|secret|api_key|apikey|key)=)[^&#\s'")]+/gi

const redactSensitiveInstallOutput = (line: string): string =>
  line
    .replace(sensitiveInstallParameterPattern, '$1***')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1***@')
    .replace(/(^|[\s'"(:=])((?:\/(?!\/)[^\s'")]+)+)/g, '$1[路径]')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+(?:\\\S*)?/g, '[路径]')

export const runInstallCommand = (
  command: string,
  args: string[]
): Promise<InstallCommandResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, buildVersionCommandOptions())
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const settle = (result: InstallCommandResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      settle({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: [stderr, error.message].filter(Boolean).join('\n')
      })
    })
    child.on('close', (code) => {
      settle({
        ok: code === 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      })
    })
  })
