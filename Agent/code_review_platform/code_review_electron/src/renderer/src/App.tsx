import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  AppUpdateInfo,
  AppUpdateProgress,
  AppUpdateStatus,
  EnvironmentCheckResult,
  EnvironmentProgressEvent,
  KeyLoginRequest,
  SvnLoginRequest
} from './code-review-api'
import { LoginPage } from './components/LoginPage'
import { GpioTaskPage } from './components/GpioTaskPage'
import { SvnBindingDialog } from './components/SvnBindingDialog'
import { TaskPage } from './components/TaskPage'
import { UpdateDialog } from './components/UpdateDialog'

type AuthSession = {
  displayName: string
}

type WorkspaceModule = 'review' | 'gpio'

const fallbackEnvironment: EnvironmentCheckResult = {
  status: 'failed'
}

export function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [activeModule, setActiveModule] = useState<WorkspaceModule>('review')
  const [environment, setEnvironment] = useState<EnvironmentCheckResult | null>(null)
  const [isCheckingEnvironment, setIsCheckingEnvironment] = useState(false)
  const [environmentProgress, setEnvironmentProgress] =
    useState<EnvironmentProgressEvent | null>(null)
  const [isInstallingCodex, setIsInstallingCodex] = useState(false)
  const [isInstallingSvn, setIsInstallingSvn] = useState(false)
  const [needSvnBinding, setNeedSvnBinding] = useState(false)
  const [bindingError, setBindingError] = useState('')
  const [isBinding, setIsBinding] = useState(false)
  const [updateState, setUpdateState] = useState<AppUpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [isUpdateDialogVisible, setIsUpdateDialogVisible] = useState(false)
  const [isStartingDownload, setIsStartingDownload] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)

  const checkEnvironment = useCallback(async (): Promise<void> => {
    setIsCheckingEnvironment(true)
    setEnvironmentProgress(null)
    try {
      setEnvironment(await window.codeReview.checkEnvironment())
    } catch {
      setEnvironment(fallbackEnvironment)
    } finally {
      setIsCheckingEnvironment(false)
      setEnvironmentProgress(null)
    }
  }, [])

  const installCodex = useCallback(async (): Promise<void> => {
    setIsInstallingCodex(true)
    try {
      setEnvironment(await window.codeReview.installCodex())
    } catch {
      setEnvironment({
        status: 'missing_codex',
        codexError: 'Codex 安装失败'
      })
    } finally {
      setIsInstallingCodex(false)
    }
  }, [])

  const installSvn = useCallback(async (): Promise<void> => {
    setIsInstallingSvn(true)
    try {
      setEnvironment(await window.codeReview.installSvn())
    } catch {
      setEnvironment({
        status: 'missing_svn',
        svnError: 'SVN CLI 安装失败'
      })
    } finally {
      setIsInstallingSvn(false)
    }
  }, [])

  const installSkill = useCallback(async (): Promise<void> => {
    setEnvironmentProgress({ stage: 'installing_skill' })
    try {
      setEnvironment(await window.codeReview.installSkill())
    } catch {
      setEnvironment({
        status: 'missing_skill',
        skillError: 'Skill 安装失败'
      })
    } finally {
      setEnvironmentProgress(null)
    }
  }, [])

  const checkForUpdate = useCallback(async (): Promise<void> => {
    try {
      const didStartChecking = await window.codeReview.checkForAppUpdate()

      if (!didStartChecking) {
        setUpdateState('idle')
        setIsUpdateDialogVisible(false)
      }
    } catch {
      setUpdateError('更新检查失败，当前版本仍可继续使用。')
      setUpdateState('error')
      setIsUpdateDialogVisible(true)
    }
  }, [])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    setUpdateError('')
    setIsStartingDownload(true)
    setUpdateState('downloading')
    setIsUpdateDialogVisible(true)
    try {
      await window.codeReview.downloadAppUpdate()
    } catch {
      setUpdateError('更新下载失败，当前版本仍可继续使用。')
      setUpdateState('error')
      setIsUpdateDialogVisible(true)
    } finally {
      setIsStartingDownload(false)
    }
  }, [])

  const installUpdate = useCallback(async (): Promise<void> => {
    setIsInstallingUpdate(true)
    try {
      await window.codeReview.installAppUpdate()
    } catch {
      setUpdateError('更新安装启动失败，请稍后重试。')
      setUpdateState('error')
      setIsUpdateDialogVisible(true)
    } finally {
      setIsInstallingUpdate(false)
    }
  }, [])

  const bindSvnCredential = useCallback(
    async (credentials: { svn_username: string; svn_password: string }): Promise<void> => {
      setBindingError('')
      setIsBinding(true)
      try {
        await window.codeReview.bindSvnCredential(credentials)
        setNeedSvnBinding(false)
      } catch (error) {
        setBindingError(error instanceof Error ? error.message : 'SVN 绑定失败，请重试。')
      } finally {
        setIsBinding(false)
      }
    },
    []
  )

  const authActions = useMemo(
    () => ({
      async keyLogin(payload: KeyLoginRequest): Promise<void> {
        const result = await window.codeReview.keyLogin(payload)
        setSession({ displayName: 'Key 用户' })
        if (result.needSvnBinding) {
          setNeedSvnBinding(true)
        }
        await checkEnvironment()
        void checkForUpdate()
      },
      async svnLogin(payload: SvnLoginRequest): Promise<void> {
        await window.codeReview.svnLogin(payload)
        setSession({ displayName: payload.svn_username })
        await checkEnvironment()
        void checkForUpdate()
      }
    }),
    [checkEnvironment, checkForUpdate]
  )

  useEffect(() => {
    const disposers = [
      window.codeReview.onAppUpdateAvailable((info) => {
        setUpdateInfo(info)
        setUpdateProgress(null)
        setUpdateError('')
        setUpdateState('available')
        setIsUpdateDialogVisible(true)
      }),
      window.codeReview.onAppUpdateNotAvailable(() => {
        setUpdateState('idle')
        setIsUpdateDialogVisible(false)
      }),
      window.codeReview.onAppUpdateProgress((progress) => {
        setUpdateProgress(progress)
        setUpdateState('downloading')
      }),
      window.codeReview.onAppUpdateDownloaded((info) => {
        setUpdateInfo(info)
        setUpdateProgress(null)
        setUpdateState('downloaded')
        setIsUpdateDialogVisible(true)
      }),
      window.codeReview.onAppUpdateError((error) => {
        setUpdateError(error.message || '更新失败，当前版本仍可继续使用。')
        setUpdateState('error')
        setIsUpdateDialogVisible(true)
      }),
      window.codeReview.onEnvironmentProgress((progress) => {
        setEnvironmentProgress(progress)
      })
    ]

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [])

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <LoginPage onKeyLogin={authActions.keyLogin} onSvnLogin={authActions.svnLogin} />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <nav className="module-switcher" aria-label="功能切换">
        <button
          className={activeModule === 'review' ? 'is-active' : ''}
          type="button"
          onClick={() => setActiveModule('review')}
        >
          代码审查
        </button>
        <button
          className={activeModule === 'gpio' ? 'is-active' : ''}
          type="button"
          onClick={() => setActiveModule('gpio')}
        >
          GPIO配置表
        </button>
        <span className="test-version-badge">测试中</span>
      </nav>
      {activeModule === 'review' ? (
        <TaskPage
          environment={environment}
          isCheckingEnvironment={isCheckingEnvironment}
          isInstallingSkillDuringCheck={environmentProgress?.stage === 'installing_skill'}
          isInstallingCodex={isInstallingCodex}
          isInstallingSvn={isInstallingSvn}
          svnUsername={session.displayName}
          onRefreshEnvironment={checkEnvironment}
          onInstallCodex={installCodex}
          onInstallSvn={installSvn}
          onInstallSkill={installSkill}
        />
      ) : (
        <GpioTaskPage svnUsername={session.displayName} />
      )}
      {needSvnBinding && (
        <SvnBindingDialog
          onSubmit={bindSvnCredential}
          onSkip={() => setNeedSvnBinding(false)}
          isSubmitting={isBinding}
          error={bindingError}
        />
      )}
      {updateState !== 'idle' && isUpdateDialogVisible && (
        <UpdateDialog
          state={updateState}
          info={updateInfo}
          progress={updateProgress}
          error={updateError}
          isDownloading={isStartingDownload}
          isInstalling={isInstallingUpdate}
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onDismiss={() => setIsUpdateDialogVisible(false)}
        />
      )}
    </main>
  )
}
