// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const exposeInMainWorldMock = vi.hoisted(() => vi.fn())
const getPathForFileMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock
  },
  ipcRenderer: {
    invoke: invokeMock,
    on: vi.fn(),
    removeListener: vi.fn()
  },
  webUtils: {
    getPathForFile: getPathForFileMock
  }
}))

describe('preload codeReview API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    invokeMock.mockResolvedValue({ id: 'feedback-1', status: 'pending' })
  })

  it('serializes screenshot files before invoking feedback IPC', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const firstScreenshot = {
      name: 'feedback.png',
      type: 'image/png',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('image-bytes').buffer)
    } as unknown as File
    const secondScreenshot = {
      name: 'feedback-2.jpg',
      type: 'image/jpeg',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('second-image').buffer)
    } as unknown as File

    await api.submitFeedback({
      description: '无法下载报告',
      screenshots: [firstScreenshot, secondScreenshot]
    })

    expect(invokeMock).toHaveBeenCalledWith(
      'feedback:submit',
      expect.objectContaining({
        description: '无法下载报告',
        screenshots: [
          expect.objectContaining({
            name: 'feedback.png',
            type: 'image/png'
          }),
          expect.objectContaining({
            name: 'feedback-2.jpg',
            type: 'image/jpeg'
          })
        ]
      })
    )
    const payload = invokeMock.mock.calls[0][1]
    expect(new TextDecoder().decode(payload.screenshots[0].bytes)).toBe('image-bytes')
    expect(new TextDecoder().decode(payload.screenshots[1].bytes)).toBe('second-image')
  })

  it('serializes legacy screenshot payload into screenshots IPC field', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const screenshot = {
      name: 'legacy-feedback.png',
      type: 'image/png',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('legacy-image-bytes').buffer)
    } as unknown as File

    await api.submitFeedback({
      description: '旧版截图上传',
      screenshot
    })

    expect(invokeMock).toHaveBeenCalledWith(
      'feedback:submit',
      expect.objectContaining({
        description: '旧版截图上传',
        screenshots: [
          expect.objectContaining({
            name: 'legacy-feedback.png',
            type: 'image/png'
          })
        ]
      })
    )
    const payload = invokeMock.mock.calls[0][1]
    expect(payload.screenshots).toHaveLength(1)
    expect(new TextDecoder().decode(payload.screenshots[0].bytes)).toBe('legacy-image-bytes')
    expect(payload).not.toHaveProperty('screenshot')
  })

  it('invokes report asset IPC with report path and asset path', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.readReportAsset({
      reportPath: '/tmp/runtime/workspaces/task-1/代码审查报告.md',
      assetPath: 'images/diagram.png'
    })

    expect(invokeMock).toHaveBeenCalledWith('report:asset', {
      reportPath: '/tmp/runtime/workspaces/task-1/代码审查报告.md',
      assetPath: 'images/diagram.png'
    })
  })

  it('invokes PDF report IPC with task id and local PDF path', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.openPdfReport({
      taskId: 'task-1',
      localPdfPath: '/tmp/runtime/workspaces/task-1/代码审查报告.pdf',
      pdfReportName: 'r1_r2审查报告_20260615_143000.pdf'
    })

    expect(invokeMock).toHaveBeenCalledWith('report:open-pdf', {
      taskId: 'task-1',
      localPdfPath: '/tmp/runtime/workspaces/task-1/代码审查报告.pdf',
      pdfReportName: 'r1_r2审查报告_20260615_143000.pdf'
    })
  })

  it('selects requirement file through IPC', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.selectRequirementFile()

    expect(invokeMock).toHaveBeenCalledWith('requirement-file:select')
  })

  it('invokes user and department IPC channels', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.getCurrentUser()
    await api.listAvailableDepartments()
    await api.setDepartment({ department_id: 'dept-1' })

    expect(invokeMock).toHaveBeenCalledWith('user:me')
    expect(invokeMock).toHaveBeenCalledWith('department:list-available')
    expect(invokeMock).toHaveBeenCalledWith('user:set-department', {
      department_id: 'dept-1'
    })
  })

  it('reads pasted file path through Electron webUtils', async () => {
    getPathForFileMock.mockReturnValue('/tmp/产品开发需求表.xlsx')
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const file = new File(['x'], '产品开发需求表.xlsx')

    expect(api.getPathForPastedFile(file)).toBe('/tmp/产品开发需求表.xlsx')
    expect(getPathForFileMock).toHaveBeenCalledWith(file)
  })

  it('invokes task completion notification IPC', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.showTaskCompletionNotification({
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md',
      pdfPath: '/tmp/report.pdf',
      pdfReportName: 'r10_r12审查报告.pdf'
    })

    expect(invokeMock).toHaveBeenCalledWith('notification:show-task-completed', {
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md',
      pdfPath: '/tmp/report.pdf',
      pdfReportName: 'r10_r12审查报告.pdf'
    })
  })

  it('subscribes to task completion notification click IPC', async () => {
    const onMock = vi.mocked((await import('electron')).ipcRenderer.on)
    const removeListenerMock = vi.mocked((await import('electron')).ipcRenderer.removeListener)
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const callback = vi.fn()

    const unsubscribe = api.onTaskCompletionNotificationClicked(callback)
    const listener = onMock.mock.calls.find(
      ([channel]) => channel === 'notification:task-completed-clicked'
    )?.[1]

    expect(listener).toBeDefined()
    listener({}, { taskId: 'task-1', svn_url: 'svn://repo/project' })
    expect(callback).toHaveBeenCalledWith({ taskId: 'task-1', svn_url: 'svn://repo/project' })

    unsubscribe()
    expect(removeListenerMock).toHaveBeenCalledWith(
      'notification:task-completed-clicked',
      listener
    )
  })
})
