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
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [loadingReportTaskId, setLoadingReportTaskId] = useState<string>()
  const [showSubmitFeedback, setShowSubmitFeedback] = useState(false)
  const selectedTaskIdRef = useRef<string | undefined>(undefined)
  const isMountedRef = useRef(true)

  const canRunTask = environment?.status === 'ready' && !environment.skillError
  const shouldShowEnvironmentStatus =
    !canRunTask ||
    isCheckingEnvironment ||
    isInstallingSkillDuringCheck ||
    isInstallingCodex ||
    isInstallingSvn
  const activeSkillNames = environment?.skills?.map((skill) => skill.name)
  const handleTaskSuccess = useCallback((task: TaskViewItem): void => {
    if (!isMountedRef.current) {
      return
    }

    if (selectedTaskIdRef.current) {
      return
    }

    if (task.reportMarkdown) {
      setMarkdown(task.reportMarkdown)
    }
    setSelectedTaskId(task.id)
    selectedTaskIdRef.current = task.id
    if (task.report_path) {
      setCurrentReportPath(task.report_path)
      setReportMessage(`报告已生成：${task.report_path}`)
    }
  }, [])
  const {
    runningTasks,
    queuedTasks,
    historyTasks,
    submitTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks
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
      setReportMessage('')
      selectedTaskIdRef.current = undefined
      setSelectedTaskId(undefined)
      setLoadingReportTaskId(undefined)
      setError('')
    },
    []
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

  const handleViewReport = async (task: TaskViewItem): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')
    updateSelectedTaskId(task.id)

    if (task.reportMarkdown && task.report_path) {
      setMarkdown(task.reportMarkdown)
      setCurrentReportPath(task.report_path)
      return
    }

    setLoadingReportTaskId(task.id)

    try {
      const reportMarkdown = await window.codeReview.readTaskReport(task.id)
      if (!isMountedRef.current) {
        return
      }
      setMarkdown(reportMarkdown)
      setCurrentReportPath(undefined)
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
  }

  const handleDownload = async (): Promise<void> => {
    if (!isMountedRef.current) {
      return
    }

    setError('')
    setReportMessage('')

    if (!selectedTaskId) {
      setError('请先选择一个已完成任务报告。')
      return
    }

    try {
      const result = await window.codeReview.downloadCurrentReport(selectedTaskId)
      if (!isMountedRef.current) {
        return
      }
      if (result.status !== 'ready' || !result.reportPath) {
        setError('暂无可查看位置的成功审查报告。')
        return
      }

      setReportMessage(`报告位置：${result.reportPath}`)
      setCurrentReportPath(result.reportPath)
    } catch (downloadError) {
      if (!isMountedRef.current) {
        return
      }
      setError(downloadError instanceof Error ? downloadError.message : '报告位置打开失败。')
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
          <button className="secondary-button" type="button" onClick={() => void handleDownload()}>
            查看报告位置
          </button>
        </div>
        <MarkdownPreview markdown={markdown} reportPath={currentReportPath} />
      </section>
      <SubmitFeedbackDialog open={showSubmitFeedback} onClose={() => setShowSubmitFeedback(false)} />
    </section>
  )
}
