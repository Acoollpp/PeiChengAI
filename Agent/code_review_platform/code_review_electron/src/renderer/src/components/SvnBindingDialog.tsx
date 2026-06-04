import { FormEvent, useState } from 'react'

import { PasswordField } from './PasswordField'

interface SvnBindingDialogProps {
  onSubmit: (credentials: { svn_username: string; svn_password: string }) => Promise<void>
  onSkip: () => void
  isSubmitting: boolean
  error: string
}

export function SvnBindingDialog({
  onSubmit,
  onSkip,
  isSubmitting,
  error
}: SvnBindingDialogProps): React.JSX.Element {
  const [svnUsername, setSvnUsername] = useState('')
  const [svnPassword, setSvnPassword] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await onSubmit({ svn_username: svnUsername.trim(), svn_password: svnPassword })
  }

  return (
    <div className="dialog-overlay" onClick={isSubmitting ? undefined : onSkip}>
      <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
        <button
          className="dialog-close"
          type="button"
          disabled={isSubmitting}
          onClick={onSkip}
          aria-label="关闭"
        >
          ✕
        </button>

        <h2>绑定 SVN 账号</h2>
        <p className="dialog-desc">
          使用 Key 登录需要绑定 SVN 账号才能执行代码审查任务。
        </p>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field auth-field">
            <span>SVN 账号</span>
            <input
              required
              value={svnUsername}
              autoComplete="username"
              placeholder="请输入 SVN 账号"
              disabled={isSubmitting}
              onChange={(event) => setSvnUsername(event.target.value)}
            />
          </label>

          <PasswordField
            label="SVN 密码"
            value={svnPassword}
            autoComplete="current-password"
            placeholder="请输入 SVN 密码"
            disabled={isSubmitting}
            onChange={setSvnPassword}
          />

          {error && <p className="form-error">{error}</p>}

          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isSubmitting}
              onClick={onSkip}
            >
              跳过
            </button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '绑定中...' : '绑定并继续'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
