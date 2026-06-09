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
    '请将下面这个本地 Skill zip 包作为最新版本安装到 Codex 自己的 Skill 目录中。',
    '要求：',
    '1. 直接读取这个 zip 文件路径，不要修改 zip 内容。',
    '2. 先定位 Codex 当前已安装的同名 Skill，并删除旧的同名 Skill，包括 Codex 自己机制中记录的旧版本目录或注册信息。',
    '3. 再安装这个 zip 包中的最新 Skill，确保后续 Codex 调用同名 Skill 时只会使用这次安装的新版本。',
    '4. 如果无法确认旧 Skill 已删除或新 Skill 已安装成功，请明确输出失败原因并以失败状态结束。',
    '5. 安装成功后只输出简短成功信息。',
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
