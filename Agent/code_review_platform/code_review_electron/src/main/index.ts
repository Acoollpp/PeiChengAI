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
import {
  getDevelopmentRendererUrl,
  getRendererDocumentName,
  isWorkbenchPreviewEnabled
} from './renderer-entry'

const APP_USER_MODEL_ID = 'com.peicheng.code-review'
const MAIN_PROCESS_DIR = dirname(fileURLToPath(import.meta.url))
const workbenchPreviewEnabled = isWorkbenchPreviewEnabled()
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
    width: workbenchPreviewEnabled ? 1440 : 1180,
    height: workbenchPreviewEnabled ? 900 : 760,
    minWidth: 920,
    minHeight: 620,
    title: 'Code Review Client',
    webPreferences: {
      preload: workbenchPreviewEnabled ? undefined : resolvePreloadPath(),
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
    void window.loadURL(
      getDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL, workbenchPreviewEnabled)
    )
  } else {
    void window.loadFile(
      join(MAIN_PROCESS_DIR, '../renderer', getRendererDocumentName(workbenchPreviewEnabled))
    )
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
