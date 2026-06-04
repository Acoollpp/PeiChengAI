import { contextBridge, ipcRenderer } from 'electron'

import type {
  EnvironmentCheckResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  KeyLoginRequest,
  KeyLoginResult,
  DownloadCurrentReportResult,
  RememberedCredentials,
  SvnCredentialPayload,
  SvnLoginRequest,
  ReviewTasksResponse,
  TaskProgressEvent
} from '../renderer/src/code-review-api'

contextBridge.exposeInMainWorld('codeReview', {
  keyLogin: (payload: KeyLoginRequest): Promise<KeyLoginResult> =>
    ipcRenderer.invoke('auth:key-login', payload),
  svnLogin: (payload: SvnLoginRequest): Promise<unknown> =>
    ipcRenderer.invoke('auth:svn-login', payload),
  saveCredentials: (payload: RememberedCredentials): Promise<unknown> =>
    ipcRenderer.invoke('credentials:save', payload),
  loadCredentials: (): Promise<RememberedCredentials | null> =>
    ipcRenderer.invoke('credentials:load'),
  clearCredentials: (): Promise<unknown> => ipcRenderer.invoke('credentials:clear'),
  loadServerConfig: (): Promise<{ server_url: string }> =>
    ipcRenderer.invoke('server-config:load'),
  listTasks: (): Promise<ReviewTasksResponse> => ipcRenderer.invoke('task:list'),
  readTaskReport: (taskId: string): Promise<string> => ipcRenderer.invoke('task:report', taskId),
  executeTask: (payload: ExecuteTaskRequest): Promise<ExecuteTaskResult> =>
    ipcRenderer.invoke('task:execute', payload),
  onTaskProgress: (callback: (event: TaskProgressEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progressEvent: TaskProgressEvent): void => {
      callback(progressEvent)
    }
    ipcRenderer.on('task:progress', listener)
    return () => {
      ipcRenderer.removeListener('task:progress', listener)
    }
  },
  downloadCurrentReport: (taskId?: string): Promise<DownloadCurrentReportResult> =>
    ipcRenderer.invoke('report:download-current', taskId),
  bindSvnCredential: (payload: SvnCredentialPayload): Promise<true> =>
    ipcRenderer.invoke('svn:bind-credential', payload),
  installCodex: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('codex:install'),
  installSvn: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('svn:install'),
  installSkill: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('skill:install'),
  checkEnvironment: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('environment:check')
})
