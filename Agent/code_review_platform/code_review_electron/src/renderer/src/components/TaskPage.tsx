import { useCallback, useEffect, useRef, useState } from 'react'

import paceLogo from '../assets/pace-logo.png'
import type { EnvironmentCheckResult, ExecuteTaskRequest } from '../code-review-api'
import { useTaskQueue, type TaskViewItem } from '../hooks/useTaskQueue'
import { EnvironmentStatus } from './EnvironmentStatus'
import { MarkdownPreview } from './MarkdownPreview'
import { TaskBoard } from './TaskBoard'
import { TaskForm } from './TaskForm'
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'
import {
  DEFAULT_REVIEW_TEMPLATE_KEY,
  type ReviewTemplateKey
} from '../../../shared/review-templates'
import { REVIEW_TEMPLATE_PREVIEWS } from '../../../shared/review-template-previews'

type TaskPageProps = {
  environment: EnvironmentCheckResult | null
  isCheckingEnvironment: boolean
  isInstallingSkillDuringCheck: boolean
  isInstallingCodex: boolean
  isInstallingSvn: boolean
  svnUsername: string
  onRefreshEnvironment: () => Promise<void>
  onInstallCodex: () => Promise<void>
  onInstallSvn: () => Promise<void>
  onInstallSkill: () => Promise<void>
}

type CompletionNotice = {
  task: TaskViewItem
}

type ReportFeedbackStatus = 'idle' | 'useful' | 'submitting'

const stripMarkerListPrefix = (value: string): string =>
  value.replace(/^\s*\d+[\.)、]\s*/, '').trim()

const parseUsefulIssuesText = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map(stripMarkerListPrefix)
    .filter(Boolean)

const formatUsefulIssues = (issues: string[]): string =>
  issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')

const uniqueIssues = (issues: string[]): string[] =>
  issues.filter((issue, index) => issues.indexOf(issue) === index)

const REPORT_FEEDBACK_EXISTS_CODE = 'report_feedback_exists'

const isReportFeedbackExistsError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  return error.message.includes(REPORT_FEEDBACK_EXISTS_CODE)
}

const formatReportFeedbackError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return '报告反馈提交失败，请稍后重试。'
  }
  const message = error.message
  if (message.includes('no_report') || message.includes('no_pdf_report')) {
    return '该任务暂无可反馈的报告'
  }
  return message
}

const isRendererForeground = (): boolean =>
  document.visibilityState === 'visible' && document.hasFocus()

export function TaskPage({
  environment,
  isCheckingEnvironment,
  isInstallingSkillDuringCheck,
  isInstallingCodex,
  isInstallingSvn,
  svnUsername,
  onRefreshEnvironment,
  onInstallCodex,
  onInstallSvn,
  onInstallSkill
}: TaskPageProps): React.JSX.Element {
  const [selectedTemplateKey, setSelectedTemplateKey] =
    useState<ReviewTemplateKey>(DEFAULT_REVIEW_TEMPLATE_KEY)
  const [markdown, setMarkdown] = useState(() => REVIEW_TEMPLATE_PREVIEWS[DEFAULT_REVIEW_TEMPLATE_KEY])
  const [error, setError] = useState('')
  const [reportMessage, setReportMessage] = useState('')
  const [currentReportPath, setCurrentReportPath] = useState<string>()
  const [currentPdfPath, setCurrentPdfPath] = useState<string>()
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [loadingReportTaskId, setLoadingReportTaskId] = useState<string>()
  const [showSubmitFeedback, setShowSubmitFeedback] = useState(false)
  const [completionNotice, setCompletionNotice] = useState<CompletionNotice | null>(null)
  const [reportFeedbackStatus, setReportFeedbackStatus] =
    useState<ReportFeedbackStatus>('idle')
  const [selectedUsefulIssues, setSelectedUsefulIssues] = useState<string[]>([])
  const [usefulIssuesText, setUsefulIssuesText] = useState('')
  const selectedTaskIdRef = useRef<string | undefined>(undefined)
  const currentPdfPathRef = useRef<string | undefined>(undefined)
  const currentPdfReportNameRef = useRef<string | undefined>(undefined)
  const usefulIssueOptionsRef = useRef<HTMLDivElement | null>(null)
  const isMountedRef = useRef(true)

  const canRunTask = environment?.status === 'ready' && !environment.skillError
  const shouldShowEnvironmentStatus =
    !canRunTask ||
    isCheckingEnvironment ||
    isInstallingSkillDuringCheck ||
    isInstallingCodex ||
    isInstallingSvn
  const activeSkillNames = environment?.skills?.map((skill) => skill.name)
  const setActivePdfPath = useCallback((pdfPath: string | undefined): void => {
    currentPdfPathRef.current = pdfPath
    setCurrentPdfPath(pdfPath)
  }, [])
  const setActivePdfReportName = useCallback((pdfReportName: string | undefined): void => {
    currentPdfReportNameRef.current = pdfReportName
  }, [])

  const buildNotificationPayload = useCallback(
    (task: TaskViewItem) => ({
      taskId: task.id,
      localTaskId: task.localTaskId,
      svn_url: task.svn_url,
      old_revision: task.old_revision,
      new_revision: task.new_revision,
      reportPath: task.report_path,
      pdfPath: task.pdfPath,
      pdfReportName: task.pdf_report_name ?? undefined
    }),
    []
  )

  const handleTaskSuccess = useCallback((task: TaskViewItem): void => {
    if (!isMountedRef.current) {
      return
    }

    const showInAppNotice = (): void => {
      if (isMountedRef.current) {
        setCompletionNotice({ task })
      }
    }

    if (isRendererForeground()) {
      showInAppNotice()
      return
    }

    void window.codeReview
      .showTaskCompletionNotification(buildNotificationPayload(task))
      .then((result) => {
        if (result.status !== 'shown') {
          showInAppNotice()
        }
      })
      .catch(() => {
        showInAppNotice()
      })
  }, [buildNotificationPayload])
  const {
    runningTasks,
    queuedTasks,
    historyTasks,
    submitTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks,
    updateTask
  } = useTaskQueue({
    executeTask: window.codeReview.executeTask,
    cancelTask: window.codeReview.cancelTask,
    onTaskSuccess: handleTaskSuccess
  })

  const updateSelectedTaskId = useCallback((taskId: string | undefined): void => {
    selectedTaskIdRef.current = taskId
    setSelectedTaskId(taskId)
  }, [])

  const handleTemplateChange = useCallback(
    (templateKey: ReviewTemplateKey): void => {
      setSelectedTemplateKey(templateKey)
      setMarkdown(REVIEW_TEMPLATE_PREVIEWS[templateKey])
      setCurrentReportPath(undefined)
      setActivePdfPath(undefined)
      setActivePdfReportName(undefined)
      setReportMessage('')
      selectedTaskIdRef.current = undefined
      setSelectedTaskId(undefined)
      setLoadingReportTaskId(undefined)
      setReportFeedbackStatus('idle')
      setSelectedUsefulIssues([])
      setUsefulIssuesText('')
      setError('')
    },
    [setActivePdfPath, setActivePdfReportName]
  )

  useEffect(() => {
    let isMounted = true
    isMountedRef.current = true

    const loadTasks = async (): Promise<void> => {
      setIsLoadingTasks(true)
      setError('')

      try {
        const response = await window.codeReview.listTasks()
        if (isMounted) {
          setServerTasks(response.data)
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : '任务列表加载失败。')
        }
      } finally {
        if (isMounted) {
          setIsLoadingTasks(false)
        }
      }
    }

    void loadTasks()

    return () => {
      isMounted = false
      isMountedRef.current = false
    }
  }, [setServerTasks])

  useEffect(() => {
    return window.codeReview.onTaskProgress((event) => {
      applyProgressEvent(event)
    })
  }, [applyProgressEvent])

  const handleTaskSubmit = async (payload: ExecuteTaskRequest): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')
    await submitTask(payload)
  }

  const handleViewReport = useCallback(async (task: TaskViewItem): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')
    updateSelectedTaskId(task.id)
    setReportFeedbackStatus('idle')
    setSelectedUsefulIssues([])
    setUsefulIssuesText('')

    if (task.reportMarkdown && task.report_path) {
      setMarkdown(task.reportMarkdown)
      setCurrentReportPath(task.report_path)
      setActivePdfPath(task.pdfPath)
      setActivePdfReportName(task.pdf_report_name ?? undefined)
      return
    }

    setLoadingReportTaskId(task.id)
    setActivePdfPath(undefined)
    setActivePdfReportName(task.pdf_report_name ?? undefined)

    try {
      const reportMarkdown = await window.codeReview.readTaskReport(task.id)
      if (!isMountedRef.current || selectedTaskIdRef.current !== task.id) {
        return
      }
      setMarkdown(reportMarkdown)
      setCurrentReportPath(undefined)
      setActivePdfPath(undefined)
      setActivePdfReportName(task.pdf_report_name ?? undefined)
    } catch (reportError) {
      if (!isMountedRef.current) {
        return
      }
      setError(reportError instanceof Error ? reportError.message : '历史报告加载失败。')
    } finally {
      if (isMountedRef.current) {
        setLoadingReportTaskId(undefined)
      }
    }
  }, [setActivePdfPath, setActivePdfReportName, updateSelectedTaskId])

  const findTaskForNotification = useCallback(
    (payload: { taskId: string; localTaskId?: string }): TaskViewItem | undefined =>
      [...runningTasks, ...queuedTasks, ...historyTasks].find(
        (task) => task.id === payload.taskId || task.localTaskId === payload.localTaskId
      ),
    [historyTasks, queuedTasks, runningTasks]
  )

  const handleOpenCompletionNotice = useCallback(
    (task: TaskViewItem): void => {
      setCompletionNotice(null)
      void handleViewReport(task)
    },
    [handleViewReport]
  )

  useEffect(() => {
    return window.codeReview.onTaskCompletionNotificationClicked((payload) => {
      const task = findTaskForNotification(payload)
      if (!task) {
        return
      }
      setCompletionNotice(null)
      void handleViewReport(task)
    })
  }, [findTaskForNotification, handleViewReport])

  const selectedTask = [...runningTasks, ...queuedTasks, ...historyTasks].find(
    (task) => task.id === selectedTaskId
  )

  const markTaskFeedbackSubmitted = useCallback(
    (taskId: string, helpful: boolean, usefulText: string | null): void => {
      updateTask(taskId, (task) => ({
        ...task,
        report_feedback_helpful: helpful,
        report_feedback_useful_issues_text: usefulText
      }))
    },
    [updateTask]
  )

  const openSelectedPdfReport = useCallback(async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current

    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }

    setError('')
    try {
      const result = await window.codeReview.openPdfReport({
        taskId,
        localPdfPath: currentPdfPathRef.current,
        pdfReportName: currentPdfReportNameRef.current
      })
      if (!isMountedRef.current) {
        return
      }
      setReportMessage(`PDF报告位置：${result.pdfPath}`)
      setActivePdfPath(result.pdfPath)
    } catch (openError) {
      if (!isMountedRef.current) {
        return
      }
      const message = openError instanceof Error ? openError.message : 'PDF报告打开失败。'
      setError(message.includes('404') ? '该历史任务没有 PDF 报告，请查看 Markdown 或重新生成报告。' : message)
    }
  }, [setActivePdfPath])

  const handleOpenPdfReport = useCallback(async (): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')

    const taskId = selectedTaskIdRef.current

    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }

    await openSelectedPdfReport()
  }, [openSelectedPdfReport])

  const handleReportNotUseful = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    setError('')
    setReportFeedbackStatus('submitting')
    try {
      await window.codeReview.submitReportFeedback({
        taskId,
        helpful: false,
        useful_issues_text: ''
      })
      markTaskFeedbackSubmitted(taskId, false, null)
      setReportFeedbackStatus('idle')
      await openSelectedPdfReport()
    } catch (submitError) {
      if (isReportFeedbackExistsError(submitError)) {
        markTaskFeedbackSubmitted(taskId, false, null)
        setReportFeedbackStatus('idle')
        await openSelectedPdfReport()
        return
      }
      setReportFeedbackStatus('idle')
      setError(formatReportFeedbackError(submitError))
    }
  }

  const handleReportUseful = (): void => {
    setReportFeedbackStatus('useful')
  }

  useEffect(() => {
    if (reportFeedbackStatus !== 'useful') {
      return
    }

    const schedule =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame
        : (callback: FrameRequestCallback) => window.setTimeout(callback, 0)

    schedule(() => {
      usefulIssueOptionsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [reportFeedbackStatus])

  const handleUsefulIssueToggle = (issue: string): void => {
    const next = selectedUsefulIssues.includes(issue)
      ? selectedUsefulIssues.filter((item) => item !== issue)
      : [...selectedUsefulIssues, issue]
    setSelectedUsefulIssues(next)
    setUsefulIssuesText(formatUsefulIssues(next))
  }

  const handleUsefulIssuesTextChange = (value: string): void => {
    setUsefulIssuesText(value)
    setSelectedUsefulIssues(uniqueIssues(parseUsefulIssuesText(value)))
  }

  const handleSubmitUsefulIssuesAndOpenPdf = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    const issues = uniqueIssues(parseUsefulIssuesText(usefulIssuesText))
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    if (issues.length === 0) {
      setError('请至少标记或填写一条有用信息。')
      return
    }
    const formatted = formatUsefulIssues(issues)
    setError('')
    setReportFeedbackStatus('submitting')
    try {
      await window.codeReview.submitReportFeedback({
        taskId,
        helpful: true,
        useful_issues_text: formatted
      })
      markTaskFeedbackSubmitted(taskId, true, formatted)
      setReportFeedbackStatus('idle')
      await openSelectedPdfReport()
    } catch (submitError) {
      if (isReportFeedbackExistsError(submitError)) {
        markTaskFeedbackSubmitted(taskId, true, formatted)
        setReportFeedbackStatus('idle')
        await openSelectedPdfReport()
        return
      }
      setReportFeedbackStatus('useful')
      setError(formatReportFeedbackError(submitError))
    }
  }

  return (
    <section className="review-workspace">
      <aside className="left-pane">
        <div className="workspace-header">
          <div>
            <img className="workspace-logo" src={paceLogo} alt="沛城科技" />
            <p className="eyebrow">SVN审查</p>
            <h1>任务工作台</h1>
          </div>
          <div className="workspace-actions">
            <span className="user-badge">{svnUsername}</span>
            <button
              className="admin-contact-button"
              type="button"
              onClick={() => setShowSubmitFeedback(true)}
            >
              提交意见
            </button>
          </div>
        </div>

        {shouldShowEnvironmentStatus && (
          <EnvironmentStatus
            result={environment}
            isChecking={isCheckingEnvironment}
            isInstallingSkillDuringCheck={isInstallingSkillDuringCheck}
            isInstallingCodex={isInstallingCodex}
            isInstallingSvn={isInstallingSvn}
            onRefresh={onRefreshEnvironment}
            onInstallCodex={onInstallCodex}
            onInstallSvn={onInstallSvn}
            onInstallSkill={onInstallSkill}
          />
        )}

        <section className="panel">
          <h2>新建任务</h2>
          <TaskForm
            disabled={!canRunTask}
            activeSkillNames={activeSkillNames}
            selectedTemplateKey={selectedTemplateKey}
            onTemplateChange={handleTemplateChange}
            onSubmit={handleTaskSubmit}
          />
          {!canRunTask && <p className="hint">本地环境就绪后才可发起审查。</p>}
          {error && <p className="form-error">{error}</p>}
          {reportMessage && <p className="hint">{reportMessage}</p>}
        </section>

        <section className="panel board-panel">
          <h2>任务看板</h2>
          <TaskBoard
            runningTasks={runningTasks}
            queuedTasks={queuedTasks}
            historyTasks={historyTasks}
            isLoading={isLoadingTasks}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
            onViewReport={(task) => void handleViewReport(task)}
            onCancelTask={(task) => void cancelTask(task)}
          />
        </section>
      </aside>

      <section className="right-pane">
        <div className="preview-toolbar">
          <div>
            <p className="eyebrow">Markdown</p>
            <h2>审查报告</h2>
          </div>
          {selectedTask && (
            <div className="report-toolbar-actions">
              {selectedTask.report_feedback_helpful == null &&
                (reportFeedbackStatus === 'useful' ? (
                  <div className="report-feedback-bar">
                    <div className="report-feedback-copy">
                      <strong>标记有用信息</strong>
                      <span>勾选下方标题，或手动补充有价值内容。</span>
                    </div>
                    <span className="report-feedback-count">
                      已选 {parseUsefulIssuesText(usefulIssuesText).length} 条
                    </span>
                    <textarea
                      aria-label="有用信息"
                      value={usefulIssuesText}
                      onChange={(event) => handleUsefulIssuesTextChange(event.target.value)}
                      placeholder="可补充报告中有价值的问题或建议点，每行一条"
                      maxLength={4096}
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={parseUsefulIssuesText(usefulIssuesText).length === 0}
                      onClick={() => void handleSubmitUsefulIssuesAndOpenPdf()}
                    >
                      提交并打开PDF
                    </button>
                  </div>
                ) : (
                  <div className="report-feedback-actions">
                    <div className="report-feedback-copy">
                      <strong>报告反馈</strong>
                      <span>这两个按钮用于统计报告是否对代码审查有帮助。</span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={reportFeedbackStatus === 'submitting'}
                      onClick={handleReportUseful}
                    >
                      有帮助
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={reportFeedbackStatus === 'submitting'}
                      onClick={() => void handleReportNotUseful()}
                    >
                      没帮助
                    </button>
                  </div>
                ))}
              <button className="secondary-button" type="button" onClick={() => void handleOpenPdfReport()}>
                查看PDF报告
              </button>
            </div>
          )}
        </div>
        <MarkdownPreview
          markdown={markdown}
          reportPath={currentReportPath}
          usefulIssueSelection={{
            enabled: reportFeedbackStatus === 'useful',
            selectedIssues: selectedUsefulIssues,
            onToggle: handleUsefulIssueToggle,
            optionsRef: usefulIssueOptionsRef
          }}
        />
      </section>
      {completionNotice && (
        <aside className="completion-notice" role="status" aria-label="审查完成提醒">
          <div>
            <p className="completion-notice-title">审查完成</p>
            <p className="completion-notice-url">{completionNotice.task.svn_url}</p>
            <p className="completion-notice-revisions">
              {completionNotice.task.old_revision} → {completionNotice.task.new_revision}
            </p>
          </div>
          <div className="completion-notice-actions">
            <button
              className="task-action-button"
              type="button"
              onClick={() => handleOpenCompletionNotice(completionNotice.task)}
            >
              查看报告
            </button>
            <button
              className="task-action-button"
              type="button"
              onClick={() => setCompletionNotice(null)}
            >
              关闭
            </button>
          </div>
        </aside>
      )}
      <SubmitFeedbackDialog open={showSubmitFeedback} onClose={() => setShowSubmitFeedback(false)} />
    </section>
  )
}
