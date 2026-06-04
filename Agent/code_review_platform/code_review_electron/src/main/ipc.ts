import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { ipcMain, shell } from 'electron'

import {
  ApiClient,
  ApiError,
  type CreateTaskRequest,
  type KeyLoginRequest,
  type SvnLoginRequest
} from './api-client'
import { AuthStore } from './auth-store'
import { installCodexCli } from './codex-cli-installer'
import { CredentialStore, type RememberedCredentials } from './credential-store'
import { checkEnvironment } from './environment-checker'
import {
  defaultPrepareWorkspace,
  defaultRunCodex,
  executeReviewTask,
  type ExecuteReviewTaskResult,
  type TaskAgentDependencies
} from './task-agent'
import type { EnvironmentCheckResult } from './environment-checker'
import { uploadReportFile } from './report-uploader'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'
import { ServerConfigStore, normalizeServerUrl } from './server-config-store'
import { createSkillSyncService, type SkillSyncResult } from './skill-sync'

export interface IpcHandlerDependencies {
  api?: ApiClient
  authStore?: AuthStore
  credentialStore?: CredentialStore
  serverConfigStore?: ServerConfigStore
  checkEnvironment?: () => Promise<EnvironmentCheckResult>
  installCodexCli?: () => Promise<EnvironmentCheckResult>
  syncSkill?: (token: string) => Promise<SkillSyncResult>
  prepareWorkspace?: typeof defaultPrepareWorkspace
  runCodex?: typeof defaultRunCodex
  uploadReport?: TaskAgentDependencies['uploadReport']
  runtimePaths?: RuntimePaths
}

export interface DownloadCurrentReportResult {
  status: 'ready' | 'missing'
  taskId?: string
  reportPath?: string
}

export const registerIpcHandlers = (dependencies: IpcHandlerDependencies = {}): void => {
  const apiOverride = dependencies.api
  const authStore = dependencies.authStore ?? new AuthStore()
  const credentialStore = dependencies.credentialStore ?? new CredentialStore()
  const serverConfigStore = dependencies.serverConfigStore ?? new ServerConfigStore()
  const checkLocalEnvironment = dependencies.checkEnvironment ?? checkEnvironment
  const installLocalCodexCli = dependencies.installCodexCli ?? installCodexCli
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

  ipcMain.handle('skill:install', async (): Promise<EnvironmentCheckResult> => {
    const skillError = await syncSkillForCurrentUser(authStore, syncSkill, {
      loginRequiredMessage: '请先登录后安装 Skill'
    })
    const result = await checkLocalEnvironment()

    if (skillError) {
      return {
        ...result,
        skillError
      }
    }

    return result
  })

  ipcMain.handle('environment:check', async (): Promise<EnvironmentCheckResult> => {
    const firstPass = await checkLocalEnvironment()

    if (firstPass.status === 'missing_codex' || firstPass.status === 'failed') {
      return firstPass
    }

    const skillError = await syncSkillForCurrentUser(authStore, syncSkill)
    const result = await checkLocalEnvironment()

    if (skillError) {
      return {
        ...result,
        skillError
      }
    }

    return result
  })

  ipcMain.handle(
    'task:execute',
    async (event, payload: CreateTaskRequest): Promise<ExecuteReviewTaskResult> => {
      const tokens = await authStore.load()

      if (!tokens) {
        throw new Error('Not authenticated')
      }

      const taskApi = await createApiClient()
      const result = await executeReviewTask(
        {
          token: tokens.access_token,
          request: payload
        },
        {
          api: taskApi,
          checkEnvironment: checkLocalEnvironment,
          prepareWorkspace: dependencies.prepareWorkspace ?? defaultPrepareWorkspace,
          runCodex: dependencies.runCodex ?? defaultRunCodex,
          uploadReport:
            dependencies.uploadReport ??
            ((token, taskId, reportPath) => uploadReportFile(taskApi, token, taskId, reportPath))
        },
        (progressEvent) => {
          event.sender?.send('task:progress', progressEvent)
        }
      )

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
}

const syncSkillForCurrentUser = async (
  authStore: AuthStore,
  syncSkill: (token: string) => Promise<SkillSyncResult>,
  options: { loginRequiredMessage?: string } = {}
): Promise<string | undefined> => {
  const tokens = await authStore.load()

  if (!tokens) {
    return options.loginRequiredMessage
  }

  try {
    await syncSkill(tokens.access_token)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  return undefined
}
