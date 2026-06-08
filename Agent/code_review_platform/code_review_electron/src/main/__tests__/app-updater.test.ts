import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'
import type { AppUpdaterClient } from '../app-updater'

interface FakeUpdater extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  setFeedURL: AppUpdaterClient['setFeedURL'] & ReturnType<typeof vi.fn>
  addAuthHeader: AppUpdaterClient['addAuthHeader'] & ReturnType<typeof vi.fn>
  checkForUpdates: AppUpdaterClient['checkForUpdates'] & ReturnType<typeof vi.fn>
  downloadUpdate: AppUpdaterClient['downloadUpdate'] & ReturnType<typeof vi.fn>
  quitAndInstall: AppUpdaterClient['quitAndInstall'] & ReturnType<typeof vi.fn>
}

function createFakeUpdater(): FakeUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    setFeedURL: vi.fn(),
    addAuthHeader: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '1.0.1' } })),
    downloadUpdate: vi.fn(async () => ['installer.exe']),
    quitAndInstall: vi.fn()
  })
}

describe('AppUpdateService', () => {
  it('checks updates from the current server generic feed with a bearer token', async () => {
    const updater = createFakeUpdater()
    const send = vi.fn()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000/' })),
      loadToken: vi.fn(async () => 'token-123'),
      send
    })

    await expect(service.check()).resolves.toBe(true)

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:8000/api/v1/client-updates/win32/x64'
    })
    expect(updater.addAuthHeader).toHaveBeenCalledWith('Bearer token-123')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('skips checking when the token is missing', async () => {
    const updater = createFakeUpdater()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => null),
      send: vi.fn()
    })

    await expect(service.check()).resolves.toBe(false)

    expect(updater.setFeedURL).not.toHaveBeenCalled()
    expect(updater.addAuthHeader).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('rejects install before an update has been downloaded', async () => {
    const updater = createFakeUpdater()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      send: vi.fn()
    })

    expect(() => service.install()).toThrow('更新尚未下载完成')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('installs after an update has been downloaded', async () => {
    const updater = createFakeUpdater()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      send: vi.fn()
    })

    updater.emit('update-downloaded', { version: '1.0.1', files: [] })

    expect(service.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('forwards updater events to the renderer', async () => {
    const updater = createFakeUpdater()
    const send = vi.fn()
    const { AppUpdateService } = await import('../app-updater')
    new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      send
    })

    updater.emit('update-available', { version: '1.0.1' })
    updater.emit('update-not-available', { version: '1.0.0' })
    updater.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
    updater.emit('update-downloaded', { version: '1.0.1', files: [] })
    updater.emit('error', new Error('下载更新失败'))

    expect(send).toHaveBeenCalledWith('app-update:available', { version: '1.0.1' })
    expect(send).toHaveBeenCalledWith('app-update:not-available', { version: '1.0.0' })
    expect(send).toHaveBeenCalledWith('app-update:download-progress', {
      percent: 42,
      transferred: 42,
      total: 100
    })
    expect(send).toHaveBeenCalledWith('app-update:downloaded', { version: '1.0.1', files: [] })
    expect(send).toHaveBeenCalledWith(
      'app-update:error',
      expect.objectContaining({
        message: '下载更新失败'
      })
    )
  })
})
