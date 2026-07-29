import { contextBridge, ipcRenderer } from 'electron'

import type { ReportFeedbackWindowApi } from '../renderer/src/report-feedback-api'

const reportFeedbackApi: ReportFeedbackWindowApi = {
  getContext: () => ipcRenderer.invoke('report-feedback-window:get-context'),
  focusAnchor: (payload) => ipcRenderer.invoke('report-feedback-window:focus-anchor', payload),
  submit: (payload) => ipcRenderer.invoke('report-feedback-window:submit', payload),
  saveIssueDraft: (payload) =>
    ipcRenderer.invoke('report-feedback-window:save-issue-draft', payload),
  submitIssueFeedback: (payload) =>
    ipcRenderer.invoke('report-feedback-window:submit-issues', payload),
  close: () => ipcRenderer.invoke('report-feedback-window:close')
}

contextBridge.exposeInMainWorld('reportFeedback', reportFeedbackApi)
