import { FormEvent, useEffect, useState } from 'react'

import paceLogo from '../assets/pace-logo.png'
import type { KeyLoginRequest, SvnLoginRequest } from '../code-review-api'

type LoginPageProps = {
  onKeyLogin: (payload: KeyLoginRequest) => Promise<void>
  onSvnLogin: (payload: SvnLoginRequest) => Promise<void>
}

type AuthMode = 'key' | 'svn'

export function LoginPage({ onKeyLogin, onSvnLogin }: LoginPageProps): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('key')
  const [serverUrl, setServerUrl] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [svnUsername, setSvnUsername] = useState('')
  const [svnPassword, setSvnPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    Promise.all([window.codeReview.loadServerConfig(), window.codeReview.loadCredentials()])
      .then(([serverConfig, credentials]) => {
        if (!isMounted) {
          return
        }

        setServerUrl(credentials?.server_url || serverConfig.server_url)

        if (!credentials) {
          return
        }

        setMode(credentials.mode === 'key' ? 'key' : 'svn')
        if (credentials.mode === 'key') {
          setAccessKey(credentials.key)
        } else {
          setSvnUsername(credentials.svn_username)
          setSvnPassword(credentials.svn_password)
        }
        setRememberPassword(true)
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        setServerUrl('http://172.23.17.242:8000')
      })

    return () => {
      isMounted = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    const normalizedServerUrl = serverUrl.trim()

    try {
      if (mode === 'key') {
        const keyPayload = {
          server_url: normalizedServerUrl,
          key: accessKey.trim()
        }

        await onKeyLogin(keyPayload)
        if (rememberPassword) {
          await window.codeReview.saveCredentials({
            mode: 'key',
            ...keyPayload
          })
        } else {
          await window.codeReview.clearCredentials()
        }
        return
      }

      const svnPayload = {
        server_url: normalizedServerUrl,
        svn_username: svnUsername.trim(),
        svn_password: svnPassword
      }

      await onSvnLogin(svnPayload)

      if (rememberPassword) {
        await window.codeReview.saveCredentials({
          mode: 'svn',
          ...svnPayload
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
      <div className="auth-brand">
        <img className="auth-logo" src={paceLogo} alt="沛城科技" />
        <h1 id="auth-title">代码审查平台</h1>
      </div>

      <div className="tabs" role="tablist" aria-label="认证方式">
        <button
          className={mode === 'key' ? 'tab is-active' : 'tab'}
          type="button"
          role="tab"
          aria-selected={mode === 'key'}
          onClick={() => setMode('key')}
        >
          Key 登录
        </button>
        <button
          className={mode === 'svn' ? 'tab is-active' : 'tab'}
          type="button"
          role="tab"
          aria-selected={mode === 'svn'}
          onClick={() => setMode('svn')}
        >
          SVN 登录
        </button>
      </div>

      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field auth-field">
          <span>服务端地址</span>
          <input
            required
            value={serverUrl}
            inputMode="url"
            placeholder="http://172.23.17.242:8000"
            autoComplete="url"
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </label>

        {mode === 'key' ? (
          <label className="field auth-field">
            <span>Key</span>
            <input
              required
              type="password"
              value={accessKey}
              autoComplete="current-password"
              onChange={(event) => setAccessKey(event.target.value)}
            />
          </label>
        ) : (
          <>
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
                autoComplete="current-password"
                onChange={(event) => setSvnPassword(event.target.value)}
              />
            </label>
          </>
        )}

        <div className="auth-options">
          <label className="remember-field">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            <span>记住密码</span>
          </label>
        </div>

        {error && <p className="form-error">{error}</p>}

        <button className="primary-button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? '处理中...' : mode === 'key' ? 'Key 登录' : 'SVN 登录'}
        </button>
      </form>
    </section>
  )
}
