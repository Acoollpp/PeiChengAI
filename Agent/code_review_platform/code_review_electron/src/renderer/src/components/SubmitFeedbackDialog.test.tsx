// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi } from '../code-review-api'
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'

const createObjectURLMock = vi.fn(() => 'blob:feedback-screenshot')
const revokeObjectURLMock = vi.fn()

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' }))
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  setupCodeReviewApi()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURLMock
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURLMock
  })
})

afterEach(() => {
  cleanup()
  createObjectURLMock.mockClear()
  revokeObjectURLMock.mockClear()
})

describe('SubmitFeedbackDialog', () => {
  it('空描述不能提交并提示请填写问题描述', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: '提交意见' }))

    expect(await screen.findByText('请填写问题描述')).toBeInTheDocument()
    expect(window.codeReview.submitFeedback).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('填写描述后提交意见并关闭弹窗', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '  无法生成报告  ')
    await user.click(screen.getByRole('button', { name: '提交意见' }))

    await waitFor(() => {
      expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
        description: '无法生成报告',
        screenshot: null
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('拒绝上传非图片截图文件', async () => {
    const user = userEvent.setup({ applyAccept: false })

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    const invalidFile = new File(['plain text'], 'notes.txt', { type: 'text/plain' })
    await user.upload(screen.getByLabelText('选择截图'), invalidFile)

    expect(await screen.findByText('仅支持 PNG、JPG 或 WEBP 截图')).toBeInTheDocument()
    expect(screen.getByLabelText('选择截图')).toHaveValue('')
  })

  it('拒绝超过 5MB 的截图文件', async () => {
    const user = userEvent.setup()

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    const oversizedFile = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png'
    })
    await user.upload(screen.getByLabelText('选择截图'), oversizedFile)

    expect(await screen.findByText('截图不能超过 5MB')).toBeInTheDocument()
    expect(screen.getByLabelText('选择截图')).toHaveValue('')
  })

  it('关闭弹窗时释放截图预览并清空表单状态', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '无法下载报告')
    await user.upload(
      screen.getByLabelText('选择截图'),
      new File(['image-bytes'], 'feedback.png', { type: 'image/png' })
    )
    expect(await screen.findByAltText('问题截图预览')).toHaveAttribute(
      'src',
      'blob:feedback-screenshot'
    )

    await user.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot')
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<SubmitFeedbackDialog open={false} onClose={onClose} />)
    rerender(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    expect(screen.getByLabelText('问题描述')).toHaveValue('')
    expect(screen.queryByText('feedback.png')).not.toBeInTheDocument()
  })
})
