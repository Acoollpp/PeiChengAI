import { useEffect, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import paceLogo from '../assets/pace-logo.png'
import type { EnvironmentCheckResult, ExecuteTaskRequest } from '../code-review-api'
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
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [reportMessage, setReportMessage] = useState('')
  const [currentReportPath, setCurrentReportPath] = useState<string>()
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [loadingReportTaskId, setLoadingReportTaskId] = useState<string>()
  const [showSubmitFeedback, setShowSubmitFeedback] = useState(false)

  const canRunTask = environment?.status === 'ready'

  useEffect(() => {
    let isMounted = true

    const loadTasks = async (): Promise<void> => {
      setIsLoadingTasks(true)
      setError('')

      try {
        const response = await window.codeReview.listTasks()
        if (isMounted) {
          setTasks((current) => mergeTasks(response.data, current))
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
  }, [])

  useEffect(() => {
    return window.codeReview.onTaskProgress((event) => {
      setTasks((current) => applyTaskProgress(current, event))
    })
  }, [])

  const handleTaskSubmit = async (payload: ExecuteTaskRequest): Promise<void> => {
    setError('')
    setReportMessage('')

    const pendingTask: ReviewTask = {
      id: `local-${Date.now()}`,
      svn_url: payload.svn_url,
      old_revision: payload.old_revision,
      new_revision: payload.new_revision,
      template_key: payload.template_key,
      skill_name: payload.skill_name,
      status: 'created'
    }

    setTasks((current) => [pendingTask, ...current])

    try {
      const result = await window.codeReview.executeTask(payload)
      if (result.reportMarkdown) {
        setMarkdown(result.reportMarkdown)
      }
      setSelectedTaskId(result.taskId)
      if (result.reportPath) {
        setCurrentReportPath(result.reportPath)
        setReportMessage(`报告已生成：${result.reportPath}`)
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === pendingTask.id
            ? {
                ...task,
                id: result.taskId,
                status: result.status,
                template_key: payload.template_key,
                skill_name: payload.skill_name,
                report_path: result.reportPath,
                progress_message: result.status === 'success' ? '审查完成' : task.progress_message
              }
            : task
        )
      )
    } catch (taskError) {
      const message = taskError instanceof Error ? taskError.message : '审查任务执行失败。'
      setError(message)
      setTasks((current) =>
        current.map((task) =>
          task.id === pendingTask.id ? { ...task, status: 'failed', error_message: message } : task
        )
      )
    }
  }

  const handleViewReport = async (task: ReviewTask): Promise<void> => {
    setError('')
    setReportMessage('')
    setSelectedTaskId(task.id)
    setLoadingReportTaskId(task.id)

    try {
      const reportMarkdown = await window.codeReview.readTaskReport(task.id)
      setMarkdown(reportMarkdown)
      setCurrentReportPath(task.report_path)
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
          <TaskForm disabled={!canRunTask} onSubmit={handleTaskSubmit} />
          {!canRunTask && <p className="hint">本地环境就绪后才可发起审查。</p>}
          {error && <p className="form-error">{error}</p>}
          {reportMessage && <p className="hint">{reportMessage}</p>}
        </section>

        <section className="panel board-panel">
          <h2>任务看板</h2>
          <TaskBoard
            tasks={tasks}
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

const mergeTasks = (serverTasks: ReviewTask[], localTasks: ReviewTask[]): ReviewTask[] => {
  const serverIds = new Set(serverTasks.map((task) => task.id))
  return [...serverTasks, ...localTasks.filter((task) => !serverIds.has(task.id))]
}

const applyTaskProgress = (tasks: ReviewTask[], event: TaskProgressEvent): ReviewTask[] => {
  const targetIndex = tasks.findIndex(
    (task) => task.id === event.taskId || task.id.startsWith('local-')
  )

  if (targetIndex < 0) {
    return tasks
  }

  return tasks.map((task, index) => {
    if (index !== targetIndex) {
      return task
    }

    const codexLog = event.type === 'codex_output' ? [...(task.codex_log ?? []), event].slice(-20) : task.codex_log

    return {
      ...task,
      id: event.taskId,
      status: event.type === 'stage' ? mapProgressStageToTaskStatus(event.stage) : task.status,
      progress_message: event.message,
      codex_log: codexLog
    }
  })
}

const mapProgressStageToTaskStatus = (
  stage: Extract<TaskProgressEvent, { type: 'stage' }>['stage']
): ReviewTask['status'] => {
  if (stage === 'preparing_workspace') {
    return 'checking_environment'
  }

  if (stage === 'created') {
    return 'created'
  }

  return stage
}
