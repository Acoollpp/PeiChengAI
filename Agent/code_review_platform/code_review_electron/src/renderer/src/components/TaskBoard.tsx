import { useState } from 'react'

import type { ReviewTask } from '../../../shared/types'

type TaskBoardProps = {
  tasks: ReviewTask[]
  isLoading?: boolean
  selectedTaskId?: string
  loadingReportTaskId?: string
  onViewReport?: (task: ReviewTask) => void
}

const statusText: Record<ReviewTask['status'], string> = {
  created: '已创建',
  checking_environment: '检查环境',
  running_codex: '审查中',
  uploading_report: '上传报告',
  success: '已完成',
  failed: '失败',
  environment_error: '环境异常',
  cancelled: '已取消'
}

type TaskCardProps = {
  task: ReviewTask
  selectedTaskId?: string
  loadingReportTaskId?: string
  showCodexLog?: boolean
  onViewReport?: (task: ReviewTask) => void
}

function TaskCard({
  task,
  selectedTaskId,
  loadingReportTaskId,
  showCodexLog = false,
  onViewReport
}: TaskCardProps): React.JSX.Element {
  return (
    <article className={`task-card${task.id === selectedTaskId ? ' is-selected' : ''}`}>
      <div className="task-card-header">
        <strong>{task.id}</strong>
        <span className={`task-status task-status-${task.status}`}>{statusText[task.status]}</span>
      </div>
      <p className="task-url">{task.svn_url}</p>
      <dl className="task-meta">
        <div>
          <dt>旧版本</dt>
          <dd>{task.old_revision}</dd>
        </div>
        <div>
          <dt>新版本</dt>
          <dd>{task.new_revision}</dd>
        </div>
      </dl>
      {task.status === 'success' && (
        <button
          className="task-action-button"
          type="button"
          disabled={loadingReportTaskId === task.id}
          onClick={() => onViewReport?.(task)}
        >
          {loadingReportTaskId === task.id ? '加载中...' : '查看报告'}
        </button>
      )}
      {task.progress_message && <p className="task-progress">{task.progress_message}</p>}
      {showCodexLog && task.codex_log && task.codex_log.length > 0 && (
        <div className="task-log" aria-label="Codex 执行输出">
          {task.codex_log.slice(-4).map((event, index) => (
            <pre className={`task-log-line task-log-${event.type}`} key={`${task.id}-${index}`}>
              {event.message.trimEnd()}
            </pre>
          ))}
        </div>
      )}
      {task.error_message && <p className="task-error">{task.error_message}</p>}
    </article>
  )
}

export function TaskBoard({
  tasks,
  isLoading = false,
  selectedTaskId,
  loadingReportTaskId,
  onViewReport
}: TaskBoardProps): React.JSX.Element {
  const [activeView, setActiveView] = useState<'current' | 'history'>('current')
  const currentTask = tasks[0]
  const historyTasks = tasks.slice(1)
  const isCurrentView = activeView === 'current'

  const renderPanelContent = (): React.JSX.Element => {
    if (isLoading) {
      return <p className="empty-state">正在加载任务...</p>
    }

    if (isCurrentView) {
      if (!currentTask) {
        return <p className="empty-state">暂无当前任务，填写上方表单后开始审查。</p>
      }

      return (
        <div className="task-list" aria-label="当前任务列表">
          <TaskCard
            task={currentTask}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
            showCodexLog
            onViewReport={onViewReport}
          />
        </div>
      )
    }

    if (historyTasks.length === 0) {
      return <p className="empty-state">暂无历史任务。</p>
    }

    return (
      <div className="task-list" aria-label="历史任务列表">
        {historyTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            selectedTaskId={selectedTaskId}
            loadingReportTaskId={loadingReportTaskId}
            onViewReport={onViewReport}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="task-board">
      <div role="tablist" aria-label="任务看板">
        <button
          type="button"
          role="tab"
          aria-selected={isCurrentView}
          onClick={() => setActiveView('current')}
        >
          当前任务
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isCurrentView}
          onClick={() => setActiveView('history')}
        >
          历史任务
        </button>
      </div>
      <div role="tabpanel" aria-label={isCurrentView ? '当前任务' : '历史任务'}>
        {renderPanelContent()}
      </div>
    </div>
  )
}
