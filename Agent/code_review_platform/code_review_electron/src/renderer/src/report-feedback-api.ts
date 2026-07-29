import type {
  FocusReportFeedbackAnchorPayload,
  PrepareIssueFeedbackSubmissionPayload,
  PrepareIssueFeedbackSubmissionResult,
  ReportFeedbackContext,
  ReportFeedbackSubmittedEvent,
  SaveIssueFeedbackDraftPayload,
  SubmitHelpfulReportFeedbackPayload
} from '../../shared/report-feedback-window'
import type { ReviewTaskIssue } from '../../shared/types'

export interface ReportFeedbackWindowApi {
  getContext(): Promise<ReportFeedbackContext>
  focusAnchor(payload: FocusReportFeedbackAnchorPayload): Promise<true>
  submit(payload: SubmitHelpfulReportFeedbackPayload): Promise<ReportFeedbackSubmittedEvent>
  saveIssueDraft(payload: SaveIssueFeedbackDraftPayload): Promise<ReviewTaskIssue>
  prepareIssueSubmit(
    payload: PrepareIssueFeedbackSubmissionPayload
  ): Promise<PrepareIssueFeedbackSubmissionResult>
  close(): Promise<true>
}

declare global {
  interface Window {
    reportFeedback: ReportFeedbackWindowApi
  }
}

export type ReportFeedbackWindowApiFromWindow = Window['reportFeedback']
