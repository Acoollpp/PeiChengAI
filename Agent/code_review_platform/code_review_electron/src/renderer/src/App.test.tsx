// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type {
  AppUpdateInfo,
  AppUpdateProgress,
  CodeReviewApi,
  EnvironmentProgressEvent
} from './code-review-api'

type ProgressListener = (progress: AppUpdateProgress) => void
type AvailableListener = (info: AppUpdateInfo) => void
type EnvironmentProgressListener = (progress: EnvironmentProgressEvent) => void

let progressListener: ProgressListener | null = null
let availableListener: AvailableListener | null = null
let environmentProgressListener: EnvironmentProgressListener | null = null

const setupCodeReviewApi = (): void => {
  progressListener = null
  availableListener = null
  environmentProgressListener = null
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
    listAvailableDepartments: vi.fn(async () => ({
      data: [{ id: 'dept-1', name: '研发部', is_active: true }],
      count: 1
    })),
    setDepartment: vi.fn(async () => ({
      id: 'user-1',
      full_name: 'Key 用户',
      svn_username: null,
      department_id: 'dept-1',
      department_name: '研发部',
      role: 'user'
    })),
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    readTaskReport: vi.fn(),
    executeTask: vi.fn(),
    retryTask: vi.fn(),
    cancelTask: vi.fn(),
    selectRequirementFile: vi.fn(),
    getPathForPastedFile: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    downloadCurrentReport: vi.fn(),
    openPdfReport: vi.fn(),
    openTaskLog: vi.fn(),
    readReportAsset: vi.fn(),
    showTaskCompletionNotification: vi.fn(),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(async () => ({ status: 'ready' })),
    submitFeedback: vi.fn(),
    openReportFeedbackWindow: vi.fn(async () => true),
    submitNegativeReportFeedback: vi.fn(),
    onReportFeedbackFocusAnchor: vi.fn(() => vi.fn()),
    onReportFeedbackSubmitted: vi.fn(() => vi.fn()),
    onIssueFeedbackSubmitted: vi.fn(() => vi.fn()),
    onEnvironmentProgress: vi.fn((callback: EnvironmentProgressListener) => {
      environmentProgressListener = callback
      return vi.fn()
    }),
    bindSvnCredential: vi.fn(),
    checkForAppUpdate: vi.fn(async () => true),
    downloadAppUpdate: vi.fn(async () => true),
    installAppUpdate: vi.fn(async () => true),
    onAppUpdateAvailable: vi.fn((callback: AvailableListener) => {
      availableListener = callback
      return vi.fn()
    }),
    onAppUpdateNotAvailable: vi.fn(() => vi.fn()),
    onAppUpdateDownloadProgress: vi.fn(() => vi.fn()),
    onAppUpdateProgress: vi.fn((callback: ProgressListener) => {
      progressListener = callback
      return vi.fn()
    }),
    onAppUpdateDownloaded: vi.fn(() => vi.fn()),
    onAppUpdateError: vi.fn(() => vi.fn())
  } as unknown as CodeReviewApi
}

beforeEach(() => {
  setupCodeReviewApi()
})

afterEach(() => {
  cleanup()
})

describe('App update flow', () => {
  it('requires department selection before entering the task page when current user has no department', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.getCurrentUser).mockResolvedValueOnce({
      id: 'user-1',
      full_name: 'Key 用户',
      svn_username: null,
      department_id: null,
      department_name: null,
      role: 'user'
    })
    render(<App />)

    await user.type(await screen.findByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    expect(await screen.findByRole('heading', { name: '选择部门' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '任务工作台' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('部门'), 'dept-1')
    await user.click(screen.getByRole('button', { name: '确认选择' }))

    await waitFor(() => {
      expect(window.codeReview.setDepartment).toHaveBeenCalledWith({
        department_id: 'dept-1'
      })
    })
    expect(await screen.findByRole('heading', { name: '任务工作台' })).toBeInTheDocument()
  })

  it('shows login error instead of department selection when department admin has no department', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.getCurrentUser).mockResolvedValueOnce({
      id: 'user-1',
      full_name: '部门管理员',
      svn_username: null,
      department_id: null,
      department_name: null,
      role: 'department_admin'
    })
    render(<App />)

    await user.type(await screen.findByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    expect(
      await screen.findByText('当前账号未绑定部门，请联系超级管理员。')
    ).toBeInTheDocument()
    expect(window.codeReview.listAvailableDepartments).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '选择部门' })).not.toBeInTheDocument()
  })

  it('enters the task page directly when current user already has a department', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    expect(await screen.findByRole('heading', { name: '任务工作台' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '选择部门' })).not.toBeInTheDocument()
  })

  it('keeps download progress in background after the user hides the downloading dialog', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))

    await waitFor(() => {
      expect(window.codeReview.checkForAppUpdate).toHaveBeenCalledTimes(1)
    })

    act(() => {
      availableListener?.({ version: '1.0.1' })
    })
    await user.click(await screen.findByRole('button', { name: '现在更新' }))
    expect(window.codeReview.downloadAppUpdate).toHaveBeenCalledTimes(1)

    act(() => {
      progressListener?.({ percent: 12 })
    })
    expect(await screen.findByText('正在下载新版本')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '后台下载' }))
    expect(screen.queryByText('正在下载新版本')).not.toBeInTheDocument()

    act(() => {
      progressListener?.({ percent: 43 })
    })
    expect(screen.queryByText('正在下载新版本')).not.toBeInTheDocument()
  })
})
