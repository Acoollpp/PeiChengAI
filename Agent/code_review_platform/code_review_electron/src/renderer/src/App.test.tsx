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
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    readTaskReport: vi.fn(),
    executeTask: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    createGpioTask: vi.fn(async () => ({
      id: 'gpio-task-1',
      status: 'success',
      manual_svn_url: 'svn://repo/manual',
      code_svn_url: 'svn://repo/code',
      uploaded_files: []
    })),
    listGpioTasks: vi.fn(async () => ({ data: [], count: 0 })),
    generateGpioTask: vi.fn(async () => ({
      id: 'gpio-task-1',
      status: 'success',
      manual_svn_url: 'svn://repo/manual',
      code_svn_url: 'svn://repo/code',
      uploaded_files: [],
      result_name: 'GPIO配置表.xlsx'
    })),
    openGpioWorkbook: vi.fn(),
    deleteGpioTask: vi.fn(),
    downloadCurrentReport: vi.fn(),
    openPdfReport: vi.fn(),
    readReportAsset: vi.fn(),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(async () => ({ status: 'ready' })),
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

describe('App workspace navigation', () => {
  it('opens GPIO configuration task page from the client without running local Codex', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Key'), 'sk-cch-test')
    await user.click(screen.getByRole('button', { name: 'Key 登录' }))
    await user.click(await screen.findByRole('button', { name: 'GPIO配置表' }))

    expect(await screen.findByRole('heading', { name: 'GPIO配置表任务' })).toBeInTheDocument()
    expect(
      screen.getByText('客户端只提交 SVN 路径，服务端自行拉取芯片手册和代码生成 Excel。')
    ).toBeInTheDocument()
    expect(window.codeReview.listGpioTasks).toHaveBeenCalledTimes(1)
    expect(window.codeReview.executeTask).not.toHaveBeenCalled()
  })
})
