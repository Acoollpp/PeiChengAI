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
最终生成 Markdown 审查报告到报告输出路径：${reportPath}`

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
          reject(new Error(`Codex review failed with exit code ${code}: ${stderr}`))
          return
        }

        resolve({ stdout, stderr })
      })
    })
  })
