import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import log from 'electron-log/main'

import { ApiClient, type CreateTaskRequest } from '../api-client'
import { AuthStore } from '../auth-store'
import { checkEnvironment, type EnvironmentCheckResult } from '../environment-checker'
import { generatePdfReport } from '../report-pdf-generator'
import {
  prepareReportForPublishing,
  ReportUploadRecoveryError,
  type PdfReportUploadApi,
  type ReportUploadApi,
  type RequirementFileUploadApi,
  uploadPdfReportFile,
  uploadReportFile,
  uploadRequirementFile
} from '../report-uploader'
import {
  ReportUploadRecoveryStore,
  type ReportUploadRecoveryRepository,
  type StoredReportUploadRecovery
} from '../report-upload-recovery-store'
import { createSkillSyncService, type SkillSyncResult } from '../skill-sync'
import { ServerConfigStore } from '../server-config-store'
import {
  defaultPrepareWorkspace,
  defaultRunCodex,
  executeReviewTask,
  retryReviewTask,
  sanitizeErrorSummary,
  toUserFacingErrorMessage,
  type ExecuteReviewTaskResult,
  type TaskAgentDependencies
} from '../task-agent'
import { appendTaskLogEvent, CODEX_REVIEW_LOG_FILE_NAME, flushTaskLog } from '../task-log'
import { runSvnPreflight } from '../svn-preflight'
import type { SelectedReviewItemInput } from '../../shared/review-items'
import type { TaskProgressEvent } from '../../shared/types'
import {
  REPORT_IMAGE_DECRYPTION_REQUIRED_MESSAGE,
  REPORT_IMAGE_INVALID_UTF8,
  type ReportUploadRecovery
} from '../../shared/report-upload-recovery'
import { ActiveTaskRegistry, type ActiveReviewTaskRun } from './active-task-registry'

export type ReviewTaskRunCommand =
  | {
      kind: 'create'
      clientTaskId?: string
      request: CreateTaskRequest
    }
  | {
      kind: 'retry'
      clientTaskId?: string
      taskId: string
      oldRevision?: string
      newRevision?: string
      requirementFilePath?: string
      reviewItems?: SelectedReviewItemInput[]
    }

export interface ActiveReviewTaskReference {
  clientTaskId?: string
  taskId?: string
}

export type CancelTaskResult =
  | { status: 'cancelled' }
  | { status: 'not_found' }

export type ReviewTaskProgressObserver = (event: TaskProgressEvent) => void

/**
 * 审查任务运行的主进程接口。
 *
 * 不变量：
 * 1. clientTaskId 与服务端 taskId 只能作为同一次运行的两个别名。
 * 2. 服务端 taskId 首次出现后，必须先完成内部绑定，再把进度转发给 Renderer。
 * 3. run 返回或抛错前，必须注销全部活动索引并等待日志写入完成。
 * 4. 取消必须幂等；服务端状态写入失败也不能跳过本地资源清理。
 * 5. 本接口不承担 Renderer 队列调度、报告浏览或 Skill 规则解释。
 */
export interface ReviewTaskRuntime {
  run(
    command: ReviewTaskRunCommand,
    onProgress?: ReviewTaskProgressObserver
  ): Promise<ExecuteReviewTaskResult>
  cancel(reference: ActiveReviewTaskReference): Promise<CancelTaskResult>
  retryReportUpload(
    taskId: string,
    onProgress?: ReviewTaskProgressObserver
  ): Promise<ExecuteReviewTaskResult>
  getReportUploadRecovery(
    taskId: string,
    failureCode: string | null | undefined
  ): Promise<ReportUploadRecovery | undefined>
  cancelAll(): Promise<void>
}

export interface ReviewTaskRuntimeOptions {
  // 这些内部装配点只用于组合根和隔离外部副作用的测试，不属于业务调用接口。
  authStore: Pick<AuthStore, 'load'>
  createApiClient: () => Promise<ReviewTaskRuntimeApi>
  syncSkill: (token: string) => Promise<SkillSyncResult>
  checkEnvironment?: () => Promise<EnvironmentCheckResult>
  preflightSvn?: TaskAgentDependencies['preflightSvn']
  prepareWorkspace?: typeof defaultPrepareWorkspace
  runCodex?: typeof defaultRunCodex
  prepareReport?: TaskAgentDependencies['prepareReport']
  generatePdfReport?: TaskAgentDependencies['generatePdfReport']
  uploadRequirementFile?: TaskAgentDependencies['uploadRequirementFile']
  uploadReport?: TaskAgentDependencies['uploadReport']
  uploadPdfReport?: TaskAgentDependencies['uploadPdfReport']
  flushTaskLog?: typeof flushTaskLog
  reportUploadRecoveryStore?: ReportUploadRecoveryRepository
}

export type ReviewTaskRuntimeApi = TaskAgentDependencies['api'] &
  ReportUploadApi &
  PdfReportUploadApi &
  RequirementFileUploadApi

/**
 * 管理 Electron 主进程内一次审查任务运行的身份、取消、资源与日志收尾。
 * 本模块不负责 Renderer 排队、审查报告浏览，也不解释 Skill 内部规则。
 */
export class DefaultReviewTaskRuntime implements ReviewTaskRuntime {
  private readonly registry = new ActiveTaskRegistry()
  private readonly pendingCompletions = new Set<Promise<void>>()
  private readonly reportUploadRecoveryStore: ReportUploadRecoveryRepository
  private readonly pendingReportUploads = new Map<string, Promise<ExecuteReviewTaskResult>>()

  constructor(private readonly options: ReviewTaskRuntimeOptions) {
    this.reportUploadRecoveryStore =
      options.reportUploadRecoveryStore ?? new ReportUploadRecoveryStore()
  }

  async run(
    command: ReviewTaskRunCommand,
    onProgress?: ReviewTaskProgressObserver
  ): Promise<ExecuteReviewTaskResult> {
    const tokens = await this.options.authStore.load()
    if (!tokens) {
      throw new Error('Not authenticated')
    }

    await this.syncSkillForCurrentUser(tokens.access_token)
    if (command.kind === 'retry') {
      await this.clearReportUploadRecovery(command.taskId)
    }
    const api = await this.options.createApiClient()
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    this.pendingCompletions.add(completion)
    const activeTask: ActiveReviewTaskRun = {
      clientTaskId: command.clientTaskId,
      ...(command.kind === 'retry' ? { taskId: command.taskId } : {}),
      token: tokens.access_token,
      api,
      abortController: new AbortController(),
      completion,
      resolveCompletion
    }
    this.registry.register(activeTask)

    let codexLogPath: string | undefined
    const dependencies = this.createTaskDependencies(api, activeTask, (path) => {
      codexLogPath = path
    })
    const reportProgress = (event: TaskProgressEvent): void => {
      if (codexLogPath) {
        void appendTaskLogEvent(codexLogPath, event)
      }
      if (event.taskId) {
        activeTask.taskId = event.taskId
        this.registry.register(activeTask)
      }
      onProgress?.(event)
    }

    try {
      const result = command.kind === 'create'
        ? await executeReviewTask(
            {
              token: tokens.access_token,
              request: command.request,
              clientTaskId: command.clientTaskId,
              signal: activeTask.abortController.signal
            },
            dependencies,
            reportProgress
          )
        : await retryReviewTask(
            {
              token: tokens.access_token,
              taskId: command.taskId,
              clientTaskId: command.clientTaskId,
              oldRevision: command.oldRevision,
              newRevision: command.newRevision,
              requirementFilePath: command.requirementFilePath,
              reviewItems: command.reviewItems,
              signal: activeTask.abortController.signal
            },
            dependencies,
            reportProgress
          )
      await this.syncReportUploadRecovery(result)
      return result
    } finally {
      this.registry.unregister(activeTask)
      // 日志写入由进度回调异步触发；运行结束前必须 flush，避免任务已返回而日志仍缺行。
      try {
        await (this.options.flushTaskLog ?? flushTaskLog)(codexLogPath)
      } finally {
        activeTask.resolveCompletion()
        this.pendingCompletions.delete(activeTask.completion)
      }
    }
  }

  retryReportUpload(
    taskId: string,
    onProgress?: ReviewTaskProgressObserver
  ): Promise<ExecuteReviewTaskResult> {
    const existing = this.pendingReportUploads.get(taskId)
    if (existing) return existing

    const operation = this.retryReportUploadOnce(taskId, onProgress).finally(() => {
      if (this.pendingReportUploads.get(taskId) === operation) {
        this.pendingReportUploads.delete(taskId)
      }
    })
    this.pendingReportUploads.set(taskId, operation)
    return operation
  }

  async getReportUploadRecovery(
    taskId: string,
    failureCode: string | null | undefined
  ): Promise<ReportUploadRecovery | undefined> {
    if (failureCode !== REPORT_IMAGE_INVALID_UTF8) return undefined
    const source = await this.reportUploadRecoveryStore.load(taskId)
    if (!source) return this.toRecovery([], 'other_client')
    if (source.status === 'source_missing') {
      return this.toRecovery(source.assetPaths, 'source_missing')
    }
    return this.toRecovery(source.record.assetPaths, 'ready')
  }

  async cancel(reference: ActiveReviewTaskReference): Promise<CancelTaskResult> {
    const activeTask = this.registry.find(reference)
    if (!activeTask) {
      return { status: 'not_found' }
    }
    return this.cancelActiveTask(activeTask)
  }

  async cancelAll(): Promise<void> {
    const pendingOperations: Promise<unknown>[] = [
      ...this.registry.uniqueTasks().map((activeTask) => this.cancelActiveTask(activeTask)),
      ...this.pendingCompletions
    ]
    await Promise.allSettled(pendingOperations)
  }

  private async retryReportUploadOnce(
    taskId: string,
    onProgress?: ReviewTaskProgressObserver
  ): Promise<ExecuteReviewTaskResult> {
    const tokens = await this.options.authStore.load()
    if (!tokens) throw new Error('Not authenticated')
    const api = await this.options.createApiClient()
    const source = await this.reportUploadRecoveryStore.load(taskId)
    if (!source) {
      return {
        taskId,
        status: 'uploading_report',
        reportUploadRecovery: this.toRecovery([], 'other_client')
      }
    }
    if (source.status === 'source_missing') {
      return {
        taskId,
        status: 'uploading_report',
        reportUploadRecovery: this.toRecovery(source.assetPaths, 'source_missing')
      }
    }

    const record = source.record
    onProgress?.({
      taskId,
      type: 'stage',
      stage: 'uploading_report',
      message: '重新检测并上传报告'
    })
    const prepareReport = this.options.prepareReport ?? prepareReportForPublishing
    const uploadReport =
      this.options.uploadReport ??
      ((token: string, id: string, reportPath: string, reportContent?: string) =>
        uploadReportFile(api, token, id, reportPath, reportContent))
    let reportMarkdown: string
    try {
      reportMarkdown = await prepareReport(record.reportPath)
      await uploadReport(tokens.access_token, taskId, record.reportPath, reportMarkdown)
    } catch (error) {
      if (error instanceof ReportUploadRecoveryError) {
        const updatedRecord = { ...record, assetPaths: error.assetPaths }
        await this.persistRecovery(updatedRecord)
        await api.updateTaskStatus(tokens.access_token, taskId, {
          status: 'uploading_report',
          error_message: REPORT_IMAGE_DECRYPTION_REQUIRED_MESSAGE,
          report_upload_failure_code: REPORT_IMAGE_INVALID_UTF8
        })
        return {
          taskId,
          status: 'uploading_report',
          reportPath: record.reportPath,
          reportUploadRecovery: this.toRecovery(error.assetPaths, 'ready')
        }
      }

      const serverTask = api.readTask
        ? await api.readTask(tokens.access_token, taskId).catch(() => undefined)
        : undefined
      if (serverTask?.status === 'success') {
        await this.clearReportUploadRecovery(taskId)
        return {
          taskId,
          status: 'success',
          reportPath: record.reportPath,
          serverTask
        }
      }
      const errorMessage = toUserFacingErrorMessage(
        sanitizeErrorSummary(error, tokens.access_token)
      )
      await api.updateTaskStatus(tokens.access_token, taskId, {
        status: 'failed',
        error_message: errorMessage
      })
      await this.clearReportUploadRecovery(taskId)
      throw new Error(errorMessage)
    }

    await this.clearReportUploadRecovery(taskId)
    return {
      taskId,
      status: 'success',
      reportMarkdown,
      reportPath: record.reportPath
    }
  }

  private toRecovery(
    assetPaths: string[],
    availability: ReportUploadRecovery['availability']
  ): ReportUploadRecovery {
    return {
      failureCode: REPORT_IMAGE_INVALID_UTF8,
      stage: 'uploading_report',
      assetPaths,
      availability
    }
  }

  private async syncReportUploadRecovery(result: ExecuteReviewTaskResult): Promise<void> {
    if (result.reportUploadRecovery && result.reportPath) {
      await this.persistRecovery({
        taskId: result.taskId,
        reportPath: result.reportPath,
        failureCode: result.reportUploadRecovery.failureCode,
        assetPaths: result.reportUploadRecovery.assetPaths
      })
      return
    }
    await this.clearReportUploadRecovery(result.taskId)
  }

  private async persistRecovery(record: StoredReportUploadRecovery): Promise<void> {
    try {
      await this.reportUploadRecoveryStore.save(record)
    } catch (error) {
      log.error('[REPORT_UPLOAD_RECOVERY_SAVE_FAILED]', {
        taskId: record.taskId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async clearReportUploadRecovery(taskId: string): Promise<void> {
    try {
      await this.reportUploadRecoveryStore.remove(taskId)
    } catch (error) {
      log.warn('[REPORT_UPLOAD_RECOVERY_REMOVE_FAILED]', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async syncSkillForCurrentUser(token: string): Promise<void> {
    try {
      await this.options.syncSkill(token)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
  }

  private createTaskDependencies(
    api: ReviewTaskRuntimeApi,
    activeTask: ActiveReviewTaskRun,
    setLogPath: (path: string) => void
  ): TaskAgentDependencies {
    const prepareWorkspace = this.options.prepareWorkspace ?? defaultPrepareWorkspace
    return {
      api,
      checkEnvironment: this.options.checkEnvironment ?? checkEnvironment,
      preflightSvn: this.options.preflightSvn ?? runSvnPreflight,
      prepareWorkspace: async (input) => {
        activeTask.taskId = input.taskId
        this.registry.register(activeTask)
        const workspace = await prepareWorkspace(input)
        activeTask.workspaceDir = workspace.cwd
        activeTask.evidenceDir = workspace.evidenceDir
        const logPath = workspace.codexLogPath ?? join(workspace.cwd, CODEX_REVIEW_LOG_FILE_NAME)
        setLogPath(logPath)
        return { ...workspace, codexLogPath: logPath }
      },
      runCodex: this.options.runCodex ?? defaultRunCodex,
      prepareReport: this.options.prepareReport ?? prepareReportForPublishing,
      generatePdfReport: this.options.generatePdfReport ?? generatePdfReport,
      uploadRequirementFile:
        this.options.uploadRequirementFile ??
        ((token, taskId, filePath) => uploadRequirementFile(api, token, taskId, filePath)),
      uploadReport:
        this.options.uploadReport ??
        ((token, taskId, reportPath, reportContent) =>
          uploadReportFile(api, token, taskId, reportPath, reportContent)),
      uploadPdfReport:
        this.options.uploadPdfReport ??
        ((token, taskId, pdfPath) => uploadPdfReportFile(api, token, taskId, pdfPath))
    }
  }

  private cancelActiveTask(activeTask: ActiveReviewTaskRun): Promise<{ status: 'cancelled' }> {
    if (activeTask.cancelPromise) {
      return activeTask.cancelPromise
    }

    activeTask.cancelPromise = (async () => {
      activeTask.abortController.abort()
      let statusError: unknown
      if (activeTask.taskId) {
        try {
          await activeTask.api.updateTaskStatus(activeTask.token, activeTask.taskId, {
            status: 'cancelled',
            error_message: '任务已取消'
          })
        } catch (error) {
          statusError = error
        }
      }

      // 先等待运行停止并完成日志 flush，再删除目录，避免迟到日志重新创建已清理的工作区。
      await activeTask.completion
      // 证据目录为规避 Windows MAX_PATH 位于工作区外，取消时必须分别清理两个目录。
      await this.deleteDirectory(activeTask.workspaceDir)
      await this.deleteDirectory(activeTask.evidenceDir)
      if (statusError) {
        throw statusError
      }
      return { status: 'cancelled' as const }
    })()

    return activeTask.cancelPromise
  }

  private async deleteDirectory(directory: string | undefined): Promise<void> {
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

export const createDefaultReviewTaskRuntime = (): ReviewTaskRuntime => {
  const authStore = new AuthStore()
  const serverConfigStore = new ServerConfigStore()
  const createApiClient = async (): Promise<ApiClient> => {
    const config = await serverConfigStore.load()
    return new ApiClient(config.server_url)
  }
  return new DefaultReviewTaskRuntime({
    authStore,
    createApiClient,
    syncSkill: async (token) => {
      const service = await createSkillSyncService(await createApiClient())
      return service.sync(token)
    }
  })
}
