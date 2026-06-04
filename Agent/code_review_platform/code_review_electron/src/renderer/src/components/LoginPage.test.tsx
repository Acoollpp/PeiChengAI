// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginPage } from './LoginPage'
import type { CodeReviewApi } from '../code-review-api'

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
    loadCredentials: vi.fn(async () => null),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    keyLogin: vi.fn(),
    svnLogin: vi.fn(),
    listTasks: vi.fn(),
    readTaskReport: vi.fn(),
    executeTask: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    downloadCurrentReport: vi.fn(),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(),
    bindSvnCredential: vi.fn()
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  setupCodeReviewApi()
})

afterEach(() => {
  cleanup()
})

describe('LoginPage', () => {
  it('在登录卡片底部打开管理员名片', async () => {
    const user = userEvent.setup()
    render(<LoginPage onKeyLogin={vi.fn()} onSvnLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '联系管理员' }))

    expect(screen.getByRole('dialog', { name: '管理员联系方式' })).toBeInTheDocument()
    expect(screen.getByText('杨慧城')).toBeInTheDocument()
  })

  it('可以切换 Key 的可见性', async () => {
    const user = userEvent.setup()
    render(<LoginPage onKeyLogin={vi.fn()} onSvnLogin={vi.fn()} />)

    const keyInput = screen.getByLabelText('Key') as HTMLInputElement
    expect(keyInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: '显示 Key' }))

    expect(keyInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏 Key' })).toBeInTheDocument()
  })

  it('可以切换 SVN 密码的可见性', async () => {
    const user = userEvent.setup()
    render(<LoginPage onKeyLogin={vi.fn()} onSvnLogin={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'SVN 登录' }))
    const passwordInput = screen.getByLabelText('SVN 密码') as HTMLInputElement

    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: '显示 SVN 密码' }))

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏 SVN 密码' })).toBeInTheDocument()
  })
})
