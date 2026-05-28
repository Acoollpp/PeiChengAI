import { FormEvent, useEffect, useState } from 'react'

import paceLogo from '../assets/pace-logo.png'
import type { LoginRequest, RegisterRequest } from '../code-review-api'

type LoginPageProps = {
  onLogin: (payload: LoginRequest) => Promise<void>
  onRegister: (payload: RegisterRequest) => Promise<void>
}

type AuthMode = 'login' | 'register'

export function LoginPage({ onLogin, onRegister }: LoginPageProps): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('login')
  const [serverUrl, setServerUrl] = useState('')
  const [fullName, setFullName] = useState('')
  const [svnUsername, setSvnUsername] = useState('')
  const [svnPassword, setSvnPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    Promise.all([window.codeReview.loadServerConfig(), window.codeReview.loadCredentials()]).then(
      ([serverConfig, credentials]) => {
        if (!isMounted) {
          return
        }

        setServerUrl(credentials?.server_url || serverConfig.server_url)

        if (!credentials) {
          return
        }

        setSvnUsername(credentials.svn_username)
        setSvnPassword(credentials.svn_password)
        setRememberPassword(true)
      }
    ).catch(() => {
      if (!isMounted) {
        return
      }

      setServerUrl('http://172.23.17.190:8000')
    })

    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      if (mode === 'register') {
        await onRegister({
          server_url: serverUrl.trim(),
          full_name: fullName.trim(),
          svn_username: svnUsername.trim(),
          svn_password: svnPassword
        })
      } else {
        await onLogin({
          server_url: serverUrl.trim(),
          svn_username: svnUsername.trim(),
          svn_password: svnPassword
        })
      }

      if (rememberPassword) {
        await window.codeReview.saveCredentials({
          server_url: serverUrl.trim(),
          svn_username: svnUsername.trim(),
          svn_password: svnPassword
        })
      } else {
        await window.codeReview.clearCredentials()
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '认证失败，请稍后重试。')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-topbar">
        <span>← 选择账户</span>
        <span>中文⌄</span>
      </div>

      <div className="auth-brand">
        <img className="auth-logo" src={paceLogo} alt="沛城科技" />
        <h1 id="auth-title">代码审查平台</h1>
      </div>

      <div className="tabs" role="tablist" aria-label="认证方式">
        <button
          className={mode === 'login' ? 'tab is-active' : 'tab'}
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => setMode('login')}
        >
          登录
        </button>
        <button
          className={mode === 'register' ? 'tab is-active' : 'tab'}
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          onClick={() => setMode('register')}
        >
          注册
        </button>
      </div>

      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field auth-field">
          <span>服务端地址</span>
          <input
            required
            value={serverUrl}
            inputMode="url"
            placeholder="http://172.23.17.190:8000"
            autoComplete="url"
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </label>

        {mode === 'register' && (
          <label className="field auth-field">
            <span>姓名</span>
            <input
              required
              value={fullName}
              autoComplete="name"
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>
        )}

        <label className="field auth-field">
          <span>SVN账号</span>
          <input
            required
            value={svnUsername}
            autoComplete="username"
            onChange={(event) => setSvnUsername(event.target.value)}
          />
        </label>

        <label className="field auth-field">
          <span>SVN密码</span>
          <input
            required
            type="password"
            value={svnPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(event) => setSvnPassword(event.target.value)}
          />
        </label>

        <div className="auth-options">
          <label className="remember-field">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            <span>记住密码</span>
          </label>
          <button
            className="link-button"
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '注册账户' : '返回登录'}
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '处理中...' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>
    </section>
  )
}
