import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { buildVersionCommandOptions } from './environment-checker'

export interface ReviewPromptInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  reportPath: string
  imagesDir: string
  skillName: string
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
  reportPath,
  imagesDir,
  skillName
}: ReviewPromptInput): string => `请强制使用本机 Codex 已安装的 Skill：${skillName}

审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${oldRevision}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}
- 图片保存目录：${imagesDir}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
最终生成 Markdown 审查报告到报告输出路径：${reportPath}
如需生成或保存审查相关图片，必须保存到图片保存目录：${imagesDir}
Markdown 报告中引用图片时必须使用相对路径：images/<文件名>

---

错误处理规范（必须严格遵守）：

核心原则：Skill 内部已定义了错误恢复策略（如 SVN 远端 diff 失败后切换为双版本导出本地比对）。
遇到错误时，必须先按 Skill 定义的恢复策略逐一尝试，只有所有恢复策略都失败后，才输出错误码终止。

错误输出格式（仅在穷尽所有恢复策略后使用）：
[CODEX_ERROR::<错误码>] <具体错误描述，包括已尝试过的恢复策略和每一步的失败原因>

已定义的错误码：
- SVN_ERROR：SVN 操作失败，且 Skill 定义的兜底策略（如远端 diff 失败后双版本导出本地比对）也全部失败
- SKILL_ERROR：Skill 文件缺失、无法读取或格式错误
- PARAM_ERROR：输入参数无效（路径为空、版本号格式错误等）
- REPORT_ERROR：审查报告文件写入失败（磁盘空间不足、权限不足等）
- INTERNAL_ERROR：其他未预期的错误。使用此错误码时，必须附带你对错误原因的详细分析，包括可能的原因和建议的解决方案

规则：
1. 遇到操作失败时，优先按 Skill 中定义的恢复策略尝试恢复，不要立即放弃
2. 例如 SVN 远端 diff 失败时，必须切换为双版本导出本地比对（参见 SVN 获取策略中的"远端 diff 异常兜底"）
3. 只有所有恢复策略都穷尽后，才输出 [CODEX_ERROR::...] 标记并终止
4. [CODEX_ERROR::...] 标记只能出现一次，放在错误描述的最前面
5. 错误描述应包含已尝试的恢复策略、每步失败的具体原因，帮助用户定位问题
6. 对于不在上述列表中的错误，一律使用 INTERNAL_ERROR 并附上你的分析`

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
