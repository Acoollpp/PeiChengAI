// @vitest-environment jsdom

import type { IpcRendererEvent } from 'electron'
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

  it('通过只读 IPC 转发意见列表、详情和截图读取请求', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const listOptions = { skip: 10, limit: 10 }
    const screenshotPayload = { feedbackId: 'feedback-1', screenshotId: 'screenshot-1' }

    await api.listFeedback(listOptions)
    await api.readFeedback('feedback-1')
    await api.readFeedbackScreenshot(screenshotPayload)

    expect(invokeMock).toHaveBeenCalledWith('feedback:list', listOptions)
    expect(invokeMock).toHaveBeenCalledWith('feedback:read', 'feedback-1')
    expect(invokeMock).toHaveBeenCalledWith('feedback:read-screenshot', screenshotPayload)
  })

  it('does not expose the legacy generic report feedback API', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    expect(api).not.toHaveProperty('submitReportFeedback')
  })

  it('invokes report feedback window and fixed negative feedback IPC', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const payload = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }

    await api.openReportFeedbackWindow(payload)
    await api.submitNegativeReportFeedback('task-1')

    expect(invokeMock).toHaveBeenCalledWith('report-feedback:open', payload)
    expect(invokeMock).toHaveBeenCalledWith('report-feedback:submit-negative', 'task-1')
  })

  it('invokes SVN 预检 IPC before a task enters the local queue', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const payload = {
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2'
    }

    await api.preflightTask(payload)

    expect(invokeMock).toHaveBeenCalledWith('task:preflight', payload)
  })

  it('通过只读 IPC 获取今日任务统计', async () => {
    const stats = {
      range: 'today',
      total: 12,
      success: 7,
      running: 2,
      failed_or_error: 3,
      average_duration_seconds: null,
      by_status: {},
      reports_by_user: [],
      trend: []
    }
    invokeMock.mockResolvedValueOnce(stats)
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await expect(api.getTodayTaskStats()).resolves.toEqual(stats)
    expect(invokeMock).toHaveBeenCalledWith('task:stats')
  })

  it('从头重试时通过类型化 IPC 原样传递 revision 和逐项输入', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const payload = {
      task_id: 'task-multi-items',
      client_task_id: 'local-multi-items',
      old_revision: '0',
      new_revision: 'R130',
      review_items: [
        {
          id: 'DS-01',
          user_extra_rules: '仅核对本次协议导入',
          materials: [
            { field_id: 'requirement-sheet', file_paths: ['/source/requirements.xlsx'] },
            { field_id: 'product-spec', file_paths: ['/source/specification.pdf'] }
          ]
        },
        { id: 'DS-02', user_extra_rules: '只检查新增诊断代码' },
        { id: 'DS-03', user_extra_rules: '' }
      ]
    }

    await api.retryTask(payload)

    expect(invokeMock).toHaveBeenCalledWith('task:retry', payload)
  })

  it('重新检测报告时使用独立 IPC 且只传递任务 ID', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const payload = { task_id: 'task-report-decryption' }

    await api.retryReportUpload(payload)

    expect(invokeMock).toHaveBeenCalledWith('task:retry-report-upload', payload)
  })

  it('通过类型化 IPC 选择 DS-01 本地材料', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const payload = { review_item_id: 'DS-01', field_id: 'product-spec' }

    await api.selectReviewMaterialFile(payload)

    expect(invokeMock).toHaveBeenCalledWith('review-material-file:select', payload)
  })

  it('移除任务 IPC 错误中的 Electron 英文调用前缀', async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("Error invoking remote method 'task:execute': Error: SVN 新旧版本范围无效，请确保旧版本小于新版本。")
    )
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await expect(
      api.executeTask({ svn_url: 'svn://repo/project', old_revision: '20', new_revision: '10' })
    ).rejects.toThrow('SVN 新旧版本范围无效，请确保旧版本小于新版本。')
  })

  it.each([
    [
      'onReportFeedbackFocusAnchor',
      'report-feedback:focus-anchor',
      { taskId: 'task-1', anchorId: 'anchor-1' }
    ],
    [
      'onReportFeedbackSubmitted',
      'report-feedback:submitted',
      { taskId: 'task-1', usefulIssuesText: '1. 空指针风险' }
    ],
    [
      'onIssueFeedbackSubmitted',
      'report-feedback:issues-submitted',
      {
        taskId: 'task-1',
        feedbackSubmittedAt: '2026-07-29T12:00:00Z',
        pdfPath: '/tmp/final.pdf',
        pdfReportName: 'final.pdf'
      }
    ]
  ])('subscribes and cleans up %s with the same listener', async (method, channel, payload) => {
    const onMock = vi.mocked((await import('electron')).ipcRenderer.on)
    const removeListenerMock = vi.mocked((await import('electron')).ipcRenderer.removeListener)
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]
    const callback = vi.fn()

    const unsubscribe = api[method](callback)
    const listener = onMock.mock.calls.find(
      ([registeredChannel]) => registeredChannel === channel
    )?.[1]
    expect(listener).toBeDefined()
    if (!listener) {
      throw new Error(`未注册 ${channel} 监听器`)
    }
    listener({} as IpcRendererEvent, payload)
    expect(callback).toHaveBeenCalledWith(payload)

    unsubscribe()
    expect(removeListenerMock).toHaveBeenCalledWith(channel, listener)
  })

  it('invokes report asset IPC with report path and asset path', async () => {
    await import('./index')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    await api.readReportAsset({
      taskId: 'task-1',
      localReportPath: '/tmp/runtime/workspaces/task-1/代码审查报告.md',
      assetPath: 'images/diagram.png'
    })

    expect(invokeMock).toHaveBeenCalledWith('report:asset', {
      taskId: 'task-1',
      localReportPath: '/tmp/runtime/workspaces/task-1/代码审查报告.md',
      assetPath: 'images/diagram.png'
    })
  })

  it('保留旧 reportPath 报告资源 IPC 请求', async () => {
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
    if (!listener) {
      throw new Error('未注册通知点击监听器')
    }

    listener({} as IpcRendererEvent, {
      taskId: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12'
    })
    expect(callback).toHaveBeenCalledWith({
      taskId: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12'
    })

    unsubscribe()
    expect(removeListenerMock).toHaveBeenCalledWith(
      'notification:task-completed-clicked',
      listener
    )
  })
})
