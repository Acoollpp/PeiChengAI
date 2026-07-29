export interface ReportFeedbackOption {
  id: string
  text: string
  anchorId: string
}

export interface LegacyReportFeedbackContext {
  mode?: 'legacy'
  taskId: string
  options: ReportFeedbackOption[]
}

export interface IssueFeedbackAnchor {
  order: number
  anchorId: string
}

export interface IssueFeedbackItem {
  id: string
  issueText: string
  descriptionText: string
  order: number
  helpful: boolean | null
  feedbackText: string
  anchorId?: string
}

export interface IssueReportFeedbackContext {
  mode: 'issues'
  taskId: string
  issues: IssueFeedbackItem[]
  feedbackSubmittedAt: string | null
}

export type ReportFeedbackContext = LegacyReportFeedbackContext | IssueReportFeedbackContext

export type OpenReportFeedbackWindowPayload =
  | LegacyReportFeedbackContext
  | {
      mode: 'issues'
      taskId: string
      anchors: IssueFeedbackAnchor[]
    }

export interface FocusReportFeedbackAnchorPayload {
  taskId: string
  optionId?: string
}

export interface SubmitHelpfulReportFeedbackPayload {
  taskId: string
  selectedOptionIds: string[]
  manualText: string
}

export interface SaveIssueFeedbackDraftPayload {
  taskId: string
  issueId: string
  helpful: boolean | null
  feedbackText: string
}

export interface PrepareIssueFeedbackSubmissionPayload {
  taskId: string
}

export interface PrepareIssueFeedbackSubmissionResult {
  status: 'ready'
}

export interface ReportFeedbackSubmittedEvent {
  taskId: string
  helpful: boolean
  usefulIssuesText: string | null
}
