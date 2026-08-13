// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { CodeReviewApi } from './code-review-api'
import { CLIENT_THEME_STORAGE_KEY } from './theme'

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    loadServerConfig: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
    loadCredentials: vi.fn(async () => null),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    keyLogin: vi.fn(async () => ({ needSvnBinding: false })),
    svnLogin: vi.fn(),
    getCurrentUser: vi.fn(async () => ({
      id: 'user-1',
      full_name: 'Key 用户',
      svn_username: null,
      department_id: 'dept-bound',
      department_name: '已绑定部门',
      role: 'user'
    })),
    listAvailableDepartments: vi.fn(async () => ({ data: [], count: 0 })),
    setDepartment: vi.fn(),
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    getTodayTaskStats: vi.fn(async () => ({
      success: 0,
      running: 0,
      failed: 0,
      total: 0
    })),
    readTaskReport: vi.fn(),
    preflightTask: vi.fn(),
    executeTask: vi.fn(),
    retryTask: vi.fn(),
    cancelTask: vi.fn(),
    openTaskLog: vi.fn(),
    hideTask: vi.fn(),
    selectRequirementFile: vi.fn(),
    selectReviewMaterialFile: vi.fn(),
    getPathForPastedFile: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    downloadCurrentReport: vi.fn(),
    openPdfReport: vi.fn(),
    readReportAsset: vi.fn(),
    showTaskCompletionNotification: vi.fn(),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(async () => ({ status: 'ready' })),
    onEnvironmentProgress: vi.fn(() => vi.fn()),
    submitFeedback: vi.fn(),
    openReportFeedbackWindow: vi.fn(async () => true),
    submitNegativeReportFeedback: vi.fn(),
    onReportFeedbackFocusAnchor: vi.fn(() => vi.fn()),
    onReportFeedbackSubmitted: vi.fn(() => vi.fn()),
    onIssueFeedbackSubmitted: vi.fn(() => vi.fn()),
    bindSvnCredential: vi.fn(),
    checkForAppUpdate: vi.fn(async () => ({
      status: 'current' as const,
      policy: {
        platform: 'win32',
        arch: 'x64',
        current_version: '1.0.0',
        active_version: '1.0.0',
        minimum_supported_version: null,
        update_available: false,
        update_required: false
      }
    })),
    downloadAppUpdate: vi.fn(async () => true),
    installAppUpdate: vi.fn(async () => true),
    quitApp: vi.fn(async () => true),
    onAppUpdateAvailable: vi.fn(() => vi.fn()),
    onAppUpdateNotAvailable: vi.fn(() => vi.fn()),
    onAppUpdateDownloadProgress: vi.fn(() => vi.fn()),
    onAppUpdateProgress: vi.fn(() => vi.fn()),
    onAppUpdateDownloaded: vi.fn(() => vi.fn()),
    onAppUpdateError: vi.fn(() => vi.fn()),
    onAppUpdateRequired: vi.fn(() => vi.fn())
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  setupCodeReviewApi()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('客户端主题契约', () => {
  it('首次启动和损坏偏好都降级为浅色，并在登录页显示深色切换入口', async () => {
    localStorage.setItem(CLIENT_THEME_STORAGE_KEY, 'system')

    render(<App />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(
      await screen.findByRole('button', { name: '切换到深色模式' })
    ).toBeInTheDocument()
  })

  it('登录页切换立即生效并持久化为本机客户端偏好', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '切换到深色模式' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(CLIENT_THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByRole('button', { name: '切换到浅色模式' })).toBeInTheDocument()
  })

  it('登录前选择的主题在登录后工作台右上角保持，并可继续切换', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '切换到深色模式' }))
    await user.type(screen.getByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    expect(await screen.findByRole('heading', { name: '创建审查任务' })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    await user.click(screen.getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('重启客户端后恢复已持久化主题', async () => {
    localStorage.setItem(CLIENT_THEME_STORAGE_KEY, 'dark')

    render(<App />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(
      await screen.findByRole('button', { name: '切换到浅色模式' })
    ).toBeInTheDocument()
  })

  it('本机主题存储不可读时降级为浅色且不阻断登录页渲染', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('localStorage disabled')
    })

    render(<App />)

    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(
      await screen.findByRole('button', { name: '切换到深色模式' })
    ).toBeInTheDocument()
  })

  it('主题保存失败不阻断登录进入任务创建页', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '切换到深色模式' }))
    await user.type(screen.getByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    expect(await screen.findByRole('heading', { name: '创建审查任务' })).toBeInTheDocument()
    await waitFor(() => expect(window.codeReview.keyLogin).toHaveBeenCalled())
  })
})
