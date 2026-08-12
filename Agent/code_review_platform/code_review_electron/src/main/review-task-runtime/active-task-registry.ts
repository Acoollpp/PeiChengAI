import type { TaskAgentDependencies } from '../task-agent'

export interface ActiveReviewTaskRun {
  clientTaskId?: string
  taskId?: string
  token: string
  api: TaskAgentDependencies['api']
  abortController: AbortController
  completion: Promise<void>
  resolveCompletion: () => void
  workspaceDir?: string
  evidenceDir?: string
  cancelPromise?: Promise<{ status: 'cancelled' }>
}

/**
 * 一个审查任务运行在服务端创建任务前后分别使用 clientTaskId 和 taskId 定位。
 * 两个 ID 是同一运行实例的别名，不代表两个任务；批量操作必须按实例去重。
 */
export class ActiveTaskRegistry {
  private readonly tasksById = new Map<string, ActiveReviewTaskRun>()

  register(task: ActiveReviewTaskRun): void {
    if (task.clientTaskId) {
      this.tasksById.set(task.clientTaskId, task)
    }
    if (task.taskId) {
      this.tasksById.set(task.taskId, task)
    }
  }

  unregister(task: ActiveReviewTaskRun): void {
    if (task.clientTaskId) {
      this.tasksById.delete(task.clientTaskId)
    }
    if (task.taskId) {
      this.tasksById.delete(task.taskId)
    }
  }

  find(reference: { clientTaskId?: string; taskId?: string }): ActiveReviewTaskRun | undefined {
    if (reference.clientTaskId) {
      const task = this.tasksById.get(reference.clientTaskId)
      if (task) {
        return task
      }
    }
    if (!reference.taskId) {
      return undefined
    }
    return this.tasksById.get(reference.taskId)
  }

  uniqueTasks(): ActiveReviewTaskRun[] {
    return Array.from(new Set(this.tasksById.values()))
  }
}
