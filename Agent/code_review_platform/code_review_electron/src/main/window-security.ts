import { shell, type BrowserWindow } from 'electron'

const allowedExternalProtocols = new Set(['http:', 'https:', 'mailto:'])

export const isSafeExternalUrl = (url: string): boolean => {
  try {
    return allowedExternalProtocols.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export const configureExternalLinkHandling = (
  mainWindow: BrowserWindow,
  openExternal: typeof shell.openExternal = shell.openExternal
): void => {
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void openExternal(url)
    }

    return { action: 'deny' }
  })
}
