import path from 'node:path'

import { REVIEW_REPORT_FILE_NAME, REVIEW_REPORT_IMAGES_DIR_NAME } from '../shared/report-artifacts'

export interface RuntimePaths {
  runtimeRoot: string
  skillPackagesDir: string
  skillManifestPath: string
  workspacesDir: string
  workspaceForTask(taskId: string): string
  codexLogPathForTask?: (taskId: string) => string
  reportPathForTask(taskId: string, reportFileName?: string): string
  pdfReportPathForTask?: (taskId: string) => string
  imagesDirForTask(taskId: string): string
  evidenceDirForTask?: (taskId: string) => string
}

export const RUNTIME_DATA_DIR = 'runtime-data'
export const DEV_RUNTIME_DATA_DIR = '.runtime-data'
export const PACKAGED_RUNTIME_DATA_DIR = 'code-review-electron-data'

// Skill 会把 SVN 导出的整棵源码树放进证据目录，路径预算必须留给仓库自身的层级：
// 目录名压到 'e'，任务段只取 ID 前 8 位，否则 Windows MAX_PATH 260 会让 PowerShell
// 读不到深层源文件（见 issue #76）。
export const EVIDENCE_DIR = 'e'
const EVIDENCE_TASK_SEGMENT_LENGTH = 8

export const buildEvidenceTaskSegment = (taskId: string): string => {
  const normalized = taskId.replace(/[^a-zA-Z0-9]/g, '')
  return (normalized || 'task').slice(0, EVIDENCE_TASK_SEGMENT_LENGTH)
}

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
    codexLogPathForTask: (taskId: string) =>
      pathApi.join(workspacesDir, taskId, 'codex-review.log'),
    reportPathForTask: (taskId: string, reportFileName = REVIEW_REPORT_FILE_NAME) =>
      pathApi.join(workspacesDir, taskId, reportFileName),
    pdfReportPathForTask: (taskId: string) =>
      pathApi.join(workspacesDir, taskId, REVIEW_REPORT_FILE_NAME.replace(/\.md$/i, '.pdf')),
    imagesDirForTask: (taskId: string) => pathApi.join(workspacesDir, taskId, REVIEW_REPORT_IMAGES_DIR_NAME),
    evidenceDirForTask: (taskId: string) =>
      pathApi.join(runtimeRoot, EVIDENCE_DIR, buildEvidenceTaskSegment(taskId))
  }
}

const isWindowsPath = (value: string): boolean => /^[a-zA-Z]:\\/.test(value) || value.startsWith('\\\\')
