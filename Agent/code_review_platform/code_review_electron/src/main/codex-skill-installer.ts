import { spawn } from 'node:child_process'

import { buildCodexCommand, buildCodexExecArgs } from './codex-runner'
import { buildVersionCommandOptions } from './environment-checker'

export interface InstallCodexSkillInput {
  packagePath: string
  timeoutMs?: number
}

export interface InstallCodexSkillResult {
  stdout: string
  stderr: string
}

export const buildInstallSkillPrompt = (packagePath: string): string =>
  [
    '请将下面这个本地 Skill zip 包安装到 Codex 自己的 Skill 目录中。',
    '要求：',
    '1. 直接读取这个 zip 文件路径，不要修改 zip 内容。',
    '2. 如果 Codex 已经安装了同名 Skill，请用这个 zip 包中的版本覆盖更新。',
    '3. 安装完成后只输出简短成功信息。',
    '',
    `Skill zip 路径：${packagePath}`
  ].join('\n')

export const installCodexSkillFromZip = ({
  packagePath,
  timeoutMs = 5 * 60 * 1000
}: InstallCodexSkillInput): Promise<InstallCodexSkillResult> =>
  new Promise((resolve, reject) => {
    const commandOptions = buildVersionCommandOptions()
    const child = spawn(buildCodexCommand(), buildCodexExecArgs(buildInstallSkillPrompt(packagePath)), {
      ...commandOptions,
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
        reject(new Error(`Codex Skill install timed out after ${timeoutMs}ms`))
      })
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.stdin.end()

    child.on('error', (error) => {
      settle(() => reject(error))
    })

    child.on('close', (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (code !== 0) {
          reject(new Error(`Codex Skill install failed with exit code ${code}: ${stderr}`))
          return
        }

        resolve({ stdout, stderr })
      })
    })
  })
