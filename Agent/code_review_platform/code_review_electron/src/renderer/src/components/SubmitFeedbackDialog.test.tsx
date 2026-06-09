// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi } from '../code-review-api'
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' }))
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  setupCodeReviewApi()
})

afterEach(() => {
  cleanup()
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
})
