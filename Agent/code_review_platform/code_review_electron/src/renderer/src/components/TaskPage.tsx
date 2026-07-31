import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import paceLogo from '../assets/pace-logo.png'
import {
  TaskPreflightValidationError,
  type EnvironmentCheckResult,
  type ExecuteTaskRequest
} from '../code-review-api'
import { useTaskQueue, type TaskViewItem } from '../hooks/useTaskQueue'
import { EnvironmentStatus } from './EnvironmentStatus'
import { extractDetailedHeadingOptions, MarkdownPreview } from './MarkdownPreview'
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

type ReportFeedbackStatus = 'idle' | 'submitting'

type PdfReportSnapshot = {
  taskId: string
  localPdfPath?: string
  pdfReportName?: string
  action?: 'open' | 'reveal'
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
  const [activeFeedbackAnchorId, setActiveFeedbackAnchorId] = useState<string>()
  const [feedbackAnchorScrollRequest, setFeedbackAnchorScrollRequest] = useState<{
    anchorId: string
    requestId: number
  }>()
  const selectedTaskIdRef = useRef<string | undefined>(undefined)
  const currentPdfPathRef = useRef<string | undefined>(undefined)
  const currentPdfReportNameRef = useRef<string | undefined>(undefined)
  const isMountedRef = useRef(true)

  const canRunTask = environment?.status === 'ready' && !environment.skillError
  const shouldShowEnvironmentStatus =
    !canRunTask ||
    isCheckingEnvironment ||
    isInstallingSkillDuringCheck ||
    isInstallingCodex ||
    isInstallingSvn
  const activeSkillNames = environment?.skills?.map((skill) => skill.name)
  const usefulIssueOptions = useMemo(() => extractDetailedHeadingOptions(markdown), [markdown])
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
    retryTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks,
    updateTask
  } = useTaskQueue({
    executeTask: window.codeReview.executeTask,
    retryTask: window.codeReview.retryTask,
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
      setActiveFeedbackAnchorId(undefined)
      setFeedbackAnchorScrollRequest(undefined)
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
    const preflightResult = await window.codeReview.preflightTask({
      svn_url: payload.svn_url,
      old_revision: payload.old_revision,
      new_revision: payload.new_revision
    })
    if (preflightResult.status === 'invalid') {
      throw new TaskPreflightValidationError(preflightResult.errors)
    }
    await submitTask(payload)
  }

  const handleRetryTask = async (task: TaskViewItem): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')
    setMarkdown(REVIEW_TEMPLATE_PREVIEWS[task.template_key ?? DEFAULT_REVIEW_TEMPLATE_KEY])
    setCurrentReportPath(undefined)
    setActivePdfPath(undefined)
    setActivePdfReportName(undefined)
    updateSelectedTaskId(undefined)
    setLoadingReportTaskId(undefined)
    setReportFeedbackStatus('idle')
    setActiveFeedbackAnchorId(undefined)
    setFeedbackAnchorScrollRequest(undefined)
    await retryTask(task)
  }

  const handleViewReport = useCallback(async (task: TaskViewItem): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')
    updateSelectedTaskId(task.id)
    setReportFeedbackStatus('idle')
    setActiveFeedbackAnchorId(undefined)
    setFeedbackAnchorScrollRequest(undefined)

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

  const handleOpenTaskLog = useCallback(async (task: TaskViewItem): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')

    try {
      const result = await window.codeReview.openTaskLog(task.id)
      if (result.status === 'missing') {
        setError('未找到该任务的本地 Codex 执行日志。')
      }
    } catch (logError) {
      setError(logError instanceof Error ? logError.message : '打开 Codex 执行日志失败。')
    }
  }, [])

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

  const openSelectedPdfReport = useCallback(async ({
    taskId,
    localPdfPath,
    pdfReportName,
    action
  }: PdfReportSnapshot): Promise<void> => {
    if (!isMountedRef.current || selectedTaskIdRef.current !== taskId) {
      return
    }

    setError('')
    try {
      const result = await window.codeReview.openPdfReport({
        taskId,
        localPdfPath,
        pdfReportName,
        action
      })
      if (!isMountedRef.current || selectedTaskIdRef.current !== taskId) {
        return
      }
      setReportMessage(`PDF报告位置：${result.pdfPath}`)
      setActivePdfPath(result.pdfPath)
    } catch (openError) {
      if (!isMountedRef.current || selectedTaskIdRef.current !== taskId) {
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

    await openSelectedPdfReport({
      taskId,
      localPdfPath: currentPdfPathRef.current,
      pdfReportName: currentPdfReportNameRef.current,
      ...(selectedTask?.feedback_protocol_version === 1 ? { action: 'open' as const } : {})
    })
  }, [openSelectedPdfReport, selectedTask?.feedback_protocol_version])

  const handleReportNotUseful = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    setError('')
    setReportFeedbackStatus('submitting')
    try {
      await window.codeReview.submitNegativeReportFeedback(taskId)
    } catch (submitError) {
      if (selectedTaskIdRef.current === taskId) {
        setReportFeedbackStatus('idle')
        setError(formatReportFeedbackError(submitError))
      }
    }
  }

  const handleReportUseful = async (): Promise<void> => {
    const taskId = selectedTaskIdRef.current
    if (!taskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }
    setError('')
    try {
      if (selectedTask?.feedback_protocol_version === 1) {
        await window.codeReview.openReportFeedbackWindow({
          mode: 'issues',
          taskId,
          anchors: usefulIssueOptions.map((option, order) => ({
            order,
            anchorId: option.anchorId
          }))
        })
      } else {
        await window.codeReview.openReportFeedbackWindow({
          mode: 'legacy',
          taskId,
          options: usefulIssueOptions
        })
      }
    } catch {
      if (isMountedRef.current && selectedTaskIdRef.current === taskId) {
        setError('反馈窗口打开失败，请重试。')
      }
    }
  }

  useEffect(() =>
    window.codeReview.onReportFeedbackFocusAnchor(({ taskId, anchorId }) => {
      if (selectedTaskIdRef.current !== taskId) {
        return
      }
      setActiveFeedbackAnchorId(anchorId)
      if (anchorId) {
        setFeedbackAnchorScrollRequest((current) => ({
          anchorId,
          requestId: (current?.requestId ?? 0) + 1
        }))
      } else {
        setFeedbackAnchorScrollRequest(undefined)
      }
    }), [])

  useEffect(() =>
    window.codeReview.onReportFeedbackSubmitted(({ taskId, helpful, usefulIssuesText }) => {
      markTaskFeedbackSubmitted(taskId, helpful, usefulIssuesText)
      if (selectedTaskIdRef.current !== taskId) {
        return
      }
      setReportFeedbackStatus('idle')
      setActiveFeedbackAnchorId(undefined)
      setFeedbackAnchorScrollRequest(undefined)
      void openSelectedPdfReport({
        taskId,
        localPdfPath: currentPdfPathRef.current,
        pdfReportName: currentPdfReportNameRef.current
      })
    }), [markTaskFeedbackSubmitted, openSelectedPdfReport])

  useEffect(() =>
    window.codeReview.onIssueFeedbackSubmitted(({
      taskId,
      feedbackSubmittedAt,
      pdfPath,
      pdfReportName
    }) => {
      updateTask(taskId, (task) => ({
        ...task,
        feedback_submitted_at: feedbackSubmittedAt,
        evaluated_issue_count: task.issue_count ?? task.evaluated_issue_count,
        pdf_report_name: pdfReportName,
        pdfPath
      }))
      if (selectedTaskIdRef.current !== taskId) {
        return
      }
      setReportFeedbackStatus('idle')
      setActiveFeedbackAnchorId(undefined)
      setFeedbackAnchorScrollRequest(undefined)
      setActivePdfPath(pdfPath)
      setActivePdfReportName(pdfReportName)
    }), [setActivePdfPath, setActivePdfReportName, updateTask])

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
            onRetryTask={(task) => void handleRetryTask(task)}
            onOpenTaskLog={(task) => void handleOpenTaskLog(task)}
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
              {selectedTask.feedback_protocol_version === 1 &&
                !selectedTask.feedback_submitted_at && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleReportUseful}
                >
                  查看PDF报告
                </button>
              )}
              {selectedTask.feedback_protocol_version === 1 &&
                selectedTask.feedback_submitted_at && (
                <>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={handleReportUseful}
                  >
                    查看已提交反馈
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void handleOpenPdfReport()}
                  >
                    查看PDF报告
                  </button>
                </>
              )}
              {selectedTask.feedback_protocol_version !== 1 &&
                selectedTask.report_feedback_helpful == null && (
                <div className="report-feedback-actions">
                  <div className="report-feedback-copy">
                    <strong>报告反馈</strong>
                    <span>用于统计这份 AI 审查报告是否真的有参考价值。</span>
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
              )}
              {selectedTask.feedback_protocol_version !== 1 &&
                selectedTask.report_feedback_helpful != null && (
                <button className="secondary-button" type="button" onClick={() => void handleOpenPdfReport()}>
                  查看PDF报告
                </button>
              )}
            </div>
          )}
        </div>
        <MarkdownPreview
          markdown={markdown}
          reportPath={currentReportPath}
          activeFeedbackAnchorId={activeFeedbackAnchorId}
          feedbackAnchorScrollRequest={feedbackAnchorScrollRequest}
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
