import { contextBridge, ipcRenderer } from 'electron'

import type {
  EnvironmentCheckResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  DownloadCurrentReportResult,
  LoginRequest,
  RememberedCredentials,
  RegisterRequest,
  TaskProgressEvent
} from '../renderer/src/code-review-api'

contextBridge.exposeInMainWorld('codeReview', {
  register: (payload: RegisterRequest): Promise<unknown> =>
    ipcRenderer.invoke('auth:register', payload),
  login: (payload: LoginRequest): Promise<unknown> => ipcRenderer.invoke('auth:login', payload),
  saveCredentials: (payload: RememberedCredentials): Promise<unknown> =>
    ipcRenderer.invoke('credentials:save', payload),
  loadCredentials: (): Promise<RememberedCredentials | null> =>
    ipcRenderer.invoke('credentials:load'),
  clearCredentials: (): Promise<unknown> => ipcRenderer.invoke('credentials:clear'),
  loadServerConfig: (): Promise<{ server_url: string }> =>
    ipcRenderer.invoke('server-config:load'),
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
  downloadCurrentReport: (): Promise<DownloadCurrentReportResult> =>
    ipcRenderer.invoke('report:download-current'),
  installSkill: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('skill:install'),
  checkEnvironment: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('environment:check')
})
