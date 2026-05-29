import { access } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { join } from 'node:path'
import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'

import type { EnvironmentStatus } from '../shared/types'

interface EnvironmentChecks {
  codexOk: boolean
  svnOk: boolean
  skillOk: boolean
}

interface CommandResult {
  ok: boolean
  output?: string
  path?: string
}

export interface EnvironmentCheckResult {
  status: EnvironmentStatus
  codexVersion?: string
  svnVersion?: string
  codexPath?: string
  svnPath?: string
  skillError?: string
}

export const classifyEnvironment = ({
  codexOk,
  svnOk,
  skillOk
}: EnvironmentChecks): EnvironmentStatus => {
  if (!codexOk) {
    return 'missing_codex'
  }

  if (!svnOk) {
    return 'missing_svn'
  }

  if (!skillOk) {
    return 'missing_skill'
  }

  return 'ready'
}

const extraSearchPaths = [
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WindowsApps'),
  join(process.env.APPDATA ?? '', 'npm'),
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
]

const commandCandidates: Record<string, string[]> = {
  codex: [
    'codex',
    'codex.cmd',
    join(process.env.HOME ?? '', '.local/bin/codex'),
    '/Applications/Codex.app/Contents/Resources/codex'
  ],
  svn: ['svn', '/opt/homebrew/bin/svn', '/usr/local/bin/svn', '/usr/bin/svn']
}

const buildCommandEnv = (): NodeJS.ProcessEnv => {
  const currentPath = process.env.PATH ?? ''
  const mergedPath = [...extraSearchPaths, currentPath].filter(Boolean).join(delimiter)
  return {
    ...process.env,
    PATH: mergedPath
  }
}

export const buildVersionCommandOptions = (
  platform: NodeJS.Platform = process.platform
): SpawnOptionsWithoutStdio => ({
  env: buildCommandEnv(),
  shell: platform === 'win32',
  windowsHide: true
})

const runVersionCommand = (command: string, args: string[]): Promise<CommandResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, buildVersionCommandOptions())
    const chunks: Buffer[] = []
    let settled = false

    const settle = (result: CommandResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    child.on('error', () => {
      settle({ ok: false })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        settle({ ok: false })
        return
      }

      settle({
        ok: true,
        output: Buffer.concat(chunks).toString('utf8').trim(),
        path: command
      })
    })
  })

const findVersionCommand = async (command: string, args: string[]): Promise<CommandResult> => {
  for (const candidate of commandCandidates[command] ?? [command]) {
    const result = await runVersionCommand(candidate, args)
    if (result.ok) {
      return result
    }
  }

  return { ok: false }
}

const checkSkillExists = async (): Promise<boolean> => {
  const { app } = await import('electron')
  const skillPath = join(app.getPath('userData'), 'skills', '通用-代码变更审查', 'SKILL.md')

  try {
    await access(skillPath)
    return true
  } catch {
    return false
  }
}

export const checkEnvironment = async (): Promise<EnvironmentCheckResult> => {
  const [codexResult, svnResult, skillOk] = await Promise.all([
    findVersionCommand('codex', ['--version']),
    findVersionCommand('svn', ['--version', '--quiet']),
    checkSkillExists()
  ])

  return {
    status: classifyEnvironment({
      codexOk: codexResult.ok,
      svnOk: svnResult.ok,
      skillOk
    }),
    codexVersion: codexResult.output,
    svnVersion: svnResult.output,
    codexPath: codexResult.path,
    svnPath: svnResult.path
  }
}
