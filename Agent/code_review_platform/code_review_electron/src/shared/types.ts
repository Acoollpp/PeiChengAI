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

export type GpioTaskStatus =
  | 'created'
  | 'uploaded'
  | 'analyzing'
  | 'needs_confirmation'
  | 'success'
  | 'failed'

export interface GpioUploadedFile {
  file_name: string
  file_path: string
  content_type?: string | null
  file_size: number
}

export interface GpioTask {
  id: string
  user_id?: string
  user_name?: string | null
  svn_username?: string | null
  manual_svn_url: string
  code_svn_url: string
  status: GpioTaskStatus
  uploaded_files: GpioUploadedFile[]
  recognition_summary?: Record<string, unknown> | null
  result_path?: string | null
  result_name?: string | null
  error_message?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
}

export interface GpioTasksResponse {
  data: GpioTask[]
  count: number
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
