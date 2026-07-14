import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const exposeInMainWorldMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock
  },
  ipcRenderer: {
    invoke: invokeMock
  }
}))

describe('preload reportFeedback API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(true)
  })

  it('只暴露四个一次性反馈窗口命令', async () => {
    await import('./report-feedback')
    const api = exposeInMainWorldMock.mock.calls[0][1]

    expect(exposeInMainWorldMock).toHaveBeenCalledWith('reportFeedback', api)
    expect(Object.keys(api).sort()).toEqual(['close', 'focusAnchor', 'getContext', 'submit'])

    await api.getContext()
    expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:get-context')

    const focusPayload = { taskId: 'task-1', optionId: 'option-1' }
    await api.focusAnchor(focusPayload)
    expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:focus-anchor', focusPayload)

    const submitPayload = {
      taskId: 'task-1',
      selectedOptionIds: ['option-1'],
      manualText: '补充说明'
    }
    await api.submit(submitPayload)
    expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:submit', submitPayload)

    await api.close()
    expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:close')
  })
})
