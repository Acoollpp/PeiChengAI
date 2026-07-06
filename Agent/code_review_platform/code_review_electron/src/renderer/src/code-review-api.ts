import type { ReviewTemplateKey } from '../../shared/review-templates'
import type {
  EnvironmentProgressEvent,
  EnvironmentStatus,
  CurrentUser,
  DepartmentsResponse,
  ReviewTask,
  ReviewTaskStatus,
  SyncedSkill,
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult,
  TaskProgressEvent
} from '../../shared/types'

export type { EnvironmentProgressEvent, TaskProgressEvent }
export type { CurrentUser, DepartmentsResponse }
export type {
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult
} from '../../shared/types'

export interface KeyLoginRequest {
  server_url: string
  key: string
}

export interface SvnLoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export type RememberedCredentials =
  | {
      mode: 'key'
      server_url?: string
      key: string
    }
  | {
      mode?: 'svn'
      server_url?: string
      svn_username: string
      svn_password: string
    }

export interface ExecuteTaskRequest {
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
  requirement_file_path?: string
  requirement_file_name?: string
  focus_direction_id?: string
  focus_direction_snapshot?: string
  client_task_id?: string
}

export type SelectRequirementFileResult =
  | {
      status: 'selected'
      filePath: string
    }
  | {
      status: 'cancelled'
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
  skills?: SyncedSkill[]
}

export interface ExecuteTaskResult {
  taskId: string
  status: ReviewTaskStatus
  reportMarkdown?: string
  reportPath?: string
  pdfPath?: string
  pdfReportName?: string
  codexLogPath?: string
}

export interface CancelTaskRequest {
  client_task_id?: string
  task_id?: string
}

export interface CancelTaskResult {
  status: 'cancelled' | 'not_found'
}

export interface OpenTaskLogResult {
  status: 'ready' | 'missing'
  logPath?: string
}

export interface SubmitFeedbackPayload {
  description: string
  screenshots?: File[]
  screenshot?: File | null
}

export interface SerializedFeedbackScreenshot {
  name: string
  type: string
  bytes: ArrayBuffer
}

export interface SubmitFeedbackIpcPayload {
  description: string
  screenshots?: SerializedFeedbackScreenshot[]
}

export interface SubmitFeedbackResult {
  id: string
  status: 'pending' | 'processing' | 'resolved'
}

export interface SubmitReportFeedbackPayload {
  taskId: string
  helpful: boolean
  useful_issues_text?: string | null
}

export interface SubmitReportFeedbackResult {
  id: string
  task_id: string
  user_id: string
  helpful: boolean
  useful_issues_text?: string | null
}

export interface ReviewTasksResponse {
  data: ReviewTask[]
  count: number
}

export interface DownloadCurrentReportResult {
  status: 'ready' | 'missing'
  taskId?: string
  reportPath?: string
}

export interface OpenPdfReportRequest {
  taskId?: string
  localPdfPath?: string
  pdfReportName?: string
}

export interface OpenPdfReportResult {
  status: 'ready'
  pdfPath: string
}

export interface ReadReportAssetRequest {
  reportPath: string
  assetPath: string
}

export interface ReadReportAssetResult {
  dataUrl: string
  contentType: string
}

export interface KeyLoginResult {
  needSvnBinding: boolean
}

export interface SvnCredentialPayload {
  svn_username: string
  svn_password: string
}

export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface AppUpdateInfo {
  version: string
  releaseName?: string
  releaseNotes?: string | Array<{ version?: string; note?: string }>
  releaseDate?: string
}

export interface AppUpdateProgress {
  total?: number
  delta?: number
  transferred?: number
  percent?: number
  bytesPerSecond?: number
}

export interface AppUpdateError {
  message: string
  stack?: string
}

export interface CodeReviewApi {
  keyLogin(payload: KeyLoginRequest): Promise<KeyLoginResult>
  svnLogin(payload: SvnLoginRequest): Promise<unknown>
  getCurrentUser(): Promise<CurrentUser>
  listAvailableDepartments(): Promise<DepartmentsResponse>
  setDepartment(payload: { department_id: string }): Promise<CurrentUser>
  saveCredentials(payload: RememberedCredentials): Promise<unknown>
  loadCredentials(): Promise<RememberedCredentials | null>
  clearCredentials(): Promise<unknown>
  loadServerConfig(): Promise<{ server_url: string }>
  listTasks(): Promise<ReviewTasksResponse>
  readTaskReport(taskId: string): Promise<string>
  executeTask(payload: ExecuteTaskRequest): Promise<ExecuteTaskResult>
  cancelTask(payload: CancelTaskRequest): Promise<CancelTaskResult>
  openTaskLog(taskId: string): Promise<OpenTaskLogResult>
  selectRequirementFile(): Promise<SelectRequirementFileResult>
  getPathForPastedFile(file: File): string
  onTaskProgress(callback: (event: TaskProgressEvent) => void): () => void
  downloadCurrentReport(taskId?: string): Promise<DownloadCurrentReportResult>
  openPdfReport(payload: OpenPdfReportRequest): Promise<OpenPdfReportResult>
  readReportAsset(payload: ReadReportAssetRequest): Promise<ReadReportAssetResult>
  showTaskCompletionNotification(
    payload: TaskCompletionNotificationPayload
  ): Promise<TaskCompletionNotificationResult>
  onTaskCompletionNotificationClicked(
    callback: (payload: TaskCompletionNotificationPayload) => void
  ): () => void
  installCodex(): Promise<EnvironmentCheckResult>
  installSvn(): Promise<EnvironmentCheckResult>
  installSkill(): Promise<EnvironmentCheckResult>
  checkEnvironment(): Promise<EnvironmentCheckResult>
  onEnvironmentProgress(callback: (event: EnvironmentProgressEvent) => void): () => void
  submitFeedback(payload: SubmitFeedbackPayload): Promise<SubmitFeedbackResult>
  submitReportFeedback(payload: SubmitReportFeedbackPayload): Promise<SubmitReportFeedbackResult>
  bindSvnCredential(payload: SvnCredentialPayload): Promise<true>
  checkForAppUpdate(): Promise<boolean>
  downloadAppUpdate(): Promise<true>
  installAppUpdate(): Promise<true>
  onAppUpdateAvailable(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateNotAvailable(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateDownloadProgress(callback: (progress: AppUpdateProgress) => void): () => void
  onAppUpdateProgress(callback: (progress: AppUpdateProgress) => void): () => void
  onAppUpdateDownloaded(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateError(callback: (error: AppUpdateError) => void): () => void
}
