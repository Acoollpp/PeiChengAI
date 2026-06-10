import path from 'node:path'

import { REVIEW_REPORT_FILE_NAME, REVIEW_REPORT_IMAGES_DIR_NAME } from '../shared/report-artifacts'

export interface RuntimePaths {
  runtimeRoot: string
  skillPackagesDir: string
  skillManifestPath: string
  workspacesDir: string
  workspaceForTask(taskId: string): string
  reportPathForTask(taskId: string, reportFileName?: string): string
  imagesDirForTask(taskId: string): string
}

export const RUNTIME_DATA_DIR = 'runtime-data'
export const DEV_RUNTIME_DATA_DIR = '.runtime-data'
export const PACKAGED_RUNTIME_DATA_DIR = 'code-review-electron-data'

export const getRuntimePaths = async (): Promise<RuntimePaths> => {
  const { app } = await import('electron')
  const pathApi = app.isPackaged && isWindowsPath(app.getPath('exe')) ? path.win32 : path
  const appRoot = app.isPackaged ? pathApi.dirname(app.getPath('exe')) : app.getAppPath()
  const runtimeRoot = app.isPackaged
    ? pathApi.join(pathApi.dirname(appRoot), PACKAGED_RUNTIME_DATA_DIR)
    : pathApi.join(appRoot, DEV_RUNTIME_DATA_DIR)
  const skillPackagesDir = pathApi.join(runtimeRoot, 'skill-packages')
  const workspacesDir = pathApi.join(runtimeRoot, 'workspaces')

  return {
    runtimeRoot,
    skillPackagesDir,
    skillManifestPath: pathApi.join(skillPackagesDir, 'manifest.json'),
    workspacesDir,
    workspaceForTask: (taskId: string) => pathApi.join(workspacesDir, taskId),
    reportPathForTask: (taskId: string, reportFileName = REVIEW_REPORT_FILE_NAME) =>
      pathApi.join(workspacesDir, taskId, reportFileName),
    imagesDirForTask: (taskId: string) => pathApi.join(workspacesDir, taskId, REVIEW_REPORT_IMAGES_DIR_NAME)
  }
}

const isWindowsPath = (value: string): boolean => /^[a-zA-Z]:\\/.test(value) || value.startsWith('\\\\')
