import type {
  EnvironmentStatus,
  ReviewTask,
  ReviewTaskStatus,
  TaskProgressEvent
} from '../../shared/types'

export type { TaskProgressEvent }

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
}

export interface ExecuteTaskResult {
  taskId: string
  status: ReviewTaskStatus
  reportMarkdown?: string
  reportPath?: string
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

export interface KeyLoginResult {
  needSvnBinding: boolean
}

export interface SvnCredentialPayload {
  svn_username: string
  svn_password: string
}

export type AppUpdateStatus = 'available' | 'not-available' | 'download-progress' | 'downloaded' | 'error'

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
  saveCredentials(payload: RememberedCredentials): Promise<unknown>
  loadCredentials(): Promise<RememberedCredentials | null>
  clearCredentials(): Promise<unknown>
  loadServerConfig(): Promise<{ server_url: string }>
  listTasks(): Promise<ReviewTasksResponse>
  readTaskReport(taskId: string): Promise<string>
  executeTask(payload: ExecuteTaskRequest): Promise<ExecuteTaskResult>
  onTaskProgress(callback: (event: TaskProgressEvent) => void): () => void
  downloadCurrentReport(taskId?: string): Promise<DownloadCurrentReportResult>
  installCodex(): Promise<EnvironmentCheckResult>
  installSvn(): Promise<EnvironmentCheckResult>
  installSkill(): Promise<EnvironmentCheckResult>
  checkEnvironment(): Promise<EnvironmentCheckResult>
  bindSvnCredential(payload: SvnCredentialPayload): Promise<true>
  checkForAppUpdate(): Promise<boolean>
  downloadAppUpdate(): Promise<true>
  installAppUpdate(): Promise<true>
  onAppUpdateAvailable(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateNotAvailable(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateDownloadProgress(callback: (progress: AppUpdateProgress) => void): () => void
  onAppUpdateDownloaded(callback: (info: AppUpdateInfo) => void): () => void
  onAppUpdateError(callback: (error: AppUpdateError) => void): () => void
}
