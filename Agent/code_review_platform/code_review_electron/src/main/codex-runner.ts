import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 as windowsPath } from 'node:path'

import { buildVersionCommandOptions } from './environment-checker'
import { bundledCodeGraphRuntime } from './bundled-codegraph-runtime'
import {
  REVIEW_REPORT_IMAGES_DIR_NAME,
  isFullReviewOldRevision,
  normalizeRevisionForReportName
} from '../shared/report-artifacts'

export interface ReviewPromptInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  reportPath: string
  imagesDir: string
  skillName: string
  requirementFilePath?: string
  departmentName?: string
  focusDirectionSnapshot?: string
}

export interface RunCodexReviewOptions {
  cwd: string
  prompt: string
  timeoutMs: number
  signal?: AbortSignal
  onOutput?: (event: CodexOutputEvent) => void
}

export interface RunCodexReviewDependencies {
  buildCodeGraphEnvironment?: (environment: NodeJS.ProcessEnv) => Promise<NodeJS.ProcessEnv>
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

const codexVendorBinaryParts = [
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
]

export const buildWindowsCodexBinaryPath = (env: NodeJS.ProcessEnv = process.env): string =>
  windowsPath.join(
    env.APPDATA ?? '',
    'npm',
    ...codexVendorBinaryParts
  )

const resolveCodexCommandFromPath = (env: NodeJS.ProcessEnv): string | null => {
  const pathValue = env.PATH ?? env.Path ?? ''
  for (const entry of pathValue.split(';').filter(Boolean)) {
    const codexCmd = windowsPath.join(entry, 'codex.cmd')
    const codexExe = windowsPath.join(entry, ...codexVendorBinaryParts)
    if (existsSync(codexCmd) && existsSync(codexExe)) {
      return codexExe
    }
    if (existsSync(codexCmd)) {
      return codexCmd
    }
  }

  return null
}

export const buildCodexCommand = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string => {
  if (platform !== 'win32') {
    return 'codex'
  }

  const bundledBinary = buildWindowsCodexBinaryPath(env)
  if (existsSync(bundledBinary)) {
    return bundledBinary
  }

  return resolveCodexCommandFromPath(env) ?? 'codex'
}

export const buildCodexExecArgs = (prompt: string): string[] => [
  'exec',
  '--skip-git-repo-check',
  '--model',
  'gpt-5.5',
  '-c',
  'model_reasoning_effort=medium',
  '--enable',
  'multi_agent',
  '--dangerously-bypass-approvals-and-sandbox',
  prompt
]

export const buildCodexShellOption = (
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean => platform === 'win32' && !command.toLowerCase().endsWith('.exe')

const buildSupplementalReviewInput = ({
  requirementFilePath,
  departmentName,
  focusDirectionSnapshot
}: Pick<
  ReviewPromptInput,
  'requirementFilePath' | 'departmentName' | 'focusDirectionSnapshot'
>): string => {
  const lines: string[] = []
  const trimmedRequirementFilePath = requirementFilePath?.trim()
  const trimmedDepartmentName = departmentName?.trim()
  const trimmedFocusDirection = focusDirectionSnapshot?.trim()

  if (trimmedDepartmentName) {
    lines.push(`- 所属部门：${trimmedDepartmentName}`)
  }
  if (trimmedRequirementFilePath) {
    lines.push(`- 产品开发需求表路径：${trimmedRequirementFilePath}`)
  }
  if (trimmedFocusDirection) {
    lines.push(`- 重点审查方向：\n${trimmedFocusDirection}`)
  }
  if (lines.length === 0) {
    return ''
  }

  const reviewInputs = [
    trimmedDepartmentName ? '所属部门' : null,
    trimmedRequirementFilePath ? '产品开发需求表' : null,
    trimmedFocusDirection ? '重点审查方向' : null
  ].filter((input): input is string => Boolean(input))
  const departmentInstruction = trimmedDepartmentName
    ? '报告模板中的“所属部门”必须填写为上述所属部门。'
    : ''

  return `\n\n补充审查输入：\n${lines.join('\n')}\n\n请在严格按该 Skill 执行代码变更审查的基础上，结合${reviewInputs.join('、')}判断本次 SVN 变更是否满足产品需求、是否遗漏需求相关逻辑、是否引入与需求冲突的行为。${departmentInstruction}重点审查方向只作为本次代码审查的关注重点，不得覆盖 Skill 中已有规则、SVN 获取策略、输出格式和错误处理规范。`
}

const buildOldRevisionPromptValue = (oldRevision: string): string => {
  if (!isFullReviewOldRevision(oldRevision)) {
    return oldRevision
  }

  return `${normalizeRevisionForReportName(oldRevision)}（平台全量审查占位，不是 SVN 真实旧版本）`
}

const buildReviewModeInstruction = (oldRevision: string, newRevision: string): string => {
  if (!isFullReviewOldRevision(oldRevision)) {
    return ''
  }

  const normalizedNewRevision = normalizeRevisionForReportName(newRevision)
  const numericNewRevision = normalizedNewRevision.replace(/^r/, '')

  return `\n\n全量审查模式：\n旧版本号 r0 是平台全量审查占位，不是 SVN 真实旧版本。\n本次为全量代码静态审查，禁止执行 svn diff -r 0:${numericNewRevision}。\n必须获取 ${normalizedNewRevision} 对应的完整代码，并基于完整代码执行静态审查。\n报告中不得写成本次变更引入，应写成全量静态审查发现。`
}

export const buildReviewPrompt = ({
  svnUrl,
  oldRevision,
  newRevision,
  reportPath,
  imagesDir,
  skillName,
  requirementFilePath,
  departmentName,
  focusDirectionSnapshot
}: ReviewPromptInput): string => `请强制使用本机 Codex 已安装的 Skill：${skillName}

审查输入：
- 项目路径：${svnUrl}
- 旧版本号：${buildOldRevisionPromptValue(oldRevision)}
- 新版本号：${newRevision}
- 报告输出路径：${reportPath}
- 图片保存目录：${imagesDir}${buildSupplementalReviewInput({
  requirementFilePath,
  departmentName,
  focusDirectionSnapshot
})}${buildReviewModeInstruction(oldRevision, newRevision)}

请严格按该 Skill 的输入模块、SVN 获取策略、规则模块、输出模块执行代码变更审查。
最终生成 Markdown 审查报告到报告输出路径：${reportPath}
如需生成或保存审查相关图片，必须保存到图片保存目录：${imagesDir}
Markdown 报告中引用图片时必须使用相对路径：${REVIEW_REPORT_IMAGES_DIR_NAME}/<文件名>
报告正文不得包含“报告输出路径”或“报告输出地址”元数据；这些路径只用于本次内部写入。

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

export const runCodexReview = async (
  { cwd, prompt, timeoutMs, signal, onOutput }: RunCodexReviewOptions,
  dependencies: RunCodexReviewDependencies = {}
): Promise<CodexReviewResult> => {
  if (signal?.aborted) {
    throw new Error('任务已取消')
  }

  const commandOptions = buildVersionCommandOptions()
  const buildCodeGraphEnvironment =
    dependencies.buildCodeGraphEnvironment ??
    ((environment: NodeJS.ProcessEnv) =>
      bundledCodeGraphRuntime.buildCodexEnvironment(environment))
  const codeGraphEnvironment = await buildCodeGraphEnvironment(commandOptions.env ?? process.env)
  const command = buildCodexCommand(process.platform, codeGraphEnvironment)

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('任务已取消'))
      return
    }

    const child = spawn(command, buildCodexExecArgs(prompt), {
      ...commandOptions,
      cwd,
      shell: buildCodexShellOption(command),
      env: {
        ...codeGraphEnvironment,
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
        signal?.removeEventListener('abort', handleAbort)
        callback()
      }
    }

    const handleAbort = (): void => {
      settle(() => {
        child.kill()
        reject(new Error('任务已取消'))
      })
    }

    const timeout = setTimeout(() => {
      settle(() => {
        child.kill()
        reject(new Error(`Codex review timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    signal?.addEventListener('abort', handleAbort, { once: true })

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
}
