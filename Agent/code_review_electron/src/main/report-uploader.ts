import { readFile, stat } from 'node:fs/promises'

import type { ApiClient } from './api-client'

export interface ReportUploadApi {
  uploadReport: ApiClient['uploadReport']
}

export const ensureReportReady = async (reportPath: string): Promise<void> => {
  let reportStat

  try {
    reportStat = await stat(reportPath)
  } catch {
    throw new Error(`审查报告不存在：${reportPath}`)
  }

  if (!reportStat.isFile() || reportStat.size <= 0) {
    throw new Error(`审查报告为空：${reportPath}`)
  }
}

export const uploadReportFile = async (
  api: ReportUploadApi,
  token: string,
  taskId: string,
  reportPath: string
): Promise<unknown> => {
  await ensureReportReady(reportPath)

  const reportContent = await readFile(reportPath, 'utf8')

  return api.uploadReport(token, taskId, {
    report_content: reportContent,
    report_path: reportPath
  })
}
