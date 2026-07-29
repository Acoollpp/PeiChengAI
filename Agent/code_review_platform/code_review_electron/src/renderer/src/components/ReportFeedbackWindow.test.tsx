// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
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

const issueContext = {
  mode: 'issues' as const,
  taskId: 'task-1',
  feedbackSubmittedAt: null,
  issues: [
    {
      id: 'issue-1',
      issueText: '高风险：空指针解引用',
      descriptionText: '返回值未经校验就被解引用。',
      order: 0,
      helpful: null,
      feedbackText: '',
      anchorId: 'anchor-1'
    },
    {
      id: 'issue-2',
      issueText: '中风险：事务边界不完整',
      descriptionText: '异常路径没有回滚。',
      order: 1,
      helpful: null,
      feedbackText: '',
      anchorId: 'anchor-2'
    }
  ]
}

const setupApi = (): ReportFeedbackWindowApi => ({
  getContext: vi.fn(async () => context),
  focusAnchor: vi.fn(async () => true as const),
  submit: vi.fn(async () => ({
    taskId: 'task-1', helpful: true, usefulIssuesText: '空指针风险'
  })),
  saveIssueDraft: vi.fn(),
  submitIssueFeedback: vi.fn(async () => ({
    status: 'submitted' as const,
    taskId: 'task-1',
    feedbackSubmittedAt: '2026-07-29T12:00:00Z',
    pdfPath: '/tmp/final.pdf',
    pdfReportName: 'final.pdf'
  })),
  close: vi.fn(async () => true as const)
})

beforeEach(() => {
  window.reportFeedback = setupApi()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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
    let resolveSubmit:
      ((value: { taskId: string; helpful: boolean; usefulIssuesText: string | null }) => void)
      | undefined
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

    resolveSubmit?.({ taskId: 'task-1', helpful: true, usefulIssuesText: '空指针风险' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交并打开PDF' })).toBeEnabled()
    })
  })
})

describe('ReportFeedbackWindow 逐问题草稿', () => {
  beforeEach(() => {
    window.reportFeedback.getContext = vi.fn(async () => issueContext)
    window.reportFeedback.saveIssueDraft = vi.fn(async (payload) => ({
      id: payload.issueId,
      task_id: payload.taskId,
      issue_text: '问题',
      description_text: '描述',
      display_snapshot: '问题',
      order: 0,
      source: 'template_1_heading',
      location: {
        start_offset: 0,
        end_offset: 1,
        feedback_insertion_offset: 1,
        anchor_line: 0,
        heading_level: 3
      },
      helpful: payload.helpful,
      feedback_text: payload.feedbackText
    }))
  })

  it('逐问题展示原文、描述和未评价状态，并互斥选择评价后立即保存', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    expect(await screen.findByText('高风险：空指针解引用')).toBeInTheDocument()
    expect(screen.getByText('返回值未经校验就被解引用。')).toBeInTheDocument()
    expect(screen.getAllByText('未评价')).toHaveLength(2)

    const helpful = screen.getAllByRole('radio', { name: '有帮助' })[0]
    const notHelpful = screen.getAllByRole('radio', { name: '没帮助' })[0]
    await user.click(helpful)
    expect(helpful).toBeChecked()
    expect(notHelpful).not.toBeChecked()
    expect(screen.getByLabelText('问题 1 反馈说明')).toHaveAttribute(
      'placeholder',
      '例如：说明这个问题提供了哪些帮助，以及实际如何处理。'
    )
    await waitFor(() => {
      expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledWith({
        taskId: 'task-1',
        issueId: 'issue-1',
        helpful: true,
        feedbackText: ''
      })
    })

    await user.click(notHelpful)
    expect(helpful).not.toBeChecked()
    expect(notHelpful).toBeChecked()
    expect(screen.getByLabelText('问题 1 反馈说明')).toHaveAttribute(
      'placeholder',
      '例如：说明这个问题没有帮助的原因和具体情况。'
    )
  })

  it('停止输入一秒保存说明，失焦会提前保存且不会重复同一版本', async () => {
    render(<ReportFeedbackWindow />)
    const input = await screen.findByLabelText('问题 1 反馈说明')
    vi.useFakeTimers()

    fireEvent.change(input, { target: { value: '记录处理结果' } })
    act(() => vi.advanceTimersByTime(999))
    expect(window.reportFeedback.saveIssueDraft).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    await act(async () => Promise.resolve())
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(1)
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenLastCalledWith({
      taskId: 'task-1',
      issueId: 'issue-1',
      helpful: null,
      feedbackText: '记录处理结果'
    })

    fireEvent.blur(input)
    await act(async () => Promise.resolve())
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: '失焦立即保存' } })
    fireEvent.blur(input)
    await act(async () => Promise.resolve())
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(2)
    act(() => vi.advanceTimersByTime(1000))
    await act(async () => Promise.resolve())
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(2)
  })

  it('保存失败保留本地评价和说明，点击重试保存同一份当前草稿', async () => {
    const user = userEvent.setup()
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], feedbackText: '必须保留的输入' }]
    }))
    vi.mocked(window.reportFeedback.saveIssueDraft)
      .mockRejectedValueOnce(new Error('网络连接中断'))
      .mockResolvedValueOnce({} as never)
    render(
      <StrictMode>
        <ReportFeedbackWindow />
      </StrictMode>
    )

    await user.click(await screen.findByRole('radio', { name: '有帮助' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接中断')
    expect(screen.getByRole('radio', { name: '有帮助' })).toBeChecked()
    expect(screen.getByLabelText('问题 1 反馈说明')).toHaveValue('必须保留的输入')

    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(2))
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenLastCalledWith({
      taskId: 'task-1',
      issueId: 'issue-1',
      helpful: true,
      feedbackText: '必须保留的输入'
    })
  })

  it('旧保存响应晚到时不覆盖较新的本地评价', async () => {
    const user = userEvent.setup()
    let resolveFirst: (() => void) | undefined
    vi.mocked(window.reportFeedback.saveIssueDraft)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({} as never)
          })
      )
      .mockResolvedValueOnce({} as never)
    render(<ReportFeedbackWindow />)

    const helpful = (await screen.findAllByRole('radio', { name: '有帮助' }))[0]
    const notHelpful = screen.getAllByRole('radio', { name: '没帮助' })[0]
    await user.click(helpful)
    await user.click(notHelpful)
    expect(notHelpful).toBeChecked()
    expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await waitFor(() => expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(2))
    expect(notHelpful).toBeChecked()
    expect(helpful).not.toBeChecked()
  })

  it('从服务端上下文恢复已保存草稿', async () => {
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [
        {
          ...issueContext.issues[0],
          helpful: false,
          feedbackText: '与当前规则不适用'
        }
      ]
    }))
    render(<ReportFeedbackWindow />)

    expect(await screen.findByRole('radio', { name: '没帮助' })).toBeChecked()
    expect(screen.getByLabelText('问题 1 反馈说明')).toHaveValue('与当前规则不适用')
    expect(window.reportFeedback.saveIssueDraft).not.toHaveBeenCalled()
  })

  it('关闭窗口前会保存尚在防抖期内的最新输入', async () => {
    const user = userEvent.setup()
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0] }]
    }))
    render(<ReportFeedbackWindow />)

    await user.type(await screen.findByLabelText('问题 1 反馈说明'), '关闭前保存')
    await user.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => {
      expect(window.reportFeedback.saveIssueDraft).toHaveBeenLastCalledWith({
        taskId: 'task-1',
        issueId: 'issue-1',
        helpful: null,
        feedbackText: '关闭前保存'
      })
    })
    expect(window.reportFeedback.close).toHaveBeenCalledTimes(1)
  })

  it('存在未评价问题时阻止提交并定位首个未评价问题', async () => {
    const user = userEvent.setup()
    render(<ReportFeedbackWindow />)

    await user.click(await screen.findByRole('button', { name: '提交反馈并查看PDF报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请先评价所有审查问题')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(window.reportFeedback.submitIssueFeedback).not.toHaveBeenCalled()
  })

  it('全部评价后等待进行中的保存完成才执行提交前门禁', async () => {
    const user = userEvent.setup()
    let resolveSave: (() => void) | undefined
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0] }]
    }))
    vi.mocked(window.reportFeedback.saveIssueDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({} as never)
        })
    )
    render(<ReportFeedbackWindow />)

    await user.click(await screen.findByRole('radio', { name: '有帮助' }))
    await user.click(screen.getByRole('button', { name: '提交反馈并查看PDF报告' }))
    expect(window.reportFeedback.submitIssueFeedback).not.toHaveBeenCalled()

    resolveSave?.()
    await waitFor(() => {
      expect(window.reportFeedback.submitIssueFeedback).toHaveBeenCalledWith({ taskId: 'task-1' })
    })
    await waitFor(() => expect(window.reportFeedback.close).toHaveBeenCalledTimes(1))
  })

  it('最终PDF提交失败时保留窗口和可编辑反馈以便重试', async () => {
    const user = userEvent.setup()
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], helpful: true, feedbackText: '保留草稿' }]
    }))
    vi.mocked(window.reportFeedback.submitIssueFeedback).mockRejectedValueOnce(
      new Error('最终PDF上传失败')
    )
    render(<ReportFeedbackWindow />)

    const input = await screen.findByLabelText('问题 1 反馈说明')
    await user.click(screen.getByRole('button', { name: '提交反馈并查看PDF报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('最终PDF上传失败')
    expect(input).toHaveValue('保留草稿')
    expect(input).toBeEnabled()
    expect(window.reportFeedback.close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '提交反馈并查看PDF报告' })).toBeEnabled()
  })

  it('服务端已提交但窗口关闭失败时立即锁定输入', async () => {
    const user = userEvent.setup()
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], helpful: true, feedbackText: '已提交内容' }]
    }))
    vi.mocked(window.reportFeedback.close).mockRejectedValueOnce(new Error('窗口关闭失败'))
    render(<ReportFeedbackWindow />)

    await user.click(await screen.findByRole('button', { name: '提交反馈并查看PDF报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('反馈已正式提交，但窗口关闭失败')
    expect(screen.getByLabelText('问题 1 反馈说明')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '提交反馈并查看PDF报告' })).not.toBeInTheDocument()
  })

  it('服务端已提交但 PDF 打开失败时立即锁定输入并保留提示', async () => {
    const user = userEvent.setup()
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], helpful: true, feedbackText: '已提交内容' }]
    }))
    vi.mocked(window.reportFeedback.submitIssueFeedback).mockResolvedValueOnce({
      status: 'submitted',
      taskId: 'task-1',
      feedbackSubmittedAt: '2026-07-29T12:00:00Z',
      pdfPath: '/tmp/final.pdf',
      pdfReportName: 'final.pdf',
      pdfOpenError: '没有可用于打开 PDF 的应用'
    })
    render(<ReportFeedbackWindow />)

    await user.click(await screen.findByRole('button', { name: '提交反馈并查看PDF报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '反馈已正式提交，但 PDF 打开失败，已在文件夹中定位最终报告'
    )
    expect(screen.getByLabelText('问题 1 反馈说明')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '提交反馈并查看PDF报告' })).not.toBeInTheDocument()
    expect(window.reportFeedback.close).not.toHaveBeenCalled()
  })

  it('提交期间进行中的保存失败时保留草稿并阻止提交前门禁', async () => {
    const user = userEvent.setup()
    let rejectSave: ((error: Error) => void) | undefined
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], helpful: true }]
    }))
    vi.mocked(window.reportFeedback.saveIssueDraft).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject
        })
    )
    render(<ReportFeedbackWindow />)

    const input = await screen.findByLabelText('问题 1 反馈说明')
    fireEvent.change(input, { target: { value: '尚未保存的最新说明' } })
    fireEvent.blur(input)
    await waitFor(() => expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '提交反馈并查看PDF报告' }))

    rejectSave?.(new Error('网络连接中断'))
    expect(await screen.findByText('仍有反馈保存失败，请重试后再提交。')).toBeInTheDocument()
    expect(input).toHaveValue('尚未保存的最新说明')
    expect(window.reportFeedback.submitIssueFeedback).not.toHaveBeenCalled()
  })

  it('关闭期间进行中的保存失败时保留窗口并允许重试', async () => {
    const user = userEvent.setup()
    let rejectSave: ((error: Error) => void) | undefined
    window.reportFeedback.getContext = vi.fn(async () => ({
      ...issueContext,
      issues: [{ ...issueContext.issues[0], helpful: true }]
    }))
    vi.mocked(window.reportFeedback.saveIssueDraft).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject
        })
    )
    render(<ReportFeedbackWindow />)

    const input = await screen.findByLabelText('问题 1 反馈说明')
    fireEvent.change(input, { target: { value: '关闭前仍在保存' } })
    fireEvent.blur(input)
    await waitFor(() => expect(window.reportFeedback.saveIssueDraft).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '关闭' }))

    rejectSave?.(new Error('网络连接中断'))
    expect(await screen.findByText('仍有反馈保存失败，请重试后再关闭。')).toBeInTheDocument()
    expect(input).toHaveValue('关闭前仍在保存')
    expect(window.reportFeedback.close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
