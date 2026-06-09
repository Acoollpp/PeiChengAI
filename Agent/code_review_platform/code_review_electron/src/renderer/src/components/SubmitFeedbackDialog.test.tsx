// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi } from '../code-review-api'
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'

let objectUrlCounter = 0
const createObjectURLMock = vi.fn(() => {
  objectUrlCounter += 1
  return `blob:feedback-screenshot-${objectUrlCounter}`
})
const revokeObjectURLMock = vi.fn()

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' }))
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  objectUrlCounter = 0
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

  it('无截图提交时传空截图列表并关闭弹窗', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '  无法生成报告  ')
    await user.click(screen.getByRole('button', { name: '提交意见' }))

    await waitFor(() => {
      expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
        description: '无法生成报告',
        screenshots: []
      })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('选择多张截图后提交传截图列表', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const files = [
      new File(['image-1'], 'feedback-1.png', { type: 'image/png' }),
      new File(['image-2'], 'feedback-2.jpg', { type: 'image/jpeg' }),
      new File(['image-3'], 'feedback-3.webp', { type: 'image/webp' })
    ]

    render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '多图反馈')
    await user.upload(screen.getByLabelText('选择截图'), files)
    await user.click(screen.getByRole('button', { name: '提交意见' }))

    await waitFor(() => {
      expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
        description: '多图反馈',
        screenshots: files
      })
    })
    expect(window.codeReview.submitFeedback).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenshot: expect.anything() })
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('粘贴多张截图时追加到已选择截图列表', async () => {
    const user = userEvent.setup()
    const selectedFile = new File(['image-1'], 'selected.png', { type: 'image/png' })
    const pastedFiles = [
      new File(['image-2'], 'pasted-1.png', { type: 'image/png' }),
      new File(['image-3'], 'pasted-2.webp', { type: 'image/webp' })
    ]

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    await user.upload(screen.getByLabelText('选择截图'), selectedFile)
    fireEvent.paste(screen.getByLabelText('问题描述'), {
      clipboardData: { files: pastedFiles }
    })

    expect(screen.getByText('selected.png')).toBeInTheDocument()
    expect(screen.getByText('pasted-1.png')).toBeInTheDocument()
    expect(screen.getByText('pasted-2.webp')).toBeInTheDocument()
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

  it('超过 5 张截图时拒绝多余截图并只保留前 5 张', async () => {
    const user = userEvent.setup()
    const files = Array.from(
      { length: 6 },
      (_, index) => new File([`image-${index}`], `feedback-${index + 1}.png`, { type: 'image/png' })
    )

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    await user.upload(screen.getByLabelText('选择截图'), files)

    expect(await screen.findByText('最多只能添加 5 张截图')).toBeInTheDocument()
    expect(screen.getByText('feedback-1.png')).toBeInTheDocument()
    expect(screen.getByText('feedback-5.png')).toBeInTheDocument()
    expect(screen.queryByText('feedback-6.png')).not.toBeInTheDocument()
  })

  it('一次选择 6 张且第 6 张非法时保留前 5 张合法截图', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const validFiles = Array.from(
      { length: 5 },
      (_, index) => new File([`image-${index}`], `valid-${index + 1}.png`, { type: 'image/png' })
    )
    const invalidFile = new File(['plain text'], 'invalid.txt', { type: 'text/plain' })

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    await user.upload(screen.getByLabelText('选择截图'), [...validFiles, invalidFile])

    expect(await screen.findByText('最多只能添加 5 张截图')).toBeInTheDocument()
    expect(screen.getByText('valid-1.png')).toBeInTheDocument()
    expect(screen.getByText('valid-5.png')).toBeInTheDocument()
    expect(screen.queryByText('invalid.txt')).not.toBeInTheDocument()
    expect(screen.queryByText('仅支持 PNG、JPG 或 WEBP 截图')).not.toBeInTheDocument()
  })

  it('支持移除单张截图', async () => {
    const user = userEvent.setup()
    const files = [
      new File(['image-1'], 'feedback-1.png', { type: 'image/png' }),
      new File(['image-2'], 'feedback-2.png', { type: 'image/png' })
    ]

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    await user.upload(screen.getByLabelText('选择截图'), files)
    await user.click(screen.getByRole('button', { name: '移除 feedback-1.png' }))

    expect(screen.queryByText('feedback-1.png')).not.toBeInTheDocument()
    expect(screen.getByText('feedback-2.png')).toBeInTheDocument()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot-1')
  })

  it('移除第一张和中间截图后剩余截图预览 URL 与文件名仍对应', async () => {
    const user = userEvent.setup()
    const files = [
      new File(['image-1'], 'feedback-1.png', { type: 'image/png' }),
      new File(['image-2'], 'feedback-2.png', { type: 'image/png' }),
      new File(['image-3'], 'feedback-3.png', { type: 'image/png' }),
      new File(['image-4'], 'feedback-4.png', { type: 'image/png' })
    ]

    render(<SubmitFeedbackDialog open={true} onClose={vi.fn()} />)

    await user.upload(screen.getByLabelText('选择截图'), files)
    await user.click(screen.getByRole('button', { name: '移除 feedback-1.png' }))
    await user.click(screen.getByRole('button', { name: '移除 feedback-3.png' }))

    expect(screen.queryByText('feedback-1.png')).not.toBeInTheDocument()
    expect(screen.queryByText('feedback-3.png')).not.toBeInTheDocument()
    expect(screen.getByAltText('feedback-2.png 预览')).toHaveAttribute('src', 'blob:feedback-screenshot-2')
    expect(screen.getByAltText('feedback-4.png 预览')).toHaveAttribute('src', 'blob:feedback-screenshot-4')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot-1')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot-3')
    expect(revokeObjectURLMock).not.toHaveBeenCalledWith('blob:feedback-screenshot-2')
    expect(revokeObjectURLMock).not.toHaveBeenCalledWith('blob:feedback-screenshot-4')
  })

  it('关闭弹窗时释放截图预览并清空表单状态', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText('问题描述'), '无法下载报告')
    await user.upload(screen.getByLabelText('选择截图'), [
      new File(['image-1'], 'feedback-1.png', { type: 'image/png' }),
      new File(['image-2'], 'feedback-2.png', { type: 'image/png' })
    ])
    expect(await screen.findByAltText('feedback-1.png 预览')).toHaveAttribute(
      'src',
      'blob:feedback-screenshot-1'
    )
    expect(screen.getByAltText('feedback-2.png 预览')).toHaveAttribute(
      'src',
      'blob:feedback-screenshot-2'
    )

    await user.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot-1')
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:feedback-screenshot-2')
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<SubmitFeedbackDialog open={false} onClose={onClose} />)
    rerender(<SubmitFeedbackDialog open={true} onClose={onClose} />)

    expect(screen.getByLabelText('问题描述')).toHaveValue('')
    expect(screen.queryByText('feedback-1.png')).not.toBeInTheDocument()
    expect(screen.queryByText('feedback-2.png')).not.toBeInTheDocument()
    expect(screen.getByLabelText('选择截图')).toHaveValue('')
  })
})
