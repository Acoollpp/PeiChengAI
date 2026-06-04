import { useCallback, useMemo, useState } from 'react'

import type { EnvironmentCheckResult, KeyLoginRequest, SvnLoginRequest } from './code-review-api'
import { LoginPage } from './components/LoginPage'
import { SvnBindingDialog } from './components/SvnBindingDialog'
import { TaskPage } from './components/TaskPage'

type AuthSession = {
  displayName: string
}

const fallbackEnvironment: EnvironmentCheckResult = {
  status: 'failed'
}

export function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [environment, setEnvironment] = useState<EnvironmentCheckResult | null>(null)
  const [isCheckingEnvironment, setIsCheckingEnvironment] = useState(false)
  const [isInstallingCodex, setIsInstallingCodex] = useState(false)
  const [isInstallingSvn, setIsInstallingSvn] = useState(false)
  const [needSvnBinding, setNeedSvnBinding] = useState(false)
  const [bindingError, setBindingError] = useState('')
  const [isBinding, setIsBinding] = useState(false)

  const checkEnvironment = useCallback(async (): Promise<void> => {
    setIsCheckingEnvironment(true)
    try {
      setEnvironment(await window.codeReview.checkEnvironment())
    } catch {
      setEnvironment(fallbackEnvironment)
    } finally {
      setIsCheckingEnvironment(false)
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
    try {
      setEnvironment(await window.codeReview.installSkill())
    } catch {
      setEnvironment({
        status: 'missing_skill',
        skillError: 'Skill 安装失败'
      })
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
      },
      async svnLogin(payload: SvnLoginRequest): Promise<void> {
        await window.codeReview.svnLogin(payload)
        setSession({ displayName: payload.svn_username })
        await checkEnvironment()
      }
    }),
    [checkEnvironment]
  )

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <LoginPage onKeyLogin={authActions.keyLogin} onSvnLogin={authActions.svnLogin} />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <TaskPage
        environment={environment}
        isCheckingEnvironment={isCheckingEnvironment}
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
    </main>
  )
}
