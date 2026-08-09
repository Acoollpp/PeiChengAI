import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

import type { EnvironmentStatus, SyncedSkill } from '../shared/types'
import {
  bundledCodeGraphRuntime,
  type CodeGraphRuntimeInspection,
  type CodeGraphRuntimeStatus
} from './bundled-codegraph-runtime'
import { getRuntimePaths } from './runtime-paths'

interface EnvironmentChecks {
  codexOk: boolean
  svnOk: boolean
  skillOk: boolean
}

export interface CommandResult {
  ok: boolean
  output?: string
  path?: string
}

export interface EnvironmentCheckDependencies {
  getRuntimePaths?: typeof getRuntimePaths
  findVersionCommand?: typeof findVersionCommand
  checkRuntimeWritable?: typeof checkRuntimeWritable
  checkSkillPackageReady?: typeof checkSkillPackageReady
  readSyncedSkills?: typeof readSyncedSkills
  inspectCodeGraphRuntime?: () => Promise<CodeGraphRuntimeInspection>
}

export interface EnvironmentCheckResult {
  status: EnvironmentStatus
  codexVersion?: string
  svnVersion?: string
  codexPath?: string
  svnPath?: string
  codexError?: string
  svnError?: string
  skillError?: string
  codegraphStatus?: CodeGraphRuntimeStatus
  codegraphRequiredVersion?: string
  codegraphVersion?: string
  codegraphPath?: string
  codegraphError?: string
  skills?: SyncedSkill[]
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
  npm: ['npm', 'npm.cmd'],
  winget: ['winget', 'winget.exe'],
  brew: ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew'],
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

export const buildDirectCommandOptions = (
  _platform: NodeJS.Platform = process.platform
): SpawnOptionsWithoutStdio => ({
  env: buildCommandEnv(),
  shell: false,
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

const runCommandOutput = (command: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    const child = spawn(command, args, buildVersionCommandOptions())
    const stdoutChunks: Buffer[] = []
    let settled = false

    const settle = (output: string | null): void => {
      if (!settled) {
        settled = true
        resolve(output)
      }
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.on('error', () => settle(null))
    child.on('close', (code) => {
      settle(code === 0 ? Buffer.concat(stdoutChunks).toString('utf8').trim() : null)
    })
  })

export const refreshProcessPath = async (
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  if (platform !== 'win32') {
    return
  }

  const [machinePath, userPath] = await Promise.all([
    queryWindowsPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    queryWindowsPath('HKCU\\Environment')
  ])
  const refreshedPath = [machinePath, userPath].filter(Boolean).join(delimiter)

  if (refreshedPath) {
    process.env.PATH = refreshedPath
    process.env.Path = refreshedPath
  }
}

const queryWindowsPath = async (key: string): Promise<string> => {
  const output = await runCommandOutput('reg.exe', ['query', key, '/v', 'Path'])
  if (!output) {
    return ''
  }

  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^Path\s+REG_(?:EXPAND_)?SZ\s+/i.test(value))

  return line?.replace(/^Path\s+REG_(?:EXPAND_)?SZ\s+/i, '').trim() ?? ''
}

export const findVersionCommand = async (
  command: string,
  args: string[]
): Promise<CommandResult> => {
  for (const candidate of commandCandidates[command] ?? [command]) {
    const result = await runVersionCommand(candidate, args)
    if (result.ok) {
      return result
    }
  }

  return { ok: false }
}

export const checkRuntimeWritable = async (runtimeRoot: string): Promise<boolean> => {
  const probePath = join(runtimeRoot, `.write-check-${randomUUID()}`)

  try {
    await mkdir(runtimeRoot, { recursive: true })
    await writeFile(probePath, 'ok')
    await rm(probePath, { force: true })
    return true
  } catch {
    return false
  }
}

export const checkSkillPackageReady = async (manifestPath: string): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (!isSkillManifest(manifest)) {
      return false
    }

    if (manifest.skills.length === 0) {
      return false
    }

    for (const entry of manifest.skills) {
      await access(entry.package_path)
    }

    return true
  } catch {
    return false
  }
}

interface SkillManifestEntry {
  id: string
  name: string
  version: string
  package_path: string
  installed_at: string
}

interface SkillManifest {
  skills: SkillManifestEntry[]
}

const isSkillManifest = (value: unknown): value is SkillManifest =>
  typeof value === 'object' &&
  value !== null &&
  'skills' in value &&
  Array.isArray(value.skills) &&
  value.skills.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      'version' in entry &&
      'package_path' in entry &&
      'installed_at' in entry &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.version === 'string' &&
      typeof entry.package_path === 'string' &&
      typeof entry.installed_at === 'string'
  )

export const readSyncedSkills = async (manifestPath: string): Promise<SyncedSkill[]> => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  if (!isSkillManifest(manifest)) {
    return []
  }

  return manifest.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    version: skill.version,
    package_path: skill.package_path,
    installed_at: skill.installed_at
  }))
}

export const checkEnvironment = async (
  dependencies: EnvironmentCheckDependencies = {}
): Promise<EnvironmentCheckResult> => {
  const loadRuntimePaths = dependencies.getRuntimePaths ?? getRuntimePaths
  const findCommand = dependencies.findVersionCommand ?? findVersionCommand
  const runtimeWritableCheck = dependencies.checkRuntimeWritable ?? checkRuntimeWritable
  const skillPackageReadyCheck = dependencies.checkSkillPackageReady ?? checkSkillPackageReady
  const syncedSkillsReader = dependencies.readSyncedSkills ?? readSyncedSkills
  const inspectCodeGraph =
    dependencies.inspectCodeGraphRuntime ?? (() => bundledCodeGraphRuntime.inspect())

  try {
    const runtimePaths = await loadRuntimePaths()
    const [codexResult, runtimeWritable, codeGraph] = await Promise.all([
      findCommand('codex', ['--version']),
      runtimeWritableCheck(runtimePaths.runtimeRoot),
      inspectCodeGraph()
    ])
    const codeGraphFields = {
      codegraphStatus: codeGraph.status,
      codegraphRequiredVersion: codeGraph.requiredVersion,
      codegraphVersion: codeGraph.version,
      codegraphPath: codeGraph.commandPath,
      codegraphError: codeGraph.error
    }

    if (!runtimeWritable) {
      return {
        status: 'failed',
        codexVersion: codexResult.output,
        codexPath: codexResult.path,
        skillError: `客户端运行目录不可写：${runtimePaths.runtimeRoot}`,
        ...codeGraphFields
      }
    }

    if (codeGraph.status !== 'ready') {
      return {
        status: 'failed',
        codexVersion: codexResult.output,
        codexPath: codexResult.path,
        ...codeGraphFields
      }
    }

    if (!codexResult.ok) {
      return {
        status: 'missing_codex',
        ...codeGraphFields
      }
    }

    const [svnResult, skillOk] = await Promise.all([
      findCommand('svn', ['--version', '--quiet']),
      skillPackageReadyCheck(runtimePaths.skillManifestPath)
    ])
    const syncedSkills = skillOk ? await syncedSkillsReader(runtimePaths.skillManifestPath) : []

    return {
      status: classifyEnvironment({
        codexOk: codexResult.ok,
        svnOk: svnResult.ok,
        skillOk
      }),
      codexVersion: codexResult.output,
      svnVersion: svnResult.output,
      codexPath: codexResult.path,
      svnPath: svnResult.path,
      ...codeGraphFields,
      skills: syncedSkills
    }
  } catch (error) {
    return {
      status: 'failed',
      skillError: error instanceof Error ? error.message : String(error)
    }
  }
}
