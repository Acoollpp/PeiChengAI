import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type {
  AppUpdateError,
  AppUpdateInfo,
  AppUpdateProgress,
  CodeReviewApi,
  EnvironmentCheckResult,
  EnvironmentProgressEvent,
  CancelTaskRequest,
  CancelTaskResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  KeyLoginRequest,
  KeyLoginResult,
  DownloadCurrentReportResult,
  OpenPdfReportRequest,
  OpenPdfReportResult,
  ReadReportAssetRequest,
  ReadReportAssetResult,
  RetryTaskRequest,
  RememberedCredentials,
  SubmitFeedbackIpcPayload,
  SubmitFeedbackPayload,
  SubmitFeedbackResult,
  SvnCredentialPayload,
  SvnLoginRequest,
  ReviewTasksResponse,
  SelectRequirementFileResult,
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult,
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
): Promise<SubmitFeedbackIpcPayload> => {
  const screenshots = payload.screenshots ?? (payload.screenshot ? [payload.screenshot] : [])

  return {
    description: payload.description,
    screenshots: await Promise.all(
      screenshots.map(async (screenshot) => ({
        name: screenshot.name,
        type: screenshot.type,
        bytes: await screenshot.arrayBuffer()
      }))
    )
  }
}

contextBridge.exposeInMainWorld('codeReview', {
  keyLogin: (payload: KeyLoginRequest): Promise<KeyLoginResult> =>
  ipcRenderer.invoke('auth:key-login', payload),
  svnLogin: (payload: SvnLoginRequest): Promise<unknown> =>
    ipcRenderer.invoke('auth:svn-login', payload),
  getCurrentUser: (): ReturnType<CodeReviewApi['getCurrentUser']> =>
    ipcRenderer.invoke('user:me'),
  listAvailableDepartments: (): ReturnType<CodeReviewApi['listAvailableDepartments']> =>
    ipcRenderer.invoke('department:list-available'),
  setDepartment: (
    payload: Parameters<CodeReviewApi['setDepartment']>[0]
  ): ReturnType<CodeReviewApi['setDepartment']> =>
    ipcRenderer.invoke('user:set-department', payload),
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
  retryTask: (payload: RetryTaskRequest): Promise<ExecuteTaskResult> =>
    ipcRenderer.invoke('task:retry', payload),
  cancelTask: (payload: CancelTaskRequest): Promise<CancelTaskResult> =>
    ipcRenderer.invoke('task:cancel', payload),
  openTaskLog: (taskId: string): ReturnType<CodeReviewApi['openTaskLog']> =>
    ipcRenderer.invoke('task:open-log', { taskId }),
  selectRequirementFile: (): Promise<SelectRequirementFileResult> =>
    ipcRenderer.invoke('requirement-file:select'),
  getPathForPastedFile: (file: File): string => webUtils.getPathForFile(file),
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
  openPdfReport: (payload: OpenPdfReportRequest): Promise<OpenPdfReportResult> =>
    ipcRenderer.invoke('report:open-pdf', payload),
  readReportAsset: (payload: ReadReportAssetRequest): Promise<ReadReportAssetResult> =>
    ipcRenderer.invoke('report:asset', payload),
  showTaskCompletionNotification: (
    payload: TaskCompletionNotificationPayload
  ): Promise<TaskCompletionNotificationResult> =>
    ipcRenderer.invoke('notification:show-task-completed', payload),
  onTaskCompletionNotificationClicked: (
    callback: (payload: TaskCompletionNotificationPayload) => void
  ): (() => void) => listen('notification:task-completed-clicked', callback),
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
  openReportFeedbackWindow: (
    payload: Parameters<CodeReviewApi['openReportFeedbackWindow']>[0]
  ): Promise<true> =>
    ipcRenderer.invoke('report-feedback:open', payload),
  submitNegativeReportFeedback: (taskId: string): ReturnType<CodeReviewApi['submitNegativeReportFeedback']> =>
    ipcRenderer.invoke('report-feedback:submit-negative', taskId),
  onReportFeedbackFocusAnchor: (
    callback: Parameters<CodeReviewApi['onReportFeedbackFocusAnchor']>[0]
  ): (() => void) =>
    listen('report-feedback:focus-anchor', callback),
  onReportFeedbackSubmitted: (
    callback: Parameters<CodeReviewApi['onReportFeedbackSubmitted']>[0]
  ): (() => void) =>
    listen('report-feedback:submitted', callback),
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
