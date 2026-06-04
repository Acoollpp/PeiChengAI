// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskPage } from './TaskPage'
import type { CodeReviewApi } from '../code-review-api'

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    loadServerConfig: vi.fn(),
    loadCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    keyLogin: vi.fn(),
    svnLogin: vi.fn(),
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
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

describe('TaskPage', () => {
  it('在工作台顶部打开管理员名片', async () => {
    const user = userEvent.setup()

    render(
      <TaskPage
        environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
        isCheckingEnvironment={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: '联系管理员' }))

    expect(screen.getByRole('dialog', { name: '管理员联系方式' })).toBeInTheDocument()
    expect(screen.getByText('杨慧城')).toBeInTheDocument()
  })

  it('环境面板不再额外显示联系管理员入口', () => {
    render(
      <TaskPage
        environment={{ status: 'missing_svn' }}
        isCheckingEnvironment={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getAllByRole('button', { name: '联系管理员' })).toHaveLength(1)
  })
})
