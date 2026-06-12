import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import type { ApiClient } from './api-client'

export interface ReportUploadApi {
  uploadReport: ApiClient['uploadReport']
}

export interface PdfReportUploadApi {
  uploadPdfReport: ApiClient['uploadPdfReport']
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
    report_path: reportPath,
    report_name: basename(reportPath)
  })
}

export const ensurePdfReportReady = async (pdfPath: string): Promise<void> => {
  let reportStat

  try {
    reportStat = await stat(pdfPath)
  } catch {
    throw new Error(`PDF报告不存在：${pdfPath}`)
  }

  if (!reportStat.isFile() || reportStat.size <= 0) {
    throw new Error(`PDF报告为空：${pdfPath}`)
  }
}

export const uploadPdfReportFile = async (
  api: PdfReportUploadApi,
  token: string,
  taskId: string,
  pdfPath: string
): Promise<unknown> => {
  await ensurePdfReportReady(pdfPath)

  const pdfContent = await readFile(pdfPath)

  return api.uploadPdfReport(token, taskId, {
    pdf_content: pdfContent,
    pdf_name: basename(pdfPath)
  })
}
