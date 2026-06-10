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
})
