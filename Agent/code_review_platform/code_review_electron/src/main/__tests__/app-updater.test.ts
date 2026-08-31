import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'
import type { AppUpdaterClient } from '../app-updater'

const optionalPolicy = {
  platform: 'win32',
  arch: 'x64',
  current_version: '1.0.0',
  active_version: '1.0.1',
  minimum_supported_version: '1.0.0',
  update_available: true,
  update_required: false,
  release_notes: '修复更新问题'
}

interface FakeUpdater extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
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
    autoRunAppAfterInstall: true,
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
      loadPolicy: vi.fn(async () => optionalPolicy),
      send
    })

    await expect(service.check()).resolves.toEqual({ status: 'optional', policy: optionalPolicy })

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

    await expect(service.check()).resolves.toEqual({ status: 'check_failed' })

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

    await expect(service.install()).rejects.toThrow('更新尚未下载完成')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('allows use when the policy request fails', async () => {
    const updater = createFakeUpdater()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      loadPolicy: vi.fn(async () => {
        throw new Error('服务不可用')
      }),
      send: vi.fn()
    })

    await expect(service.check()).resolves.toEqual({ status: 'check_failed' })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('allows use when the policy request times out', async () => {
    const updater = createFakeUpdater()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      loadPolicy: vi.fn(() => new Promise<typeof optionalPolicy>(() => undefined)),
      updateCheckTimeoutMs: 5,
      send: vi.fn()
    })

    await expect(service.check()).resolves.toEqual({ status: 'check_failed' })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('does not block login while an optional updater check is pending', async () => {
    const updater = createFakeUpdater()
    updater.checkForUpdates.mockImplementation(() => new Promise(() => undefined))
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      loadPolicy: vi.fn(async () => optionalPolicy),
      updateCheckTimeoutMs: 5,
      send: vi.fn()
    })

    await expect(service.check()).resolves.toEqual({ status: 'optional', policy: optionalPolicy })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('locks forced updates and starts only one automatic download', async () => {
    const updater = createFakeUpdater()
    const send = vi.fn()
    const requiredPolicy = { ...optionalPolicy, minimum_supported_version: '1.0.1', update_required: true }
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      loadPolicy: vi.fn(async () => requiredPolicy),
      send
    })

    await expect(service.check()).resolves.toEqual({ status: 'required', policy: requiredPolicy })

    await vi.waitFor(() => {
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    })

    expect(send).toHaveBeenCalledWith('app-update:required', requiredPolicy)
  })

  it('starts a required download when update availability arrives after a timeout', async () => {
    const updater = createFakeUpdater()
    updater.checkForUpdates.mockImplementation(() => new Promise(() => undefined))
    const send = vi.fn()
    const requiredPolicy = { ...optionalPolicy, minimum_supported_version: '1.0.1', update_required: true }
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      loadPolicy: vi.fn(async () => requiredPolicy),
      updateCheckTimeoutMs: 5,
      send
    })

    await expect(service.check()).resolves.toEqual({ status: 'required', policy: requiredPolicy })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'app-update:error',
        expect.objectContaining({ message: '更新检查超时', phase: 'download' })
      )
    })

    updater.emit('update-available', { version: '1.0.1' })
    await vi.waitFor(() => {
      expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    })
  })

  it('exits through the injected app quit action', async () => {
    const quit = vi.fn()
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => createFakeUpdater() as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      quit
    })

    expect(service.quit()).toBe(true)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('installs after an update has been downloaded', async () => {
    const updater = createFakeUpdater()
    const send = vi.fn()
    const operationOrder: string[] = []
    const prepareInstall = vi.fn(async () => {
      operationOrder.push('prepare')
    })
    updater.quitAndInstall.mockImplementation(() => {
      operationOrder.push('install')
    })
    const { AppUpdateService } = await import('../app-updater')
    const service = new AppUpdateService({
      createUpdater: () => updater as unknown as AppUpdaterClient,
      loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      loadToken: vi.fn(async () => 'token-123'),
      prepareInstall,
      send
    })

    updater.emit('update-downloaded', { version: '1.0.1', files: [] })

    await expect(service.install()).resolves.toBe(true)
    expect(prepareInstall).toHaveBeenCalledTimes(1)
    expect(operationOrder).toEqual(['prepare', 'install'])
    expect(updater.autoRunAppAfterInstall).toBe(false)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, false)

    updater.emit('error', new Error('安装启动失败'))
    expect(send).toHaveBeenCalledWith(
      'app-update:error',
      expect.objectContaining({ message: '安装启动失败', phase: 'install' })
    )
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
