import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { ReportFeedbackContext } from '../shared/report-feedback-window'

export interface ReportFeedbackWindowManager {
  open(context: ReportFeedbackContext): Promise<true>
  getContext(senderId: number): ReportFeedbackContext
  isCurrentSender(senderId: number): boolean
  close(senderId: number): true
  closeTask(taskId: string): boolean
  destroy(): void
}

interface ReportFeedbackWindowManagerOptions {
  onContextCleared?: (taskId: string) => void
}

const cloneContext = (context: ReportFeedbackContext): ReportFeedbackContext => ({
  taskId: context.taskId,
  options: context.options.map((option) => ({ ...option }))
})

const resolvePreloadPath = (): string => {
  const mjsPath = join(__dirname, '../preload/report-feedback.mjs')
  if (existsSync(mjsPath)) {
    return mjsPath
  }

  return join(__dirname, '../preload/report-feedback.js')
}

const createWindowOptions = (mainWindow: BrowserWindow): BrowserWindowConstructorOptions => ({
  width: 720,
  height: 680,
  minWidth: 560,
  minHeight: 480,
  title: '报告有用信息反馈',
  parent: mainWindow,
  modal: false,
  show: false,
  autoHideMenuBar: true,
  webPreferences: {
    preload: resolvePreloadPath(),
    sandbox: false,
    contextIsolation: true
  }
})

export const createReportFeedbackWindowManager = (
  mainWindow: BrowserWindow,
  options: ReportFeedbackWindowManagerOptions = {}
): ReportFeedbackWindowManager => {
  let feedbackWindow: BrowserWindow | null = null
  let context: ReportFeedbackContext | null = null
  let currentLoadPromise: Promise<void> | null = null

  const clearCurrent = (window: BrowserWindow): void => {
    if (feedbackWindow !== window) {
      return
    }

    const clearedContext = context
    feedbackWindow = null
    context = null
    currentLoadPromise = null
    if (clearedContext) {
      try {
        options.onContextCleared?.(clearedContext.taskId)
      } catch {
        // 高亮清理失败不应阻断反馈窗口生命周期。
      }
    }
  }

  const destroyCurrent = (): void => {
    const window = feedbackWindow
    if (!window) {
      return
    }

    try {
      clearCurrent(window)
    } finally {
      if (!window.isDestroyed()) {
        window.destroy()
      }
    }
  }

  const isCurrentSender = (senderId: number): boolean =>
    Boolean(
      feedbackWindow &&
        !feedbackWindow.isDestroyed() &&
        feedbackWindow.webContents.id === senderId
    )

  const waitForWindowLoad = async (
    window: BrowserWindow,
    windowLoadPromise: Promise<void>
  ): Promise<true> => {
    try {
      await windowLoadPromise
    } catch (error) {
      if (feedbackWindow === window) {
        clearCurrent(window)
        if (!window.isDestroyed()) {
          window.destroy()
        }
      }
      throw error
    }

    if (feedbackWindow !== window || window.isDestroyed()) {
      throw new Error('反馈窗口已失效')
    }

    if (currentLoadPromise === windowLoadPromise) {
      currentLoadPromise = null
    }
    return true
  }

  const manager: ReportFeedbackWindowManager = {
    async open(nextContext) {
      if (feedbackWindow?.isDestroyed()) {
        clearCurrent(feedbackWindow)
      }

      if (feedbackWindow && context?.taskId === nextContext.taskId) {
        const window = feedbackWindow
        window.focus()
        if (currentLoadPromise) {
          return waitForWindowLoad(window, currentLoadPromise)
        }
        return true
      }

      destroyCurrent()

      const window = new BrowserWindow(createWindowOptions(mainWindow))
      feedbackWindow = window
      context = cloneContext(nextContext)

      window.once('ready-to-show', () => {
        if (feedbackWindow === window && !window.isDestroyed()) {
          window.show()
        }
      })
      window.once('closed', () => {
        clearCurrent(window)
      })

      let windowLoadPromise: Promise<void>
      try {
        if (process.env.ELECTRON_RENDERER_URL) {
          const rendererUrl = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '')
          windowLoadPromise = window.loadURL(`${rendererUrl}/feedback.html`)
        } else {
          windowLoadPromise = window.loadFile(join(__dirname, '../renderer/feedback.html'))
        }
      } catch (error) {
        clearCurrent(window)
        if (!window.isDestroyed()) {
          window.destroy()
        }
        throw error
      }

      currentLoadPromise = windowLoadPromise
      return waitForWindowLoad(window, windowLoadPromise)
    },

    getContext(senderId) {
      if (!isCurrentSender(senderId) || !context) {
        throw new Error('无权访问当前反馈窗口')
      }

      return cloneContext(context)
    },

    isCurrentSender,

    close(senderId) {
      if (!isCurrentSender(senderId)) {
        throw new Error('无权关闭当前反馈窗口')
      }

      destroyCurrent()
      return true
    },

    closeTask(taskId) {
      if (!feedbackWindow || context?.taskId !== taskId) {
        return false
      }

      destroyCurrent()
      return true
    },

    destroy: destroyCurrent
  }

  mainWindow.once('closed', manager.destroy)

  return manager
}
