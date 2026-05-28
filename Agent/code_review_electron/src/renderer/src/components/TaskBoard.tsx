import type { ReviewTask } from '../../../shared/types'

type TaskBoardProps = {
  tasks: ReviewTask[]
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

export function TaskBoard({ tasks }: TaskBoardProps): React.JSX.Element {
  if (tasks.length === 0) {
    return <p className="empty-state">暂无任务，填写左侧表单后开始审查。</p>
  }

  return (
    <div className="task-list" aria-label="任务列表">
      {tasks.map((task) => (
        <article className="task-card" key={task.id}>
          <div className="task-card-header">
            <strong>{task.id}</strong>
            <span className={`task-status task-status-${task.status}`}>{statusText[task.status]}</span>
          </div>
          <p>{task.svn_url}</p>
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
          {task.error_message && <p className="task-error">{task.error_message}</p>}
        </article>
      ))}
    </div>
  )
}
