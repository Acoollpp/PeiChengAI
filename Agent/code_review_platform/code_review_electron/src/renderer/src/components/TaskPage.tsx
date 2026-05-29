import { useEffect, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import paceLogo from '../assets/pace-logo.png'
import type { EnvironmentCheckResult, ExecuteTaskRequest } from '../code-review-api'
import { EnvironmentStatus } from './EnvironmentStatus'
import { MarkdownPreview } from './MarkdownPreview'
import { TaskBoard } from './TaskBoard'
import { TaskForm } from './TaskForm'

type TaskPageProps = {
  environment: EnvironmentCheckResult | null
  svnUsername: string
  onRefreshEnvironment: () => Promise<void>
  onInstallSkill: () => Promise<void>
}

export function TaskPage({
  environment,
  svnUsername,
  onRefreshEnvironment,
  onInstallSkill
}: TaskPageProps): React.JSX.Element {
  const [tasks, setTasks] = useState<ReviewTask[]>([])
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const [reportMessage, setReportMessage] = useState('')
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)

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
      status: 'created'
    }

    setTasks((current) => [pendingTask, ...current])

    try {
      const result = await window.codeReview.executeTask(payload)
      if (result.reportMarkdown) {
        setMarkdown(result.reportMarkdown)
      }
      if (result.reportPath) {
        setReportMessage(`报告已生成：${result.reportPath}`)
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === pendingTask.id
            ? {
                ...task,
                id: result.taskId,
                status: result.status,
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

  const handleDownload = async (): Promise<void> => {
    setError('')
    setReportMessage('')

    try {
      const result = await window.codeReview.downloadCurrentReport()
      if (result.status !== 'ready' || !result.reportPath) {
        setError('暂无可下载的成功审查报告。')
        return
      }

      setReportMessage(`报告路径：${result.reportPath}`)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '报告下载失败。')
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
          <span className="user-badge">{svnUsername}</span>
        </div>

        <EnvironmentStatus
          result={environment}
          onRefresh={onRefreshEnvironment}
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
          <TaskBoard tasks={tasks} isLoading={isLoadingTasks} />
        </section>
      </aside>

      <section className="right-pane">
        <div className="preview-toolbar">
          <div>
            <p className="eyebrow">Markdown</p>
            <h2>审查报告</h2>
          </div>
          <button className="secondary-button" type="button" onClick={() => void handleDownload()}>
            下载报告
          </button>
        </div>
        <MarkdownPreview markdown={markdown} />
      </section>
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
