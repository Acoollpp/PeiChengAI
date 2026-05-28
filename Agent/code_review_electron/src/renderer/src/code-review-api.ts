import type { EnvironmentStatus, ReviewTaskStatus } from '../../shared/types'

export interface RegisterRequest {
  server_url: string
  full_name: string
  svn_username: string
  svn_password: string
}

export interface LoginRequest {
  server_url: string
  svn_username: string
  svn_password: string
}

export interface RememberedCredentials {
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

export interface DownloadCurrentReportResult {
  status: 'ready' | 'missing'
  taskId?: string
  reportPath?: string
}

export interface CodeReviewApi {
  register(payload: RegisterRequest): Promise<unknown>
  login(payload: LoginRequest): Promise<unknown>
  saveCredentials(payload: RememberedCredentials): Promise<unknown>
  loadCredentials(): Promise<RememberedCredentials | null>
  clearCredentials(): Promise<unknown>
  loadServerConfig(): Promise<{ server_url: string }>
  executeTask(payload: ExecuteTaskRequest): Promise<ExecuteTaskResult>
  downloadCurrentReport(): Promise<DownloadCurrentReportResult>
  installSkill(): Promise<EnvironmentCheckResult>
  checkEnvironment(): Promise<EnvironmentCheckResult>
}
