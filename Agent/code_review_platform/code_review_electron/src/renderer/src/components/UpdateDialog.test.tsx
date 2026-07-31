// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UpdateDialog } from './UpdateDialog'

describe('UpdateDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows available update and starts download', async () => {
    const onDownload = vi.fn()
    const onDismiss = vi.fn()

    render(
      <UpdateDialog
        state="available"
        info={{ version: '1.0.1', releaseNotes: '修复任务列表显示问题' }}
        progress={null}
        error=""
        onDownload={onDownload}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByText('发现新版本 1.0.1')).toBeInTheDocument()
    expect(screen.getByText('修复任务列表显示问题')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '现在更新' }))
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('supports keyboard dismissal and disables pending downloads', async () => {
    const onDismiss = vi.fn()

    render(
      <UpdateDialog
        state="available"
        info={{ version: '1.0.1' }}
        progress={null}
        error=""
        isDownloading
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
      />
    )

    const downloadButton = screen.getByRole('button', { name: '准备下载...' })
    expect(downloadButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '稍后' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('shows download progress', () => {
    render(
      <UpdateDialog
        state="downloading"
        info={{ version: '1.0.1' }}
        progress={{ percent: 43, transferred: 43, total: 100, bytesPerSecond: 10 }}
        error=""
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText('43%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43')
  })

  it('installs downloaded update', async () => {
    const onInstall = vi.fn()

    render(
      <UpdateDialog
        state="downloaded"
        info={{ version: '1.0.1' }}
        progress={null}
        error=""
        onDownload={vi.fn()}
        onInstall={onInstall}
        onDismiss={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: '立即重启' }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it('disables install while restart is pending', () => {
    render(
      <UpdateDialog
        state="downloaded"
        info={{ version: '1.0.1' }}
        progress={null}
        error=""
        isInstalling
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '正在重启...' })).toBeDisabled()
  })

  it('shows update errors', () => {
    render(
      <UpdateDialog
        state="error"
        info={null}
        progress={null}
        error="更新下载失败"
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByText('更新失败')).toBeInTheDocument()
    expect(screen.getByText('更新下载失败')).toBeInTheDocument()
  })

  it('does not allow a forced update to be dismissed', async () => {
    const onDismiss = vi.fn()
    const onExit = vi.fn()

    render(
      <UpdateDialog
        state="downloading"
        info={{ version: '1.6.0', releaseNotes: '强制更新能力' }}
        progress={{ percent: 20 }}
        error=""
        isForced
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
        onExit={onExit}
      />
    )

    expect(screen.queryByRole('button', { name: '后台下载' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出客户端' })).toBeInTheDocument()
    expect(screen.getByText('强制更新能力')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('only offers retry or exit after a forced update failure', async () => {
    const onRetry = vi.fn()
    render(
      <UpdateDialog
        state="error"
        info={{ version: '1.6.0' }}
        progress={null}
        error="更新下载失败"
        isForced
        onDownload={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
        onRetry={onRetry}
        onExit={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '知道了' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试更新' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
