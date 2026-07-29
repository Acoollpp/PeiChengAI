import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

import type { ApiClient } from './api-client'
import { generatePdfReport, type GeneratePdfReportResult } from './report-pdf-generator'
import {
  ensurePdfReportReady,
  extractRelativeImagePaths,
  uploadPdfReportFile
} from './report-uploader'
import type { RuntimePaths } from './runtime-paths'
import { composeIssueFeedbackMarkdown } from '../shared/issue-feedback-markdown'
import type { SubmitIssueFeedbackResult } from '../shared/report-feedback-window'
import type { ReviewTask } from '../shared/types'

type IssueFeedbackSubmissionApi = Pick<
  ApiClient,
  | 'readTask'
  | 'readTaskReport'
  | 'readTaskIssues'
  | 'downloadReportAsset'
  | 'uploadPdfReport'
>

export interface SubmitIssueFeedbackDependencies {
  api: IssueFeedbackSubmissionApi
  token: string
  taskId: string
  runtimePaths: RuntimePaths
  generatePdf?: (
    reportPath: string,
    dependencies?: Parameters<typeof generatePdfReport>[1]
  ) => Promise<GeneratePdfReportResult>
}

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}${sep}`)

const safelyDecodeAssetPath = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`PDF生成失败：报告图片路径编码无效：${value}`)
  }
}

const resolveReportFileName = (value: string | null | undefined): string => {
  const fileName = value?.trim()
  if (
    !fileName ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    extname(fileName).toLowerCase() !== '.md'
  ) {
    return '代码审查报告.md'
  }
  return fileName
}

const submittedResult = (
  taskId: string,
  pdfPath: string,
  task: ReviewTask,
  feedbackSubmittedAt: string
): SubmitIssueFeedbackResult => ({
  status: 'submitted',
  taskId,
  feedbackSubmittedAt,
  pdfPath,
  pdfReportName:
    task.pdf_report_name ?? pdfPath.split(/[\\/]/).at(-1) ?? '代码审查报告.pdf'
})

const downloadReportAssets = async (
  api: IssueFeedbackSubmissionApi,
  token: string,
  taskId: string,
  reportPath: string,
  markdown: string
): Promise<void> => {
  const reportDirectory = resolve(dirname(reportPath))
  const imagesDirectory = resolve(reportDirectory, 'images')
  const paths = extractRelativeImagePaths(markdown)
  await mkdir(imagesDirectory, { recursive: true })
  const [realReportDirectory, realImagesDirectory] = await Promise.all([
    realpath(reportDirectory),
    realpath(imagesDirectory)
  ])
  if (!isInsideDirectory(realImagesDirectory, realReportDirectory)) {
    throw new Error('PDF生成失败：报告图片目录不能指向报告目录外')
  }

  for (const rawPath of paths) {
    const decodedPath = safelyDecodeAssetPath(rawPath)
    if (isAbsolute(decodedPath) || decodedPath.includes('\\')) {
      throw new Error(`PDF生成失败：报告图片必须使用安全的相对路径：${rawPath}`)
    }
    const targetPath = resolve(reportDirectory, decodedPath)
    if (!isInsideDirectory(targetPath, imagesDirectory)) {
      throw new Error(`PDF生成失败：报告图片必须位于 images 目录：${rawPath}`)
    }

    const content = await api.downloadReportAsset(token, taskId, decodedPath)
    if (content.byteLength === 0) {
      throw new Error(`PDF生成失败：报告图片为空：${rawPath}`)
    }
    const targetDirectory = dirname(targetPath)
    await mkdir(targetDirectory, { recursive: true })
    const realTargetDirectory = await realpath(targetDirectory)
    if (!isInsideDirectory(realTargetDirectory, realImagesDirectory)) {
      throw new Error(`PDF生成失败：报告图片路径不能指向 images 目录外：${rawPath}`)
    }

    const temporaryPath = join(
      targetDirectory,
      `.${basename(targetPath)}.${randomUUID()}.download`
    )
    try {
      await writeFile(temporaryPath, Buffer.from(content))
      await rm(targetPath, { force: true })
      await rename(temporaryPath, targetPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}

export const submitIssueFeedback = async ({
  api,
  token,
  taskId,
  runtimePaths,
  generatePdf = generatePdfReport
}: SubmitIssueFeedbackDependencies): Promise<SubmitIssueFeedbackResult> => {
  const [task, issueResponse] = await Promise.all([
    api.readTask(token, taskId),
    api.readTaskIssues(token, taskId)
  ])
  if (task.feedback_protocol_version !== 1) {
    throw new Error('当前任务不支持逐问题反馈')
  }
  const existingSubmittedAt =
    task.feedback_submitted_at ?? issueResponse.feedback_submitted_at
  if (existingSubmittedAt) {
    const reportPath = runtimePaths.reportPathForTask(
      taskId,
      resolveReportFileName(task.report_name)
    )
    const pdfPath = reportPath.replace(/\.md$/i, '.pdf')
    await ensurePdfReportReady(pdfPath)
    return submittedResult(taskId, pdfPath, task, existingSubmittedAt)
  }
  if (issueResponse.data.some((issue) => issue.helpful == null)) {
    throw new Error('请先评价所有审查问题')
  }

  const reportPath = runtimePaths.reportPathForTask(
    taskId,
    resolveReportFileName(task.report_name)
  )
  const originalMarkdown = await api.readTaskReport(token, taskId)
  await mkdir(dirname(reportPath), { recursive: true })
  await downloadReportAssets(api, token, taskId, reportPath, originalMarkdown)
  const renderingMarkdown = composeIssueFeedbackMarkdown(
    originalMarkdown,
    issueResponse.data
  )
  const pdf = await generatePdf(reportPath, { markdown: renderingMarkdown })
  let submittedTask: ReviewTask
  try {
    submittedTask = await uploadPdfReportFile(api, token, taskId, pdf.pdfPath)
  } catch (uploadError) {
    let recoveredTask: ReviewTask | undefined
    try {
      const latestTask = await api.readTask(token, taskId)
      if (latestTask.feedback_submitted_at) {
        recoveredTask = latestTask
      }
    } catch {
      // 保留原始上传错误；回查失败不能证明服务端已经完成提交。
    }
    if (!recoveredTask) {
      throw uploadError
    }
    submittedTask = recoveredTask
  }
  if (!submittedTask.feedback_submitted_at) {
    throw new Error('服务端未确认最终反馈提交状态')
  }

  return submittedResult(
    taskId,
    pdf.pdfPath,
    submittedTask,
    submittedTask.feedback_submitted_at
  )
}
