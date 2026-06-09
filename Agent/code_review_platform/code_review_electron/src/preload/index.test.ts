// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const exposeInMainWorldMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock
  },
  ipcRenderer: {
    invoke: invokeMock,
    on: vi.fn(),
    removeListener: vi.fn()
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
    const screenshot = {
      name: 'feedback.png',
      type: 'image/png',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('image-bytes').buffer)
    } as unknown as File

    await api.submitFeedback({ description: '无法下载报告', screenshot })

    expect(invokeMock).toHaveBeenCalledWith(
      'feedback:submit',
      expect.objectContaining({
        description: '无法下载报告',
        screenshot: expect.objectContaining({
          name: 'feedback.png',
          type: 'image/png'
        })
      })
    )
    const payload = invokeMock.mock.calls[0][1]
    expect(new TextDecoder().decode(payload.screenshot.bytes)).toBe('image-bytes')
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
})
