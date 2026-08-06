import { FormEvent, useMemo, useState } from 'react'

import {
  BMS_CODE_REVIEW_SKILL_NAME,
  findReviewItem
} from '../../../shared/review-items'
import { TaskPreflightValidationError, type ExecuteTaskRequest } from '../code-review-api'

const RECENT_SVN_URLS_STORAGE_KEY = 'code-review:recent-svn-urls'
const MAX_RECENT_SVN_URLS = 3
const ds03Definition = (() => {
  const definition = findReviewItem('DS-03')
  if (!definition) {
    throw new Error('审查项目录缺少稳定 ID DS-03。')
  }
  return definition
})()

type TaskFormProps = {
  disabled: boolean
  activeSkillNames?: string[]
  onSubmit: (payload: ExecuteTaskRequest) => Promise<void>
}

export function TaskForm({
  disabled,
  activeSkillNames,
  onSubmit
}: TaskFormProps): React.JSX.Element {
  const [svnUrl, setSvnUrl] = useState('')
  const [recentSvnUrls, setRecentSvnUrls] = useState<string[]>(() => readRecentSvnUrls())
  const [isSvnHistoryOpen, setIsSvnHistoryOpen] = useState(false)
  const [activeSvnHistoryIndex, setActiveSvnHistoryIndex] = useState<number | null>(null)
  const [svnValidationErrors, setSvnValidationErrors] = useState({
    svnUrl: '',
    oldRevision: '',
    newRevision: ''
  })
  const [oldRevision, setOldRevision] = useState('')
  const [newRevision, setNewRevision] = useState('')
  const [isDs03Selected, setIsDs03Selected] = useState(true)
  const [ds03ExtraRules, setDs03ExtraRules] = useState('')
  const [reviewItemError, setReviewItemError] = useState('')
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
  const activeSkillNameSet = useMemo(
    () => (activeSkillNames ? new Set(activeSkillNames) : null),
    [activeSkillNames]
  )
  const bmsSkillAvailable =
    !activeSkillNameSet || activeSkillNameSet.has(BMS_CODE_REVIEW_SKILL_NAME)

  const selectSvnHistoryItem = (selectedSvnUrl: string): void => {
    setSvnUrl(selectedSvnUrl)
    setActiveSvnHistoryIndex(null)
    setIsSvnHistoryOpen(false)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSvnValidationErrors({ svnUrl: '', oldRevision: '', newRevision: '' })
    setReviewItemError('')

    if (!isDs03Selected) {
      setReviewItemError('请至少选择一个审查项。')
      return
    }
    if (!bmsSkillAvailable) {
      setReviewItemError('本机尚未同步 bms-code-reviewer Skill，请先刷新环境。')
      return
    }

    setIsSubmitting(true)

    try {
      const normalizedSvnUrl = svnUrl.trim()
      await onSubmit({
        svn_url: normalizedSvnUrl,
        old_revision: oldRevision.trim(),
        new_revision: newRevision.trim(),
        review_items: [
          {
            id: ds03Definition.id,
            ...(ds03ExtraRules.trim() ? { user_extra_rules: ds03ExtraRules.trim() } : {})
          }
        ]
      })
      setRecentSvnUrls(rememberRecentSvnUrl(normalizedSvnUrl))
      setActiveSvnHistoryIndex(null)
      setIsSvnHistoryOpen(false)
      setSvnUrl('')
      setOldRevision('')
      setNewRevision('')
      setDs03ExtraRules('')
    } catch (error) {
      if (error instanceof TaskPreflightValidationError) {
        setSvnValidationErrors({
          svnUrl: error.errors.svn_url ?? '',
          oldRevision: error.errors.old_revision ?? '',
          newRevision: error.errors.new_revision ?? ''
        })
      } else {
        setSvnValidationErrors({
          svnUrl: error instanceof Error ? error.message : 'SVN 地址或版本校验失败。',
          oldRevision: '',
          newRevision: ''
        })
      }
      return
    } finally {
      setIsSubmitting(false)
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
              setSvnValidationErrors((current) => ({ ...current, svnUrl: '' }))
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
        {svnValidationErrors.svnUrl ? <span className="form-error">{svnValidationErrors.svnUrl}</span> : null}
      </div>

      <div className="revision-grid">
        <label className="field">
          <span>旧版本号</span>
          <input
            required
            aria-label="旧版本号"
            value={oldRevision}
            inputMode="numeric"
            placeholder="例如 0 或 123"
            onChange={(event) => {
              setOldRevision(event.target.value)
              setSvnValidationErrors((current) => ({ ...current, oldRevision: '' }))
            }}
          />
          {svnValidationErrors.oldRevision ? (
            <span className="form-error">{svnValidationErrors.oldRevision}</span>
          ) : null}
        </label>
        <label className="field">
          <span>新版本号</span>
          <input
            required
            aria-label="新版本号"
            value={newRevision}
            inputMode="numeric"
            onChange={(event) => {
              setNewRevision(event.target.value)
              setSvnValidationErrors((current) => ({ ...current, newRevision: '' }))
            }}
          />
          {svnValidationErrors.newRevision ? (
            <span className="form-error">{svnValidationErrors.newRevision}</span>
          ) : null}
        </label>
      </div>

      <fieldset className="review-item-choice">
        <legend>审查项</legend>
        <label className="review-item-option">
          <input
            type="checkbox"
            checked={isDs03Selected}
            disabled={!bmsSkillAvailable}
            aria-label="DS-03 状态机审核"
            onChange={(event) => {
              setIsDs03Selected(event.target.checked)
              setReviewItemError('')
            }}
          />
          <span className="review-item-copy">
            <strong>{ds03Definition.id} · {ds03Definition.name}</strong>
            <span>{ds03Definition.category.name} · {ds03Definition.summary}</span>
            <span>{ds03Definition.details.target}</span>
          </span>
        </label>
        {isDs03Selected ? (
          <label className="field review-item-rules">
            <span>DS-03 用户额外规则（可选）</span>
            <textarea
              aria-label="DS-03 用户额外规则"
              maxLength={4096}
              value={ds03ExtraRules}
              placeholder="补充本次状态条件、状态转换或受控输出约束"
              onChange={(event) => setDs03ExtraRules(event.target.value)}
            />
          </label>
        ) : null}
        {!bmsSkillAvailable ? (
          <span className="form-error">本机尚未同步 bms-code-reviewer Skill。</span>
        ) : null}
        {reviewItemError ? <span className="form-error">{reviewItemError}</span> : null}
      </fieldset>

      <button
        className="primary-button"
        type="submit"
        disabled={disabled || isSubmitting || !bmsSkillAvailable}
      >
        {isSubmitting ? '提交中...' : '开始审查'}
      </button>
    </form>
  )
}

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
