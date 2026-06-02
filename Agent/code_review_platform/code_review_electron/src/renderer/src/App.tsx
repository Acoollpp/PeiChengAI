import { useCallback, useMemo, useState } from 'react'

import type { EnvironmentCheckResult, KeyLoginRequest, SvnLoginRequest } from './code-review-api'
import { LoginPage } from './components/LoginPage'
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

  const checkEnvironment = useCallback(async (): Promise<void> => {
    try {
      setEnvironment(await window.codeReview.checkEnvironment())
    } catch {
      setEnvironment(fallbackEnvironment)
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

  const authActions = useMemo(
    () => ({
      async keyLogin(payload: KeyLoginRequest): Promise<void> {
        await window.codeReview.keyLogin(payload)
        setSession({ displayName: 'Key 用户' })
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
        svnUsername={session.displayName}
        onRefreshEnvironment={checkEnvironment}
        onInstallSkill={installSkill}
      />
    </main>
  )
}
