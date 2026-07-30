import { app, BrowserWindow, Menu } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cancelAllActiveReviewTasks, registerIpcHandlers } from './ipc'
import {
  createReportFeedbackWindowManager,
  type ReportFeedbackWindowManager
} from './report-feedback-window'
import { configureExternalLinkHandling } from './window-security'

const APP_USER_MODEL_ID = 'com.peicheng.code-review'
const MAIN_PROCESS_DIR = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | undefined
let reportFeedbackWindowManager: ReportFeedbackWindowManager | undefined

const resolvePreloadPath = (): string => {
  const mjsPath = join(MAIN_PROCESS_DIR, '../preload/index.mjs')
  if (existsSync(mjsPath)) {
    return mjsPath
  }

  return join(MAIN_PROCESS_DIR, '../preload/index.js')
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
  reportFeedbackWindowManager = createReportFeedbackWindowManager(window, {
    onContextCleared: (taskId) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('report-feedback:focus-anchor', { taskId })
      }
    }
  })

  configureExternalLinkHandling(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(MAIN_PROCESS_DIR, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  Menu.setApplicationMenu(null)
  createWindow()
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getReportFeedbackWindowManager: () => reportFeedbackWindowManager
  })

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
  reportFeedbackWindowManager?.destroy()

  if (isQuittingAfterTaskCleanup) {
    return
  }

  event.preventDefault()
  void cancelAllActiveReviewTasks().finally(() => {
    isQuittingAfterTaskCleanup = true
    app.quit()
  })
})
