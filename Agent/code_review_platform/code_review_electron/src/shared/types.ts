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
      type: 'stage'
      stage: TaskProgressStage
      message: string
    }
  | {
      taskId: string
      type: 'codex_output'
      stream: 'stdout' | 'stderr'
      message: string
    }
