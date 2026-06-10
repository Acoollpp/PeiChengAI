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
  task: TaskViewItem
  selectedTaskId?: string
  loadingReportTaskId?: string
  showCodexLog?: boolean
  showQueueIndex?: boolean
  onViewReport?: (task: TaskViewItem) => void
}

function TaskCard({
  task,
  selectedTaskId,
  loadingReportTaskId,
  showCodexLog = false,
  showQueueIndex = false,
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

type TaskSectionProps = {
  title: string
  emptyText: string
  tasks: TaskViewItem[]
  selectedTaskId?: string
  loadingReportTaskId?: string
  showCodexLog?: boolean
  showQueueIndex?: boolean
  onViewReport?: (task: TaskViewItem) => void
}

function TaskSection({
  title,
  emptyText,
  tasks,
  selectedTaskId,
  loadingReportTaskId,
  showCodexLog = false,
  showQueueIndex = false,
  onViewReport
}: TaskSectionProps): React.JSX.Element {
  return (
    <section className="task-board-section" aria-label={title}>
      <div className="task-section-header">
        <h3>{title}</h3>
        <span className="task-section-count">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="empty-state">{emptyText}</p>
      ) : (
        <div className="task-list" aria-label={`${title}列表`}>
          {tasks.map((task) => (
            <TaskCard
              key={task.localTaskId}
              task={task}
              selectedTaskId={selectedTaskId}
              loadingReportTaskId={loadingReportTaskId}
              showCodexLog={showCodexLog}
              showQueueIndex={showQueueIndex}
              onViewReport={onViewReport}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function TaskBoard({
  runningTasks,
  queuedTasks,
  historyTasks,
  isLoading = false,
  selectedTaskId,
  loadingReportTaskId,
  onViewReport
}: TaskBoardProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="task-board">
        <p className="empty-state">正在加载任务...</p>
      </div>
    )
  }

  return (
    <div className="task-board">
      <TaskSection
        title="运行中"
        emptyText="暂无运行中任务。"
        tasks={runningTasks}
        selectedTaskId={selectedTaskId}
        loadingReportTaskId={loadingReportTaskId}
        showCodexLog
        onViewReport={onViewReport}
      />
      <TaskSection
        title="等待中"
        emptyText="暂无等待中的任务。"
        tasks={queuedTasks}
        selectedTaskId={selectedTaskId}
        loadingReportTaskId={loadingReportTaskId}
        showQueueIndex
        onViewReport={onViewReport}
      />
      <TaskSection
        title="历史任务"
        emptyText="暂无历史任务。"
        tasks={historyTasks}
        selectedTaskId={selectedTaskId}
        loadingReportTaskId={loadingReportTaskId}
        onViewReport={onViewReport}
      />
    </div>
  )
}
