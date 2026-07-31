import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { NsisUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

import type { TokenPair } from './api-client'
import type { AuthStore } from './auth-store'
import type { ServerConfig, ServerConfigStore } from './server-config-store'
import { normalizeServerUrl } from './server-config-store'

const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 10_000

export interface AppUpdateError {
  message: string
  stack?: string
  phase?: 'check' | 'download' | 'install'
}

export interface ClientUpdatePolicy {
  platform: string
  arch: string
  current_version: string
  active_version: string | null
  minimum_supported_version: string | null
  update_available: boolean
  update_required: boolean
  release_notes?: string | null
}

export type AppUpdateCheckResult =
  | { status: 'check_failed' }
  | { status: 'current'; policy: ClientUpdatePolicy }
  | { status: 'optional'; policy: ClientUpdatePolicy }
  | { status: 'required'; policy: ClientUpdatePolicy }

type AppUpdateSender = (channel: string, payload: unknown) => void

export interface AppUpdaterClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  setFeedURL(options: { provider: 'generic'; url: string }): void
  addAuthHeader(token: string): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string | symbol, listener: (...args: any[]) => void): this
}

export interface AppUpdateServiceOptions {
  createUpdater?: () => AppUpdaterClient
  loadServerConfig: () => Promise<ServerConfig>
  loadToken: () => Promise<string | null>
  getCurrentVersion?: () => string
  loadPolicy?: (
    serverUrl: string,
    token: string,
    currentVersion: string
  ) => Promise<ClientUpdatePolicy>
  updateCheckTimeoutMs?: number
  quit?: () => void
  send?: AppUpdateSender
}

export class AppUpdateService {
  private updater?: AppUpdaterClient
  private isUpdateDownloaded = false
  private isUpdateRequired = false
  private isUpdateAvailable = false
  private downloadPromise?: Promise<true>
  private activeOperation?: AppUpdateError['phase']
  private readonly createUpdater: () => AppUpdaterClient
  private readonly loadServerConfig: () => Promise<ServerConfig>
  private readonly loadToken: () => Promise<string | null>
  private readonly getCurrentVersion: () => string
  private readonly loadPolicy: NonNullable<AppUpdateServiceOptions['loadPolicy']>
  private readonly updateCheckTimeoutMs: number
  private readonly quitApp: () => void
  private readonly send: AppUpdateSender

  constructor(options: AppUpdateServiceOptions) {
    this.createUpdater = options.createUpdater ?? (() => new NsisUpdater())
    this.loadServerConfig = options.loadServerConfig
    this.loadToken = options.loadToken
    this.getCurrentVersion = options.getCurrentVersion ?? (() => '0.0.0')
    this.loadPolicy = options.loadPolicy ?? readClientUpdatePolicy
    this.updateCheckTimeoutMs = options.updateCheckTimeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS
    this.quitApp = options.quit ?? (() => undefined)
    this.send = options.send ?? sendToAllRendererWindows

    if (options.createUpdater) {
      this.getUpdater()
    }
  }

  async check(): Promise<AppUpdateCheckResult> {
    const token = await this.loadToken()

    if (!token) {
      return { status: 'check_failed' }
    }

    const config = await this.loadServerConfig()
    let policy: ClientUpdatePolicy
    try {
      policy = await withTimeout(
        this.loadPolicy(config.server_url, token, this.getCurrentVersion()),
        this.updateCheckTimeoutMs,
        '更新策略检查超时'
      )
    } catch (error) {
      log.warn('客户端更新策略检查失败，允许继续使用当前版本', error)
      return { status: 'check_failed' }
    }

    if (!policy.update_available) {
      this.isUpdateRequired = false
      this.isUpdateAvailable = false
      return { status: 'current', policy }
    }

    const updater = this.getUpdater()
    updater.setFeedURL({
      provider: 'generic',
      url: buildUpdateFeedUrl(config.server_url)
    })
    updater.addAuthHeader(`Bearer ${token}`)
    if (policy.update_required) {
      this.isUpdateRequired = true
      this.send('app-update:required', policy)
      void this.download().catch((error: unknown) => {
        this.send('app-update:error', serializeUnknownUpdateError(error, 'download'))
      })
      return { status: 'required', policy }
    }

    this.isUpdateRequired = false
    this.activeOperation = 'check'
    void withTimeout(updater.checkForUpdates(), this.updateCheckTimeoutMs, '更新检查超时')
      .catch((error: unknown) => {
        log.warn('可选更新检查失败，允许继续使用当前版本', error)
      })
      .finally(() => {
        if (this.activeOperation === 'check') {
          this.activeOperation = undefined
        }
      })
    return { status: 'optional', policy }
  }

  async download(): Promise<true> {
    if (this.downloadPromise) {
      return this.downloadPromise
    }

    this.activeOperation = 'download'
    this.downloadPromise = Promise.resolve()
      .then(() => this.prepareAndDownload())
      .then(() => true as const)
      .catch((error: unknown) => {
        this.downloadPromise = undefined
        this.activeOperation = undefined
        throw error
      })
    return this.downloadPromise
  }

  install(): true {
    if (!this.isUpdateDownloaded) {
      throw new Error('更新尚未下载完成')
    }

    this.activeOperation = 'install'
    try {
      this.getUpdater().quitAndInstall(false, true)
    } catch (error) {
      this.activeOperation = undefined
      throw error
    }
    return true
  }

  quit(): true {
    this.quitApp()
    return true
  }

  private getUpdater(): AppUpdaterClient {
    if (this.updater) {
      return this.updater
    }

    const updater = this.createUpdater()
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.logger = log
    this.registerEventForwarding(updater)
    this.updater = updater
    return updater
  }

  private async prepareAndDownload(): Promise<string[]> {
    const updater = this.getUpdater()
    if (this.isUpdateRequired && !this.isUpdateAvailable) {
      await withTimeout(updater.checkForUpdates(), this.updateCheckTimeoutMs, '更新检查超时')
    }
    return updater.downloadUpdate()
  }

  private registerEventForwarding(updater: AppUpdaterClient): void {
    updater.on('update-available', (info: UpdateInfo) => {
      this.isUpdateAvailable = true
      this.send('app-update:available', info)
      if (this.isUpdateRequired && !this.downloadPromise) {
        void this.download().catch((error: unknown) => {
          this.send('app-update:error', serializeUnknownUpdateError(error, 'download'))
        })
      }
    })
    updater.on('update-not-available', (info: UpdateInfo) => {
      this.isUpdateAvailable = false
      this.send('app-update:not-available', info)
    })
    updater.on('download-progress', (progress: ProgressInfo) => {
      this.send('app-update:download-progress', progress)
    })
    updater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.isUpdateDownloaded = true
      this.activeOperation = undefined
      this.send('app-update:downloaded', event)
    })
    updater.on('error', (error: Error) => {
      const phase = this.activeOperation
      this.downloadPromise = undefined
      this.activeOperation = undefined
      this.send('app-update:error', serializeUpdateError(error, phase))
    })
  }
}

export function createAppUpdateService(
  authStore: AuthStore,
  serverConfigStore: ServerConfigStore
): AppUpdateService {
  return new AppUpdateService({
    loadServerConfig: () => serverConfigStore.load(),
    loadToken: async () => {
      const tokens: TokenPair | null = await authStore.load()
      return tokens?.access_token ?? null
    },
    getCurrentVersion: () => app.getVersion(),
    quit: () => app.quit()
  })
}

function buildUpdateFeedUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/api/v1/client-updates/win32/x64`
}

function serializeUpdateError(error: Error, phase?: AppUpdateError['phase']): AppUpdateError {
  return {
    message: error.message,
    stack: error.stack,
    phase
  }
}

function serializeUnknownUpdateError(
  error: unknown,
  phase?: AppUpdateError['phase']
): AppUpdateError {
  return serializeUpdateError(error instanceof Error ? error : new Error(String(error)), phase)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

async function readClientUpdatePolicy(
  serverUrl: string,
  token: string,
  currentVersion: string
): Promise<ClientUpdatePolicy> {
  const query = new URLSearchParams({ current_version: currentVersion })
  const response = await fetch(
    `${normalizeServerUrl(serverUrl)}/api/v1/client-update-policy/win32/x64/check?${query}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) {
    throw new Error(`更新策略接口返回 HTTP ${response.status}`)
  }
  return (await response.json()) as ClientUpdatePolicy
}

function sendToAllRendererWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
