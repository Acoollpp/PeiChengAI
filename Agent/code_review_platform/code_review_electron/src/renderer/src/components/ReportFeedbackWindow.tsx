import { useEffect, useRef, useState } from 'react'

import type {
  IssueFeedbackItem,
  LegacyReportFeedbackContext,
  ReportFeedbackContext
} from '../../../shared/report-feedback-window'

type IssueSaveState = 'idle' | 'saving' | 'failed'

type IssueDraft = IssueFeedbackItem & {
  revision: number
  saveState: IssueSaveState
  saveError?: string
}

const feedbackPlaceholder = (helpful: boolean | null): string => {
  if (helpful === true) {
    return '例如：说明这个问题的有效之处，以及实际如何处理。'
  }
  if (helpful === false) {
    return '例如：说明这个问题无效的原因和具体情况。'
  }
  return '请先评价审查问题；评价后会显示对应的填写示例。'
}

const formatFeedbackSubmittedAt = (value: string): string => {
  const submittedAt = new Date(value)
  if (Number.isNaN(submittedAt.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false
  }).format(submittedAt)
}

const scrollToIssue = (issueId: string): void => {
  document.getElementById(`feedback-issue-${issueId}`)?.scrollIntoView({
    block: 'center',
    behavior: 'smooth'
  })
}

const focusIssueFeedbackText = (issueId: string): void => {
  scrollToIssue(issueId)
  document.getElementById(`feedback-text-${issueId}`)?.focus()
}

function LegacyReportFeedbackForm({
  context
}: {
  context: LegacyReportFeedbackContext
}): React.JSX.Element {
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])
  const [manualText, setManualText] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleOptionChange = async (optionId: string, checked: boolean): Promise<void> => {
    setError('')
    setSelectedOptionIds((currentIds) =>
      checked ? [...currentIds, optionId] : currentIds.filter((id) => id !== optionId)
    )

    try {
      await window.reportFeedback.focusAnchor({
        taskId: context.taskId,
        ...(checked ? { optionId } : {})
      })
    } catch (focusError) {
      setError(focusError instanceof Error ? focusError.message : '报告定位失败')
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (isSubmitting || (selectedOptionIds.length === 0 && !manualText.trim())) {
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      await window.reportFeedback.submit({
        taskId: context.taskId,
        selectedOptionIds,
        manualText: manualText.trim()
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '反馈提交失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = async (): Promise<void> => {
    setError('')
    try {
      await window.reportFeedback.close()
    } catch {
      setError('反馈窗口关闭失败，请重试')
    }
  }

  const canSubmit = selectedOptionIds.length > 0 || Boolean(manualText.trim())

  return (
    <form className="report-feedback-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="report-feedback-scroll">
        <fieldset className="report-feedback-options" disabled={isSubmitting}>
          <legend>有帮助的问题</legend>
          {context.options.map((option) => (
            <label className="report-feedback-option" key={option.id}>
              <input
                type="checkbox"
                checked={selectedOptionIds.includes(option.id)}
                onChange={(event) => void handleOptionChange(option.id, event.target.checked)}
              />
              <span>{option.text}</span>
            </label>
          ))}
        </fieldset>

        <label className="report-feedback-manual">
          <span>补充说明</span>
          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            rows={6}
            placeholder="补充其他有帮助的问题"
            disabled={isSubmitting}
          />
        </label>

        {error && (
          <p className="report-feedback-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="report-feedback-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={isSubmitting}
          onClick={() => void handleClose()}
        >
          取消
        </button>
        <button type="submit" className="primary-button" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? '提交中...' : '提交并打开PDF'}
        </button>
      </div>
    </form>
  )
}

function IssueFeedbackForm({
  context,
  onSubmitted
}: {
  context: Extract<ReportFeedbackContext, { mode: 'issues' }>
  onSubmitted: (feedbackSubmittedAt: string) => void
}): React.JSX.Element {
  const initialDrafts = context.issues.map<IssueDraft>((issue) => ({
    ...issue,
    revision: 0,
    saveState: 'idle'
  }))
  const [drafts, setDrafts] = useState(initialDrafts)
  const [error, setError] = useState('')
  const [focusError, setFocusError] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const [submittedAt, setSubmittedAt] = useState(context.feedbackSubmittedAt)
  const draftsRef = useRef(initialDrafts)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const queuesRef = useRef(new Map<string, Promise<void>>())
  const lastEnqueuedRevisionRef = useRef(
    new Map(initialDrafts.map((draft) => [draft.id, draft.revision]))
  )
  const mountedRef = useRef(true)
  const isReadOnly = submittedAt !== null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const replaceDraft = (nextDraft: IssueDraft): void => {
    const nextDrafts = draftsRef.current.map((draft) =>
      draft.id === nextDraft.id ? nextDraft : draft
    )
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
  }

  const editDraft = (
    issueId: string,
    changes: Pick<IssueDraft, 'helpful'> | Pick<IssueDraft, 'feedbackText'>
  ): IssueDraft | undefined => {
    const current = draftsRef.current.find((draft) => draft.id === issueId)
    if (!current) {
      return undefined
    }
    const next = {
      ...current,
      ...changes,
      revision: current.revision + 1,
      saveState: 'idle' as const,
      saveError: undefined
    }
    replaceDraft(next)
    return next
  }

  const setSaveState = (
    issueId: string,
    revision: number,
    saveState: IssueSaveState,
    saveError?: string
  ): void => {
    if (!mountedRef.current) {
      return
    }
    const current = draftsRef.current.find((draft) => draft.id === issueId)
    if (!current || current.revision !== revision) {
      return
    }
    replaceDraft({ ...current, saveState, saveError })
  }

  const enqueueSave = (issueId: string, force = false): Promise<void> => {
    const timer = timersRef.current.get(issueId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(issueId)
    }
    const snapshot = draftsRef.current.find((draft) => draft.id === issueId)
    if (!snapshot || isReadOnly) {
      return Promise.resolve()
    }
    const previousRevision = lastEnqueuedRevisionRef.current.get(issueId) ?? 0
    const existingQueue = queuesRef.current.get(issueId)
    if (!force && previousRevision >= snapshot.revision) {
      return existingQueue ?? Promise.resolve()
    }

    lastEnqueuedRevisionRef.current.set(issueId, snapshot.revision)
    setSaveState(issueId, snapshot.revision, 'saving')
    const previous = existingQueue ?? Promise.resolve()
    const request = previous.catch(() => undefined).then(async () => {
      await window.reportFeedback.saveIssueDraft({
        taskId: context.taskId,
        issueId,
        helpful: snapshot.helpful,
        feedbackText: snapshot.feedbackText
      })
    })
    const tail = request.then(
      () => {
        setSaveState(issueId, snapshot.revision, 'idle')
      },
      (saveError: unknown) => {
        setSaveState(
          issueId,
          snapshot.revision,
          'failed',
          saveError instanceof Error ? saveError.message : '保存失败'
        )
      }
    )
    queuesRef.current.set(issueId, tail)
    void tail.then(() => {
      if (queuesRef.current.get(issueId) === tail) {
        queuesRef.current.delete(issueId)
      }
    })
    return request
  }

  const scheduleSave = (issueId: string): void => {
    const currentTimer = timersRef.current.get(issueId)
    if (currentTimer) {
      clearTimeout(currentTimer)
    }
    timersRef.current.set(
      issueId,
      setTimeout(() => {
        timersRef.current.delete(issueId)
        void enqueueSave(issueId).catch(() => undefined)
      }, 1000)
    )
  }

  const handleHelpfulChange = (issueId: string, helpful: boolean): void => {
    setError('')
    const next = editDraft(issueId, { helpful })
    if (next) {
      void enqueueSave(issueId).catch(() => undefined)
    }
  }

  const handleIssueFocus = async (issueId: string): Promise<void> => {
    setFocusError('')
    try {
      await window.reportFeedback.focusAnchor({ taskId: context.taskId, optionId: issueId })
    } catch (focusError) {
      setFocusError(focusError instanceof Error ? focusError.message : '报告定位失败')
    }
  }

  const handleTextChange = (issueId: string, feedbackText: string): void => {
    setError('')
    const next = editDraft(issueId, { feedbackText })
    if (next) {
      scheduleSave(issueId)
    }
  }

  const handleRetry = (issueId: string): void => {
    setError('')
    void enqueueSave(issueId, true).catch(() => undefined)
  }

  const handleSubmitIssueFeedback = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (isPreparing || isReadOnly) {
      return
    }

    setError('')
    const firstUnevaluated = draftsRef.current.find((draft) => draft.helpful === null)
    if (firstUnevaluated) {
      scrollToIssue(firstUnevaluated.id)
      setError('请先评价所有审查问题。')
      return
    }
    const firstMissingFeedbackText = draftsRef.current.find(
      (draft) => !draft.feedbackText.trim()
    )
    if (firstMissingFeedbackText) {
      const issueNumber = draftsRef.current.indexOf(firstMissingFeedbackText) + 1
      focusIssueFeedbackText(firstMissingFeedbackText.id)
      setError(`请填写第 ${issueNumber} 个审查问题的反馈说明。`)
      return
    }

    setIsPreparing(true)
    const saveResults = await Promise.allSettled(
      draftsRef.current.map((draft) => enqueueSave(draft.id, draft.saveState === 'failed'))
    )
    const firstFailed = draftsRef.current.find((draft) => draft.saveState === 'failed')
    if (saveResults.some((result) => result.status === 'rejected') || firstFailed) {
      if (firstFailed) {
        scrollToIssue(firstFailed.id)
      }
      setError('仍有反馈保存失败，请重试后再提交。')
      setIsPreparing(false)
      return
    }

    try {
      const result = await window.reportFeedback.submitIssueFeedback({ taskId: context.taskId })
      setSubmittedAt(result.feedbackSubmittedAt)
      onSubmitted(result.feedbackSubmittedAt)
      if (result.pdfOpenError) {
        setError('反馈已正式提交，但无法在文件夹中定位最终报告。')
        return
      }
      try {
        await window.reportFeedback.close()
      } catch {
        setError('反馈已正式提交，但窗口关闭失败，请手动关闭。')
      }
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : '提交前校验失败，请重试。')
    } finally {
      setIsPreparing(false)
    }
  }

  const handleClose = async (): Promise<void> => {
    setError('')
    setIsPreparing(true)
    try {
      if (!isReadOnly) {
        const saveResults = await Promise.allSettled(
          draftsRef.current.map((draft) =>
            enqueueSave(draft.id, draft.saveState === 'failed')
          )
        )
        const firstFailed = draftsRef.current.find((draft) => draft.saveState === 'failed')
        if (saveResults.some((result) => result.status === 'rejected') || firstFailed) {
          if (firstFailed) {
            scrollToIssue(firstFailed.id)
          }
          setError('仍有反馈保存失败，请重试后再关闭。')
          return
        }
      }
      await window.reportFeedback.close()
    } catch {
      setError('反馈窗口关闭失败，请重试')
    } finally {
      setIsPreparing(false)
    }
  }

  if (isReadOnly) {
    return (
      <div className="report-feedback-form">
        <div className="report-feedback-scroll">
          <dl className="issue-feedback-submission-meta">
            <div>
              <dt>提交时间</dt>
              <dd>
                <time dateTime={submittedAt ?? undefined}>
                  {submittedAt ? formatFeedbackSubmittedAt(submittedAt) : '未记录'}
                </time>
              </dd>
            </div>
          </dl>
          {drafts.length === 0 && (
            <p className="report-feedback-status">报告中没有需要逐项反馈的审查问题。</p>
          )}
          <div className="issue-feedback-list">
            {drafts.map((draft, index) => (
              <section className="issue-feedback-item" key={draft.id}>
                <div className="issue-feedback-heading">
                  <span className="issue-feedback-order">问题 {index + 1}</span>
                  <span
                    className={`issue-feedback-state ${
                      draft.helpful === null
                        ? 'is-pending'
                        : draft.helpful
                          ? ''
                          : 'is-not-helpful'
                    }`}
                  >
                    {draft.helpful === null ? '未评价' : draft.helpful ? '有效' : '无效'}
                  </span>
                </div>
                <h2>{draft.issueText}</h2>
                <p className="issue-feedback-description">
                  {draft.descriptionText || '未提供问题描述。'}
                </p>
                <dl className="issue-feedback-readonly-details">
                  <div>
                    <dt>是否有效</dt>
                    <dd>
                      {draft.helpful === null ? '未评价' : draft.helpful ? '有效' : '无效'}
                    </dd>
                  </div>
                  <div>
                    <dt>反馈说明</dt>
                    <dd>{draft.feedbackText.trim() || '未填写'}</dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
          {(error || focusError) && (
            <p className="report-feedback-error" role="alert">
              {error || focusError}
            </p>
          )}
        </div>
        <div className="report-feedback-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isPreparing}
            onClick={() => void handleClose()}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="report-feedback-form"
      noValidate
      onSubmit={(event) => void handleSubmitIssueFeedback(event)}
    >
      <div className="report-feedback-scroll">
        {drafts.length === 0 && (
          <p className="report-feedback-status">报告中没有需要逐项反馈的审查问题。</p>
        )}
        <div className="issue-feedback-list">
          {drafts.map((draft, index) => (
            <section
              className="issue-feedback-item"
              id={`feedback-issue-${draft.id}`}
              key={draft.id}
            >
              <div className="issue-feedback-heading">
                <span className="issue-feedback-order">问题 {index + 1}</span>
                <span className={`issue-feedback-state ${draft.helpful === null ? 'is-pending' : ''}`}>
                  {draft.helpful === null ? '未评价' : draft.helpful ? '有效' : '无效'}
                </span>
              </div>
              <h2>{draft.issueText}</h2>
              <p className="issue-feedback-description">
                {draft.descriptionText || '未提供问题描述。'}
              </p>

              <fieldset className="issue-feedback-choice" disabled={isReadOnly || isPreparing}>
                <legend>是否有效</legend>
                <label>
                  <input
                    type="radio"
                    name={`helpful-${draft.id}`}
                    checked={draft.helpful === true}
                    onFocus={() => void handleIssueFocus(draft.id)}
                    onChange={() => handleHelpfulChange(draft.id, true)}
                  />
                  <span>有效</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name={`helpful-${draft.id}`}
                    checked={draft.helpful === false}
                    onFocus={() => void handleIssueFocus(draft.id)}
                    onChange={() => handleHelpfulChange(draft.id, false)}
                  />
                  <span>无效</span>
                </label>
              </fieldset>

              <label className="issue-feedback-text">
                <span>反馈说明（必填）</span>
                <textarea
                  id={`feedback-text-${draft.id}`}
                  aria-label={`问题 ${index + 1} 反馈说明`}
                  aria-required="true"
                  value={draft.feedbackText}
                  maxLength={4096}
                  required
                  rows={4}
                  placeholder={feedbackPlaceholder(draft.helpful)}
                  disabled={isReadOnly || isPreparing}
                  onFocus={() => void handleIssueFocus(draft.id)}
                  onChange={(event) => handleTextChange(draft.id, event.target.value)}
                  onBlur={() => void enqueueSave(draft.id).catch(() => undefined)}
                />
              </label>

              {draft.saveState === 'failed' && (
                <div className="issue-feedback-save-error" role="alert">
                  <span>{draft.saveError || '保存失败，请重试。'}</span>
                  <button type="button" onClick={() => handleRetry(draft.id)}>
                    重试
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>

        {(error || focusError) && (
          <p className="report-feedback-error" role="alert">
            {error || focusError}
          </p>
        )}
      </div>

      <div className="report-feedback-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={isPreparing}
          onClick={() => void handleClose()}
        >
          关闭
        </button>
        {!isReadOnly && (
          <button type="submit" className="primary-button" disabled={isPreparing}>
            {isPreparing ? '正在生成最终PDF...' : '提交反馈并查看PDF报告'}
          </button>
        )}
      </div>
    </form>
  )
}

export function ReportFeedbackWindow(): React.JSX.Element {
  const [context, setContext] = useState<ReportFeedbackContext | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.reportFeedback
      .getContext()
      .then(setContext)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '反馈内容加载失败')
      })
  }, [])

  const handleClose = async (): Promise<void> => {
    try {
      await window.reportFeedback.close()
    } catch {
      setError('反馈窗口关闭失败，请重试')
    }
  }

  const handleIssueFeedbackSubmitted = (feedbackSubmittedAt: string): void => {
    setContext((current) =>
      current?.mode === 'issues' ? { ...current, feedbackSubmittedAt } : current
    )
  }

  const isSubmittedIssueFeedback =
    context?.mode === 'issues' && context.feedbackSubmittedAt !== null

  return (
    <main className="report-feedback-window">
      <header className="report-feedback-header">
        <h1>
          {isSubmittedIssueFeedback
            ? '已提交反馈'
            : context?.mode === 'issues'
              ? '审查问题反馈'
              : '报告反馈'}
        </h1>
        <p>
          {isSubmittedIssueFeedback
            ? '反馈已正式提交，以下内容仅供查看。'
            : context?.mode === 'issues'
            ? '请逐项评价审查问题并填写反馈说明。软件质量提升需要你的真实反馈，谢谢！'
            : '请选择报告中有帮助的问题，也可以补充说明。'}
        </p>
      </header>

      {!context && !error && (
        <div className="report-feedback-scroll">
          <p className="report-feedback-status">正在加载反馈内容...</p>
        </div>
      )}
      {error && (
        <div className="report-feedback-scroll">
          <p className="report-feedback-error" role="alert">
            {error}
          </p>
        </div>
      )}
      {!context && (
        <div className="report-feedback-actions">
          <button type="button" className="secondary-button" onClick={() => void handleClose()}>
            关闭
          </button>
        </div>
      )}
      {context?.mode === 'issues' && (
        <IssueFeedbackForm context={context} onSubmitted={handleIssueFeedbackSubmitted} />
      )}
      {context && context.mode !== 'issues' && <LegacyReportFeedbackForm context={context} />}
    </main>
  )
}
