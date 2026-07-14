import { describe, expect, it, vi } from 'vitest'

describe('main window menu', () => {
  it('clears Electron default application menu before creating the window', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const registerIpcHandlers = vi.fn()
    const feedbackWindowManager = { destroy: vi.fn() }
    const createReportFeedbackWindowManager = vi.fn(() => feedbackWindowManager)
    let createdWindow:
      | {
          loadFile: typeof loadFile
          loadURL: typeof loadURL
          webContents: { setWindowOpenHandler: typeof setWindowOpenHandler }
        }
      | undefined

    function BrowserWindowMock(): {
      loadFile: typeof loadFile
      loadURL: typeof loadURL
      webContents: { setWindowOpenHandler: typeof setWindowOpenHandler }
    } {
      createdWindow = {
        loadFile,
        loadURL,
        webContents: {
          setWindowOpenHandler
        }
      }
      return createdWindow
    }

    vi.doMock('electron', () => ({
      app: {
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
      registerIpcHandlers
    }))
    vi.doMock('../report-feedback-window', () => ({
      createReportFeedbackWindowManager
    }))

    await import('../index')
    await Promise.resolve()

    const { app } = await import('electron')
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.peicheng.code-review')
    expect(setApplicationMenu).toHaveBeenCalledWith(null)
    expect(registerIpcHandlers).toHaveBeenCalledWith({
      getMainWindow: expect.any(Function),
      getReportFeedbackWindowManager: expect.any(Function)
    })
    expect(createReportFeedbackWindowManager).toHaveBeenCalledWith(createdWindow)
    expect(createReportFeedbackWindowManager.mock.invocationCallOrder[0]).toBeLessThan(
      registerIpcHandlers.mock.invocationCallOrder[0]
    )
    const { getMainWindow, getReportFeedbackWindowManager } = registerIpcHandlers.mock.calls[0][0]
    expect(getMainWindow()).toBe(createdWindow)
    expect(getReportFeedbackWindowManager()).toBe(feedbackWindowManager)
  })

  it('registers active task cancellation before app quit', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const cancelAllActiveReviewTasks = vi.fn(async () => undefined)
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
      registerIpcHandlers: vi.fn(),
      cancelAllActiveReviewTasks
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
    expect(cancelAllActiveReviewTasks).toHaveBeenCalledWith()
    expect(event.preventDefault).toHaveBeenCalledWith()
  })

  it('cancels active tasks when all windows are closed', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const cancelAllActiveReviewTasks = vi.fn(async () => undefined)
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
      registerIpcHandlers: vi.fn(),
      cancelAllActiveReviewTasks
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

    expect(cancelAllActiveReviewTasks).toHaveBeenCalledWith()
  })
})
