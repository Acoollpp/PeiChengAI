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

export interface CodeReviewApi {
  keyLogin(payload: KeyLoginRequest): Promise<unknown>
  svnLogin(payload: SvnLoginRequest): Promise<unknown>
  saveCredentials(payload: RememberedCredentials): Promise<unknown>
  loadCredentials(): Promise<RememberedCredentials | null>
  clearCredentials(): Promise<unknown>
  loadServerConfig(): Promise<{ server_url: string }>
  listTasks(): Promise<ReviewTasksResponse>
  readTaskReport(taskId: string): Promise<string>
  executeTask(payload: ExecuteTaskRequest): Promise<ExecuteTaskResult>
  onTaskProgress(callback: (event: TaskProgressEvent) => void): () => void
  downloadCurrentReport(): Promise<DownloadCurrentReportResult>
  installSkill(): Promise<EnvironmentCheckResult>
  checkEnvironment(): Promise<EnvironmentCheckResult>
}
