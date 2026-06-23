import { app, BrowserWindow, Menu } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { cancelAllActiveReviewTasks, registerIpcHandlers } from './ipc'
import { configureExternalLinkHandling } from './window-security'

const APP_USER_MODEL_ID = 'com.peicheng.code-review'
let mainWindow: BrowserWindow | undefined

const resolvePreloadPath = (): string => {
  const mjsPath = join(__dirname, '../preload/index.mjs')
  if (existsSync(mjsPath)) {
    return mjsPath
  }

  return join(__dirname, '../preload/index.js')
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Code Review Client',
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  const window = mainWindow

  configureExternalLinkHandling(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  Menu.setApplicationMenu(null)
  registerIpcHandlers({
    getMainWindow: () => mainWindow
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  void cancelAllActiveReviewTasks().finally(() => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
})

let isQuittingAfterTaskCleanup = false

app.on('before-quit', (event) => {
  if (isQuittingAfterTaskCleanup) {
    return
  }

  event.preventDefault()
  void cancelAllActiveReviewTasks().finally(() => {
    isQuittingAfterTaskCleanup = true
    app.quit()
  })
})
