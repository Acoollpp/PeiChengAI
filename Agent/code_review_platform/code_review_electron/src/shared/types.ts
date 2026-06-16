import type { ReviewTemplateKey } from './review-templates'

export type EnvironmentStatus =
  | 'ready'
  | 'missing_codex'
  | 'missing_svn'
  | 'missing_skill'
  | 'failed'

export type EnvironmentProgressStage = 'installing_skill'

export interface EnvironmentProgressEvent {
  stage: EnvironmentProgressStage
}

export interface SyncedSkill {
  id: string
  name: string
  version: string
  package_path: string
  installed_at: string
}

export interface CurrentUser {
  id: string
  full_name?: string | null
  svn_username?: string | null
  department_id?: string | null
  department_name?: string | null
  role?: 'admin' | 'user'
}

export interface DepartmentPublic {
  id: string
  name: string
  description?: string | null
  is_active: boolean
}

export interface DepartmentsResponse {
  data: DepartmentPublic[]
  count: number
}

export type ReviewTaskStatus =
  | 'created'
  | 'checking_environment'
  | 'running_codex'
  | 'uploading_report'
  | 'success'
  | 'failed'
  | 'environment_error'
  | 'cancelled'

export interface ReviewTask {
  id: string
  svn_url: string
  old_revision: string
  new_revision: string
  template_key?: ReviewTemplateKey
  skill_name?: string
  department_id?: string | null
  department_name?: string | null
  focus_direction_id?: string | null
  focus_direction_snapshot?: string | null
  requirement_file_name?: string | null
  requirement_file_size?: number | null
  requirement_file_sha256?: string | null
  status: ReviewTaskStatus
  report_path?: string
  pdf_report_path?: string
  pdf_report_name?: string
  started_at?: string | null
  finished_at?: string | null
  error_message?: string
  progress_message?: string
  codex_log?: TaskProgressEvent[]
}

export type TaskProgressStage =
  | 'created'
  | 'checking_environment'
  | 'preparing_workspace'
  | 'running_codex'
  | 'uploading_report'
  | 'success'
  | 'failed'
  | 'environment_error'

export type TaskProgressEvent =
  | {
      taskId: string
      clientTaskId?: string
      type: 'stage'
      stage: TaskProgressStage
      message: string
    }
  | {
      taskId: string
      clientTaskId?: string
      type: 'codex_output'
      stream: 'stdout' | 'stderr'
      message: string
    }
