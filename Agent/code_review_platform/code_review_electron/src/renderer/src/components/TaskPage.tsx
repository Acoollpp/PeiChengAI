import { useCallback, useEffect, useRef, useState } from 'react'

import paceLogo from '../assets/pace-logo.png'
import type { EnvironmentCheckResult, ExecuteTaskRequest } from '../code-review-api'
import { useTaskQueue, type TaskViewItem } from '../hooks/useTaskQueue'
import { EnvironmentStatus } from './EnvironmentStatus'
import { MarkdownPreview } from './MarkdownPreview'
import { TaskBoard } from './TaskBoard'
import { TaskForm } from './TaskForm'
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog'

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
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [reportMessage, setReportMessage] = useState('')
  const [currentReportPath, setCurrentReportPath] = useState<string>()
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [loadingReportTaskId, setLoadingReportTaskId] = useState<string>()
  const [showSubmitFeedback, setShowSubmitFeedback] = useState(false)
  const selectedTaskIdRef = useRef<string | undefined>(undefined)

  const canRunTask = environment?.status === 'ready' && !environment.skillError
  const activeSkillNames = environment?.skills?.map((skill) => skill.name)
  const handleTaskSuccess = useCallback((task: TaskViewItem): void => {
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
    applyProgressEvent,
    setServerTasks
  } = useTaskQueue({
    executeTask: window.codeReview.executeTask,
    onTaskSuccess: handleTaskSuccess
  })

  const updateSelectedTaskId = useCallback((taskId: string | undefined): void => {
    selectedTaskIdRef.current = taskId
    setSelectedTaskId(taskId)
  }, [])

  useEffect(() => {
    let isMounted = true

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
    }
  }, [setServerTasks])

  useEffect(() => {
    return window.codeReview.onTaskProgress((event) => {
      applyProgressEvent(event)
    })
  }, [applyProgressEvent])

  const handleTaskSubmit = async (payload: ExecuteTaskRequest): Promise<void> => {
    setError('')
    setReportMessage('')
    await submitTask(payload)
  }

  const handleViewReport = async (task: TaskViewItem): Promise<void> => {
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
      setMarkdown(reportMarkdown)
      setCurrentReportPath(undefined)
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : '历史报告加载失败。')
    } finally {
      setLoadingReportTaskId(undefined)
    }
  }

  const handleDownload = async (): Promise<void> => {
    setError('')
    setReportMessage('')

    try {
      const result = await window.codeReview.downloadCurrentReport(selectedTaskId)
      if (result.status !== 'ready' || !result.reportPath) {
        setError('暂无可查看位置的成功审查报告。')
        return
      }

      setReportMessage(`报告位置：${result.reportPath}`)
      setCurrentReportPath(result.reportPath)
    } catch (downloadError) {
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

        <section className="panel">
          <h2>新建任务</h2>
          <TaskForm
            disabled={!canRunTask}
            activeSkillNames={activeSkillNames}
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
