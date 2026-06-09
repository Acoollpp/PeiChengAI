import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { NsisUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

import type { TokenPair } from './api-client'
import type { AuthStore } from './auth-store'
import type { ServerConfig, ServerConfigStore } from './server-config-store'
import { normalizeServerUrl } from './server-config-store'

export interface AppUpdateError {
  message: string
  stack?: string
}

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
  send?: AppUpdateSender
}

export class AppUpdateService {
  private updater?: AppUpdaterClient
  private isUpdateDownloaded = false
  private readonly createUpdater: () => AppUpdaterClient
  private readonly loadServerConfig: () => Promise<ServerConfig>
  private readonly loadToken: () => Promise<string | null>
  private readonly send: AppUpdateSender

  constructor(options: AppUpdateServiceOptions) {
    this.createUpdater = options.createUpdater ?? (() => new NsisUpdater())
    this.loadServerConfig = options.loadServerConfig
    this.loadToken = options.loadToken
    this.send = options.send ?? sendToAllRendererWindows

    if (options.createUpdater) {
      this.getUpdater()
    }
  }

  async check(): Promise<boolean> {
    const token = await this.loadToken()

    if (!token) {
      return false
    }

    const config = await this.loadServerConfig()
    const updater = this.getUpdater()
    updater.setFeedURL({
      provider: 'generic',
      url: buildUpdateFeedUrl(config.server_url)
    })
    updater.addAuthHeader(`Bearer ${token}`)
    await updater.checkForUpdates()
    return true
  }

  async download(): Promise<true> {
    await this.getUpdater().downloadUpdate()
    return true
  }

  install(): true {
    if (!this.isUpdateDownloaded) {
      throw new Error('更新尚未下载完成')
    }

    this.getUpdater().quitAndInstall(false, true)
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

  private registerEventForwarding(updater: AppUpdaterClient): void {
    updater.on('update-available', (info: UpdateInfo) => {
      this.send('app-update:available', info)
    })
    updater.on('update-not-available', (info: UpdateInfo) => {
      this.send('app-update:not-available', info)
    })
    updater.on('download-progress', (progress: ProgressInfo) => {
      this.send('app-update:download-progress', progress)
    })
    updater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.isUpdateDownloaded = true
      this.send('app-update:downloaded', event)
    })
    updater.on('error', (error: Error) => {
      this.send('app-update:error', serializeUpdateError(error))
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
    }
  })
}

function buildUpdateFeedUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/api/v1/client-updates/win32/x64`
}

function serializeUpdateError(error: Error): AppUpdateError {
  return {
    message: error.message,
    stack: error.stack
  }
}

function sendToAllRendererWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
