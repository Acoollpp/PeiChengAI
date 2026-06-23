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

    await import('../index')
    await Promise.resolve()

    const { app } = await import('electron')
    expect(app.setAppUserModelId).toHaveBeenCalledWith('com.peicheng.code-review')
    expect(setApplicationMenu).toHaveBeenCalledWith(null)
    expect(registerIpcHandlers).toHaveBeenCalledWith({
      getMainWindow: expect.any(Function)
    })
    const getMainWindow = registerIpcHandlers.mock.calls[0][0].getMainWindow
    expect(getMainWindow()).toBe(createdWindow)
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

    await import('../index')
    await Promise.resolve()

    const beforeQuitHandler = on.mock.calls.find(([eventName]) => eventName === 'before-quit')?.[1]
    expect(beforeQuitHandler).toBeDefined()

    const event = { preventDefault: vi.fn() }

    await beforeQuitHandler(event)

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

    await import('../index')
    await Promise.resolve()

    const allClosedHandler = on.mock.calls.find(([eventName]) => eventName === 'window-all-closed')?.[1]
    expect(allClosedHandler).toBeDefined()

    allClosedHandler()
    await Promise.resolve()

    expect(cancelAllActiveReviewTasks).toHaveBeenCalledWith()
  })
})
