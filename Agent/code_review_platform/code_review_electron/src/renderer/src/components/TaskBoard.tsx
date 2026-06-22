import { useState } from 'react'

import type { ReviewTask } from '../../../shared/types'
import type { TaskViewItem } from '../hooks/useTaskQueue'

type TaskBoardProps = {
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  isLoading?: boolean
  selectedTaskId?: string
  loadingReportTaskId?: string
  onViewReport?: (task: TaskViewItem) => void
  onCancelTask?: (task: TaskViewItem) => void
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

const reviewReportNamePattern = /_审查报告(?:_\d{8}_\d{6})?\.(?:md|pdf)$/i

function basenameLike(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function extractSoftwareVersionFromReportName(value?: string | null): string | null {
  if (!value) {
    return null
  }

  const fileName = basenameLike(value)
  const softwareVersion = fileName.replace(reviewReportNamePattern, '')
  if (!softwareVersion || softwareVersion === fileName) {
    return null
  }

  return softwareVersion
}

function formatRevisionLabel(value: string): string {
  const revision = value.trim().replace(/^[rR]+/, '')
  return revision ? `r${revision}` : ''
}

function buildTaskDisplayName(task: TaskViewItem): string {
  const softwareVersion =
    extractSoftwareVersionFromReportName(task.report_name) ??
    extractSoftwareVersionFromReportName(task.pdf_report_name)
  const revision = formatRevisionLabel(task.new_revision)

  if (softwareVersion && revision) {
    return `${softwareVersion}_${revision}`
  }

  return softwareVersion ?? task.id
}

function formatTaskDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const pad = (part: number) => String(part).padStart(2, '0')
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

type TaskCardProps = {
  task: TaskViewItem
  selectedTaskId?: string
  loadingReportTaskId?: string
  showCodexLog?: boolean
  showQueueIndex?: boolean
  onViewReport?: (task: TaskViewItem) => void
  onCancelTask?: (task: TaskViewItem) => void
}

function TaskCard({
  task,
  selectedTaskId,
  loadingReportTaskId,
  showCodexLog = false,
  showQueueIndex = false,
  onViewReport,
  onCancelTask
}: TaskCardProps): React.JSX.Element {
  const canCancel =
    task.localQueueState === 'starting' ||
    task.localQueueState === 'running' ||
    task.localQueueState === 'queued'

  return (
    <article className={`task-card${task.id === selectedTaskId ? ' is-selected' : ''}`}>
      <div className="task-card-header">
        <strong>{buildTaskDisplayName(task)}</strong>
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
        <div>
          <dt>开始时间</dt>
          <dd>{formatTaskDateTime(task.started_at)}</dd>
        </div>
        <div>
          <dt>结束时间</dt>
          <dd>{formatTaskDateTime(task.finished_at)}</dd>
        </div>
      </dl>
      {showQueueIndex && <p className="task-queue-index">排队第 {task.queueIndex} 位</p>}
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
      {canCancel && (
        <button
          className="task-action-button task-cancel-button"
          type="button"
          onClick={() => onCancelTask?.(task)}
        >
          取消任务
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

type TaskBoardView = 'running' | 'queued' | 'history'

const viewLabels: Record<TaskBoardView, string> = {
  running: '运行中',
  queued: '等待中',
  history: '历史任务'
}

export function TaskBoard({
  runningTasks,
  queuedTasks,
  historyTasks,
  isLoading = false,
  selectedTaskId,
  loadingReportTaskId,
  onViewReport,
  onCancelTask
}: TaskBoardProps): React.JSX.Element {
  const [activeView, setActiveView] = useState<TaskBoardView>('running')
  const viewTasks: Record<TaskBoardView, TaskViewItem[]> = {
    running: runningTasks,
    queued: queuedTasks,
    history: historyTasks
  }
  const emptyText: Record<TaskBoardView, string> = {
    running: '暂无运行中任务。',
    queued: '暂无等待中的任务。',
    history: '暂无历史任务。'
  }
  const isRunningView = activeView === 'running'
  const isQueuedView = activeView === 'queued'
  const activeTasks = viewTasks[activeView]
  const activeLabel = viewLabels[activeView]

  if (isLoading) {
    return (
      <div className="task-board">
        <p className="empty-state">正在加载任务...</p>
      </div>
    )
  }

  return (
    <div className="task-board">
      <div role="tablist" aria-label="任务看板">
        {(['running', 'queued', 'history'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={activeView === view}
            onClick={() => setActiveView(view)}
          >
            {viewLabels[view]} <span>{viewTasks[view].length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={activeLabel}>
        {activeTasks.length === 0 ? (
          <p className="empty-state">{emptyText[activeView]}</p>
        ) : (
          <div className="task-list" aria-label={`${activeLabel}列表`}>
            {activeTasks.map((task) => (
              <TaskCard
                key={task.localTaskId ?? task.id}
                task={task}
                selectedTaskId={selectedTaskId}
                loadingReportTaskId={loadingReportTaskId}
                showCodexLog={isRunningView}
                showQueueIndex={isQueuedView}
                onViewReport={onViewReport}
                onCancelTask={onCancelTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
