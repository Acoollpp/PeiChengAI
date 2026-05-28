import { FormEvent, useState } from 'react'

import type { ExecuteTaskRequest } from '../code-review-api'

type TaskFormProps = {
  disabled: boolean
  onSubmit: (payload: ExecuteTaskRequest) => Promise<void>
}

export function TaskForm({ disabled, onSubmit }: TaskFormProps): React.JSX.Element {
  const [svnUrl, setSvnUrl] = useState('')
  const [oldRevision, setOldRevision] = useState('')
  const [newRevision, setNewRevision] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      await onSubmit({
        svn_url: svnUrl.trim(),
        old_revision: oldRevision.trim(),
        new_revision: newRevision.trim()
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>SVN 地址</span>
        <input
          required
          value={svnUrl}
          placeholder="https://svn.example.com/project/trunk"
          onChange={(event) => setSvnUrl(event.target.value)}
        />
      </label>

      <div className="revision-grid">
        <label className="field">
          <span>旧版本号</span>
          <input
            required
            value={oldRevision}
            inputMode="numeric"
            onChange={(event) => setOldRevision(event.target.value)}
          />
        </label>
        <label className="field">
          <span>新版本号</span>
          <input
            required
            value={newRevision}
            inputMode="numeric"
            onChange={(event) => setNewRevision(event.target.value)}
          />
        </label>
      </div>

      <button className="primary-button" type="submit" disabled={disabled || isSubmitting}>
        {isSubmitting ? '审查中...' : '开始审查'}
      </button>
    </form>
  )
}
