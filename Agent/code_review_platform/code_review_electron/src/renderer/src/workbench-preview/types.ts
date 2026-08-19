import type { CustomReviewMode, ReviewItemId } from '../../../shared/review-items'

export type { ReviewItemId } from '../../../shared/review-items'

export type MaterialMultiplicity = 'single' | 'multiple'

export interface MaterialFieldDefinition {
  id: string
  label: string
  description: string
  required: boolean
  extensions: string[]
  multiplicity: MaterialMultiplicity
  maxFiles?: number
  maxFileBytes?: number
}

export interface ReviewItemDefinition {
  id: ReviewItemId
  category: string
  name: string
  summary: string
  goal: string
  process: string[]
  specification: string
  materialFields: MaterialFieldDefinition[]
  customReview?: {
    modes: CustomReviewMode[]
    maxRuleLength: number
    maxTotalMaterialBytes: number
  }
}

export interface MaterialFileView {
  id: string
  name: string
  sizeLabel: string
  sizeBytes?: number
}

export interface ReviewItemInput {
  itemId: ReviewItemId
  extraRules: string
  customMode?: CustomReviewMode
  materials: Record<string, MaterialFileView[]>
}

export type ReviewSelection = Partial<Record<ReviewItemId, ReviewItemInput>>

export interface CustomReviewRetryViewModel {
  taskId: string
  rule: string
  mode: NonNullable<CustomReviewMode>
  materialFields: MaterialFieldDefinition[]
  fixedReviewItems: Array<Pick<ReviewItemDefinition, 'id' | 'name' | 'materialFields'>>
}

export type TaskStage =
  | 'waiting'
  | 'checking_environment'
  | 'preparing_workspace'
  | 'running_review'
  | 'uploading_report'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface StageTrackItem {
  id: Exclude<TaskStage, 'waiting' | 'failed' | 'cancelled'>
  label: string
  state: 'complete' | 'current' | 'upcoming'
}

export interface ReviewTaskViewModel {
  id: string
  title: string
  svnUrl: string
  oldRevision: string
  newRevision: string
  reviewItemIds: string[]
  stage: TaskStage
  stageLabel: string
  message: string
  updatedAt: string
  queueIndex?: number
  phaseTrack: StageTrackItem[]
}

export interface ReviewReportViewModel {
  id: string
  taskId: string
  title: string
  svnUrl: string
  revisionRange: string
  reviewItemIds: string[]
  completedAt: string
  issueCount?: number
  highestSeverity: 'high' | 'medium' | 'low' | 'suggestion' | 'none' | 'unknown'
  summary: string
  markdown: string
  contentStatus?: 'idle' | 'loading' | 'ready' | 'error' | 'parse_error'
  contentMessage?: string
  reportPath?: string
  localReportPath?: string
  feedbackProtocolVersion?: number | null
  feedbackSubmittedAt?: string | null
  reportFeedbackHelpful?: boolean | null
}

export type PreviewScenario = 'active' | 'empty'

export type WorkbenchViewId = 'task-management' | 'report-center' | 'feedback'

export interface FeedbackScreenshotView {
  id: string
  name: string
  sizeLabel: string
  file?: File
}

export interface SubmitFeedbackCommand {
  description: string
  screenshots: FeedbackScreenshotView[]
}

export type WorkbenchTaskStats =
  | { status: 'loading' }
  | {
      status: 'ready'
      range: 'today'
      failedOrError: number
      success: number
    }
  | { status: 'error'; message: string }

export type WorkbenchReportListState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export interface WorkbenchViewModel {
  productName: string
  previewLabel: string
  userName: string
  departmentName: string
  scenarios: Array<{ id: PreviewScenario; label: string }>
  activeScenario: PreviewScenario
  catalog: ReviewItemDefinition[]
  sampleTask: CreateTaskCommand
  tasks: ReviewTaskViewModel[]
  reports: ReviewReportViewModel[]
  selectedReportId?: string
  notice?: string
  noticeAction?: { label: string; reportId: string }
  activeFeedbackAnchorId?: string
  feedbackAnchorScrollRequest?: { anchorId: string; requestId: number }
  mode?: 'preview' | 'production'
  canCreateTask?: boolean
  taskCreationDisabledReason?: string
  requestedView?: { id: WorkbenchViewId; requestId: number }
  customReviewRetry?: CustomReviewRetryViewModel
  taskStats?: WorkbenchTaskStats
  reportListState?: WorkbenchReportListState
}

export interface CreateTaskCommand {
  svnUrl: string
  oldRevision: string
  newRevision: string
  selection: ReviewSelection
}

export interface PreviewCommandResult {
  message: string
}

export interface WorkbenchCommands {
  setScenario(scenario: PreviewScenario): Promise<PreviewCommandResult>
  createTask(input: CreateTaskCommand): Promise<PreviewCommandResult>
  cancelTask(taskId: string): Promise<PreviewCommandResult>
  retryTask(taskId: string): Promise<PreviewCommandResult>
  confirmCustomReviewRetry?(
    taskId: string,
    customMaterials: Record<string, MaterialFileView[]>,
    fixedMaterials: Record<string, Record<string, MaterialFileView[]>>
  ): Promise<PreviewCommandResult>
  cancelCustomReviewRetry?(): Promise<PreviewCommandResult>
  advanceTasks(): Promise<PreviewCommandResult>
  reloadTaskStats?(): Promise<PreviewCommandResult>
  reloadReportList?(): Promise<PreviewCommandResult>
  openReport(reportId: string): Promise<PreviewCommandResult>
  retryReport?(reportId: string): Promise<PreviewCommandResult>
  closeReport(): Promise<PreviewCommandResult>
  viewPdfReport(reportId: string): Promise<PreviewCommandResult>
  openReportFeedback?(reportId: string): Promise<PreviewCommandResult>
  submitNegativeReportFeedback?(reportId: string): Promise<PreviewCommandResult>
  openTaskLog?(taskId: string): Promise<PreviewCommandResult>
  hideTask?(taskId: string): Promise<PreviewCommandResult>
  chooseFeedbackScreenshot(currentScreenshotIds?: string[]): Promise<FeedbackScreenshotView>
  submitFeedback(input: SubmitFeedbackCommand): Promise<PreviewCommandResult>
  chooseMaterial(
    itemId: ReviewItemId,
    fieldId: string,
    currentFileIds?: string[]
  ): Promise<MaterialFileView | null>
  dismissNotice(): Promise<void>
}

export interface WorkbenchAdapter {
  getViewModel(): WorkbenchViewModel
  subscribe(listener: (viewModel: WorkbenchViewModel) => void): () => void
  commands: WorkbenchCommands
}
