import { useCallback, useMemo, useState } from 'react'

import type { EnvironmentCheckResult, LoginRequest, RegisterRequest } from './code-review-api'
import { LoginPage } from './components/LoginPage'
import { TaskPage } from './components/TaskPage'

type AuthSession = {
  svnUsername: string
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
      async login(payload: LoginRequest): Promise<void> {
        await window.codeReview.login(payload)
        setSession({ svnUsername: payload.svn_username })
        await checkEnvironment()
      },
      async register(payload: RegisterRequest): Promise<void> {
        await window.codeReview.register(payload)
        setSession({ svnUsername: payload.svn_username })
        await checkEnvironment()
      }
    }),
    [checkEnvironment]
  )

  if (!session) {
    return (
      <main className="app-shell auth-shell">
        <LoginPage onLogin={authActions.login} onRegister={authActions.register} />
      </main>
    )
  }

  return (
    <main className="app-shell">
      <TaskPage
        environment={environment}
        svnUsername={session.svnUsername}
        onRefreshEnvironment={checkEnvironment}
        onInstallSkill={installSkill}
      />
    </main>
  )
}
