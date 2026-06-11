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
        quit: vi.fn()
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

    await import('../index')
    await Promise.resolve()

    expect(setApplicationMenu).toHaveBeenCalledWith(null)
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
        quit: vi.fn()
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
        quit: vi.fn()
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
