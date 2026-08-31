import { describe, expect, it, vi } from 'vitest'

describe('main window menu', () => {
  it('创建主窗口前清除默认菜单并在 activate 时更新稳定 manager getter', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const appendSwitch = vi.fn()
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const send = vi.fn()
    const registerIpcHandlers = vi.fn()
    const reviewTaskRuntime = { cancelAll: vi.fn(async () => undefined) }
    const createDefaultReviewTaskRuntime = vi.fn(() => reviewTaskRuntime)
    const getAllWindows = vi.fn(() => [])
    const firstFeedbackWindowManager = { destroy: vi.fn() }
    const secondFeedbackWindowManager = { destroy: vi.fn() }
    const createReportFeedbackWindowManager = vi
      .fn()
      .mockReturnValueOnce(firstFeedbackWindowManager)
      .mockReturnValueOnce(secondFeedbackWindowManager)
    const createdWindows: Array<{
      loadFile: typeof loadFile
      loadURL: typeof loadURL
      options: Electron.BrowserWindowConstructorOptions
      webContents: {
        setWindowOpenHandler: typeof setWindowOpenHandler
        send: typeof send
        isDestroyed: () => boolean
      }
    }> = []

    function BrowserWindowMock(options: Electron.BrowserWindowConstructorOptions): {
      loadFile: typeof loadFile
      loadURL: typeof loadURL
      options: Electron.BrowserWindowConstructorOptions
      webContents: {
        setWindowOpenHandler: typeof setWindowOpenHandler
        send: typeof send
        isDestroyed: () => boolean
      }
    } {
      const createdWindow = {
        loadFile,
        loadURL,
        options,
        webContents: {
          setWindowOpenHandler,
          send,
          isDestroyed: () => false
        }
      }
      createdWindows.push(createdWindow)
      return createdWindow
    }

    vi.doMock('electron', () => ({
      app: {
        commandLine: { appendSwitch },
        whenReady,
        on,
        quit: vi.fn(),
        setAppUserModelId: vi.fn()
      },
      BrowserWindow: Object.assign(BrowserWindowMock, { getAllWindows }),
      Menu: {
        setApplicationMenu
      },
      shell: {
        openExternal: vi.fn()
      }
    }))
    vi.doMock('../ipc', () => ({
      registerIpcHandlers
    }))
    vi.doMock('../review-task-runtime', () => ({ createDefaultReviewTaskRuntime }))
    vi.doMock('../report-feedback-window', () => ({
      createReportFeedbackWindowManager
    }))

    await import('../index')
    await Promise.resolve()

    const { app } = await import('electron')
    expect(appendSwitch).toHaveBeenNthCalledWith(1, 'disable-gpu')
    expect(appendSwitch).toHaveBeenNthCalledWith(2, 'disable-software-rasterizer')
    expect(appendSwitch.mock.invocationCallOrder[0]).toBeLessThan(
      whenReady.mock.invocationCallOrder[0]
    )
    expect(appendSwitch.mock.invocationCallOrder[1]).toBeLessThan(
      whenReady.mock.invocationCallOrder[0]
    )
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.peicheng.code-review')
    expect(setApplicationMenu).toHaveBeenCalledWith(null)
    expect(registerIpcHandlers).toHaveBeenCalledWith({
      getMainWindow: expect.any(Function),
      getReportFeedbackWindowManager: expect.any(Function),
      prepareForAppUpdateInstall: expect.any(Function),
      reviewTaskRuntime
    })
    expect(createReportFeedbackWindowManager).toHaveBeenCalledWith(createdWindows[0], {
      onContextCleared: expect.any(Function)
    })
    expect(createdWindows[0].options.webPreferences?.preload).toMatch(
      /preload[\\/]index\.(?:mjs|js)$/
    )
    expect(loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer[\\/]index\.html$/)
    )
    expect(createReportFeedbackWindowManager.mock.invocationCallOrder[0]).toBeLessThan(
      registerIpcHandlers.mock.invocationCallOrder[0]
    )
    const { getMainWindow, getReportFeedbackWindowManager } = registerIpcHandlers.mock.calls[0][0]
    expect(getMainWindow()).toBe(createdWindows[0])
    expect(getReportFeedbackWindowManager()).toBe(firstFeedbackWindowManager)
    const { onContextCleared } = createReportFeedbackWindowManager.mock.calls[0][1]
    onContextCleared('task-1')
    expect(send).toHaveBeenCalledWith('report-feedback:focus-anchor', { taskId: 'task-1' })

    const activateHandler = on.mock.calls.find(([eventName]) => eventName === 'activate')?.[1]
    expect(activateHandler).toBeDefined()
    activateHandler()

    expect(createdWindows).toHaveLength(2)
    expect(createReportFeedbackWindowManager).toHaveBeenNthCalledWith(2, createdWindows[1], {
      onContextCleared: expect.any(Function)
    })
    expect(getMainWindow()).toBe(createdWindows[1])
    expect(getReportFeedbackWindowManager()).toBe(secondFeedbackWindowManager)

    firstFeedbackWindowManager.destroy()
    expect(getReportFeedbackWindowManager()).toBe(secondFeedbackWindowManager)

    const { prepareForAppUpdateInstall } = registerIpcHandlers.mock.calls[0][0]
    await prepareForAppUpdateInstall()
    const beforeQuitHandler = on.mock.calls.find(([eventName]) => eventName === 'before-quit')?.[1]
    const updateQuitEvent = { preventDefault: vi.fn() }
    beforeQuitHandler(updateQuitEvent)
    expect(reviewTaskRuntime.cancelAll).toHaveBeenCalledTimes(1)
    expect(updateQuitEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('registers active task cancellation before app quit', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const appendSwitch = vi.fn()
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const cancelAll = vi.fn(async () => undefined)
    const reviewTaskRuntime = { cancelAll }
    const feedbackWindowManager = { destroy: vi.fn() }
    const createReportFeedbackWindowManager = vi.fn(() => feedbackWindowManager)

    function BrowserWindowMock(): {
      loadFile: typeof loadFile
      loadURL: typeof loadURL
      webContents: { setWindowOpenHandler: typeof setWindowOpenHandler }
    } {
      return {
        loadFile,
        loadURL,
        webContents: {
          setWindowOpenHandler
        }
      }
    }

    vi.doMock('electron', () => ({
      app: {
        commandLine: { appendSwitch },
        whenReady,
        on,
        quit: vi.fn(),
        setAppUserModelId: vi.fn()
      },
      BrowserWindow: BrowserWindowMock,
      Menu: {
        setApplicationMenu
      },
      shell: {
        openExternal: vi.fn()
      }
    }))
    vi.doMock('../ipc', () => ({
      registerIpcHandlers: vi.fn()
    }))
    vi.doMock('../review-task-runtime', () => ({
      createDefaultReviewTaskRuntime: vi.fn(() => reviewTaskRuntime)
    }))
    vi.doMock('../report-feedback-window', () => ({
      createReportFeedbackWindowManager
    }))

    await import('../index')
    await Promise.resolve()

    const beforeQuitHandler = on.mock.calls.find(([eventName]) => eventName === 'before-quit')?.[1]
    expect(beforeQuitHandler).toBeDefined()

    const event = { preventDefault: vi.fn() }

    await beforeQuitHandler(event)

    expect(feedbackWindowManager.destroy).toHaveBeenCalledTimes(1)
    expect(cancelAll).toHaveBeenCalledWith()
    expect(event.preventDefault).toHaveBeenCalledWith()
  })

  it('cancels active tasks when all windows are closed', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const appendSwitch = vi.fn()
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const cancelAll = vi.fn(async () => undefined)
    const reviewTaskRuntime = { cancelAll }
    const createReportFeedbackWindowManager = vi.fn(() => ({ destroy: vi.fn() }))

    function BrowserWindowMock(): {
      loadFile: typeof loadFile
      loadURL: typeof loadURL
      webContents: { setWindowOpenHandler: typeof setWindowOpenHandler }
    } {
      return {
        loadFile,
        loadURL,
        webContents: {
          setWindowOpenHandler
        }
      }
    }

    vi.doMock('electron', () => ({
      app: {
        commandLine: { appendSwitch },
        whenReady,
        on,
        quit: vi.fn(),
        setAppUserModelId: vi.fn()
      },
      BrowserWindow: BrowserWindowMock,
      Menu: {
        setApplicationMenu
      },
      shell: {
        openExternal: vi.fn()
      }
    }))
    vi.doMock('../ipc', () => ({
      registerIpcHandlers: vi.fn()
    }))
    vi.doMock('../review-task-runtime', () => ({
      createDefaultReviewTaskRuntime: vi.fn(() => reviewTaskRuntime)
    }))
    vi.doMock('../report-feedback-window', () => ({
      createReportFeedbackWindowManager
    }))

    await import('../index')
    await Promise.resolve()

    const allClosedHandler = on.mock.calls.find(([eventName]) => eventName === 'window-all-closed')?.[1]
    expect(allClosedHandler).toBeDefined()

    allClosedHandler()
    await Promise.resolve()

    expect(cancelAll).toHaveBeenCalledWith()
  })
})
