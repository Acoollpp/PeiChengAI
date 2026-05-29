import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { buildVersionCommandOptions } from './environment-checker'

export interface ReviewPromptInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  reportPath: string
}

export interface RunCodexReviewOptions {
  cwd: string
  prompt: string
  timeoutMs: number
  onOutput?: (event: CodexOutputEvent) => void
}

export interface CodexReviewResult {
  stdout: string
  stderr: string
}

export const CodexErrorCodes = {
  SVN_ERROR: 'SVN_ERROR',
  SKILL_ERROR: 'SKILL_ERROR',
  PARAM_ERROR: 'PARAM_ERROR',
  REPORT_ERROR: 'REPORT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type CodexErrorCode = (typeof CodexErrorCodes)[keyof typeof CodexErrorCodes]

const CODEX_ERROR_PATTERN = /\[CODEX_ERROR::(\w+)\]\s*([\s\S]*)/

export class CodexReviewError extends Error {
  readonly errorCode: CodexErrorCode

  constructor(errorCode: CodexErrorCode, message: string) {
    super(message)
    this.name = 'CodexReviewError'
    this.errorCode = errorCode
  }
}

export const parseCodexError = (stderr: string): CodexReviewError | null => {
  const match = stderr.match(CODEX_ERROR_PATTERN)
  if (!match) return null
  const [, code, description] = match
  if (!isCodexErrorCode(code)) return null
  return new CodexReviewError(code, description.trim())
}

const isCodexErrorCode = (value: string): value is CodexErrorCode =>
  (Object.values(CodexErrorCodes) as string[]).includes(value)

export interface CodexOutputEvent {
  stream: 'stdout' | 'stderr'
  text: string
}

export const buildWindowsCodexBinaryPath = (): string =>
  join(
    process.env.APPDATA ?? '',
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe'
  )

export const buildCodexCommand = (platform: NodeJS.Platform = process.platform): string => {
  if (platform !== 'win32') {
    return 'codex'
  }

  const bundledBinary = buildWindowsCodexBinaryPath()
  return existsSync(bundledBinary) ? bundledBinary : 'codex'
}

export const buildCodexExecArgs = (prompt: string): string[] => [
  'exec',
  '--dangerously-bypass-approvals-and-sandbox',
  prompt
]

export const buildReviewPrompt = ({
  svnUrl,
  oldRevision,
  newRevision,
  reportPath
}: ReviewPromptInput): string => `请使用当前工作区中的 skill：skills/通用-代码变更审查

审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${oldRevision}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
最终生成 Markdown 审查报告到报告输出路径：${reportPath}

---

错误处理规范（必须严格遵守）：

在执行任何步骤前，先进行前置检查。如果遇到以下错误，立即终止并输出以下格式的错误信息到标准错误输出（stderr）：
[CODEX_ERROR::<错误码>] <具体错误描述>

已定义的错误码：
- SVN_ERROR：SVN 操作失败（无法获取差异、导出文件、连接 SVN 服务器等）
- SKILL_ERROR：Skill 文件缺失、无法读取或格式错误
- PARAM_ERROR：输入参数无效（路径为空、版本号格式错误等）
- REPORT_ERROR：审查报告文件写入失败（磁盘空间不足、权限不足等）
- INTERNAL_ERROR：其他未预期的错误。使用此错误码时，必须附带你对错误原因的详细分析，包括可能的原因和建议的解决方案

规则：
1. 遇到以上错误时，不要尝试重试或继续执行，立即终止
2. [CODEX_ERROR::...] 标记只能出现一次，放在错误描述的最前面
3. 错误描述应包含足够的信息帮助用户定位问题
4. 对于不在上述列表中的错误，一律使用 INTERNAL_ERROR 并附上你的分析`

export const runCodexReview = ({
  cwd,
  prompt,
  timeoutMs,
  onOutput
}: RunCodexReviewOptions): Promise<CodexReviewResult> =>
  new Promise((resolve, reject) => {
    const commandOptions = buildVersionCommandOptions()
    const child = spawn(buildCodexCommand(), buildCodexExecArgs(prompt), {
      ...commandOptions,
      cwd,
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
        reject(new Error(`Codex review timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
      onOutput?.({ stream: 'stdout', text: chunk.toString('utf8') })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
      onOutput?.({ stream: 'stderr', text: chunk.toString('utf8') })
    })

    child.stdin.end()

    child.on('error', (error) => {
      settle(() => {
        reject(error)
      })
    })

    child.on('close', (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (code !== 0) {
          const codexError = parseCodexError(stderr)
          if (codexError) {
            reject(codexError)
            return
          }
          reject(new Error(`Codex review failed with exit code ${code}: ${stderr}`))
          return
        }

        resolve({ stdout, stderr })
      })
    })
  })
