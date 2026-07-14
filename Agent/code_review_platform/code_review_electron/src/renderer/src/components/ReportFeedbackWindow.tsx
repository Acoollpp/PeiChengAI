import { useEffect, useState } from 'react'

import type { ReportFeedbackContext } from '../../../shared/report-feedback-window'

export function ReportFeedbackWindow(): React.JSX.Element {
  const [context, setContext] = useState<ReportFeedbackContext | null>(null)
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])
  const [manualText, setManualText] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    void window.reportFeedback
      .getContext()
      .then(setContext)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '反馈内容加载失败')
      })
  }, [])

  const handleOptionChange = async (optionId: string, checked: boolean): Promise<void> => {
    if (!context) {
      return
    }

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
    if (!context || isSubmitting || (selectedOptionIds.length === 0 && !manualText.trim())) {
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

  const canSubmit = Boolean(context) && (selectedOptionIds.length > 0 || Boolean(manualText.trim()))

  return (
    <main className="report-feedback-window">
      <header className="report-feedback-header">
        <h1>报告反馈</h1>
        <p>请选择报告中有帮助的问题，也可以补充说明。</p>
      </header>

      <form className="report-feedback-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="report-feedback-scroll">
          {!context && !error && <p className="report-feedback-status">正在加载反馈内容...</p>}

          {context && (
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
          )}

          <label className="report-feedback-manual">
            <span>补充说明</span>
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              rows={6}
              placeholder="补充其他有帮助的问题"
              disabled={!context || isSubmitting}
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
    </main>
  )
}
