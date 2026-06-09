import { spawn } from 'node:child_process'

import { buildCodexCommand, buildCodexExecArgs } from './codex-runner'
import { buildVersionCommandOptions } from './environment-checker'

export interface InstallCodexSkillInput {
  packagePath: string
  skillId: string
  skillName: string
  version: string
  contentHash?: string
  timeoutMs?: number
}

export interface DeleteCodexSkillInput {
  skillId: string
  skillName: string
  version: string
  timeoutMs?: number
}

export interface InstallCodexSkillResult {
  stdout: string
  stderr: string
}

type LegacyInstallCodexSkillInput = Pick<InstallCodexSkillInput, 'packagePath' | 'timeoutMs'>

export const buildInstallSkillPrompt = ({
  packagePath,
  skillId,
  skillName,
  version,
  contentHash
}: InstallCodexSkillInput): string =>
  [
    '请将下面这个本地 Skill zip 包安装为 Codex 当前可用的最新 Skill。',
    '',
    '这是服务端当前激活 Skill 列表中的一个条目，客户端正在按服务端激活列表同步本机 Codex Skill。',
    '',
    '服务端 Skill 元信息：',
    `- Skill ID：${skillId}`,
    `- Skill 名称：${skillName}`,
    `- Skill 版本：${version}`,
    `- 内容哈希：${contentHash ?? '未提供'}`,
    `- Skill zip 路径：${packagePath}`,
    '',
    '安装要求：',
    '1. 直接读取 Skill zip 路径对应的 zip 文件，不要修改 zip 内容。',
    `2. 安装前必须识别 zip 包内的 Skill 名称，并确认它与服务端 Skill 名称一致：${skillName}。`,
    `3. 在安装新包前，必须定位 Codex 当前已安装的所有同名 Skill：${skillName}。`,
    '4. 删除所有旧的同名 Skill，包括旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的旧记录。',
    '5. 只能删除同名 Skill，不要删除其他名称的 Skill。',
    '6. 删除完成后，安装当前 zip 包中的 Skill。',
    `7. 安装后必须确认后续通过 Skill 名称 ${skillName} 调用时，只会使用本次安装的新版本。`,
    '8. 如果无法确认旧同名 Skill 已删除、无法确认新 Skill 已安装成功，或发现安装后的 Skill 名称与服务端元信息不一致，必须以失败状态结束。',
    '9. 安装成功后只输出简短成功信息。',
    '',
    '失败输出格式：',
    '[SKILL_INSTALL_ERROR] <失败原因，包括已尝试的删除路径、安装步骤和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_INSTALL_OK] ${skillName}@${version}`
  ].join('\n')

export const buildDeleteSkillPrompt = ({
  skillId,
  skillName,
  version
}: DeleteCodexSkillInput): string =>
  [
    '请从 Codex 当前已安装的 Skill 中删除指定 Skill。',
    '',
    '删除目标：',
    `- Skill 名称：${skillName}`,
    `- 原服务端 Skill ID：${skillId}`,
    `- 原版本：${version}`,
    '',
    '删除要求：',
    `1. 只删除名称为 ${skillName} 的 Skill。`,
    '2. 删除该名称下所有旧版本目录、缓存目录、注册信息或 Codex 机制中会影响同名 Skill 解析的记录。',
    '3. 不要删除其他名称的 Skill。',
    `4. 删除后必须确认后续通过 Skill 名称 ${skillName} 不会再启动到任何本地残留版本。`,
    '5. 如果无法确认删除成功，必须以失败状态结束。',
    '',
    '失败输出格式：',
    '[SKILL_DELETE_ERROR] <失败原因，包括已尝试的删除路径和失败细节>',
    '',
    '成功输出格式：',
    `[SKILL_DELETE_OK] ${skillName}`
  ].join('\n')

const toInstallPromptInput = (input: InstallCodexSkillInput | LegacyInstallCodexSkillInput): InstallCodexSkillInput => {
  if ('skillId' in input && 'skillName' in input && 'version' in input) {
    return input
  }

  return {
    packagePath: input.packagePath,
    skillId: '未提供',
    skillName: '未提供',
    version: '未提供'
  }
}

const runCodexPrompt = (
  prompt: string,
  timeoutMs = 5 * 60 * 1000,
  failureLabel = 'Codex Skill operation'
): Promise<InstallCodexSkillResult> =>
  new Promise((resolve, reject) => {
    const commandOptions = buildVersionCommandOptions()
    const child = spawn(buildCodexCommand(), buildCodexExecArgs(prompt), {
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
        reject(new Error(`${failureLabel} timed out after ${timeoutMs}ms`))
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
          reject(new Error(`${failureLabel} failed with exit code ${code}: ${stderr}`))
          return
        }

        resolve({ stdout, stderr })
      })
    })
  })

export function installCodexSkillFromZip(
  input: InstallCodexSkillInput | LegacyInstallCodexSkillInput
): Promise<InstallCodexSkillResult> {
  return runCodexPrompt(
    buildInstallSkillPrompt(toInstallPromptInput(input)),
    input.timeoutMs,
    'Codex Skill install'
  )
}

export const deleteCodexSkill = (input: DeleteCodexSkillInput): Promise<InstallCodexSkillResult> =>
  runCodexPrompt(buildDeleteSkillPrompt(input), input.timeoutMs, 'Codex Skill delete')
