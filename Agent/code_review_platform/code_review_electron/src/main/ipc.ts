import { ipcMain } from 'electron'

import { ApiClient, type CreateTaskRequest, type LoginRequest, type RegisterRequest } from './api-client'
import { AuthStore } from './auth-store'
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
import { ServerConfigStore, normalizeServerUrl } from './server-config-store'
import { createSkillSyncService, type SkillSyncResult } from './skill-sync'

export interface IpcHandlerDependencies {
  api?: ApiClient
  authStore?: AuthStore
  credentialStore?: CredentialStore
  serverConfigStore?: ServerConfigStore
  checkEnvironment?: () => Promise<EnvironmentCheckResult>
  syncSkill?: (token: string) => Promise<SkillSyncResult>
  prepareWorkspace?: typeof defaultPrepareWorkspace
  runCodex?: typeof defaultRunCodex
  uploadReport?: TaskAgentDependencies['uploadReport']
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

  ipcMain.handle('auth:register', async (_event, payload: RegisterRequest): Promise<true> => {
    const serverUrl = normalizeServerUrl(payload.server_url)
    const api = apiOverride ?? new ApiClient(serverUrl)
    const tokens = await api.register({
      full_name: payload.full_name,
      svn_username: payload.svn_username,
      svn_password: payload.svn_password
    })
    await serverConfigStore.save({ server_url: serverUrl })
    await authStore.save(tokens)
    return true
  })

  ipcMain.handle('auth:login', async (_event, payload: LoginRequest): Promise<true> => {
    const serverUrl = normalizeServerUrl(payload.server_url)
    const api = apiOverride ?? new ApiClient(serverUrl)
    const tokens = await api.login({
      svn_username: payload.svn_username,
      svn_password: payload.svn_password
    })
    await serverConfigStore.save({ server_url: serverUrl })
    await authStore.save(tokens)
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

  ipcMain.handle('report:download-current', async (): Promise<DownloadCurrentReportResult> => {
    if (!latestSuccessfulReport) {
      return { status: 'missing' }
    }

    return latestSuccessfulReport
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
