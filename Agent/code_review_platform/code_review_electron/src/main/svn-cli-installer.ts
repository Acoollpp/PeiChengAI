import {
  checkEnvironment,
  findVersionCommand,
  type CommandResult,
  type EnvironmentCheckResult
} from './environment-checker'
import {
  runInstallCommand,
  summarizeInstallError,
  type InstallCommandResult
} from './codex-cli-installer'

export interface InstallSvnCliDependencies {
  platform?: NodeJS.Platform
  findVersionCommand?: (command: string, args: string[]) => Promise<CommandResult>
  runInstallCommand?: (command: string, args: string[]) => Promise<InstallCommandResult>
  checkEnvironment?: typeof checkEnvironment
}

type InstallTool = 'winget' | 'brew'

export const MissingWingetMessage = '未检测到 winget，请联系管理员或手动安装 SVN CLI。'
export const MissingBrewMessage = '未检测到 Homebrew，请联系管理员或手动安装 SVN CLI。'
export const UnsupportedSvnInstallPlatformMessage =
  '当前系统暂不支持自动安装 SVN CLI，请联系管理员处理。'
export const SvnNotDetectedAfterInstallMessage =
  'SVN CLI 已安装但当前客户端暂未检测到，请重启客户端或检查系统 PATH。'

const installCommands: Record<InstallTool, string[]> = {
  winget: [
    'install',
    '-e',
    '--id',
    'Slik.Subversion',
    '--silent',
    '--accept-package-agreements',
    '--accept-source-agreements'
  ],
  brew: ['install', 'subversion']
}

export const installSvnCli = async (
  dependencies: InstallSvnCliDependencies = {}
): Promise<EnvironmentCheckResult> => {
  const platform = dependencies.platform ?? process.platform
  const findCommand = dependencies.findVersionCommand ?? findVersionCommand
  const runInstall = dependencies.runInstallCommand ?? runInstallCommand
  const refreshEnvironment = dependencies.checkEnvironment ?? checkEnvironment
  const installTool = getInstallTool(platform)

  if (!installTool) {
    return {
      status: 'missing_svn',
      svnError: UnsupportedSvnInstallPlatformMessage
    }
  }

  const packageManagerResult = await findCommand(installTool, ['--version'])
  if (!packageManagerResult.ok) {
    return {
      status: 'missing_svn',
      svnError: installTool === 'winget' ? MissingWingetMessage : MissingBrewMessage
    }
  }

  const installResult = await runInstall(
    packageManagerResult.path ?? installTool,
    installCommands[installTool]
  )

  if (!installResult.ok) {
    return {
      status: 'missing_svn',
      svnError: `通过 ${installTool} 安装 SVN CLI 失败：${summarizeSvnInstallError(installResult)}`
    }
  }

  const svnResult = await findCommand('svn', ['--version', '--quiet'])
  if (!svnResult.ok) {
    return {
      status: 'missing_svn',
      svnError: SvnNotDetectedAfterInstallMessage
    }
  }

  return refreshEnvironment()
}

const getInstallTool = (platform: NodeJS.Platform): InstallTool | null => {
  if (platform === 'win32') {
    return 'winget'
  }

  if (platform === 'darwin') {
    return 'brew'
  }

  return null
}

const summarizeSvnInstallError = (result: InstallCommandResult): string => {
  const sharedSummary = summarizeInstallError(result)
  if (sharedSummary !== 'npm 未返回错误详情') {
    return sharedSummary
  }

  const output = `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n')

  return output || '安装命令未返回错误详情'
}
