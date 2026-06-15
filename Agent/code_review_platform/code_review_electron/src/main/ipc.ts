import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'

import { ipcMain, shell } from 'electron'

import {
  ApiClient,
  ApiError,
  type CreateTaskRequest,
  type FeedbackResult,
  type KeyLoginRequest,
  type SubmitFeedbackRequest,
  type SvnLoginRequest
} from './api-client'
import { createAppUpdateService, type AppUpdateService } from './app-updater'
import { AuthStore } from './auth-store'
import { installCodexCli } from './codex-cli-installer'
import { installSvnCli } from './svn-cli-installer'
import { CredentialStore, type RememberedCredentials } from './credential-store'
import { checkEnvironment } from './environment-checker'
import type { EnvironmentProgressEvent } from '../shared/types'
import { generatePdfReport } from './report-pdf-generator'
import {
  defaultPrepareWorkspace,
  defaultRunCodex,
  executeReviewTask,
  type ExecuteReviewTaskResult,
  type TaskAgentDependencies
} from './task-agent'
import type { EnvironmentCheckResult } from './environment-checker'
import { uploadPdfReportFile, uploadReportFile } from './report-uploader'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'
import { ServerConfigStore, normalizeServerUrl } from './server-config-store'
import { createSkillSyncService, type SkillSyncResult } from './skill-sync'

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
  installCodexCli?: () => Promise<EnvironmentCheckResult>
  installSvnCli?: () => Promise<EnvironmentCheckResult>
  syncSkill?: (token: string) => Promise<SkillSyncResult>
  prepareWorkspace?: typeof defaultPrepareWorkspace
  runCodex?: typeof defaultRunCodex
  generatePdfReport?: TaskAgentDependencies['generatePdfReport']
  uploadReport?: TaskAgentDependencies['uploadReport']
  uploadPdfReport?: TaskAgentDependencies['uploadPdfReport']
  runtimePaths?: RuntimePaths
  appUpdateService?: AppUpdateService
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
}

interface OpenPdfReportResult {
  status: 'ready'
  pdfPath: string
}

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

interface CancelTaskResult {
  status: 'cancelled' | 'not_found'
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

const resolveReportFileName = (
  fileName: string | undefined,
  fallback: string
): { fileName: string; isValidProvidedName: boolean } => {
  const trimmedFileName = fileName?.trim()

  if (!trimmedFileName || trimmedFileName.includes('/') || trimmedFileName.includes('\\')) {
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
): void => {
  if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
    return
  }

  try {
    sender.send(channel, payload)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Object has been destroyed')) {
      return
    }

    throw error
  }
}

export const registerIpcHandlers = (dependencies: IpcHandlerDependencies = {}): void => {
  const apiOverride = dependencies.api
  const authStore = dependencies.authStore ?? new AuthStore()
  const credentialStore = dependencies.credentialStore ?? new CredentialStore()
  const serverConfigStore = dependencies.serverConfigStore ?? new ServerConfigStore()
  const appUpdateService =
    dependencies.appUpdateService ?? createAppUpdateService(authStore, serverConfigStore)
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
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const api = await createApiClient()
    await api.updateSvnCredential(tokens.access_token, body)
    return true
  })

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

  ipcMain.handle('app-update:check', (): Promise<boolean> => appUpdateService.check())

  ipcMain.handle('app-update:download', (): Promise<true> => appUpdateService.download())

  ipcMain.handle('app-update:install', (): true => appUpdateService.install())

  ipcMain.handle('task:list', async () => {
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    return taskApi.listTasks(tokens.access_token)
  })

  ipcMain.handle('task:report', async (_event, taskId: string): Promise<string> => {
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    return taskApi.readTaskReport(tokens.access_token, taskId)
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
          prepareWorkspace: async (input) => {
            activeTask.taskId = input.taskId
            registerActiveTask(activeTask)
            const workspace = await prepareWorkspace(input)
            activeTask.workspaceDir = workspace.cwd
            return workspace
          },
          runCodex: dependencies.runCodex ?? defaultRunCodex,
          generatePdfReport: dependencies.generatePdfReport ?? generatePdfReport,
          uploadReport:
            dependencies.uploadReport ??
            ((token, taskId, reportPath) => uploadReportFile(taskApi, token, taskId, reportPath)),
          uploadPdfReport:
            dependencies.uploadPdfReport ??
            ((token, taskId, pdfPath) => uploadPdfReportFile(taskApi, token, taskId, pdfPath))
        },
        (progressEvent) => {
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
    if (await isExistingFile(payload.localPdfPath)) {
      shell.showItemInFolder(payload.localPdfPath)
      return { status: 'ready', pdfPath: payload.localPdfPath }
    }

    if (!payload.taskId) {
      throw new Error('请先选择一个已完成任务报告。')
    }

    const runtimePaths = await loadRuntimePaths()
    const fallbackPdfPath =
      runtimePaths.pdfReportPathForTask?.(payload.taskId) ??
      runtimePaths.reportPathForTask(payload.taskId).replace(/\.md$/i, '.pdf')
    const fallbackPdfFileName = '代码审查报告.pdf'
    const { fileName: pdfFileName, isValidProvidedName } = resolveReportFileName(
      payload.pdfReportName,
      fallbackPdfFileName
    )
    const workspacePdfPath = isValidProvidedName
      ? join(runtimePaths.workspaceForTask(payload.taskId), pdfFileName)
      : undefined

    if (workspacePdfPath && (await isExistingFile(workspacePdfPath))) {
      shell.showItemInFolder(workspacePdfPath)
      return { status: 'ready', pdfPath: workspacePdfPath }
    }

    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    const pdfBytes = await taskApi.downloadPdfReport(tokens.access_token, payload.taskId)
    const pdfPath = workspacePdfPath ?? fallbackPdfPath
    await mkdir(dirname(pdfPath), { recursive: true })
    await writeFile(pdfPath, Buffer.from(pdfBytes))
    shell.showItemInFolder(pdfPath)

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
