import { useEffect, useRef } from 'react'

import type { AppUpdateInfo, AppUpdateProgress, AppUpdateStatus } from '../code-review-api'

interface UpdateDialogProps {
  state: Exclude<AppUpdateStatus, 'idle'>
  info: AppUpdateInfo | null
  progress: AppUpdateProgress | null
  error: string
  isDownloading?: boolean
  isInstalling?: boolean
  isForced?: boolean
  onDownload: () => void
  onInstall: () => void
  onDismiss: () => void
  onRetry?: () => void
  onExit?: () => void
}

export function UpdateDialog({
  state,
  info,
  progress,
  error,
  isDownloading = false,
  isInstalling = false,
  isForced = false,
  onDownload,
  onInstall,
  onDismiss,
  onRetry = onDownload,
  onExit = onDismiss
}: UpdateDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)
  const version = info?.version ?? ''
  const notes = formatReleaseNotes(info?.releaseNotes)
  const percent = clampPercent(progress?.percent)

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    const preferredFocusElement =
      dialog.querySelector<HTMLElement>('.primary-button:not(:disabled)') ?? getFocusableElements(dialog)[0]

    ;(preferredFocusElement ?? dialog).focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!isForced) {
          onDismiss()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const elements = getFocusableElements(dialog)
      const firstElement = elements[0]
      const lastElement = elements.at(-1)

      if (!firstElement || !lastElement) {
        event.preventDefault()
        dialog.focus()
        return
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown)
    }
  }, [isForced, onDismiss])

  return (
    <div className="modal-backdrop login-update-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        tabIndex={-1}
      >
        {state === 'available' && (
          <>
            <header>
              <h2 id="update-title">发现新版本 {version}</h2>
              <p>
                {isForced
                  ? '当前版本已停止支持，必须完成更新后才能继续使用。'
                  : '当前版本仍可继续使用，你可以现在更新或稍后处理。'}
              </p>
            </header>
            <div className="update-notes">{notes}</div>
            <footer className="dialog-actions">
              {isForced ? (
                <button className="secondary-button" type="button" onClick={onExit}>
                  退出客户端
                </button>
              ) : (
                <button className="secondary-button" type="button" onClick={onDismiss}>
                  稍后
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={isDownloading}
                onClick={onDownload}
              >
                {isDownloading ? '准备下载...' : '现在更新'}
              </button>
            </footer>
          </>
        )}

        {state === 'downloading' && (
          <>
            <header>
              <h2 id="update-title">正在下载新版本</h2>
              <p>
                {isForced
                  ? `当前版本已低于最低支持版本，正在下载 ${version || '最新版本'}。`
                  : '下载期间可以继续使用客户端。'}
              </p>
            </header>
            {isForced && <div className="update-notes">{notes}</div>}
            <div className="update-progress">
              <strong>{percent}%</strong>
              <div
                className="update-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
            </div>
            <footer className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={isForced ? onExit : onDismiss}
              >
                {isForced ? '退出客户端' : '后台下载'}
              </button>
            </footer>
          </>
        )}

        {state === 'downloaded' && (
          <>
            <header>
              <h2 id="update-title">新版本已准备好</h2>
              <p>
                {isForced
                  ? '必须重启并安装新版本后才能继续使用客户端。'
                  : '重启客户端后将完成安装。'}
              </p>
            </header>
            <footer className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={isForced ? onExit : onDismiss}
              >
                {isForced ? '退出客户端' : '稍后重启'}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isInstalling}
                onClick={onInstall}
              >
                {isInstalling ? '正在重启...' : isForced ? '重启并安装' : '立即重启'}
              </button>
            </footer>
          </>
        )}

        {state === 'error' && (
          <>
            <header>
              <h2 id="update-title">更新失败</h2>
              <p>
                {error ||
                  (isForced ? '更新失败，请重试或退出客户端。' : '当前版本仍可继续使用。')}
              </p>
            </header>
            <footer className="dialog-actions">
              {isForced ? (
                <>
                  <button className="secondary-button" type="button" onClick={onExit}>
                    退出客户端
                  </button>
                  <button className="primary-button" type="button" onClick={onRetry}>
                    重试更新
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={onDismiss}>
                  知道了
                </button>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  )
}

function formatReleaseNotes(notes: AppUpdateInfo['releaseNotes']): string {
  if (typeof notes === 'string' && notes.trim()) {
    return notes
  }

  if (Array.isArray(notes)) {
    const joinedNotes = notes
      .map((item) => item.note?.trim())
      .filter((note): note is string => Boolean(note))
      .join('\n')

    if (joinedNotes) {
      return joinedNotes
    }
  }

  return '此版本包含稳定性修复和体验优化。'
}

function clampPercent(percent: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round(percent ?? 0)))
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  )
}
