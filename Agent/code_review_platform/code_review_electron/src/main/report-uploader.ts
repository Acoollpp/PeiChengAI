import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import type { ApiClient } from './api-client'
import { stripReviewReportOutputMetadata } from '../shared/review-report-metadata'

export interface ReportUploadApi {
  uploadReport: ApiClient['uploadReport']
}

export interface PdfReportUploadApi {
  uploadPdfReport: ApiClient['uploadPdfReport']
}

export interface RequirementFileUploadApi {
  uploadRequirementFile: ApiClient['uploadRequirementFile']
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
  reportPath: string,
  preparedReportContent?: string
): Promise<unknown> => {
  const reportContent =
    preparedReportContent ?? (await prepareReportForPublishing(reportPath))

  return api.uploadReport(token, taskId, {
    report_content: reportContent,
    report_path: reportPath,
    report_name: basename(reportPath)
  })
}

export const prepareReportForPublishing = async (reportPath: string): Promise<string> => {
  await ensureReportReady(reportPath)

  const originalReport = await readFile(reportPath, 'utf8')
  const cleanedReport = stripReviewReportOutputMetadata(originalReport)
  if (!cleanedReport.trim()) {
    throw new Error(`审查报告为空：${reportPath}`)
  }
  if (cleanedReport !== originalReport) {
    await writeFile(reportPath, cleanedReport, 'utf8')
  }

  return cleanedReport
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

export const ensureRequirementFileReady = async (filePath: string): Promise<void> => {
  let requirementStat

  try {
    requirementStat = await stat(filePath)
  } catch {
    throw new Error(`产品开发需求表不存在：${filePath}`)
  }

  if (!requirementStat.isFile() || requirementStat.size <= 0) {
    throw new Error(`产品开发需求表为空：${filePath}`)
  }
}

export const uploadRequirementFile = async (
  api: RequirementFileUploadApi,
  token: string,
  taskId: string,
  filePath: string
): Promise<unknown> => {
  await ensureRequirementFileReady(filePath)

  const fileContent = await readFile(filePath)

  return api.uploadRequirementFile(token, taskId, {
    file_content: fileContent,
    file_name: basename(filePath)
  })
}
