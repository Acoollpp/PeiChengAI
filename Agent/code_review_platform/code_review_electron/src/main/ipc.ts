import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

import { dialog, ipcMain, Notification, shell, type BrowserWindow } from 'electron'

import {
  ApiClient,
  ApiError,
  type CreateTaskRequest,
  type FeedbackResult,
  type KeyLoginRequest,
  type SubmitReportFeedbackRequest,
  type SubmitFeedbackRequest,
  type SvnLoginRequest
} from './api-client'
import { createAppUpdateService, type AppUpdateService } from './app-updater'
import { AuthStore } from './auth-store'
import { installCodexCli } from './codex-cli-installer'
import { installSvnCli } from './svn-cli-installer'
import { CredentialStore, type RememberedCredentials } from './credential-store'
import { checkEnvironment } from './environment-checker'
import type {
  FocusReportFeedbackAnchorPayload,
  IssueFeedbackSubmittedEvent,
  OpenReportFeedbackWindowPayload,
  SubmitIssueFeedbackPayload,
  SubmitIssueFeedbackResult,
  ReportFeedbackContext,
  ReportFeedbackSubmittedEvent,
  SaveIssueFeedbackDraftPayload,
  SubmitHelpfulReportFeedbackPayload,
  ReportFeedbackOption
} from '../shared/report-feedback-window'
import type {
  CurrentUser,
  DepartmentsResponse,
  EnvironmentProgressEvent,
  ReviewTaskIssue,
  TaskCompletionNotificationPayload,
  TaskCompletionNotificationResult
} from '../shared/types'
import { generatePdfReport } from './report-pdf-generator'
import { submitIssueFeedback as submitFinalIssueFeedback } from './issue-feedback-submitter'
import type { ReportFeedbackWindowManager } from './report-feedback-window'
import {
  defaultPrepareWorkspace,
  defaultRunCodex,
  executeReviewTask,
  getEnvironmentErrorMessage,
  retryReviewTask,
  toSvnPreflightUserMessage,
  type ExecuteReviewTaskResult,
  type TaskAgentDependencies
} from './task-agent'
import type { EnvironmentCheckResult } from './environment-checker'
import {
  prepareReportForPublishing,
  uploadPdfReportFile,
  uploadReportFile,
  uploadRequirementFile
} from './report-uploader'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'
import { ServerConfigStore, normalizeServerUrl } from './server-config-store'
import { createSkillSyncService, type SkillSyncResult } from './skill-sync'
import { appendTaskLogEvent, CODEX_REVIEW_LOG_FILE_NAME } from './task-log'
import {
  runSvnPreflight,
  runSvnUrlPreflight,
  SvnPreflightError,
  validateSvnRevisionRange
} from './svn-preflight'
import { buildDirectCommandOptions } from './environment-checker'
import type { TaskPreflightErrorField, TaskPreflightResult } from '../shared/task-preflight'

interface SerializedFeedbackScreenshot {
  name: string
  type: string
  bytes: ArrayBuffer
}

interface SubmitFeedbackIpcPayload {
  description: string
  screenshots?: SerializedFeedbackScreenshot[]
}

export interface IpcHandlerDependencies {
  api?: ApiClient
  authStore?: AuthStore
  credentialStore?: CredentialStore
  serverConfigStore?: ServerConfigStore
  checkEnvironment?: () => Promise<EnvironmentCheckResult>
  preflightSvn?: TaskAgentDependencies['preflightSvn']
  preflightSvnUrl?: typeof runSvnUrlPreflight
  installCodexCli?: () => Promise<EnvironmentCheckResult>
  installSvnCli?: () => Promise<EnvironmentCheckResult>
  syncSkill?: (token: string) => Promise<SkillSyncResult>
  prepareWorkspace?: typeof defaultPrepareWorkspace
  runCodex?: typeof defaultRunCodex
  prepareReport?: TaskAgentDependencies['prepareReport']
  generatePdfReport?: TaskAgentDependencies['generatePdfReport']
  uploadRequirementFile?: TaskAgentDependencies['uploadRequirementFile']
  uploadReport?: TaskAgentDependencies['uploadReport']
  uploadPdfReport?: TaskAgentDependencies['uploadPdfReport']
  runtimePaths?: RuntimePaths
  appUpdateService?: AppUpdateService
  getMainWindow?: () => BrowserWindow | undefined
  getReportFeedbackWindowManager?: () => ReportFeedbackWindowManager | undefined
}

export interface DownloadCurrentReportResult {
  status: 'ready' | 'missing'
  taskId?: string
  reportPath?: string
}

interface OpenPdfReportRequest {
  taskId?: string
  localPdfPath?: string
  pdfReportName?: string
  action?: 'open' | 'reveal'
}

interface OpenPdfReportResult {
  status: 'ready'
  pdfPath: string
}

const activeNotifications = new Set<Notification>()

interface ReadReportAssetRequest {
  reportPath: string
  assetPath: string
}

interface ReadReportAssetResult {
  dataUrl: string
  contentType: string
}

interface CancelTaskRequest {
  client_task_id?: string
  task_id?: string
}

interface RetryTaskRequest {
  task_id: string
  client_task_id?: string
  requirement_file_path?: string
}

interface CancelTaskResult {
  status: 'cancelled' | 'not_found'
}

interface OpenTaskLogRequest {
  taskId: string
}

interface OpenTaskLogResult {
  status: 'ready' | 'missing'
  logPath?: string
}

type SelectRequirementFileResult =
  | {
      status: 'selected'
      filePath: string
    }
  | {
      status: 'cancelled'
    }

interface ActiveReviewTask {
  clientTaskId?: string
  taskId?: string
  token: string
  api: TaskAgentDependencies['api']
  abortController: AbortController
  workspaceDir?: string
  cancelPromise?: Promise<CancelTaskResult>
}

const activeReviewTasks = new Map<string, ActiveReviewTask>()

const registerActiveTask = (task: ActiveReviewTask): void => {
  if (task.clientTaskId) {
    activeReviewTasks.set(task.clientTaskId, task)
  }

  if (task.taskId) {
    activeReviewTasks.set(task.taskId, task)
  }
}

const unregisterActiveTask = (task: ActiveReviewTask): void => {
  if (task.clientTaskId) {
    activeReviewTasks.delete(task.clientTaskId)
  }

  if (task.taskId) {
    activeReviewTasks.delete(task.taskId)
  }
}

const findActiveTask = ({ client_task_id: clientTaskId, task_id: taskId }: CancelTaskRequest):
  | ActiveReviewTask
  | undefined => {
  if (clientTaskId) {
    const task = activeReviewTasks.get(clientTaskId)
    if (task) {
      return task
    }
  }

  if (!taskId) {
    return undefined
  }

  return Array.from(activeReviewTasks.values()).find((task) => task.taskId === taskId)
}

const deleteWorkspace = async (workspaceDir: string | undefined): Promise<void> => {
  if (!workspaceDir) {
    return
  }

  await rm(workspaceDir, { recursive: true, force: true })
}

const cancelActiveReviewTask = async (
  task: ActiveReviewTask
): Promise<CancelTaskResult> => {
  if (task.cancelPromise) {
    return task.cancelPromise
  }

  task.cancelPromise = (async () => {
    task.abortController.abort()
    let statusError: unknown

    if (task.taskId) {
      try {
        await task.api.updateTaskStatus(task.token, task.taskId, {
          status: 'cancelled',
          error_message: '任务已取消'
        })
      } catch (error) {
        statusError = error
      }
    }

    await deleteWorkspace(task.workspaceDir)
    if (statusError) {
      throw statusError
    }

    return { status: 'cancelled' as const }
  })()

  return task.cancelPromise
}

export const cancelAllActiveReviewTasks = async (): Promise<void> => {
  const uniqueTasks = new Set(activeReviewTasks.values())
  await Promise.allSettled(Array.from(uniqueTasks).map((task) => cancelActiveReviewTask(task)))
}

const toSubmitFeedbackRequest = (payload: SubmitFeedbackIpcPayload): SubmitFeedbackRequest => ({
  description: payload.description,
  screenshots: (payload.screenshots ?? []).map(
    (screenshot) => new Blob([screenshot.bytes], { type: screenshot.type })
  ),
  screenshotNames: (payload.screenshots ?? []).map((screenshot) => screenshot.name)
})

const loadAccessToken = async (authStore: AuthStore): Promise<string> => {
  const tokens = await authStore.load()

  if (!tokens) {
    throw new Error('Not authenticated')
  }

  return tokens.access_token
}

const imageContentTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}${sep}`)

const isExistingFile = async (filePath?: string): Promise<boolean> => {
  if (!filePath) {
    return false
  }

  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

const openPdfFile = async (pdfPath: string): Promise<void> => {
  let openError = ''
  try {
    openError = await shell.openPath(pdfPath)
  } catch (error) {
    openError = error instanceof Error ? error.message : '系统无法打开 PDF 报告'
  }

  if (!openError) {
    return
  }

  shell.showItemInFolder(pdfPath)
  throw new Error(`PDF报告打开失败：${openError}`)
}

const presentPdfFile = async (
  pdfPath: string,
  action: OpenPdfReportRequest['action']
): Promise<void> => {
  if (action === 'open') {
    await openPdfFile(pdfPath)
    return
  }
  shell.showItemInFolder(pdfPath)
}

const resolveTrustedTaskWorkspace = (
  taskId: string,
  runtimePaths: RuntimePaths
): { taskWorkspace: string; workspacesDirectory: string } => {
  const workspacesDirectory = resolve(runtimePaths.workspacesDir)
  const taskWorkspace = resolve(runtimePaths.workspaceForTask(taskId))
  if (
    taskWorkspace === workspacesDirectory ||
    !isInsideDirectory(taskWorkspace, workspacesDirectory)
  ) {
    throw new Error('任务工作区路径无效')
  }
  return { taskWorkspace, workspacesDirectory }
}

const resolveTrustedLocalPdfPath = async (
  localPdfPath: string | undefined,
  taskWorkspace: string,
  workspacesDirectory: string
): Promise<string | undefined> => {
  if (!localPdfPath) {
    return undefined
  }

  const resolvedPdfPath = resolve(localPdfPath)
  if (
    extname(resolvedPdfPath).toLowerCase() !== '.pdf' ||
    !isInsideDirectory(resolvedPdfPath, taskWorkspace)
  ) {
    throw new Error('本地 PDF 路径无效')
  }
  if (!(await isExistingFile(resolvedPdfPath))) {
    return undefined
  }

  const [realWorkspacesDirectory, realTaskWorkspace, realPdfPath] = await Promise.all([
    realpath(workspacesDirectory),
    realpath(taskWorkspace),
    realpath(resolvedPdfPath)
  ])
  if (
    !isInsideDirectory(realTaskWorkspace, realWorkspacesDirectory) ||
    !isInsideDirectory(realPdfPath, realTaskWorkspace)
  ) {
    throw new Error('本地 PDF 路径无效')
  }
  return resolvedPdfPath
}

const resolveReportFileName = (
  fileName: string | undefined,
  fallback: string
): { fileName: string; isValidProvidedName: boolean } => {
  const trimmedFileName = fileName?.trim()

  if (
    !trimmedFileName ||
    trimmedFileName.includes('/') ||
    trimmedFileName.includes('\\') ||
    extname(trimmedFileName).toLowerCase() !== '.pdf'
  ) {
    return { fileName: fallback, isValidProvidedName: false }
  }

  return { fileName: trimmedFileName, isValidProvidedName: true }
}

const readReportAsset = async ({
  reportPath,
  assetPath
}: ReadReportAssetRequest): Promise<ReadReportAssetResult> => {
  if (isAbsolute(assetPath)) {
    throw new Error('Report asset must be a relative path')
  }

  const reportDirectory = resolve(dirname(reportPath))
  const assetFilePath = resolve(reportDirectory, assetPath)

  if (!isInsideDirectory(assetFilePath, reportDirectory)) {
    throw new Error('Report asset is outside the report directory')
  }

  const extension = extname(assetFilePath).toLowerCase()
  const contentType = imageContentTypes[extension]

  if (!contentType) {
    throw new Error('Unsupported report asset type')
  }

  const content = await readFile(assetFilePath)
  return {
    dataUrl: `data:${contentType};base64,${content.toString('base64')}`,
    contentType
  }
}

const sendToRenderer = (
  sender: Electron.WebContents | undefined,
  channel: string,
  payload: unknown
): boolean => {
  if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
    return false
  }

  try {
    sender.send(channel, payload)
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes('Object has been destroyed')) {
      return false
    }

    throw error
  }
}

const requireReportFeedbackManager = (
  getManager: () => ReportFeedbackWindowManager | undefined
): ReportFeedbackWindowManager => {
  const manager = getManager()
  if (!manager) {
    throw new Error('反馈窗口尚未初始化')
  }
  return manager
}

const assertMainWindowSender = (
  event: Electron.IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | undefined
): void => {
  if (getMainWindow()?.webContents.id !== event.sender.id) {
    throw new Error('无权调用主窗口反馈通道')
  }
}

const validateReportFeedbackOption = (option: ReportFeedbackOption): void => {
  if (!option?.id?.trim() || !option.text?.trim() || !option.anchorId?.trim()) {
    throw new Error('反馈候选项无效')
  }
}

const validateReportFeedbackContext = (
  payload: OpenReportFeedbackWindowPayload
): OpenReportFeedbackWindowPayload => {
  if (!payload?.taskId?.trim()) {
    throw new Error('反馈窗口上下文无效')
  }

  if (payload.mode === 'issues') {
    if (!Array.isArray(payload.anchors)) {
      throw new Error('反馈窗口上下文无效')
    }
    payload.anchors.forEach((anchor) => {
      if (
        !Number.isInteger(anchor?.order) ||
        anchor.order < 0 ||
        typeof anchor.anchorId !== 'string' ||
        !anchor.anchorId.trim()
      ) {
        throw new Error('反馈问题定位信息无效')
      }
    })
    const orders = payload.anchors.map((anchor) => anchor.order)
    if (new Set(orders).size !== orders.length) {
      throw new Error('反馈问题定位顺序重复')
    }
    return {
      mode: 'issues',
      taskId: payload.taskId,
      anchors: payload.anchors.map((anchor) => ({ ...anchor }))
    }
  }

  if (!Array.isArray(payload.options)) {
    throw new Error('反馈窗口上下文无效')
  }
  payload.options.forEach(validateReportFeedbackOption)
  const optionIds = payload.options.map((option) => option.id)
  if (new Set(optionIds).size !== optionIds.length) {
    throw new Error('反馈候选项 ID 重复')
  }
  return {
    mode: 'legacy',
    taskId: payload.taskId,
    options: payload.options.map((option) => ({ ...option }))
  }
}

const stripFeedbackNumber = (value: string): string =>
  value.replace(/^\s*\d+[\.)、]\s*/, '').trim()

const buildUsefulIssuesText = (
  context: ReportFeedbackContext,
  payload: SubmitHelpfulReportFeedbackPayload
): string => {
  if (context.mode === 'issues') {
    throw new Error('新协议任务不能使用历史报告反馈接口')
  }
  if (payload.taskId !== context.taskId) {
    throw new Error('反馈任务与当前窗口不一致')
  }
  if (!Array.isArray(payload.selectedOptionIds) || typeof payload.manualText !== 'string') {
    throw new Error('反馈提交内容无效')
  }
  if (new Set(payload.selectedOptionIds).size !== payload.selectedOptionIds.length) {
    throw new Error('反馈候选项 ID 重复')
  }

  const selectedIds = new Set(payload.selectedOptionIds)
  const knownIds = new Set(context.options.map((option) => option.id))
  if (payload.selectedOptionIds.some((optionId) => !knownIds.has(optionId))) {
    throw new Error('包含未知反馈候选项 ID')
  }

  const issues = context.options
    .filter((option) => selectedIds.has(option.id))
    .map((option) => stripFeedbackNumber(option.text))
  payload.manualText
    .split(/\r?\n/)
    .map(stripFeedbackNumber)
    .filter(Boolean)
    .forEach((issue) => issues.push(issue))
  const uniqueIssues = issues.filter((issue, index) => issues.indexOf(issue) === index)
  if (uniqueIssues.length === 0) {
    throw new Error('请至少标记或填写一条有用信息')
  }
  return uniqueIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')
}

const validateIssueFeedbackDraft = (
  context: ReportFeedbackContext,
  payload: SaveIssueFeedbackDraftPayload
): SaveIssueFeedbackDraftPayload => {
  if (
    context.mode !== 'issues' ||
    !payload ||
    payload.taskId !== context.taskId ||
    typeof payload.issueId !== 'string' ||
    !payload.issueId.trim() ||
    (payload.helpful !== null && typeof payload.helpful !== 'boolean') ||
    typeof payload.feedbackText !== 'string' ||
    payload.feedbackText.length > 4096
  ) {
    throw new Error('问题反馈草稿无效')
  }
  if (!context.issues.some((issue) => issue.id === payload.issueId)) {
    throw new Error('包含未知审查问题 ID')
  }
  return { ...payload }
}

const buildIssueFeedbackContext = (
  taskId: string,
  response: {
    data: ReviewTaskIssue[]
    feedback_submitted_at?: string | null
  },
  anchors: Array<{ order: number; anchorId: string }>
): ReportFeedbackContext => {
  const anchorByOrder = new Map(anchors.map((anchor) => [anchor.order, anchor.anchorId]))
  return {
    mode: 'issues',
    taskId,
    feedbackSubmittedAt: response.feedback_submitted_at ?? null,
    issues: response.data.map((issue) => ({
      id: issue.id,
      issueText: issue.issue_text,
      descriptionText: issue.description_text,
      order: issue.order,
      helpful: issue.helpful ?? null,
      feedbackText: issue.feedback_text ?? '',
      ...(anchorByOrder.has(issue.order)
        ? { anchorId: anchorByOrder.get(issue.order) }
        : {})
    }))
  }
}

const revisionPattern = /^[rR]?\d+$/

const resolvePreflightErrorField = (
  error: SvnPreflightError,
  payload: Pick<CreateTaskRequest, 'svn_url' | 'old_revision' | 'new_revision'>
): TaskPreflightErrorField => {
  if (error.code === 'NEW_REVISION_UNAVAILABLE' || error.code === 'INVALID_REVISION_ORDER') {
    return 'new_revision'
  }
  if (error.code === 'OLD_REVISION_UNAVAILABLE') {
    return 'old_revision'
  }
  if (error.code === 'INVALID_ARGUMENT') {
    if (!revisionPattern.test(payload.old_revision.trim())) {
      return 'old_revision'
    }
    if (!revisionPattern.test(payload.new_revision.trim())) {
      return 'new_revision'
    }
  }
  return 'svn_url'
}

export const registerIpcHandlers = (dependencies: IpcHandlerDependencies = {}): void => {
  const apiOverride = dependencies.api
  const authStore = dependencies.authStore ?? new AuthStore()
  const credentialStore = dependencies.credentialStore ?? new CredentialStore()
  const serverConfigStore = dependencies.serverConfigStore ?? new ServerConfigStore()
  const appUpdateService =
    dependencies.appUpdateService ?? createAppUpdateService(authStore, serverConfigStore)
  const getMainWindow = dependencies.getMainWindow ?? (() => undefined)
  const getReportFeedbackWindowManager =
    dependencies.getReportFeedbackWindowManager ?? (() => undefined)
  const checkLocalEnvironment = dependencies.checkEnvironment ?? checkEnvironment
  const installLocalCodexCli = dependencies.installCodexCli ?? installCodexCli
  const installLocalSvnCli = dependencies.installSvnCli ?? installSvnCli
  const loadRuntimePaths = async (): Promise<RuntimePaths> =>
    dependencies.runtimePaths ?? (await getRuntimePaths())
  const createApiClient = async (): Promise<ApiClient> => {
    if (apiOverride) {
      return apiOverride
    }

    const config = await serverConfigStore.load()
    return new ApiClient(config.server_url)
  }
  const reportFeedbackQueues = new Map<string, Promise<void>>()
  const issueFeedbackDraftQueues = new Map<string, Promise<void>>()
  const failedIssueFeedbackDrafts = new Set<string>()
  const publishedReportFeedbackTasks = new Set<string>()
  const serializeReportFeedback = <T>(taskId: string, submit: () => Promise<T>): Promise<T> => {
    const previous = reportFeedbackQueues.get(taskId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(submit)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    reportFeedbackQueues.set(taskId, tail)
    void tail.then(() => {
      if (reportFeedbackQueues.get(taskId) === tail) {
        reportFeedbackQueues.delete(taskId)
        publishedReportFeedbackTasks.delete(taskId)
      }
    })
    return result
  }
  const serializeIssueFeedbackDraft = <T>(
    taskId: string,
    issueId: string,
    save: () => Promise<T>
  ): Promise<T> => {
    const key = `${taskId}:${issueId}`
    const previous = issueFeedbackDraftQueues.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(save)
    const tail = result.then(
      () => {
        failedIssueFeedbackDrafts.delete(key)
      },
      () => {
        failedIssueFeedbackDrafts.add(key)
      }
    )
    issueFeedbackDraftQueues.set(key, tail)
    void tail.then(() => {
      if (issueFeedbackDraftQueues.get(key) === tail) {
        issueFeedbackDraftQueues.delete(key)
      }
    })
    return result
  }
  const waitForIssueFeedbackDrafts = async (taskId: string): Promise<void> => {
    const prefix = `${taskId}:`
    while (true) {
      const pending = [...issueFeedbackDraftQueues.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, promise]) => promise)
      if (pending.length === 0) {
        break
      }
      await Promise.all(pending)
    }
    if ([...failedIssueFeedbackDrafts].some((key) => key.startsWith(prefix))) {
      throw new Error('仍有问题反馈草稿保存失败，请重试')
    }
  }
  const submitReportFeedback = (
    taskId: string,
    payload: SubmitReportFeedbackRequest
  ): Promise<ReportFeedbackSubmittedEvent> =>
    serializeReportFeedback(taskId, async () => {
      const token = await loadAccessToken(authStore)
      const api = await createApiClient()
      let helpful: boolean
      let usefulIssuesText: string | null

      try {
        const result = await api.submitReportFeedback(token, taskId, payload)
        helpful = result.helpful
        usefulIssuesText = result.useful_issues_text ?? null
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 409 ||
          !error.message.includes('report_feedback_exists')
        ) {
          throw error
        }

        const task = await api.readTask(token, taskId)
        if (typeof task.report_feedback_helpful !== 'boolean') {
          throw new Error('反馈已存在，但无法确认服务端反馈状态')
        }
        helpful = task.report_feedback_helpful
        usefulIssuesText = task.report_feedback_useful_issues_text ?? null
      }

      const submittedEvent = { taskId, helpful, usefulIssuesText }
      if (!publishedReportFeedbackTasks.has(taskId)) {
        try {
          if (
            sendToRenderer(
              getMainWindow()?.webContents,
              'report-feedback:submitted',
              submittedEvent
            )
          ) {
            publishedReportFeedbackTasks.add(taskId)
          }
        } finally {
          getReportFeedbackWindowManager()?.closeTask?.(taskId)
        }
      }
      return submittedEvent
    })
  const syncSkill =
    dependencies.syncSkill ??
    (async (token: string): Promise<SkillSyncResult> => {
      const api = await createApiClient()
      const service = await createSkillSyncService(api)
      return service.sync(token)
    })
  let latestSuccessfulReport: DownloadCurrentReportResult | null = null
  const notifyEnvironmentProgress = (
    event: Electron.IpcMainInvokeEvent | undefined,
    progress: EnvironmentProgressEvent
  ): void => {
    sendToRenderer(event?.sender, 'environment:progress', progress)
  }

  ipcMain.handle('auth:key-login', async (_event, payload: KeyLoginRequest): Promise<{ needSvnBinding: boolean }> => {
    const serverUrl = normalizeServerUrl(payload.server_url)
    const api = apiOverride ?? new ApiClient(serverUrl)
    const tokens = await api.keyLogin({
      key: payload.key
    })
    await serverConfigStore.save({ server_url: serverUrl })
    await authStore.save(tokens)

    try {
      await api.getSvnCredential(tokens.access_token)
      return { needSvnBinding: false }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return { needSvnBinding: true }
      }
      return { needSvnBinding: true }
    }
  })

  ipcMain.handle('auth:svn-login', async (_event, payload: SvnLoginRequest): Promise<true> => {
    const serverUrl = normalizeServerUrl(payload.server_url)
    const api = apiOverride ?? new ApiClient(serverUrl)
    const tokens = await api.svnLogin({
      svn_username: payload.svn_username,
      svn_password: payload.svn_password
    })
    await serverConfigStore.save({ server_url: serverUrl })
    await authStore.save(tokens)
    return true
  })

  ipcMain.handle('svn:bind-credential', async (_event, body: { svn_username: string; svn_password: string }): Promise<true> => {
    const token = await loadAccessToken(authStore)
    const api = await createApiClient()
    await api.updateSvnCredential(token, body)
    return true
  })

  ipcMain.handle('user:me', async (): Promise<CurrentUser> => {
    const token = await loadAccessToken(authStore)
    const api = await createApiClient()
    return api.readCurrentUser(token)
  })

  ipcMain.handle('department:list-available', async (): Promise<DepartmentsResponse> => {
    const token = await loadAccessToken(authStore)
    const api = await createApiClient()
    return api.listAvailableDepartments(token)
  })

  ipcMain.handle(
    'user:set-department',
    async (_event, body: { department_id: string }): Promise<CurrentUser> => {
      const token = await loadAccessToken(authStore)
      const api = await createApiClient()
      return api.setMyDepartment(token, body.department_id)
    }
  )

  ipcMain.handle('credentials:save', async (_event, payload: RememberedCredentials): Promise<true> => {
    await credentialStore.save(payload)
    return true
  })

  ipcMain.handle('credentials:load', (): Promise<RememberedCredentials | null> =>
    credentialStore.load()
  )

  ipcMain.handle('credentials:clear', async (): Promise<true> => {
    await credentialStore.clear()
    return true
  })

  ipcMain.handle('server-config:load', (): Promise<{ server_url: string }> =>
    serverConfigStore.load()
  )

  ipcMain.handle('app-update:check', () => appUpdateService.check())

  ipcMain.handle('app-update:download', (): Promise<true> => appUpdateService.download())

  ipcMain.handle('app-update:install', (): true => appUpdateService.install())

  ipcMain.handle('app-update:quit', (): true => appUpdateService.quit())

  ipcMain.handle(
    'notification:show-task-completed',
    async (
      _event,
      payload: TaskCompletionNotificationPayload
    ): Promise<TaskCompletionNotificationResult> => {
      try {
        if (!Notification.isSupported()) {
          return { status: 'unsupported' }
        }

        const notification = new Notification({
          title: '审查完成',
          body: `${payload.svn_url}\n${payload.old_revision} → ${payload.new_revision}`
        })
        activeNotifications.add(notification)

        notification.on('click', () => {
          try {
            const mainWindow = getMainWindow()
            if (!mainWindow || mainWindow.isDestroyed()) {
              return
            }

            if (mainWindow.isMinimized()) {
              mainWindow.restore()
            }
            mainWindow.show()
            mainWindow.focus()
            sendToRenderer(
              mainWindow.webContents,
              'notification:task-completed-clicked',
              payload
            )
          } catch (error) {
            return
          }
        })
        notification.on('close', () => {
          activeNotifications.delete(notification)
        })

        const result = new Promise<TaskCompletionNotificationResult>((resolve) => {
          notification.once('show', () => {
            resolve({ status: 'shown' })
          })
          notification.once('failed', (_event, message) => {
            activeNotifications.delete(notification)
            resolve({
              status: 'failed',
              message: message || '系统通知发送失败。'
            })
          })
        })
        notification.show()
        return await result
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : '系统通知发送失败。'
        }
      }
    }
  )

  ipcMain.handle('task:list', async () => {
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    return taskApi.listTasks(tokens.access_token, { mine: true })
  })

  ipcMain.handle('task:report', async (_event, taskId: string): Promise<string> => {
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    return taskApi.readTaskReport(tokens.access_token, taskId)
  })

  ipcMain.handle('requirement-file:select', async (): Promise<SelectRequirementFileResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel 文件', extensions: ['xls', 'xlsx'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'cancelled' }
    }
    return {
      status: 'selected',
      filePath: result.filePaths[0]
    }
  })

  ipcMain.handle('codex:install', (): Promise<EnvironmentCheckResult> => installLocalCodexCli())

  ipcMain.handle('svn:install', (): Promise<EnvironmentCheckResult> => installLocalSvnCli())

  ipcMain.handle('skill:install', async (event): Promise<EnvironmentCheckResult> => {
    notifyEnvironmentProgress(event, { stage: 'installing_skill' })
    const skillSyncResult = await syncSkillForCurrentUser(authStore, syncSkill, {
      loginRequiredMessage: '请先登录后安装 Skill'
    })
    const result = await checkLocalEnvironment()
    return withSkillSyncResult(result, skillSyncResult)
  })

  ipcMain.handle('environment:check', async (event): Promise<EnvironmentCheckResult> => {
    const firstPass = await checkLocalEnvironment()

    if (firstPass.status === 'missing_codex' || firstPass.status === 'failed') {
      return firstPass
    }

    notifyEnvironmentProgress(event, { stage: 'installing_skill' })
    const skillSyncResult = await syncSkillForCurrentUser(authStore, syncSkill)
    const result = await checkLocalEnvironment()
    return withSkillSyncResult(result, skillSyncResult)
  })

  ipcMain.handle(
    'task:preflight',
    async (
      _event,
      payload: Pick<CreateTaskRequest, 'svn_url' | 'old_revision' | 'new_revision'>
    ): Promise<TaskPreflightResult> => {
      const environment = await checkLocalEnvironment()
      if (environment.status !== 'ready') {
        return { status: 'invalid', errors: { svn_url: getEnvironmentErrorMessage(environment.status) } }
      }
      if (!environment.svnPath) {
        return {
          status: 'invalid',
          errors: { svn_url: '环境检查已通过但未返回 SVN CLI 路径' }
        }
      }

      const errors: Partial<Record<TaskPreflightErrorField, string>> = {}
      try {
        validateSvnRevisionRange(payload.old_revision, payload.new_revision)
      } catch (error) {
        if (error instanceof SvnPreflightError) {
          errors[resolvePreflightErrorField(error, payload)] = toSvnPreflightUserMessage(error, payload)
        } else {
          throw error
        }
      }

      try {
        await (dependencies.preflightSvnUrl ?? runSvnUrlPreflight)({
          svnUrl: payload.svn_url,
          svnCommand: environment.svnPath,
          commandOptions: buildDirectCommandOptions()
        })
      } catch (error) {
        if (error instanceof SvnPreflightError) {
          errors.svn_url = toSvnPreflightUserMessage(error, payload)
        } else {
          throw error
        }
      }

      if (Object.keys(errors).length > 0) {
        return { status: 'invalid', errors }
      }

      try {
        await (dependencies.preflightSvn ?? runSvnPreflight)({
          svnUrl: payload.svn_url,
          oldRevision: payload.old_revision,
          newRevision: payload.new_revision,
          svnCommand: environment.svnPath,
          commandOptions: buildDirectCommandOptions()
        })
      } catch (error) {
        if (error instanceof SvnPreflightError) {
          return {
            status: 'invalid',
            errors: {
              [resolvePreflightErrorField(error, payload)]: toSvnPreflightUserMessage(error, payload)
            }
          }
        }
        throw error
      }

      return { status: 'valid' }
    }
  )

  ipcMain.handle(
    'task:execute',
    async (
      event,
      payload: CreateTaskRequest & { client_task_id?: string }
    ): Promise<ExecuteReviewTaskResult> => {
      const tokens = await authStore.load()

      if (!tokens) {
        throw new Error('Not authenticated')
      }

      const skillSyncResult = await syncSkillForCurrentUser(authStore, syncSkill)
      if (typeof skillSyncResult === 'string') {
        throw new Error(skillSyncResult)
      }

      const taskApi = await createApiClient()
      const { client_task_id: clientTaskId, ...createTaskPayload } = payload
      const abortController = new AbortController()
      const activeTask: ActiveReviewTask = {
        clientTaskId,
        token: tokens.access_token,
        api: taskApi,
        abortController
      }

      registerActiveTask(activeTask)

      const prepareWorkspace = dependencies.prepareWorkspace ?? defaultPrepareWorkspace
      let codexLogPath: string | undefined
      const result = await executeReviewTask(
        {
          token: tokens.access_token,
          request: createTaskPayload,
          clientTaskId,
          signal: abortController.signal
        },
        {
          api: taskApi,
          checkEnvironment: checkLocalEnvironment,
          preflightSvn: dependencies.preflightSvn ?? runSvnPreflight,
          prepareWorkspace: async (input) => {
            activeTask.taskId = input.taskId
            registerActiveTask(activeTask)
            const workspace = await prepareWorkspace(input)
            activeTask.workspaceDir = workspace.cwd
            codexLogPath = workspace.codexLogPath ?? join(workspace.cwd, CODEX_REVIEW_LOG_FILE_NAME)
            return {
              ...workspace,
              codexLogPath
            }
          },
          runCodex: dependencies.runCodex ?? defaultRunCodex,
          prepareReport: dependencies.prepareReport ?? prepareReportForPublishing,
          generatePdfReport: dependencies.generatePdfReport ?? generatePdfReport,
          uploadRequirementFile:
            dependencies.uploadRequirementFile ??
            ((token, taskId, filePath) =>
              uploadRequirementFile(taskApi, token, taskId, filePath)),
          uploadReport:
            dependencies.uploadReport ??
            ((token, taskId, reportPath, reportContent) =>
              uploadReportFile(taskApi, token, taskId, reportPath, reportContent)),
          uploadPdfReport:
            dependencies.uploadPdfReport ??
            ((token, taskId, pdfPath) => uploadPdfReportFile(taskApi, token, taskId, pdfPath))
        },
        (progressEvent) => {
          if (codexLogPath) {
            void appendTaskLogEvent(codexLogPath, progressEvent)
          }
          if (progressEvent.taskId) {
            activeTask.taskId = progressEvent.taskId
            registerActiveTask(activeTask)
          }
          sendToRenderer(event.sender, 'task:progress', progressEvent)
        }
      ).finally(() => {
        unregisterActiveTask(activeTask)
      })

      if (result.status === 'success' && result.reportPath) {
        latestSuccessfulReport = {
          status: 'ready',
          taskId: result.taskId,
          reportPath: result.reportPath
        }
      }

      return result
    }
  )

  ipcMain.handle(
    'task:retry',
    async (
      event,
      payload: RetryTaskRequest
    ): Promise<ExecuteReviewTaskResult> => {
      const tokens = await authStore.load()

      if (!tokens) {
        throw new Error('Not authenticated')
      }

      const skillSyncResult = await syncSkillForCurrentUser(authStore, syncSkill)
      if (typeof skillSyncResult === 'string') {
        throw new Error(skillSyncResult)
      }

      const taskApi = await createApiClient()
      const abortController = new AbortController()
      const activeTask: ActiveReviewTask = {
        clientTaskId: payload.client_task_id,
        taskId: payload.task_id,
        token: tokens.access_token,
        api: taskApi,
        abortController
      }

      registerActiveTask(activeTask)

      const prepareWorkspace = dependencies.prepareWorkspace ?? defaultPrepareWorkspace
      let codexLogPath: string | undefined
      const result = await retryReviewTask(
        {
          token: tokens.access_token,
          taskId: payload.task_id,
          clientTaskId: payload.client_task_id,
          requirementFilePath: payload.requirement_file_path,
          signal: abortController.signal
        },
        {
          api: taskApi,
          checkEnvironment: checkLocalEnvironment,
          preflightSvn: dependencies.preflightSvn ?? runSvnPreflight,
          prepareWorkspace: async (input) => {
            activeTask.taskId = input.taskId
            registerActiveTask(activeTask)
            const workspace = await prepareWorkspace(input)
            activeTask.workspaceDir = workspace.cwd
            codexLogPath = workspace.codexLogPath ?? join(workspace.cwd, CODEX_REVIEW_LOG_FILE_NAME)
            return {
              ...workspace,
              codexLogPath
            }
          },
          runCodex: dependencies.runCodex ?? defaultRunCodex,
          prepareReport: dependencies.prepareReport ?? prepareReportForPublishing,
          generatePdfReport: dependencies.generatePdfReport ?? generatePdfReport,
          uploadRequirementFile:
            dependencies.uploadRequirementFile ??
            ((token, taskId, filePath) =>
              uploadRequirementFile(taskApi, token, taskId, filePath)),
          uploadReport:
            dependencies.uploadReport ??
            ((token, taskId, reportPath, reportContent) =>
              uploadReportFile(taskApi, token, taskId, reportPath, reportContent)),
          uploadPdfReport:
            dependencies.uploadPdfReport ??
            ((token, taskId, pdfPath) => uploadPdfReportFile(taskApi, token, taskId, pdfPath))
        },
        (progressEvent) => {
          if (codexLogPath) {
            void appendTaskLogEvent(codexLogPath, progressEvent)
          }
          if (progressEvent.taskId) {
            activeTask.taskId = progressEvent.taskId
            registerActiveTask(activeTask)
          }
          sendToRenderer(event.sender, 'task:progress', progressEvent)
        }
      ).finally(() => {
        unregisterActiveTask(activeTask)
      })

      if (result.status === 'success' && result.reportPath) {
        latestSuccessfulReport = {
          status: 'ready',
          taskId: result.taskId,
          reportPath: result.reportPath
        }
      }

      return result
    }
  )

  ipcMain.handle('task:cancel', async (_event, payload: CancelTaskRequest): Promise<CancelTaskResult> => {
    const activeTask = findActiveTask(payload)

    if (!activeTask) {
      return { status: 'not_found' }
    }

    return cancelActiveReviewTask(activeTask)
  })

  ipcMain.handle('task:open-log', async (_event, payload: OpenTaskLogRequest): Promise<OpenTaskLogResult> => {
    const trimmedTaskId = payload.taskId.trim()
    if (!trimmedTaskId) {
      return { status: 'missing' }
    }

    const runtimePaths = await loadRuntimePaths()
    const logPath =
      runtimePaths.codexLogPathForTask?.(trimmedTaskId) ??
      join(runtimePaths.workspaceForTask(trimmedTaskId), CODEX_REVIEW_LOG_FILE_NAME)

    if (!(await isExistingFile(logPath))) {
      return { status: 'missing' }
    }

    shell.showItemInFolder(logPath)
    return { status: 'ready', logPath }
  })

  ipcMain.handle(
    'feedback:submit',
    async (_event, payload: SubmitFeedbackIpcPayload): Promise<FeedbackResult> => {
      const tokens = await authStore.load()

      if (!tokens) {
        throw new Error('Not authenticated')
      }

      const api = await createApiClient()
      return api.submitFeedback(tokens.access_token, toSubmitFeedbackRequest(payload))
    }
  )

  ipcMain.handle(
    'report-feedback:open',
    async (
      event,
      payload: OpenReportFeedbackWindowPayload
    ): Promise<true> => {
      assertMainWindowSender(event, getMainWindow)
      const validatedPayload = validateReportFeedbackContext(payload)
      let context: ReportFeedbackContext
      if (validatedPayload.mode === 'issues') {
        const token = await loadAccessToken(authStore)
        const api = await createApiClient()
        const response = await api.readTaskIssues(token, validatedPayload.taskId)
        context = buildIssueFeedbackContext(
          validatedPayload.taskId,
          response,
          validatedPayload.anchors
        )
      } else {
        context = validatedPayload
      }
      return requireReportFeedbackManager(getReportFeedbackWindowManager).open(context)
    }
  )

  ipcMain.handle(
    'report-feedback:submit-negative',
    async (event, taskId: string): Promise<ReportFeedbackSubmittedEvent> => {
      assertMainWindowSender(event, getMainWindow)
      if (typeof taskId !== 'string' || !taskId.trim()) {
        throw new Error('反馈任务 ID 无效')
      }
      return submitReportFeedback(taskId, {
        helpful: false,
        useful_issues_text: null
      })
    }
  )

  ipcMain.handle(
    'report-feedback-window:get-context',
    async (event): Promise<ReportFeedbackContext> =>
      requireReportFeedbackManager(getReportFeedbackWindowManager).getContext(event.sender.id)
  )

  ipcMain.handle(
    'report-feedback-window:focus-anchor',
    async (
      event,
      payload: FocusReportFeedbackAnchorPayload
    ): Promise<true> => {
      const manager = requireReportFeedbackManager(getReportFeedbackWindowManager)
      const context = manager.getContext(event.sender.id)
      if (!payload || payload.taskId !== context.taskId) {
        throw new Error('反馈任务与当前窗口不一致')
      }

      let anchorId: string | undefined
      if (payload.optionId !== undefined) {
        const target =
          context.mode === 'issues'
            ? context.issues.find((candidate) => candidate.id === payload.optionId)
            : context.options.find((candidate) => candidate.id === payload.optionId)
        if (!target) {
          throw new Error('包含未知反馈候选项 ID')
        }
        anchorId = target.anchorId
      }
      sendToRenderer(getMainWindow()?.webContents, 'report-feedback:focus-anchor', {
        taskId: context.taskId,
        ...(anchorId ? { anchorId } : {})
      })
      return true
    }
  )

  ipcMain.handle(
    'report-feedback-window:submit',
    async (
      event,
      payload: SubmitHelpfulReportFeedbackPayload
    ): Promise<ReportFeedbackSubmittedEvent> => {
      const manager = requireReportFeedbackManager(getReportFeedbackWindowManager)
      const context = manager.getContext(event.sender.id)
      const usefulIssuesText = buildUsefulIssuesText(context, payload)
      const submittedEvent = await submitReportFeedback(context.taskId, {
        helpful: true,
        useful_issues_text: usefulIssuesText
      })
      return submittedEvent
    }
  )

  ipcMain.handle(
    'report-feedback-window:save-issue-draft',
    async (
      event,
      payload: SaveIssueFeedbackDraftPayload
    ): Promise<ReviewTaskIssue> => {
      const manager = requireReportFeedbackManager(getReportFeedbackWindowManager)
      const context = manager.getContext(event.sender.id)
      const draft = validateIssueFeedbackDraft(context, payload)
      return serializeIssueFeedbackDraft(context.taskId, draft.issueId, async () => {
        const token = await loadAccessToken(authStore)
        const api = await createApiClient()
        return api.saveIssueFeedbackDraft(token, context.taskId, draft.issueId, {
          helpful: draft.helpful,
          feedback_text: draft.feedbackText.trim() ? draft.feedbackText : null
        })
      })
    }
  )

  ipcMain.handle(
    'report-feedback-window:submit-issues',
    async (
      event,
      payload: SubmitIssueFeedbackPayload
    ): Promise<SubmitIssueFeedbackResult> => {
      const manager = requireReportFeedbackManager(getReportFeedbackWindowManager)
      const context = manager.getContext(event.sender.id)
      if (
        context.mode !== 'issues' ||
        !payload ||
        payload.taskId !== context.taskId
      ) {
        throw new Error('反馈任务与当前窗口不一致')
      }
      await waitForIssueFeedbackDrafts(context.taskId)
      const token = await loadAccessToken(authStore)
      const api = await createApiClient()
      const result = await submitFinalIssueFeedback({
        api,
        token,
        taskId: context.taskId,
        runtimePaths: await loadRuntimePaths(),
        generatePdf: dependencies.generatePdfReport ?? generatePdfReport
      })
      const submittedEvent: IssueFeedbackSubmittedEvent = {
        taskId: result.taskId,
        feedbackSubmittedAt: result.feedbackSubmittedAt,
        pdfPath: result.pdfPath,
        pdfReportName: result.pdfReportName
      }
      sendToRenderer(
        getMainWindow()?.webContents,
        'report-feedback:issues-submitted',
        submittedEvent
      )
      let pdfOpenError = ''
      try {
        shell.showItemInFolder(result.pdfPath)
      } catch (revealError) {
        pdfOpenError =
          revealError instanceof Error ? revealError.message : '系统无法定位最终 PDF'
      }
      if (pdfOpenError) {
        return { ...result, pdfOpenError }
      }
      return result
    }
  )

  ipcMain.handle('report-feedback-window:close', async (event): Promise<true> =>
    requireReportFeedbackManager(getReportFeedbackWindowManager).close(event.sender.id)
  )

  ipcMain.handle('report:asset', (_event, payload: ReadReportAssetRequest) =>
    readReportAsset(payload)
  )

  ipcMain.handle('report:download-current', async (_event, taskId?: string): Promise<DownloadCurrentReportResult> => {
    if (!latestSuccessfulReport && !taskId) {
      return { status: 'missing' }
    }

    if (
      latestSuccessfulReport?.reportPath &&
      (!taskId || latestSuccessfulReport.taskId === taskId)
    ) {
      shell.showItemInFolder(latestSuccessfulReport.reportPath)
      return latestSuccessfulReport
    }

    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const reportTaskId = taskId ?? latestSuccessfulReport?.taskId

    if (!reportTaskId) {
      return { status: 'missing' }
    }

    const taskApi = await createApiClient()
    const reportMarkdown = await taskApi.readTaskReport(tokens.access_token, reportTaskId)
    const runtimePaths = await loadRuntimePaths()
    const reportPath = runtimePaths.reportPathForTask(reportTaskId)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const downloadedReport = {
      status: 'ready',
      taskId: reportTaskId,
      reportPath
    } satisfies DownloadCurrentReportResult
    latestSuccessfulReport = downloadedReport
    shell.showItemInFolder(reportPath)

    return downloadedReport
  })

  ipcMain.handle('report:open-pdf', async (_event, payload: OpenPdfReportRequest): Promise<OpenPdfReportResult> => {
    if (!payload.taskId) {
      throw new Error('请先选择一个已完成任务报告。')
    }

    const runtimePaths = await loadRuntimePaths()
    const { taskWorkspace, workspacesDirectory } = resolveTrustedTaskWorkspace(
      payload.taskId,
      runtimePaths
    )
    const localPdfPath = await resolveTrustedLocalPdfPath(
      payload.localPdfPath,
      taskWorkspace,
      workspacesDirectory
    )
    if (localPdfPath) {
      await presentPdfFile(localPdfPath, payload.action)
      return { status: 'ready', pdfPath: localPdfPath }
    }

    const fallbackPdfFileName = '代码审查报告.pdf'
    const { fileName: pdfFileName, isValidProvidedName } = resolveReportFileName(
      payload.pdfReportName,
      fallbackPdfFileName
    )
    const fallbackPdfPath = join(taskWorkspace, fallbackPdfFileName)
    const workspacePdfPath = isValidProvidedName ? join(taskWorkspace, pdfFileName) : undefined

    const existingWorkspacePdfPath = await resolveTrustedLocalPdfPath(
      workspacePdfPath,
      taskWorkspace,
      workspacesDirectory
    )
    if (existingWorkspacePdfPath) {
      await presentPdfFile(existingWorkspacePdfPath, payload.action)
      return { status: 'ready', pdfPath: existingWorkspacePdfPath }
    }

    const existingFallbackPdfPath = workspacePdfPath
      ? undefined
      : await resolveTrustedLocalPdfPath(
          fallbackPdfPath,
          taskWorkspace,
          workspacesDirectory
        )
    if (existingFallbackPdfPath) {
      await presentPdfFile(existingFallbackPdfPath, payload.action)
      return { status: 'ready', pdfPath: existingFallbackPdfPath }
    }

    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    await mkdir(taskWorkspace, { recursive: true })
    const [realWorkspacesDirectory, realTaskWorkspace] = await Promise.all([
      realpath(workspacesDirectory),
      realpath(taskWorkspace)
    ])
    if (!isInsideDirectory(realTaskWorkspace, realWorkspacesDirectory)) {
      throw new Error('任务工作区路径无效')
    }
    const taskApi = await createApiClient()
    const pdfBytes = await taskApi.downloadPdfReport(tokens.access_token, payload.taskId)
    const pdfPath = workspacePdfPath ?? fallbackPdfPath
    await writeFile(pdfPath, Buffer.from(pdfBytes))
    await presentPdfFile(pdfPath, payload.action)

    return { status: 'ready', pdfPath }
  })
}

const syncSkillForCurrentUser = async (
  authStore: AuthStore,
  syncSkill: (token: string) => Promise<SkillSyncResult>,
  options: { loginRequiredMessage?: string } = {}
): Promise<SkillSyncResult | string | undefined> => {
  const tokens = await authStore.load()

  if (!tokens) {
    return options.loginRequiredMessage
  }

  try {
    return await syncSkill(tokens.access_token)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const withSkillSyncResult = (
  result: EnvironmentCheckResult,
  syncResult: SkillSyncResult | string | undefined
): EnvironmentCheckResult => {
  if (typeof syncResult === 'string') {
    return {
      ...result,
      status: 'missing_skill',
      skillError: syncResult,
      skills: []
    }
  }

  if (!syncResult) {
    return result
  }

  return {
    ...result,
    skills: syncResult.skills
  }
}
