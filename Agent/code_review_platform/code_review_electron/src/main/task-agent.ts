import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type { ApiClient, CreateTaskRequest, UpdateTaskStatusRequest } from './api-client'
import {
  buildDirectCommandOptions,
  checkEnvironment,
  type EnvironmentCheckResult
} from './environment-checker'
import { buildReviewPrompt, CodexReviewError, runCodexReview, type CodexErrorCode } from './codex-runner'
import { generatePdfReport, type GeneratePdfReportResult } from './report-pdf-generator'
import {
  prepareReportForPublishing,
  uploadPdfReportFile,
  uploadReportFile,
  uploadRequirementFile
} from './report-uploader'
import { getRuntimePaths } from './runtime-paths'
import {
  runSvnPreflight,
  SvnPreflightError,
  type SvnPreflightInput
} from './svn-preflight'
import { resolveReviewReportFileName, type RunSvnLog } from './svn-report-name-resolver'
import { CODEX_REVIEW_LOG_FILE_NAME } from './task-log'
import { buildBmsReviewTaskPrompt } from './review-task-prompt'
import { prepareReviewTaskMaterials } from './review-task-materials'
import {
  buildCustomReviewRetryInputs,
  getCustomReviewRetrySnapshot,
  hasPartialCustomReviewRetrySnapshot
} from '../shared/custom-review-retry'
import {
  BMS_CODE_REVIEW_SKILL_NAME,
  resolveReviewItemInputs,
  type ResolvedReviewItemInput,
  type SelectedReviewItemInput
} from '../shared/review-items'
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

export interface RetryReviewTaskInput {
  token: string
  taskId: string
  clientTaskId?: string
  oldRevision?: string
  newRevision?: string
  requirementFilePath?: string
  reviewItems?: SelectedReviewItemInput[]
  signal?: AbortSignal
}

export interface PreparedWorkspace {
  cwd: string
  reportPath: string
  imagesDir: string
  codexLogPath?: string
  evidenceDir?: string
  requirementFilePath?: string
  reviewItems?: ResolvedReviewItemInput[]
}

export interface PrepareWorkspaceInput {
  taskId: string
  svnUrl: string
  oldRevision: string
  newRevision: string
  svnCommand: string
  requirementFilePath?: string
  reviewItems?: ResolvedReviewItemInput[]
  generatedAt?: Date
  runSvnLog?: RunSvnLog
}

export interface RunCodexInput {
  cwd: string
  reportPath: string
  imagesDir: string
  requirementFilePath?: string
  reviewItems?: ResolvedReviewItemInput[]
  oldRevision?: string
  newRevision?: string
  skillName: string
  task: ReviewTask
  evidenceDir?: string
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
  codexLogPath?: string
  feedbackProtocolVersion?: number | null
  serverTask?: ReviewTask
}

export interface TaskAgentApi {
  createTask(token: string, payload: CreateTaskRequest): Promise<unknown>
  readTask?: ApiClient['readTask']
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
  preflightSvn: (input: SvnPreflightInput) => Promise<void>
  prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>
  runCodex: (input: RunCodexInput) => Promise<unknown>
  prepareReport: (reportPath: string) => Promise<string>
  generatePdfReport: (reportPath: string) => Promise<GeneratePdfReportResult>
  uploadRequirementFile: (token: string, taskId: string, filePath: string) => Promise<unknown>
  uploadReport: (
    token: string,
    taskId: string,
    reportPath: string,
    reportContent?: string
  ) => Promise<unknown>
  uploadPdfReport: (token: string, taskId: string, pdfPath: string) => Promise<unknown>
}

export type TaskProgressReporter = (event: TaskProgressEvent) => void

export const CODEX_REVIEW_TIMEOUT_MS = 90 * 60 * 1000

const environmentErrorMessages: Record<Exclude<EnvironmentStatus, 'ready'>, string> = {
  missing_codex: '本机 Codex CLI 不可用，请联系管理员处理。',
  missing_svn: '本机 SVN CLI 不可用，请联系管理员处理。',
  missing_skill: '本机代码审查 Skill 不可用，请联系管理员处理。',
  failed: '本机审查环境检查失败，请联系管理员处理。'
}

const feedbackProtocolVersionFromUpload = (result: unknown): number | null | undefined => {
  if (typeof result !== 'object' || result === null || !('feedback_protocol_version' in result)) {
    return undefined
  }
  const version = result.feedback_protocol_version
  return typeof version === 'number' || version === null ? version : undefined
}

const reviewTaskStatuses = new Set<ReviewTaskStatus>([
  'created',
  'checking_environment',
  'running_codex',
  'uploading_report',
  'success',
  'failed',
  'environment_error',
  'cancelled'
])

const reviewTaskFromUpload = (result: unknown, taskId: string): ReviewTask | undefined => {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('id' in result) ||
    result.id !== taskId ||
    !('svn_url' in result) ||
    typeof result.svn_url !== 'string' ||
    !('old_revision' in result) ||
    typeof result.old_revision !== 'string' ||
    !('new_revision' in result) ||
    typeof result.new_revision !== 'string' ||
    !('status' in result) ||
    typeof result.status !== 'string' ||
    !reviewTaskStatuses.has(result.status as ReviewTaskStatus)
  ) {
    return undefined
  }

  return result as ReviewTask
}

export const getEnvironmentErrorMessage = (status: Exclude<EnvironmentStatus, 'ready'>): string =>
  environmentErrorMessages[status]

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
  svnCommand,
  requirementFilePath,
  reviewItems,
  generatedAt,
  runSvnLog
}: PrepareWorkspaceInput): Promise<PreparedWorkspace> => {
  const runtimePaths = await getRuntimePaths()
  const cwd = runtimePaths.workspaceForTask(taskId)
  const imagesDir = runtimePaths.imagesDirForTask(taskId)
  const preparedReviewItems = reviewItems
    ? await prepareReviewTaskMaterials(reviewItems, join(cwd, 'materials'))
    : undefined
  const reportFileName = await resolveReviewReportFileName({
    svnCommand,
    svnUrl,
    oldRevision,
    newRevision,
    generatedAt,
    runSvnLog
  })

  await mkdir(cwd, { recursive: true })
  await mkdir(imagesDir, { recursive: true })
  const evidenceDir = await prepareEvidenceDir(runtimePaths.evidenceDirForTask?.(taskId))
  const workspaceRequirementFilePath = await prepareRequirementFile(
    reviewItems ? undefined : requirementFilePath,
    join(cwd, 'requirements')
  )

  return {
    cwd,
    reportPath: runtimePaths.reportPathForTask(taskId, reportFileName),
    imagesDir,
    codexLogPath:
      runtimePaths.codexLogPathForTask?.(taskId) ?? join(cwd, CODEX_REVIEW_LOG_FILE_NAME),
    ...(evidenceDir ? { evidenceDir } : {}),
    requirementFilePath: workspaceRequirementFilePath,
    ...(preparedReviewItems ? { reviewItems: preparedReviewItems } : {})
  }
}

// 证据目录必须交给 Skill 一个空目录：acquire-svn-evidence.ps1 拒绝非空输出目录，
// 而重试复用同一任务 ID，不清空会让每次重试都失败。
const prepareEvidenceDir = async (evidenceDir: string | undefined): Promise<string | undefined> => {
  if (!evidenceDir) {
    return undefined
  }

  await rm(evidenceDir, { recursive: true, force: true })
  await mkdir(evidenceDir, { recursive: true })
  return evidenceDir
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
  reviewItems,
  oldRevision,
  newRevision,
  skillName,
  task,
  evidenceDir,
  clientTaskId,
  signal,
  onProgress
}: RunCodexInput): Promise<void> => {
  const prompt = reviewItems?.length
    ? buildBmsReviewTaskPrompt({
        svnUrl: task.svn_url,
        oldRevision: oldRevision ?? task.old_revision,
        newRevision: newRevision ?? task.new_revision,
        departmentName: task.department_name ?? undefined,
        reviewItems,
        reportPath,
        evidenceDir
      })
    : buildReviewPrompt({
        svnUrl: task.svn_url,
        oldRevision: task.old_revision,
        newRevision: task.new_revision,
        reportPath,
        imagesDir,
        skillName,
        requirementFilePath,
        departmentName: task.department_name ?? undefined,
        focusDirectionSnapshot: task.focus_direction_snapshot ?? undefined,
        evidenceDir
      })

  await runCodexReview({
    cwd,
    prompt,
    timeoutMs: CODEX_REVIEW_TIMEOUT_MS,
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
  preflightSvn: runSvnPreflight,
  prepareWorkspace: defaultPrepareWorkspace,
  runCodex: defaultRunCodex,
  prepareReport: prepareReportForPublishing,
  generatePdfReport,
  uploadRequirementFile: (token, taskId, filePath) =>
    uploadRequirementFile(api, token, taskId, filePath),
  uploadReport: (token, taskId, reportPath, reportContent) =>
    uploadReportFile(api, token, taskId, reportPath, reportContent),
  uploadPdfReport: (token, taskId, pdfPath) => uploadPdfReportFile(api, token, taskId, pdfPath)
})

export const executeReviewTask = async (
  input: ExecuteReviewTaskInput,
  dependencies: TaskAgentDependencies,
  onProgress?: TaskProgressReporter
): Promise<ExecuteReviewTaskResult> => {
  throwIfCancelled(input.signal)
  const reviewItems = input.request.review_items
    ? resolveReviewItemInputs(input.request.review_items)
    : undefined
  let createRequest: CreateTaskRequest = input.request
  if (reviewItems) {
    const {
      review_items: _localReviewItems,
      requirement_file_path: _legacyRequirementFilePath,
      requirement_file_name: _legacyRequirementFileName,
      custom_review_rule: _customReviewRule,
      custom_review_mode: _customReviewMode,
      has_custom_review_word_material: _hasCustomReviewWordMaterial,
      has_custom_review_excel_material: _hasCustomReviewExcelMaterial,
      has_custom_review_pdf_material: _hasCustomReviewPdfMaterial,
      ...serverRequest
    } = input.request
    const customReview = reviewItems.find((item) => item.id === 'DS-99')
    if (
      customReview?.custom_mode === 'dual_revision' &&
      /^r?0$/i.test(input.request.old_revision.trim())
    ) {
      throw new Error('DS-99 变更代码审查模式不能使用旧 revision 0 或 r0。')
    }
    const customMaterialFieldIds = new Set(
      customReview?.materials
        .filter((material) => material.filePaths.length > 0)
        .map((material) => material.fieldId) ?? []
    )
    createRequest = {
      ...serverRequest,
      skill_name: BMS_CODE_REVIEW_SKILL_NAME,
      review_item_ids: reviewItems.map((item) => item.id),
      ...(customReview
        ? {
            custom_review_rule: customReview.user_extra_rules,
            custom_review_mode: customReview.custom_mode,
            has_custom_review_word_material: customMaterialFieldIds.has('word-materials'),
            has_custom_review_excel_material: customMaterialFieldIds.has('excel-materials'),
            has_custom_review_pdf_material: customMaterialFieldIds.has('pdf-materials')
          }
        : {})
    }
  }
  const task = toReviewTask(await dependencies.api.createTask(input.token, createRequest))
  emitStage(onProgress, task.id, input.clientTaskId, 'created', '任务已创建')

  return runExistingReviewTask({
    token: input.token,
    task,
    skillName: input.request.skill_name,
    reviewItems,
    oldRevision: input.request.old_revision,
    newRevision: input.request.new_revision,
    requirementFilePath: reviewItems ? undefined : input.request.requirement_file_path,
    clientTaskId: input.clientTaskId,
    signal: input.signal
  }, dependencies, onProgress)
}

export const retryReviewTask = async (
  input: RetryReviewTaskInput,
  dependencies: TaskAgentDependencies,
  onProgress?: TaskProgressReporter
): Promise<ExecuteReviewTaskResult> => {
  throwIfCancelled(input.signal)
  if (!dependencies.api.readTask) {
    throw new Error('当前服务端客户端不支持读取审查任务')
  }
  const task = toReviewTask(await dependencies.api.readTask(input.token, input.taskId))
  const customReviewSnapshot = getCustomReviewRetrySnapshot(task)
  const oldRevision = input.oldRevision ?? task.old_revision
  if (
    customReviewSnapshot?.mode === 'dual_revision' &&
    /^r?0$/i.test(oldRevision.trim())
  ) {
    throw new Error('DS-99 变更代码审查模式不能使用旧 revision 0 或 r0。')
  }
  const hasPartialCustomReviewSnapshot = hasPartialCustomReviewRetrySnapshot(task)
  if (!customReviewSnapshot && hasPartialCustomReviewSnapshot) {
    throw new Error('DS-99 历史任务输入快照不完整，无法安全重试，请新建审查任务。')
  }
  const isLegacyCustomReviewTask =
    !customReviewSnapshot &&
    !hasPartialCustomReviewSnapshot &&
    task.review_item_ids?.includes('DS-99')
  const reviewItems = customReviewSnapshot
    ? resolveReviewItemInputs(
        buildCustomReviewRetryInputs(task, customReviewSnapshot, input.reviewItems)
      )
    : input.reviewItems
      ? resolveReviewItemInputs(input.reviewItems)
      : isLegacyCustomReviewTask
        ? undefined
        : task.review_item_ids?.length
        ? resolveReviewItemInputs(task.review_item_ids.map((id) => ({ id })))
        : undefined
  return runExistingReviewTask({
    token: input.token,
    task,
    reviewItems,
    oldRevision,
    newRevision: input.newRevision,
    requirementFilePath: reviewItems ? undefined : input.requirementFilePath,
    restartMessage: '任务重新启动',
    clientTaskId: input.clientTaskId,
    signal: input.signal
  }, dependencies, onProgress)
}

const runExistingReviewTask = async (
  input: {
    token: string
    task: ReviewTask
    skillName?: string
    reviewItems?: ResolvedReviewItemInput[]
    oldRevision?: string
    newRevision?: string
    requirementFilePath?: string
    restartMessage?: string
    clientTaskId?: string
    signal?: AbortSignal
  },
  dependencies: TaskAgentDependencies,
  onProgress?: TaskProgressReporter
): Promise<ExecuteReviewTaskResult> => {
  const task = input.task
  const oldRevision = input.oldRevision ?? task.old_revision
  const newRevision = input.newRevision ?? task.new_revision

  try {
    throwIfCancelled(input.signal)
    const skillName = input.reviewItems?.length
      ? BMS_CODE_REVIEW_SKILL_NAME
      : resolveSkillName(input.skillName, task.skill_name)

    await updateStatus(dependencies, input.token, task.id, {
      status: 'checking_environment',
      error_message: null
    })
    if (input.restartMessage) {
      emitStage(
        onProgress,
        task.id,
        input.clientTaskId,
        'checking_environment',
        input.restartMessage
      )
    }
    emitStage(onProgress, task.id, input.clientTaskId, 'checking_environment', '检查本机环境')

    const environment = await dependencies.checkEnvironment()
    throwIfCancelled(input.signal)

    if (environment.status !== 'ready') {
      const environmentError =
        environment.codegraphError ?? environmentErrorMessages[environment.status]
      await updateStatus(dependencies, input.token, task.id, {
        status: 'environment_error',
        error_message: environmentError
      })
      emitStage(
        onProgress,
        task.id,
        input.clientTaskId,
        'environment_error',
        environmentError
      )

      return { taskId: task.id, status: 'environment_error' }
    }

    if (!environment.svnPath) {
      throw new Error('环境检查已通过但未返回 SVN CLI 路径')
    }

    emitStage(
      onProgress,
      task.id,
      input.clientTaskId,
      'checking_environment',
      '校验 SVN 地址和版本'
    )
    await dependencies.preflightSvn({
      svnUrl: task.svn_url,
      oldRevision,
      newRevision,
      svnCommand: environment.svnPath,
      commandOptions: buildDirectCommandOptions(),
      signal: input.signal
    })
    throwIfCancelled(input.signal)

    emitStage(onProgress, task.id, input.clientTaskId, 'preparing_workspace', '准备任务工作区')
    const workspace = await dependencies.prepareWorkspace({
      taskId: task.id,
      svnUrl: task.svn_url,
      oldRevision,
      newRevision,
      svnCommand: environment.svnPath,
      ...(input.requirementFilePath
        ? { requirementFilePath: input.requirementFilePath }
        : {}),
      ...(input.reviewItems ? { reviewItems: input.reviewItems } : {})
    })
    throwIfCancelled(input.signal)

    const reviewItemsForCodex = input.reviewItems
      ? workspace.reviewItems ?? (input.reviewItems.some((item) => item.materials.length > 0)
        ? undefined
        : input.reviewItems)
      : undefined
    if (input.reviewItems && !reviewItemsForCodex) {
      throw new Error('审查材料工作区准备结果缺失，未启动 Codex。')
    }

    if (!input.reviewItems && workspace.requirementFilePath) {
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

    await updateStatus(dependencies, input.token, task.id, {
      status: 'running_codex'
    })
    emitStage(onProgress, task.id, input.clientTaskId, 'running_codex', '启动 Codex 执行审查 Skill')

    const { requirementFilePath: _legacyWorkspaceRequirementFilePath, ...bmsWorkspace } = workspace
    await dependencies.runCodex({
      ...(input.reviewItems ? bmsWorkspace : workspace),
      skillName,
      task,
      ...(reviewItemsForCodex
        ? {
            reviewItems: reviewItemsForCodex,
            oldRevision,
            newRevision
          }
        : {}),
      clientTaskId: input.clientTaskId,
      signal: input.signal,
      onProgress: withClientTaskId(onProgress, input.clientTaskId)
    })
    throwIfCancelled(input.signal)

    await updateStatus(dependencies, input.token, task.id, {
      status: 'uploading_report'
    })
    emitStage(onProgress, task.id, input.clientTaskId, 'uploading_report', '上传审查报告')

    const reportMarkdown = await dependencies.prepareReport(workspace.reportPath)
    throwIfCancelled(input.signal)
    const uploadResult = await dependencies.uploadReport(
      input.token,
      task.id,
      workspace.reportPath,
      reportMarkdown
    )
    const feedbackProtocolVersion = feedbackProtocolVersionFromUpload(uploadResult)
    const serverTask = reviewTaskFromUpload(uploadResult, task.id)
    throwIfCancelled(input.signal)
    emitStage(onProgress, task.id, input.clientTaskId, 'success', '审查完成')
    return {
      taskId: task.id,
      status: 'success',
      reportMarkdown,
      reportPath: workspace.reportPath,
      ...(workspace.codexLogPath ? { codexLogPath: workspace.codexLogPath } : {}),
      ...(feedbackProtocolVersion === undefined ? {} : { feedbackProtocolVersion }),
      ...(serverTask ? { serverTask } : {})
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
      : error instanceof SvnPreflightError
        ? toSvnPreflightUserMessage(error, {
            old_revision: oldRevision,
            new_revision: newRevision
          })
        : toUserFacingErrorMessage(sanitizeErrorSummary(error, input.token))

    await updateStatus(dependencies, input.token, task.id, {
      status: 'failed',
      error_message: errorMessage
    })
    emitStage(onProgress, task.id, input.clientTaskId, 'failed', errorMessage)

    throw new Error(errorMessage)
  }
}

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new ReviewTaskCancelledError()
  }
}

const isCancelledError = (error: unknown): boolean =>
  error instanceof ReviewTaskCancelledError ||
  (error instanceof SvnPreflightError && error.code === 'CANCELLED') ||
  (error instanceof Error && error.message === '任务已取消')

export const toSvnPreflightUserMessage = (
  error: SvnPreflightError,
  task: Pick<ReviewTask, 'old_revision' | 'new_revision'>
): string => {
  switch (error.code) {
    case 'NEW_REVISION_UNAVAILABLE':
      return `新版本 ${task.new_revision} 在该 SVN 地址下不存在或不可访问。`
    case 'OLD_REVISION_UNAVAILABLE':
      return `旧版本 ${task.old_revision} 在该 SVN 地址下不存在或不可访问。`
    case 'SVN_URL_UNAVAILABLE':
      return 'SVN 地址不存在或不可访问。'
    case 'AUTHENTICATION_FAILED':
      return 'SVN 认证失败，请先在本机 SVN 客户端更新登录凭据。'
    case 'PERMISSION_DENIED':
      return '当前 SVN 账号无权访问该地址或版本，请联系管理员开通权限。'
    case 'NETWORK_FAILED':
      return '无法连接 SVN 服务，请检查网络后重试。'
    case 'TIMEOUT':
      return 'SVN 地址或版本校验超时，请检查网络后重试。'
    case 'CLI_START_FAILED':
      return 'SVN CLI 启动失败，请联系管理员处理。'
    case 'INVALID_ARGUMENT':
      return 'SVN 地址或版本参数无效，请检查后重试。'
    case 'INVALID_REVISION_ORDER':
      return 'SVN 新旧版本范围无效，请确保旧版本小于新版本。'
    case 'CANCELLED':
      return '任务已取消'
  }
}

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

export const toUserFacingErrorMessage = (message: string): string => {
  if (/Codex review timed out after \d+ms/.test(message)) {
    return 'Codex 审查超过 90 分钟仍未完成，请稍后重试或联系管理员。'
  }

  if (message.includes('审查报告不存在')) {
    return 'SVN权限不足（或者SVN账号未登录）'
  }

  if (/Codex review failed with exit code 1:/.test(message)) {
    return 'Codex报错请检查Codex对话后重试。'
  }

  return message
}
