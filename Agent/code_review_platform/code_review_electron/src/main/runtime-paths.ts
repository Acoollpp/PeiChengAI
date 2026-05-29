import { dirname, join } from 'node:path'

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
  const appRoot = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()
  const runtimeRoot = join(appRoot, app.isPackaged ? RUNTIME_DATA_DIR : DEV_RUNTIME_DATA_DIR)
  const skillPackagesDir = join(runtimeRoot, 'skill-packages')
  const workspacesDir = join(runtimeRoot, 'workspaces')

  return {
    runtimeRoot,
    skillPackagesDir,
    skillManifestPath: join(skillPackagesDir, 'manifest.json'),
    workspacesDir,
    workspaceForTask: (taskId: string) => join(workspacesDir, taskId),
    reportPathForTask: (taskId: string) => join(workspacesDir, taskId, 'report.md')
  }
}
