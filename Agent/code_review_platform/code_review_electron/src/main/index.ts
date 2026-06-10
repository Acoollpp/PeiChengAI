import { app, BrowserWindow, Menu } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { registerIpcHandlers } from './ipc'
import { configureExternalLinkHandling } from './window-security'

const resolvePreloadPath = (): string => {
  const mjsPath = join(__dirname, '../preload/index.mjs')
  if (existsSync(mjsPath)) {
    return mjsPath
  }

  return join(__dirname, '../preload/index.js')
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
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

  configureExternalLinkHandling(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
