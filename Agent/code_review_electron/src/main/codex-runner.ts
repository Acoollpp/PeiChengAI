import { spawn } from 'node:child_process'

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
}

export interface CodexReviewResult {
  stdout: string
  stderr: string
}

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
  timeoutMs
}: RunCodexReviewOptions): Promise<CodexReviewResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('codex', [prompt], {
      cwd,
      windowsHide: true,
      shell: false
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const settle = (
      callback: () => void
    ): void => {
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
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
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
