import { contextBridge, ipcRenderer } from 'electron'

import type {
  AppUpdateError,
  AppUpdateInfo,
  AppUpdateProgress,
  EnvironmentCheckResult,
  EnvironmentProgressEvent,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  KeyLoginRequest,
  KeyLoginResult,
  DownloadCurrentReportResult,
  RememberedCredentials,
  SubmitFeedbackIpcPayload,
  SubmitFeedbackPayload,
  SubmitFeedbackResult,
  SvnCredentialPayload,
  SvnLoginRequest,
  ReviewTasksResponse,
  TaskProgressEvent
} from '../renderer/src/code-review-api'

const listen = <T>(channel: string, callback: (event: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const serializeFeedbackPayload = async (
  payload: SubmitFeedbackPayload
): Promise<SubmitFeedbackIpcPayload> => ({
  description: payload.description,
  screenshot: payload.screenshot
    ? {
        name: payload.screenshot.name,
        type: payload.screenshot.type,
        bytes: await payload.screenshot.arrayBuffer()
      }
    : null
})

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
  checkEnvironment: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('environment:check'),
  onEnvironmentProgress: (callback: (event: EnvironmentProgressEvent) => void): (() => void) =>
    listen('environment:progress', callback),
  submitFeedback: async (payload: SubmitFeedbackPayload): Promise<SubmitFeedbackResult> =>
    ipcRenderer.invoke('feedback:submit', await serializeFeedbackPayload(payload)),
  checkForAppUpdate: (): Promise<boolean> => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: (): Promise<true> => ipcRenderer.invoke('app-update:download'),
  installAppUpdate: (): Promise<true> => ipcRenderer.invoke('app-update:install'),
  onAppUpdateAvailable: (callback: (info: AppUpdateInfo) => void): (() => void) =>
    listen('app-update:available', callback),
  onAppUpdateNotAvailable: (callback: (info: AppUpdateInfo) => void): (() => void) =>
    listen('app-update:not-available', callback),
  onAppUpdateDownloadProgress: (callback: (progress: AppUpdateProgress) => void): (() => void) =>
    listen('app-update:download-progress', callback),
  onAppUpdateProgress: (callback: (progress: AppUpdateProgress) => void): (() => void) =>
    listen('app-update:download-progress', callback),
  onAppUpdateDownloaded: (callback: (info: AppUpdateInfo) => void): (() => void) =>
    listen('app-update:downloaded', callback),
  onAppUpdateError: (callback: (error: AppUpdateError) => void): (() => void) =>
    listen('app-update:error', callback)
})
