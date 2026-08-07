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
  role?: 'admin' | 'department_admin' | 'user'
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
  user_id?: string | null
  svn_url: string
  old_revision: string
  new_revision: string
  review_item_ids?: string[] | null
  template_key?: ReviewTemplateKey
  skill_name?: string
  department_id?: string | null
  department_name?: string | null
  focus_direction_id?: string | null
  focus_direction_snapshot?: string | null
  requirement_file_path?: string
  requirement_file_name?: string | null
  requirement_file_size?: number | null
  requirement_file_sha256?: string | null
  status: ReviewTaskStatus
  report_path?: string
  report_name?: string | null
  pdf_report_path?: string
  pdf_report_name?: string | null
  feedback_protocol_version?: number | null
  feedback_submitted_at?: string | null
  issue_count?: number
  evaluated_issue_count?: number
  started_at?: string | null
  finished_at?: string | null
  error_message?: string
  progress_message?: string
  codex_log?: TaskProgressEvent[]
  codex_log_path?: string
  report_feedback_helpful?: boolean | null
  report_feedback_useful_issues_text?: string | null
}

export interface ReviewTaskReportUserStats {
  user_name?: string | null
  svn_username?: string | null
  report_count: number
}

export interface ReviewTaskTrendPoint {
  label: string
  count: number
}

export interface ReviewTaskStats {
  range: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'all'
  total: number
  success: number
  running: number
  failed_or_error: number
  average_duration_seconds?: number | null
  by_status: Partial<Record<ReviewTaskStatus, number>>
  reports_by_user: ReviewTaskReportUserStats[]
  trend: ReviewTaskTrendPoint[]
}

export interface ReviewTaskIssue {
  id: string
  task_id: string
  issue_text: string
  description_text: string
  display_snapshot: string
  order: number
  source: string
  location: {
    start_offset: number
    end_offset: number
    feedback_insertion_offset: number
    anchor_line: number
    heading_level: number
  }
  helpful?: boolean | null
  feedback_text?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ReviewTaskIssuesResponse {
  data: ReviewTaskIssue[]
  count: number
  evaluated_count: number
  feedback_submitted_at?: string | null
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

export interface TaskCompletionNotificationPayload {
  taskId: string
  localTaskId?: string
  svn_url: string
  old_revision: string
  new_revision: string
  reportPath?: string
  pdfPath?: string
  pdfReportName?: string | null
}

export interface ClientUpdatePolicy {
  platform: string
  arch: string
  current_version: string
  active_version: string | null
  minimum_supported_version: string | null
  update_available: boolean
  update_required: boolean
  release_notes?: string | null
}

export type TaskCompletionNotificationResult =
  | {
      status: 'shown'
    }
  | {
      status: 'unsupported'
    }
  | {
      status: 'failed'
      message: string
    }
