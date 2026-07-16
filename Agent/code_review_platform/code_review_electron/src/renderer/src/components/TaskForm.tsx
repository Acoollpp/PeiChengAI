import { ClipboardEvent, FormEvent, useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_REVIEW_TEMPLATE_KEY,
  REVIEW_TEMPLATES,
  resolveReviewTemplate,
  type ReviewTemplateKey
} from '../../../shared/review-templates'
import type { ExecuteTaskRequest } from '../code-review-api'

const RECENT_SVN_URLS_STORAGE_KEY = 'code-review:recent-svn-urls'
const MAX_RECENT_SVN_URLS = 3

type TaskFormProps = {
  disabled: boolean
  activeSkillNames?: string[]
  selectedTemplateKey?: ReviewTemplateKey
  onTemplateChange?: (templateKey: ReviewTemplateKey) => void
  onSubmit: (payload: ExecuteTaskRequest) => Promise<void>
}

export function TaskForm({
  disabled,
  activeSkillNames,
  selectedTemplateKey,
  onTemplateChange,
  onSubmit
}: TaskFormProps): React.JSX.Element {
  const [svnUrl, setSvnUrl] = useState('')
  const [recentSvnUrls, setRecentSvnUrls] = useState<string[]>(() => readRecentSvnUrls())
  const [isSvnHistoryOpen, setIsSvnHistoryOpen] = useState(false)
  const [activeSvnHistoryIndex, setActiveSvnHistoryIndex] = useState<number | null>(null)
  const [oldRevision, setOldRevision] = useState('')
  const [newRevision, setNewRevision] = useState('')
  const [requirementFilePath, setRequirementFilePath] = useState('')
  const [focusDirectionSnapshot, setFocusDirectionSnapshot] = useState('')
  const [requirementFileError, setRequirementFileError] = useState('')
  const [uncontrolledTemplateKey, setUncontrolledTemplateKey] =
    useState<ReviewTemplateKey>(DEFAULT_REVIEW_TEMPLATE_KEY)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const visibleRecentSvnUrls = useMemo(() => {
    const query = svnUrl.trim().toLocaleLowerCase()
    if (!query) {
      return recentSvnUrls
    }
    if (recentSvnUrls.some((item) => item.toLocaleLowerCase() === query)) {
      return []
    }
    return recentSvnUrls.filter((item) => item.toLocaleLowerCase().includes(query))
  }, [recentSvnUrls, svnUrl])
  const showSvnHistory = isSvnHistoryOpen && visibleRecentSvnUrls.length > 0
  const templateKey = selectedTemplateKey ?? uncontrolledTemplateKey
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
      if (selectedTemplateKey === undefined) {
        setUncontrolledTemplateKey(firstAvailableTemplate.key)
      }
      onTemplateChange?.(firstAvailableTemplate.key)
    }
  }, [activeSkillNameSet, onTemplateChange, selectedTemplate.skillName, selectedTemplateKey])

  const updateTemplateKey = (nextTemplateKey: ReviewTemplateKey): void => {
    if (selectedTemplateKey === undefined) {
      setUncontrolledTemplateKey(nextTemplateKey)
    }
    onTemplateChange?.(nextTemplateKey)
  }

  const selectSvnHistoryItem = (selectedSvnUrl: string): void => {
    setSvnUrl(selectedSvnUrl)
    setActiveSvnHistoryIndex(null)
    setIsSvnHistoryOpen(false)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const template = resolveReviewTemplate(templateKey)
      if (activeSkillNameSet && !activeSkillNameSet.has(template.skillName)) {
        return
      }

      const normalizedSvnUrl = svnUrl.trim()
      await onSubmit({
        svn_url: normalizedSvnUrl,
        old_revision: oldRevision.trim(),
        new_revision: newRevision.trim(),
        template_key: template.key,
        skill_name: template.skillName,
        requirement_file_path: requirementFilePath.trim() || undefined,
        requirement_file_name: requirementFilePath.trim()
          ? basenameLike(requirementFilePath.trim())
          : undefined,
        focus_direction_snapshot: focusDirectionSnapshot.trim() || undefined
      })
      setRecentSvnUrls(rememberRecentSvnUrl(normalizedSvnUrl))
      setActiveSvnHistoryIndex(null)
      setIsSvnHistoryOpen(false)
      setSvnUrl('')
      setOldRevision('')
      setNewRevision('')
      setRequirementFilePath('')
      setFocusDirectionSnapshot('')
      setRequirementFileError('')
    } catch {
      return
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectRequirementFile = async (): Promise<void> => {
    setRequirementFileError('')
    const result = await window.codeReview.selectRequirementFile()
    if (result.status === 'selected') {
      setRequirementFilePath(result.filePath)
    }
  }

  const handleRequirementFilePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const file = Array.from(event.clipboardData.files).find((item) =>
      /\.(xls|xlsx)$/i.test(item.name)
    )
    if (!file) {
      return
    }

    event.preventDefault()
    try {
      const filePath = window.codeReview.getPathForPastedFile(file)
      if (!filePath) {
        setRequirementFileError('无法读取粘贴文件路径，请使用选择文件按钮。')
        return
      }
      setRequirementFilePath(filePath)
      setRequirementFileError('')
    } catch {
      setRequirementFileError('无法读取粘贴文件路径，请使用选择文件按钮。')
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="field svn-url-field">
        <label htmlFor="svn-url-input">SVN 地址</label>
        <div className="svn-url-input-wrap">
          <input
            id="svn-url-input"
            required
            value={svnUrl}
            placeholder="https://svn.example.com/project/trunk"
            aria-haspopup="listbox"
            aria-expanded={showSvnHistory}
            aria-activedescendant={
              activeSvnHistoryIndex === null
                ? undefined
                : `svn-url-history-option-${activeSvnHistoryIndex}`
            }
            onFocus={() => {
              setActiveSvnHistoryIndex(null)
              setIsSvnHistoryOpen(true)
            }}
            onClick={() => {
              setActiveSvnHistoryIndex(null)
              setIsSvnHistoryOpen(true)
            }}
            onBlur={() => {
              setActiveSvnHistoryIndex(null)
              setIsSvnHistoryOpen(false)
            }}
            onKeyDown={(event) => {
              if (showSvnHistory && event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveSvnHistoryIndex((currentIndex) =>
                  currentIndex === null
                    ? 0
                    : (currentIndex + 1) % visibleRecentSvnUrls.length
                )
                return
              }
              if (showSvnHistory && event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveSvnHistoryIndex((currentIndex) =>
                  currentIndex === null
                    ? visibleRecentSvnUrls.length - 1
                    : (currentIndex - 1 + visibleRecentSvnUrls.length) % visibleRecentSvnUrls.length
                )
                return
              }
              if (showSvnHistory && event.key === 'Enter' && activeSvnHistoryIndex !== null) {
                event.preventDefault()
                selectSvnHistoryItem(visibleRecentSvnUrls[activeSvnHistoryIndex])
                return
              }
              if (event.key === 'Escape' || event.key === 'Tab') {
                setActiveSvnHistoryIndex(null)
                setIsSvnHistoryOpen(false)
              }
            }}
            onChange={(event) => {
              setSvnUrl(event.target.value)
              setActiveSvnHistoryIndex(null)
              setIsSvnHistoryOpen(true)
            }}
          />
          {showSvnHistory ? (
            <div className="svn-url-history-list" role="listbox" aria-label="最近 SVN 地址">
              {visibleRecentSvnUrls.map((recentSvnUrl, index) => (
                <button
                  id={`svn-url-history-option-${index}`}
                  key={recentSvnUrl}
                  type="button"
                  tabIndex={-1}
                  className="svn-url-history-item"
                  role="option"
                  aria-selected={activeSvnHistoryIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSvnHistoryItem(recentSvnUrl)}
                >
                  {recentSvnUrl}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="revision-grid">
        <label className="field">
          <span>旧版本号</span>
          <input
            required
            aria-label="旧版本号"
            value={oldRevision}
            inputMode="numeric"
            placeholder="填 0 表示全量审查新版本代码"
            onChange={(event) => setOldRevision(event.target.value)}
          />
        </label>
        <label className="field">
          <span>新版本号</span>
          <input
            required
            aria-label="新版本号"
            value={newRevision}
            inputMode="numeric"
            onChange={(event) => setNewRevision(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>产品开发需求表（可选）</span>
        <div className="file-input-row">
          <input
            aria-label="产品开发需求表"
            value={requirementFilePath}
            placeholder="选择、粘贴 Excel 文件或粘贴本机路径"
            onPaste={handleRequirementFilePaste}
            onChange={(event) => {
              setRequirementFilePath(event.target.value)
              setRequirementFileError('')
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || isSubmitting}
            onClick={() => {
              void handleSelectRequirementFile()
            }}
          >
            选择文件
          </button>
        </div>
        {requirementFileError && <span className="form-error">{requirementFileError}</span>}
      </label>

      <label className="field">
        <span>重点审查方向（可选）</span>
        <textarea
          aria-label="重点审查方向"
          maxLength={4096}
          value={focusDirectionSnapshot}
          placeholder="填写本次希望 Codex 重点关注的模块、风险或业务规则"
          onChange={(event) => setFocusDirectionSnapshot(event.target.value)}
        />
      </label>

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
                onChange={() => updateTemplateKey(template.key)}
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

const basenameLike = (value: string): string => value.split(/[\\/]/).filter(Boolean).at(-1) ?? value

function readRecentSvnUrls(): string[] {
  try {
    const value = localStorage.getItem(RECENT_SVN_URLS_STORAGE_KEY)
    if (!value) {
      return []
    }

    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_SVN_URLS)
  } catch {
    return []
  }
}

function writeRecentSvnUrls(urls: string[]): void {
  try {
    localStorage.setItem(RECENT_SVN_URLS_STORAGE_KEY, JSON.stringify(urls))
  } catch {
    return
  }
}

function rememberRecentSvnUrl(svnUrl: string): string[] {
  if (!svnUrl) {
    return readRecentSvnUrls()
  }

  const nextUrls = [svnUrl, ...readRecentSvnUrls().filter((item) => item !== svnUrl)].slice(
    0,
    MAX_RECENT_SVN_URLS
  )
  writeRecentSvnUrls(nextUrls)
  return nextUrls
}
