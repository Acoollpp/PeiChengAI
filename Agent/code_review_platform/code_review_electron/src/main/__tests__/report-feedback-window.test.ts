import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  LegacyReportFeedbackContext,
  ReportFeedbackContext
} from '../../shared/report-feedback-window'
import type { ReportFeedbackWindowManager } from '../report-feedback-window'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

interface MockFeedbackWindow {
  options: Record<string, unknown>
  handlers: Map<string, () => void>
  destroy: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  loadDeferred: Deferred
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  webContents: { id: number }
}

const electronMock = vi.hoisted(() => ({
  createdWindows: [] as MockFeedbackWindow[],
  nextSenderId: 100
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function BrowserWindowMock(options: Record<string, unknown>) {
    const handlers = new Map<string, () => void>()
    let destroyed = false
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const loadDeferred = { promise, resolve, reject }
    const window = {
      options,
      handlers,
      destroy: vi.fn(() => {
        destroyed = true
      }),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      loadDeferred,
      loadFile: vi.fn(() => loadDeferred.promise),
      loadURL: vi.fn(() => loadDeferred.promise),
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

const createContext = (taskId = 'task-1'): LegacyReportFeedbackContext => ({
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

const openLoadedWindow = async (
  manager: ReportFeedbackWindowManager,
  context: ReportFeedbackContext
): Promise<MockFeedbackWindow> => {
  const openPromise = manager.open(context)
  const window = electronMock.createdWindows.at(-1)
  if (!window) {
    throw new Error('反馈窗口未创建')
  }

  window.loadDeferred.resolve()
  await openPromise
  return window
}

describe('ReportFeedbackWindowManager', () => {
  afterEach(() => {
    electronMock.createdWindows.splice(0)
    electronMock.nextSenderId = 100
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('创建可移出主客户端的非模态子窗口并使用专用 preload', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const mainWindow = createMainWindow()
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')

    const manager = createReportFeedbackWindowManager(mainWindow as never)
    const openPromise = manager.open(createContext())
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
    ).toMatch(/preload[\\/]report-feedback\.(?:mjs|js)$/)
    expect(feedbackWindow.loadURL).toHaveBeenCalledWith('http://localhost:5173/feedback.html')
    expect(feedbackWindow.show).not.toHaveBeenCalled()

    feedbackWindow.handlers.get('ready-to-show')?.()
    expect(feedbackWindow.show).toHaveBeenCalledTimes(1)
    feedbackWindow.loadDeferred.resolve()
    await expect(openPromise).resolves.toBe(true)
  })

  it('生产环境加载反馈页面文件', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const feedbackWindow = await openLoadedWindow(manager, createContext())

    expect(feedbackWindow.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer[\\/]feedback\.html$/)
    )
  })

  it('同一任务加载完成后只聚焦现有窗口且不重复创建', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)
    const feedbackWindow = await openLoadedWindow(manager, createContext('task-1'))

    await expect(manager.open(createContext('task-1'))).resolves.toBe(true)

    expect(electronMock.createdWindows).toHaveLength(1)
    expect(feedbackWindow.focus).toHaveBeenCalledTimes(1)
  })

  it('同一任务加载中重复打开会共同等待且加载失败时全部拒绝', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const firstOpen = manager.open(createContext('task-1'))
    const feedbackWindow = electronMock.createdWindows[0]
    const secondOpen = manager.open(createContext('task-1'))
    let secondSettled = false
    void secondOpen.then(
      () => {
        secondSettled = true
      },
      () => {
        secondSettled = true
      }
    )
    await Promise.resolve()

    expect(electronMock.createdWindows).toHaveLength(1)
    expect(feedbackWindow.focus).toHaveBeenCalledTimes(1)
    expect(secondSettled).toBe(false)

    const loadError = new Error('页面加载失败')
    const firstResult = expect(firstOpen).rejects.toThrow('页面加载失败')
    const secondResult = expect(secondOpen).rejects.toThrow('页面加载失败')
    feedbackWindow.loadDeferred.reject(loadError)
    await Promise.all([firstResult, secondResult])
  })

  it('不同任务销毁旧窗口后创建新窗口', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const firstWindow = await openLoadedWindow(manager, createContext('task-1'))
    const secondWindow = await openLoadedWindow(manager, createContext('task-2'))

    expect(electronMock.createdWindows).toHaveLength(2)
    expect(firstWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(firstWindow.webContents.id)).toBe(false)
    expect(manager.isCurrentSender(secondWindow.webContents.id)).toBe(true)
  })

  it('旧任务 load 晚成功不会让旧 open 成功或覆盖新上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const oldOpen = manager.open(createContext('task-1'))
    const oldWindow = electronMock.createdWindows[0]
    const newOpen = manager.open(createContext('task-2'))
    const newWindow = electronMock.createdWindows[1]
    newWindow.loadDeferred.resolve()
    await expect(newOpen).resolves.toBe(true)

    const oldResult = expect(oldOpen).rejects.toThrow('反馈窗口已失效')
    oldWindow.loadDeferred.resolve()
    await oldResult
    expect(manager.getContext(newWindow.webContents.id).taskId).toBe('task-2')
  })

  it('旧任务 load 晚失败不会清理新上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const oldOpen = manager.open(createContext('task-1'))
    const oldWindow = electronMock.createdWindows[0]
    const newOpen = manager.open(createContext('task-2'))
    const newWindow = electronMock.createdWindows[1]
    newWindow.loadDeferred.resolve()
    await expect(newOpen).resolves.toBe(true)

    const oldResult = expect(oldOpen).rejects.toThrow('旧页面加载失败')
    oldWindow.loadDeferred.reject(new Error('旧页面加载失败'))
    await oldResult
    expect(manager.getContext(newWindow.webContents.id).taskId).toBe('task-2')
  })

  it('旧窗口延迟 closed 不会清理新窗口', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const onContextCleared = vi.fn()
    const manager = createReportFeedbackWindowManager(createMainWindow() as never, {
      onContextCleared
    })

    const oldOpen = manager.open(createContext('task-1'))
    const oldWindow = electronMock.createdWindows[0]
    const newOpen = manager.open(createContext('task-2'))
    const newWindow = electronMock.createdWindows[1]
    oldWindow.handlers.get('closed')?.()
    expect(manager.isCurrentSender(newWindow.webContents.id)).toBe(true)
    expect(onContextCleared).toHaveBeenCalledTimes(1)
    expect(onContextCleared).toHaveBeenCalledWith('task-1')

    newWindow.loadDeferred.resolve()
    await expect(newOpen).resolves.toBe(true)
    const oldResult = expect(oldOpen).rejects.toThrow('反馈窗口已失效')
    oldWindow.loadDeferred.resolve()
    await oldResult
    expect(manager.getContext(newWindow.webContents.id).taskId).toBe('task-2')
    expect(onContextCleared).toHaveBeenCalledTimes(1)
  })

  it('严格校验 sender 并返回无法篡改内部状态的上下文拷贝', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)
    const original = createContext()

    const feedbackWindow = await openLoadedWindow(manager, original)
    const senderId = feedbackWindow.webContents.id
    original.options[0].text = '外部已修改'
    const returned = manager.getContext(senderId)
    if (returned.mode === 'issues') {
      throw new Error('应返回历史反馈上下文')
    }
    returned.options[0].text = '返回值已修改'

    const reread = manager.getContext(senderId)
    if (reread.mode === 'issues') {
      throw new Error('应返回历史反馈上下文')
    }
    expect(reread.options[0].text).toBe('定位准确')
    expect(manager.isCurrentSender(senderId)).toBe(true)
    expect(manager.isCurrentSender(senderId + 1)).toBe(false)
    expect(() => manager.getContext(senderId + 1)).toThrow('无权访问当前反馈窗口')
    expect(() => manager.close(senderId + 1)).toThrow('无权关闭当前反馈窗口')
  })

  it('仅按匹配的任务 ID 关闭当前反馈窗口', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)
    const feedbackWindow = await openLoadedWindow(manager, createContext('task-1'))

    expect(manager.closeTask('task-2')).toBe(false)
    expect(feedbackWindow.destroy).not.toHaveBeenCalled()
    expect(manager.isCurrentSender(feedbackWindow.webContents.id)).toBe(true)

    expect(manager.closeTask('task-1')).toBe(true)
    expect(feedbackWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(feedbackWindow.webContents.id)).toBe(false)
  })

  it('清理回调抛错时按任务关闭仍销毁窗口并清空上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const onContextCleared = vi.fn(() => {
      throw new Error('清理高亮失败')
    })
    const manager = createReportFeedbackWindowManager(createMainWindow() as never, {
      onContextCleared
    })
    const feedbackWindow = await openLoadedWindow(manager, createContext('task-1'))

    expect(() => manager.closeTask('task-1')).not.toThrow()
    expect(feedbackWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(feedbackWindow.webContents.id)).toBe(false)
    expect(() => manager.getContext(feedbackWindow.webContents.id)).toThrow(
      '无权访问当前反馈窗口'
    )
    expect(onContextCleared).toHaveBeenCalledTimes(1)
    expect(onContextCleared).toHaveBeenCalledWith('task-1')
  })

  it('替换任务时清理回调抛错仍打开新窗口且旧窗口迟到关闭不影响新上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const onContextCleared = vi.fn((taskId: string) => {
      if (taskId === 'task-1') {
        throw new Error('清理旧任务高亮失败')
      }
    })
    const manager = createReportFeedbackWindowManager(createMainWindow() as never, {
      onContextCleared
    })

    const oldWindow = await openLoadedWindow(manager, createContext('task-1'))
    const newOpen = manager.open(createContext('task-2'))
    const newWindow = electronMock.createdWindows[1]
    expect(newWindow).toBeDefined()
    newWindow.loadDeferred.resolve()

    await expect(newOpen).resolves.toBe(true)
    expect(oldWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.getContext(newWindow.webContents.id).taskId).toBe('task-2')

    oldWindow.handlers.get('closed')?.()
    expect(manager.getContext(newWindow.webContents.id).taskId).toBe('task-2')
    expect(onContextCleared).toHaveBeenCalledTimes(1)
    expect(onContextCleared).toHaveBeenCalledWith('task-1')
  })

  it('原生关闭、显式关闭和主窗口销毁都会清理窗口上下文', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const mainWindow = createMainWindow()
    const onContextCleared = vi.fn()
    const manager = createReportFeedbackWindowManager(mainWindow as never, { onContextCleared })

    const firstWindow = await openLoadedWindow(manager, createContext('task-1'))
    firstWindow.handlers.get('closed')?.()
    expect(manager.isCurrentSender(firstWindow.webContents.id)).toBe(false)
    expect(onContextCleared).toHaveBeenLastCalledWith('task-1')

    const secondWindow = await openLoadedWindow(manager, createContext('task-2'))
    expect(manager.close(secondWindow.webContents.id)).toBe(true)
    expect(secondWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(secondWindow.webContents.id)).toBe(false)
    expect(onContextCleared).toHaveBeenLastCalledWith('task-2')

    const thirdWindow = await openLoadedWindow(manager, createContext('task-3'))
    mainWindow.handlers.get('closed')?.()
    expect(thirdWindow.destroy).toHaveBeenCalledTimes(1)
    expect(manager.isCurrentSender(thirdWindow.webContents.id)).toBe(false)
    expect(onContextCleared).toHaveBeenLastCalledWith('task-3')
    expect(onContextCleared).toHaveBeenCalledTimes(3)
  })

  it('窗口在加载期间关闭时 open 不会成功', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const openPromise = manager.open(createContext())
    const feedbackWindow = electronMock.createdWindows[0]
    manager.close(feedbackWindow.webContents.id)

    const openResult = expect(openPromise).rejects.toThrow('反馈窗口已失效')
    feedbackWindow.loadDeferred.resolve()
    await openResult
  })

  it('页面加载失败时销毁窗口、清理上下文并拒绝打开', async () => {
    const { createReportFeedbackWindowManager } = await import('../report-feedback-window')
    const manager = createReportFeedbackWindowManager(createMainWindow() as never)

    const openPromise = manager.open(createContext())
    const feedbackWindow = electronMock.createdWindows[0]
    const openResult = expect(openPromise).rejects.toThrow('页面加载失败')
    feedbackWindow.loadDeferred.reject(new Error('页面加载失败'))

    await openResult
    expect(feedbackWindow.destroy).toHaveBeenCalledTimes(1)
    expect(feedbackWindow.isDestroyed()).toBe(true)
    expect(manager.isCurrentSender(feedbackWindow.webContents.id)).toBe(false)
  })
})
