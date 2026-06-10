import { FormEvent, useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_REVIEW_TEMPLATE_KEY,
  REVIEW_TEMPLATES,
  resolveReviewTemplate,
  type ReviewTemplateKey
} from '../../../shared/review-templates'
import type { ExecuteTaskRequest } from '../code-review-api'

type TaskFormProps = {
  disabled: boolean
  activeSkillNames?: string[]
  onSubmit: (payload: ExecuteTaskRequest) => Promise<void>
}

export function TaskForm({ disabled, activeSkillNames, onSubmit }: TaskFormProps): React.JSX.Element {
  const [svnUrl, setSvnUrl] = useState('')
  const [oldRevision, setOldRevision] = useState('')
  const [newRevision, setNewRevision] = useState('')
  const [templateKey, setTemplateKey] = useState<ReviewTemplateKey>(DEFAULT_REVIEW_TEMPLATE_KEY)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeSkillNameSet = useMemo(
    () => (activeSkillNames ? new Set(activeSkillNames) : null),
    [activeSkillNames]
  )
  const selectedTemplate = resolveReviewTemplate(templateKey)
  const selectedTemplateAvailable =
    !activeSkillNameSet || activeSkillNameSet.has(selectedTemplate.skillName)

  useEffect(() => {
    if (!activeSkillNameSet || activeSkillNameSet.has(selectedTemplate.skillName)) {
      return
    }

    const firstAvailableTemplate = REVIEW_TEMPLATES.find((template) =>
      activeSkillNameSet.has(template.skillName)
    )
    if (firstAvailableTemplate) {
      setTemplateKey(firstAvailableTemplate.key)
    }
  }, [activeSkillNameSet, selectedTemplate.skillName])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const template = resolveReviewTemplate(templateKey)
      if (activeSkillNameSet && !activeSkillNameSet.has(template.skillName)) {
        return
      }

      await onSubmit({
        svn_url: svnUrl.trim(),
        old_revision: oldRevision.trim(),
        new_revision: newRevision.trim(),
        template_key: template.key,
        skill_name: template.skillName
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

      <fieldset className="template-choice">
        <legend>审查模板</legend>
        <div className="template-options">
          {REVIEW_TEMPLATES.map((template) => (
            <label className="template-option" key={template.key}>
              <input
                type="radio"
                name="review-template"
                value={template.key}
                disabled={Boolean(activeSkillNameSet && !activeSkillNameSet.has(template.skillName))}
                checked={templateKey === template.key}
                onChange={() => setTemplateKey(template.key)}
              />
              <span>{template.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        className="primary-button"
        type="submit"
        disabled={disabled || isSubmitting || !selectedTemplateAvailable}
      >
        {isSubmitting ? '提交中...' : '开始审查'}
      </button>
    </form>
  )
}
