import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type { ApiClient, CreateTaskRequest, UpdateTaskStatusRequest } from './api-client'
import { checkEnvironment, type EnvironmentCheckResult } from './environment-checker'
import { buildReviewPrompt, CodexReviewError, runCodexReview, type CodexErrorCode } from './codex-runner'
import { generatePdfReport, type GeneratePdfReportResult } from './report-pdf-generator'
import {
  ensureReportReady,
  uploadPdfReportFile,
  uploadReportFile,
  uploadRequirementFile
} from './report-uploader'
import { getRuntimePaths } from './runtime-paths'
import { resolveReviewReportFileName, type RunSvnLog } from './svn-report-name-resolver'
import type {
  EnvironmentStatus,
  ReviewTask,
  ReviewTaskStatus,
  TaskProgressEvent,
  TaskProgressStage
} from '../shared/types'

export interface ExecuteReviewTaskInput {
  token: string
  request: CreateTaskRequest
  clientTaskId?: string
  signal?: AbortSignal
}

export interface PreparedWorkspace {
  cwd: string
  reportPath: string
  imagesDir: string
  requirementFilePath?: string
}

export interface PrepareWorkspaceInput {
  taskId: string
  svnUrl: string
  oldRevision: string
  newRevision: string
  requirementFilePath?: string
  generatedAt?: Date
  runSvnLog?: RunSvnLog
}

export interface RunCodexInput {
  cwd: string
  reportPath: string
  imagesDir: string
  requirementFilePath?: string
  skillName: string
  task: ReviewTask
  clientTaskId?: string
  signal?: AbortSignal
  onProgress?: TaskProgressReporter
}

export interface ExecuteReviewTaskResult {
  taskId: string
  status: ReviewTaskStatus
  reportMarkdown?: string
  reportPath?: string
  pdfPath?: string
  pdfReportName?: string
}

export interface TaskAgentApi {
  createTask(token: string, payload: CreateTaskRequest): Promise<unknown>
  updateTaskStatus(
    token: string,
    taskId: string,
    payload: UpdateTaskStatusRequest
  ): Promise<unknown>
  uploadReport?: ApiClient['uploadReport']
  uploadRequirementFile?: ApiClient['uploadRequirementFile']
}

export interface TaskAgentDependencies {
  api: TaskAgentApi
  checkEnvironment: () => Promise<EnvironmentCheckResult>
  prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>
  runCodex: (input: RunCodexInput) => Promise<unknown>
  generatePdfReport: (reportPath: string) => Promise<GeneratePdfReportResult>
  uploadRequirementFile: (token: string, taskId: string, filePath: string) => Promise<unknown>
  uploadReport: (token: string, taskId: string, reportPath: string) => Promise<unknown>
  uploadPdfReport: (token: string, taskId: string, pdfPath: string) => Promise<unknown>
}

export type TaskProgressReporter = (event: TaskProgressEvent) => void

const environmentErrorMessages: Record<Exclude<EnvironmentStatus, 'ready'>, string> = {
  missing_codex: '本机 Codex CLI 不可用，请联系管理员处理。',
  missing_svn: '本机 SVN CLI 不可用，请联系管理员处理。',
  missing_skill: '本机代码审查 Skill 不可用，请联系管理员处理。',
  failed: '本机审查环境检查失败，请联系管理员处理。'
}

const codexErrorMessages: Record<CodexErrorCode, string> = {
  SVN_ERROR: 'SVN 操作失败，请检查项目路径和版本号是否正确。',
  SKILL_ERROR: '代码审查 Skill 执行异常，请联系管理员处理。',
  PARAM_ERROR: '输入参数无效，请检查项目路径、版本号等信息。',
  REPORT_ERROR: '审查报告生成失败，请重试或联系管理员。',
  INTERNAL_ERROR: 'Codex 执行过程中发生内部错误。',
}

const allowedRequirementExtensions = new Set(['.xls', '.xlsx'])

export class ReviewTaskCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'ReviewTaskCancelledError'
  }
}

const toReviewTask = (value: unknown): ReviewTask => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  ) {
    return value as ReviewTask
  }

  throw new Error('创建审查任务失败：服务端未返回任务 ID')
}

export const defaultPrepareWorkspace = async ({
  taskId,
  svnUrl,
  oldRevision,
  newRevision,
  requirementFilePath,
  generatedAt,
  runSvnLog
}: PrepareWorkspaceInput): Promise<PreparedWorkspace> => {
  const runtimePaths = await getRuntimePaths()
  const cwd = runtimePaths.workspaceForTask(taskId)
  const imagesDir = runtimePaths.imagesDirForTask(taskId)
  const reportFileName = await resolveReviewReportFileName({
    svnUrl,
    oldRevision,
    newRevision,
    generatedAt,
    runSvnLog
  })

  await mkdir(cwd, { recursive: true })
  await mkdir(imagesDir, { recursive: true })
  const workspaceRequirementFilePath = await prepareRequirementFile(
    requirementFilePath,
    join(cwd, 'requirements')
  )

  return {
    cwd,
    reportPath: runtimePaths.reportPathForTask(taskId, reportFileName),
    imagesDir,
    requirementFilePath: workspaceRequirementFilePath
  }
}

export const prepareRequirementFile = async (
  sourcePath: string | undefined,
  destinationDir: string
): Promise<string | undefined> => {
  const trimmed = sourcePath?.trim()
  if (!trimmed) {
    return undefined
  }

  const sourceStat = await stat(trimmed).catch(() => {
    throw new Error('产品开发需求表不存在，请检查文件路径。')
  })
  if (!sourceStat.isFile()) {
    throw new Error('产品开发需求表路径不是文件，请重新选择。')
  }
  if (sourceStat.size <= 0) {
    throw new Error('产品开发需求表为空，请重新选择。')
  }

  const extension = extname(trimmed).toLowerCase()
  if (!allowedRequirementExtensions.has(extension)) {
    throw new Error('产品开发需求表仅支持 .xls 或 .xlsx 文件。')
  }

  await mkdir(destinationDir, { recursive: true })
  const targetPath = join(destinationDir, basename(trimmed))
  await copyFile(trimmed, targetPath).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`产品开发需求表复制失败，请检查文件权限后重试。${message}`)
  })

  return targetPath
}

export const defaultRunCodex = async ({
  cwd,
  reportPath,
  imagesDir,
  requirementFilePath,
  skillName,
  task,
  clientTaskId,
  signal,
  onProgress
}: RunCodexInput): Promise<void> => {
  await runCodexReview({
    cwd,
    prompt: buildReviewPrompt({
      svnUrl: task.svn_url,
      oldRevision: task.old_revision,
      newRevision: task.new_revision,
      reportPath,
      imagesDir,
      skillName,
      requirementFilePath,
      departmentName: task.department_name ?? undefined,
      focusDirectionSnapshot: task.focus_direction_snapshot ?? undefined
    }),
    timeoutMs: 30 * 60 * 1000,
    signal,
    onOutput: (event) =>
      onProgress?.({
        taskId: task.id,
        clientTaskId,
        type: 'codex_output',
        stream: event.stream,
        message: event.text
      })
  })
}

export const createTaskAgentDependencies = (api: ApiClient): TaskAgentDependencies => ({
  api,
  checkEnvironment,
  prepareWorkspace: defaultPrepareWorkspace,
  runCodex: defaultRunCodex,
  generatePdfReport,
  uploadRequirementFile: (token, taskId, filePath) =>
    uploadRequirementFile(api, token, taskId, filePath),
  uploadReport: (token, taskId, reportPath) => uploadReportFile(api, token, taskId, reportPath),
  uploadPdfReport: (token, taskId, pdfPath) => uploadPdfReportFile(api, token, taskId, pdfPath)
})

export const executeReviewTask = async (
  input: ExecuteReviewTaskInput,
  dependencies: TaskAgentDependencies,
  onProgress?: TaskProgressReporter
): Promise<ExecuteReviewTaskResult> => {
  throwIfCancelled(input.signal)
  const task = toReviewTask(await dependencies.api.createTask(input.token, input.request))
  emitStage(onProgress, task.id, input.clientTaskId, 'created', '任务已创建')

  try {
    throwIfCancelled(input.signal)
    const skillName = resolveSkillName(input.request.skill_name, task.skill_name)

    emitStage(onProgress, task.id, input.clientTaskId, 'checking_environment', '检查本机环境')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'checking_environment'
    })

    const environment = await dependencies.checkEnvironment()
    throwIfCancelled(input.signal)

    if (environment.status !== 'ready') {
      emitStage(
        onProgress,
        task.id,
        input.clientTaskId,
        'environment_error',
        environmentErrorMessages[environment.status]
      )
      await updateStatus(dependencies, input.token, task.id, {
        status: 'environment_error',
        error_message: environmentErrorMessages[environment.status]
      })

      return { taskId: task.id, status: 'environment_error' }
    }

    emitStage(onProgress, task.id, input.clientTaskId, 'preparing_workspace', '准备任务工作区')
    const workspace = await dependencies.prepareWorkspace({
      taskId: task.id,
      svnUrl: task.svn_url,
      oldRevision: task.old_revision,
      newRevision: task.new_revision,
      requirementFilePath: input.request.requirement_file_path
    })
    throwIfCancelled(input.signal)

    if (workspace.requirementFilePath) {
      try {
        await dependencies.uploadRequirementFile(input.token, task.id, workspace.requirementFilePath)
      } catch {
        emitStage(
          onProgress,
          task.id,
          input.clientTaskId,
          'preparing_workspace',
          '产品开发需求表归档失败，审查将继续执行。'
        )
      }
      throwIfCancelled(input.signal)
    }

    emitStage(onProgress, task.id, input.clientTaskId, 'running_codex', '启动 Codex 执行审查 Skill')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'running_codex'
    })

    await dependencies.runCodex({
      ...workspace,
      skillName,
      task,
      clientTaskId: input.clientTaskId,
      signal: input.signal,
      onProgress: withClientTaskId(onProgress, input.clientTaskId)
    })
    throwIfCancelled(input.signal)

    emitStage(onProgress, task.id, input.clientTaskId, 'uploading_report', '上传审查报告')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'uploading_report'
    })

    await ensureReportReady(workspace.reportPath)
    throwIfCancelled(input.signal)
    const pdfResult = await dependencies.generatePdfReport(workspace.reportPath)
    throwIfCancelled(input.signal)
    await dependencies.uploadReport(input.token, task.id, workspace.reportPath)
    throwIfCancelled(input.signal)
    await dependencies.uploadPdfReport(input.token, task.id, pdfResult.pdfPath)
    throwIfCancelled(input.signal)
    const reportMarkdown = await readFile(workspace.reportPath, 'utf8')

    emitStage(onProgress, task.id, input.clientTaskId, 'success', '审查完成')
    return {
      taskId: task.id,
      status: 'success',
      reportMarkdown,
      reportPath: workspace.reportPath,
      pdfPath: pdfResult.pdfPath,
      pdfReportName: basename(pdfResult.pdfPath)
    }
  } catch (error) {
    if (isCancelledError(error) || input.signal?.aborted) {
      await updateStatus(dependencies, input.token, task.id, {
        status: 'cancelled',
        error_message: '任务已取消'
      })
      return { taskId: task.id, status: 'cancelled' }
    }

    const errorMessage = error instanceof CodexReviewError
      ? `${codexErrorMessages[error.errorCode]}（Codex 分析：${error.message}）`
      : sanitizeErrorSummary(error, input.token)

    await updateStatus(dependencies, input.token, task.id, {
      status: 'failed',
      error_message: errorMessage
    })
    emitStage(onProgress, task.id, input.clientTaskId, 'failed', errorMessage)

    throw error
  }
}

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new ReviewTaskCancelledError()
  }
}

const isCancelledError = (error: unknown): boolean =>
  error instanceof ReviewTaskCancelledError ||
  (error instanceof Error && error.message === '任务已取消')

const resolveSkillName = (
  requestSkillName: string | undefined,
  taskSkillName: string | undefined
): string => {
  const skillName = requestSkillName?.trim() || taskSkillName?.trim()

  if (!skillName) {
    throw new Error('未选择审查模板 Skill')
  }

  return skillName
}

const emitStage = (
  onProgress: TaskProgressReporter | undefined,
  taskId: string,
  clientTaskId: string | undefined,
  stage: TaskProgressStage,
  message: string
): void => {
  onProgress?.({
    taskId,
    clientTaskId,
    type: 'stage',
    stage,
    message
  })
}

const withClientTaskId = (
  onProgress: TaskProgressReporter | undefined,
  clientTaskId: string | undefined
): TaskProgressReporter | undefined =>
  onProgress
    ? (event) => {
        onProgress({
          ...event,
          clientTaskId: event.clientTaskId ?? clientTaskId
        })
      }
    : undefined

const updateStatus = (
  dependencies: TaskAgentDependencies,
  token: string,
  taskId: string,
  payload: UpdateTaskStatusRequest
): Promise<unknown> => dependencies.api.updateTaskStatus(token, taskId, payload)

const sanitizeErrorSummary = (error: unknown, token: string): string => {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const withoutToken = token ? rawMessage.split(token).join('[redacted]') : rawMessage

  return withoutToken
    .replace(
      /\b(password|svn_password|secret|token|access_token|refresh_token)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator} [redacted]`
    )
    .replace(/\bBearer\s+("[^"]*"|'[^']*'|[^\s,;]+)/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z]:\\[^\s:]+/g, '[路径已隐藏]')
    .replace(/\/[^\s:]+/g, '[路径已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}
