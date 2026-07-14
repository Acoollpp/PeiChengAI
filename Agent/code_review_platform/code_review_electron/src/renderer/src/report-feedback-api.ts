import type {
  FocusReportFeedbackAnchorPayload,
  ReportFeedbackContext,
  ReportFeedbackSubmittedEvent,
  SubmitHelpfulReportFeedbackPayload
} from '../../shared/report-feedback-window'

export interface ReportFeedbackWindowApi {
  getContext(): Promise<ReportFeedbackContext>
  focusAnchor(payload: FocusReportFeedbackAnchorPayload): Promise<true>
  submit(payload: SubmitHelpfulReportFeedbackPayload): Promise<ReportFeedbackSubmittedEvent>
  close(): Promise<true>
}

declare global {
  interface Window {
    reportFeedback: ReportFeedbackWindowApi
  }
}

export type ReportFeedbackWindowApiFromWindow = Window['reportFeedback']
