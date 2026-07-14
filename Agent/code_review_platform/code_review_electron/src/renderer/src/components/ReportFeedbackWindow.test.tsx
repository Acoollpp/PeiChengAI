// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReportFeedbackWindowApi } from '../report-feedback-api'
import { ReportFeedbackWindow } from './ReportFeedbackWindow'

const context = {
  taskId: 'task-1',
  options: [
    { id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' },
    { id: 'option-2', text: '事务边界不完整', anchorId: 'anchor-2' }
  ]
}

const setupApi = (): ReportFeedbackWindowApi => ({
  getContext: vi.fn(async () => context),
  focusAnchor: vi.fn(async () => true as const),
  submit: vi.fn(async () => ({ taskId: 'task-1', usefulIssuesText: '空指针风险' })),
  close: vi.fn(async () => true as const)
})

beforeEach(() => {
  window.reportFeedback = setupApi()
})

afterEach(cleanup)

describe('ReportFeedbackWindow', () => {
  it('启动时读取上下文并展示可选问题', async () => {
    render(<ReportFeedbackWindow />)

    expect(screen.getByText('正在加载反馈内容...')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: '空指针风险' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '事务边界不完整' })).toBeInTheDocument()
    expect(window.reportFeedback.getContext).toHaveBeenCalledTimes(1)
  })

  it('没有勾选且手工文本为空时禁用提交', async () => {
    render(<ReportFeedbackWindow />)

    await screen.findByRole('checkbox', { name: '空指针风险' })
    expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeDisabled()
  })

  it('手工文本仅包含空格和换行时仍禁用提交', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    await user.type(await screen.findByLabelText('补充说明'), '   {enter}   ')
    const submitButton = screen.getByRole('button', { name: '提交并打开PDF' })

    expect(submitButton).toBeDisabled()
    await user.click(submitButton)
    expect(window.reportFeedback.submit).not.toHaveBeenCalled()
  })

  it('勾选问题时定位锚点且只在提交时发送 option ID', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    await user.click(await screen.findByRole('checkbox', { name: '空指针风险' }))

    expect(window.reportFeedback.focusAnchor).toHaveBeenCalledWith({
      taskId: 'task-1',
      optionId: 'option-1'
    })
    expect(window.reportFeedback.submit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))

    expect(window.reportFeedback.submit).toHaveBeenCalledWith({
      taskId: 'task-1',
      selectedOptionIds: ['option-1'],
      manualText: ''
    })
  })

  it('取消勾选时清除当前定位', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    const checkbox = await screen.findByRole('checkbox', { name: '空指针风险' })
    await user.click(checkbox)
    await user.click(checkbox)

    expect(window.reportFeedback.focusAnchor).toHaveBeenLastCalledWith({ taskId: 'task-1' })
  })

  it('勾选两个候选后取消其中一个仅提交剩余 option ID', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    const firstCheckbox = await screen.findByRole('checkbox', { name: '空指针风险' })
    const secondCheckbox = screen.getByRole('checkbox', { name: '事务边界不完整' })
    await user.click(firstCheckbox)
    await user.click(secondCheckbox)
    await user.click(firstCheckbox)
    await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))

    expect(window.reportFeedback.submit).toHaveBeenCalledWith({
      taskId: 'task-1',
      selectedOptionIds: ['option-2'],
      manualText: ''
    })
  })

  it('手工文本可单独提交并去除首尾空白', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    const manualInput = await screen.findByLabelText('补充说明')
    await user.type(manualInput, '  补充的事务问题  ')
    await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))

    expect(window.reportFeedback.submit).toHaveBeenCalledWith({
      taskId: 'task-1',
      selectedOptionIds: [],
      manualText: '补充的事务问题'
    })
  })

  it('点击取消时调用窗口关闭命令', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    await screen.findByRole('checkbox', { name: '空指针风险' })
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(window.reportFeedback.close).toHaveBeenCalledTimes(1)
  })

  it('窗口关闭失败时展示固定错误且只调用一次关闭命令', async () => {
    const user = userEvent.setup()
    vi.mocked(window.reportFeedback.close).mockRejectedValueOnce(new Error('IPC 关闭失败'))
    render(<ReportFeedbackWindow />)

    await screen.findByRole('checkbox', { name: '空指针风险' })
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('反馈窗口关闭失败，请重试')
    expect(window.reportFeedback.close).toHaveBeenCalledTimes(1)
  })

  it('提交失败时展示错误并保留选择和手工文本', async () => {
    const user = userEvent.setup()
    vi.mocked(window.reportFeedback.submit).mockRejectedValueOnce(new Error('PDF 生成失败'))
    render(<ReportFeedbackWindow />)

    const checkbox = await screen.findByRole('checkbox', { name: '空指针风险' })
    const manualInput = screen.getByLabelText('补充说明')
    await user.click(checkbox)
    await user.type(manualInput, '保留这段补充')
    await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('PDF 生成失败')
    expect(checkbox).toBeChecked()
    expect(manualInput).toHaveValue('保留这段补充')
    expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeEnabled()
  })

  it('提交期间禁用勾选、手工文本和操作按钮', async () => {
    const user = userEvent.setup()
    let resolveSubmit: ((value: { taskId: string; usefulIssuesText: string }) => void) | undefined
    vi.mocked(window.reportFeedback.submit).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve
        })
    )
    render(<ReportFeedbackWindow />)

    const checkbox = await screen.findByRole('checkbox', { name: '空指针风险' })
    const manualInput = screen.getByLabelText('补充说明')
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: '提交并打开PDF' }))

    expect(checkbox).toBeDisabled()
    expect(manualInput).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled()

    resolveSubmit?.({ taskId: 'task-1', usefulIssuesText: '空指针风险' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeEnabled()
    })
  })
})
