export type ReviewItemId = 'DS-01' | 'DS-02' | 'DS-03'

export type MaterialMultiplicity = 'single' | 'multiple'

export interface MaterialFieldDefinition {
  id: string
  label: string
  description: string
  required: boolean
  extensions: string[]
  multiplicity: MaterialMultiplicity
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
}

export interface MaterialFileView {
  id: string
  name: string
  sizeLabel: string
}

export interface ReviewItemInput {
  itemId: ReviewItemId
  extraRules: string
  materials: Record<string, MaterialFileView[]>
}

export type ReviewSelection = Partial<Record<ReviewItemId, ReviewItemInput>>

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
  reviewItemIds: ReviewItemId[]
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
  reviewItemIds: ReviewItemId[]
  completedAt: string
  issueCount?: number
  highestSeverity?: 'high' | 'medium' | 'none'
  summary: string
  markdown: string
  reportPath?: string
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
  advanceTasks(): Promise<PreviewCommandResult>
  openReport(reportId: string): Promise<PreviewCommandResult>
  closeReport(): Promise<PreviewCommandResult>
  viewPdfReport(reportId: string): Promise<PreviewCommandResult>
  openReportFeedback?(reportId: string): Promise<PreviewCommandResult>
  submitNegativeReportFeedback?(reportId: string): Promise<PreviewCommandResult>
  openTaskLog?(taskId: string): Promise<PreviewCommandResult>
  chooseFeedbackScreenshot(currentScreenshotIds?: string[]): Promise<FeedbackScreenshotView>
  submitFeedback(input: SubmitFeedbackCommand): Promise<PreviewCommandResult>
  chooseMaterial(
    itemId: ReviewItemId,
    fieldId: string,
    currentFileIds?: string[]
  ): Promise<MaterialFileView>
  dismissNotice(): Promise<void>
}

export interface WorkbenchAdapter {
  getViewModel(): WorkbenchViewModel
  subscribe(listener: (viewModel: WorkbenchViewModel) => void): () => void
  commands: WorkbenchCommands
}
