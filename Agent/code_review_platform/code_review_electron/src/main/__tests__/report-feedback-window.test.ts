import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReportFeedbackContext } from '../../shared/report-feedback-window'

const electronMock = vi.hoisted(() => ({
  createdWindows: [] as Array<{
    options: Record<string, unknown>
    handlers: Map<string, () => void>
    destroy: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    webContents: { id: number }
  }>,
  nextSenderId: 100,
  nextLoadError: null as Error | null
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function BrowserWindowMock(options: Record<string, unknown>) {
    const handlers = new Map<string, () => void>()
    const window = {
      options,
      handlers,
      destroy: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadFile: vi.fn(async () => {
        if (electronMock.nextLoadError) {
          throw electronMock.nextLoadError
        }
      }),
      loadURL: vi.fn(async () => undefined),
      once: vi.fn((eventName: string, handler: () => void) => {
        handlers.set(eventName, handler)
      }),
      show: vi.fn(),
      webContents: { id: electronMock.nextSenderId++ }
    }

    electronMock.createdWindows.push(window)
    return window
  })
}))

const createContext = (taskId = 'task-1'): ReportFeedbackContext => ({
  taskId,
  options: [
    {
      id: `${taskId}-option-1`,
      text: '定位准确',
      anchorId: 'issue-1'
    }
  ]
})

const createMainWindow = () => {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((eventName: string, handler: () => void) => {
      handlers.set(eventName, handler)
    })
  }
}

describe('ReportFeedbackWindowManager', () => {
  afterEach(() => {
    electronMock.createdWindows.splice(0)
    electronMock.nextSenderId = 100
    electronMock.nextLoadError = null
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('创建可移出主客户端的非模态子窗口并使用专用 preload', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const mainWindow = createMainWindow()
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')

    const manager = createReportFeedbackWindowManager(mainWindow as never)
    await expect(manager.open(createContext())).resolves.toBe(true)

    const feedbackWindow = electronMock.createdWindows[0]
    expect(feedbackWindow.options).toMatchObject({
      parent: mainWindow,
      modal: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: false
      }
    })
    expect(feedbackWindow.options.alwaysOnTop).toBeUndefined()
    expect(
      (feedbackWindow.options.webPreferences as { preload: string }).preload
    ).toMatch(/preload\/report-feedback\.(?:mjs|js)$/)
    expect(feedbackWindow.loadURL).toHaveBeenCalledWith('http://localhost:5173/feedback.html')
    expect(feedbackWindow.show).not.toHaveBeenCalled()

    feedbackWindow.handlers.get('ready-to-show')?.()
    expect(feedbackWindow.show).toHaveBeenCalledTimes(1)
  })

  it('生产环境加载反馈页面文件', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    await manager.open(createContext())

    expect(electronMock.createdWindows[0].loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer\/feedback\.html$/)
    )
  })

  it('同一任务只聚焦现有窗口且不重复创建', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    await manager.open(createContext('task-1'))
    await expect(manager.open(createContext('task-1'))).resolves.toBe(true)

    expect(electronMock.createdWindows).toHaveLength(1)
    expect(electronMock.createdWindows[0].focus).toHaveBeenCalledTimes(1)
  })

  it('不同任务销毁旧窗口后创建新窗口', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    await manager.open(createContext('task-1'))
    await manager.open(createContext('task-2'))

    expect(electronMock.createdWindows).toHaveLength(2)
    expect(electronMock.createdWindows[0].destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(electronMock.createdWindows[0].webContents.id)).toBe(false)
    expect(manager.isCurrentSender(electronMock.createdWindows[1].webContents.id)).toBe(true)
  })

  it('严格校验 sender 并返回无法篡改内部状态的上下文拷贝', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)
    const original = createContext()

    await manager.open(original)
    const senderId = electronMock.createdWindows[0].webContents.id
    original.options[0].text = '外部已修改'
    const returned = manager.getContext(senderId)
    returned.options[0].text = '返回值已修改'

    expect(manager.getContext(senderId).options[0].text).toBe('定位准确')
    expect(manager.isCurrentSender(senderId)).toBe(true)
    expect(manager.isCurrentSender(senderId + 1)).toBe(false)
    expect(() => manager.getContext(senderId + 1)).toThrow('无权访问当前反馈窗口')
    expect(() => manager.close(senderId + 1)).toThrow('无权关闭当前反馈窗口')
  })

  it('原生关闭、显式关闭和主窗口销毁都会清理窗口上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const mainWindow = createMainWindow()
    const manager = createReportFeedbackWindowManager(mainWindow as never)

    await manager.open(createContext('task-1'))
    const firstWindow = electronMock.createdWindows[0]
    firstWindow.handlers.get('closed')?.()
    expect(manager.isCurrentSender(firstWindow.webContents.id)).toBe(false)

    await manager.open(createContext('task-2'))
    const secondWindow = electronMock.createdWindows[1]
    expect(manager.close(secondWindow.webContents.id)).toBe(true)
    expect(secondWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(secondWindow.webContents.id)).toBe(false)

    await manager.open(createContext('task-3'))
    const thirdWindow = electronMock.createdWindows[2]
    mainWindow.handlers.get('closed')?.()
    expect(thirdWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(thirdWindow.webContents.id)).toBe(false)
  })

  it('页面加载失败时销毁窗口、清理上下文并拒绝打开', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)
    const loadError = new Error('页面加载失败')
    electronMock.nextLoadError = loadError

    await expect(manager.open(createContext())).rejects.toThrow('页面加载失败')
    const feedbackWindow = electronMock.createdWindows[0]
    expect(feedbackWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(feedbackWindow.webContents.id)).toBe(false)
  })
})
