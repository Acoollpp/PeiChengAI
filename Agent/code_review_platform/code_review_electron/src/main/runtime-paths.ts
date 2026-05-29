import path from 'node:path'

export interface RuntimePaths {
  runtimeRoot: string
  skillPackagesDir: string
  skillManifestPath: string
  workspacesDir: string
  workspaceForTask(taskId: string): string
  reportPathForTask(taskId: string): string
}

export const RUNTIME_DATA_DIR = 'runtime-data'
export const DEV_RUNTIME_DATA_DIR = '.runtime-data'

export const getRuntimePaths = async (): Promise<RuntimePaths> => {
  const { app } = await import('electron')
  const pathApi = app.isPackaged && isWindowsPath(app.getPath('exe')) ? path.win32 : path
  const appRoot = app.isPackaged ? pathApi.dirname(app.getPath('exe')) : app.getAppPath()
  const runtimeRoot = pathApi.join(appRoot, app.isPackaged ? RUNTIME_DATA_DIR : DEV_RUNTIME_DATA_DIR)
  const skillPackagesDir = pathApi.join(runtimeRoot, 'skill-packages')
  const workspacesDir = pathApi.join(runtimeRoot, 'workspaces')

  return {
    runtimeRoot,
    skillPackagesDir,
    skillManifestPath: pathApi.join(skillPackagesDir, 'manifest.json'),
    workspacesDir,
    workspaceForTask: (taskId: string) => pathApi.join(workspacesDir, taskId),
    reportPathForTask: (taskId: string) => pathApi.join(workspacesDir, taskId, 'report.md')
  }
}

const isWindowsPath = (value: string): boolean => /^[a-zA-Z]:\\/.test(value) || value.startsWith('\\\\')
