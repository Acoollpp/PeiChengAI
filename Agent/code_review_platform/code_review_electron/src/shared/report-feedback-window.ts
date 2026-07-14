export interface ReportFeedbackOption {
  id: string
  text: string
  anchorId: string
}

export interface ReportFeedbackContext {
  taskId: string
  options: ReportFeedbackOption[]
}

export interface OpenReportFeedbackWindowPayload extends ReportFeedbackContext {}

export interface FocusReportFeedbackAnchorPayload {
  taskId: string
  optionId?: string
}

export interface SubmitHelpfulReportFeedbackPayload {
  taskId: string
  selectedOptionIds: string[]
  manualText: string
}

export interface ReportFeedbackSubmittedEvent {
  taskId: string
  usefulIssuesText: string
}
