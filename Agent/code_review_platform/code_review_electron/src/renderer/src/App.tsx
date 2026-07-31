import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AppUpdateInfo,
  AppUpdateProgress,
  AppUpdateStatus,
  EnvironmentCheckResult,
  EnvironmentProgressEvent,
  KeyLoginRequest,
  SvnLoginRequest,
  CurrentUser,
  DepartmentsResponse
} from './code-review-api'
import { DepartmentSelectionDialog } from './components/DepartmentSelectionDialog'
import { LoginPage } from './components/LoginPage'
import { SvnBindingDialog } from './components/SvnBindingDialog'
import { TaskPage } from './components/TaskPage'
import { UpdateDialog } from './components/UpdateDialog'

type AuthSession = {
  displayName: string
}

type PendingDepartmentSession = {
  displayName: string
  needSvnBinding: boolean
}

const fallbackEnvironment: EnvironmentCheckResult = {
  status: 'failed'
}

export function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [pendingDepartmentSession, setPendingDepartmentSession] =
    useState<PendingDepartmentSession | null>(null)
  const [departments, setDepartments] = useState<DepartmentsResponse['data']>([])
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(false)
  const [isSavingDepartment, setIsSavingDepartment] = useState(false)
  const [departmentError, setDepartmentError] = useState('')
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
  const [isForcedUpdate, setIsForcedUpdate] = useState(false)
  const isForcedUpdateRef = useRef(false)
  const [forcedRetryAction, setForcedRetryAction] = useState<'download' | 'install'>('download')

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

  const markForcedUpdate = useCallback((version: string | null, releaseNotes?: string | null) => {
    isForcedUpdateRef.current = true
    setIsForcedUpdate(true)
    setUpdateInfo({ version: version ?? '', releaseNotes: releaseNotes ?? undefined })
    setUpdateError('')
    setUpdateState('downloading')
    setIsUpdateDialogVisible(true)
  }, [])

  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.codeReview.checkForAppUpdate()

      if (result.status === 'required') {
        markForcedUpdate(result.policy.active_version, result.policy.release_notes)
        return true
      }

      if (result.status === 'current' || result.status === 'check_failed') {
        setUpdateState('idle')
        setIsUpdateDialogVisible(false)
      }
      return false
    } catch {
      return false
    }
  }, [markForcedUpdate])

  const downloadUpdate = useCallback(async (): Promise<void> => {
    setUpdateError('')
    setIsStartingDownload(true)
    setUpdateState('downloading')
    setIsUpdateDialogVisible(true)
    try {
      await window.codeReview.downloadAppUpdate()
    } catch {
      setForcedRetryAction('download')
      setUpdateError(
        isForcedUpdateRef.current
          ? '更新下载失败，请重试或退出客户端。'
          : '更新下载失败，当前版本仍可继续使用。'
      )
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
      setForcedRetryAction('install')
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

  const startAuthenticatedSession = useCallback(
    async ({
      displayName,
      needSvnBinding,
      currentUser
    }: {
      displayName: string
      needSvnBinding: boolean
      currentUser: CurrentUser
    }): Promise<void> => {
      const updateRequired = await checkForUpdate()
      if (updateRequired) {
        return
      }

      if (!currentUser.department_id) {
        if (currentUser.role === 'department_admin') {
          setPendingDepartmentSession(null)
          setDepartments([])
          setDepartmentError('')
          throw new Error('当前账号未绑定部门，请联系超级管理员。')
        }

        setPendingDepartmentSession({ displayName, needSvnBinding })
        setDepartmentError('')
        setIsLoadingDepartments(true)
        try {
          const result = await window.codeReview.listAvailableDepartments()
          setDepartments(result.data)
        } catch (error) {
          setDepartments([])
          setDepartmentError(error instanceof Error ? error.message : '部门列表加载失败，请重试。')
        } finally {
          setIsLoadingDepartments(false)
        }
        return
      }

      setPendingDepartmentSession(null)
      setDepartments([])
      setSession({ displayName })
      if (needSvnBinding) {
        setNeedSvnBinding(true)
      }
      await checkEnvironment()
    },
    [checkEnvironment, checkForUpdate]
  )

  const saveDepartment = useCallback(
    async (departmentId: string): Promise<void> => {
      if (!pendingDepartmentSession) {
        return
      }

      setDepartmentError('')
      setIsSavingDepartment(true)
      try {
        await window.codeReview.setDepartment({ department_id: departmentId })
        const nextSession = pendingDepartmentSession
        setPendingDepartmentSession(null)
        setDepartments([])
        setSession({ displayName: nextSession.displayName })
        if (nextSession.needSvnBinding) {
          setNeedSvnBinding(true)
        }
        await checkEnvironment()
      } catch (error) {
        setDepartmentError(error instanceof Error ? error.message : '部门保存失败，请重试。')
      } finally {
        setIsSavingDepartment(false)
      }
    },
    [checkEnvironment, pendingDepartmentSession]
  )

  const authActions = useMemo(
    () => ({
      async keyLogin(payload: KeyLoginRequest): Promise<void> {
        const result = await window.codeReview.keyLogin(payload)
        const currentUser = await window.codeReview.getCurrentUser()
        await startAuthenticatedSession({
          displayName: 'Key 用户',
          needSvnBinding: result.needSvnBinding,
          currentUser
        })
      },
      async svnLogin(payload: SvnLoginRequest): Promise<void> {
        await window.codeReview.svnLogin(payload)
        const currentUser = await window.codeReview.getCurrentUser()
        await startAuthenticatedSession({
          displayName: payload.svn_username,
          needSvnBinding: false,
          currentUser
        })
      }
    }),
    [startAuthenticatedSession]
  )

  useEffect(() => {
    const disposers = [
      window.codeReview.onAppUpdateAvailable((info) => {
        setUpdateInfo(info)
        setUpdateProgress(null)
        setUpdateError('')
        setUpdateState(isForcedUpdateRef.current ? 'downloading' : 'available')
        setIsUpdateDialogVisible(true)
      }),
      window.codeReview.onAppUpdateNotAvailable(() => {
        if (isForcedUpdateRef.current) {
          return
        }
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
        setForcedRetryAction(error.phase === 'install' ? 'install' : 'download')
        setUpdateError(
          error.message ||
            (isForcedUpdateRef.current
              ? '更新失败，请重试或退出客户端。'
              : '更新失败，当前版本仍可继续使用。')
        )
        setUpdateState('error')
        setIsUpdateDialogVisible(true)
      }),
      window.codeReview.onAppUpdateRequired((policy) => {
        markForcedUpdate(policy.active_version, policy.release_notes)
      }),
      window.codeReview.onEnvironmentProgress((progress) => {
        setEnvironmentProgress(progress)
      })
    ]

    return () => {
      disposers.forEach((dispose) => dispose())
    }
  }, [markForcedUpdate])

  if (isForcedUpdate && updateState !== 'idle') {
    return (
      <main className="app-shell auth-shell">
        <UpdateDialog
          state={updateState}
          info={updateInfo}
          progress={updateProgress}
          error={updateError}
          isDownloading={isStartingDownload}
          isInstalling={isInstallingUpdate}
          isForced
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onDismiss={() => undefined}
          onRetry={forcedRetryAction === 'install' ? installUpdate : downloadUpdate}
          onExit={() => void window.codeReview.quitApp()}
        />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <LoginPage onKeyLogin={authActions.keyLogin} onSvnLogin={authActions.svnLogin} />
        {pendingDepartmentSession && (
          <DepartmentSelectionDialog
            departments={departments}
            isLoading={isLoadingDepartments}
            isSubmitting={isSavingDepartment}
            error={departmentError}
            onSubmit={saveDepartment}
          />
        )}
      </main>
    )
  }

  return (
    <main className="app-shell">
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
          onRetry={downloadUpdate}
          onExit={() => void window.codeReview.quitApp()}
        />
      )}
    </main>
  )
}
