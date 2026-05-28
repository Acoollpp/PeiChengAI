export type EnvironmentStatus =
  | 'ready'
  | 'missing_codex'
  | 'missing_svn'
  | 'missing_skill'
  | 'failed'

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
  status: ReviewTaskStatus
  report_path?: string
  error_message?: string
}
