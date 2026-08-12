import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import type {
  CancelTaskRequest,
  CancelTaskResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  RetryTaskRequest
} from '../code-review-api'
import { toUserFacingIpcErrorMessage } from '../../../shared/ipc-error'
import {
  applyReviewTaskQueueCommand,
  projectReviewTaskQueue,
  toTaskViewItem,
  type ReviewTaskQueueCommand,
  type TaskViewItem
} from './review-task-queue-model'

export type { LocalTaskQueueState, TaskViewItem } from './review-task-queue-model'

export const MAX_CONCURRENT_REVIEW_TASKS = 2

type UseTaskQueueOptions = {
  executeTask: (payload: ExecuteTaskRequest) => Promise<ExecuteTaskResult>
  retryTask?: (payload: RetryTaskRequest) => Promise<ExecuteTaskResult>
  cancelTask?: (payload: CancelTaskRequest) => Promise<CancelTaskResult>
  initialTasks?: ReviewTask[]
  onTaskSuccess?: (task: TaskViewItem, result: ExecuteTaskResult) => void
}

type UseTaskQueueResult = {
  tasks: TaskViewItem[]
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  submitTask: (payload: ExecuteTaskRequest) => Promise<void>
  retryTask: (task: TaskViewItem) => Promise<void>
  cancelTask: (task: TaskViewItem) => Promise<void>
  applyProgressEvent: (event: TaskProgressEvent) => void
  setServerTasks: (serverTasks: ReviewTask[]) => void
  setTaskReportContent: (taskId: string, markdown: string) => void
  setTaskReportFeedback: (
    taskId: string,
    helpful: boolean,
    usefulIssuesText: string | null
  ) => void
  setTaskIssueFeedback: (
    taskId: string,
    feedbackSubmittedAt: string,
    pdfPath: string,
    pdfReportName: string
  ) => void
  hideTask: (taskId: string) => void
}

const getErrorMessage = (error: unknown): string =>
  toUserFacingIpcErrorMessage(error, '审查任务执行失败。')

export function useTaskQueue({
  executeTask,
  retryTask: retryTaskRequest,
  cancelTask: cancelTaskRequest,
  initialTasks = [],
  onTaskSuccess
}: UseTaskQueueOptions): UseTaskQueueResult {
  const localTaskSequence = useRef(0)
  const activeTaskRuns = useRef(new Map<string, symbol>())
  const cancelledTaskIds = useRef(new Set<string>())
  const isMountedRef = useRef(true)
  const [tasks, setTasks] = useState<TaskViewItem[]>(() =>
    applyReviewTaskQueueCommand([], {
      type: 'replace',
      tasks: initialTasks.map((task) => toTaskViewItem(task))
    })
  )
  const tasksRef = useRef(tasks)

  const dispatch = useCallback((command: ReviewTaskQueueCommand): void => {
    setTasks((current) => applyReviewTaskQueueCommand(current, command))
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      activeTaskRuns.current.clear()
    }
  }, [])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const startTask = useCallback((task: TaskViewItem): void => {
    const runId = Symbol(task.localTaskId)
    activeTaskRuns.current.set(task.localTaskId, runId)

    const defaultPayload = {
      svn_url: task.svn_url,
      old_revision: task.old_revision,
      new_revision: task.new_revision,
      review_items: task.review_items,
      template_key: task.template_key,
      skill_name: task.skill_name,
      requirement_file_path: task.requirement_file_path ?? undefined,
      requirement_file_name: task.requirement_file_name ?? undefined,
      focus_direction_id: task.focus_direction_id ?? undefined,
      focus_direction_snapshot: task.focus_direction_snapshot ?? undefined,
      client_task_id: task.localTaskId
    } satisfies ExecuteTaskRequest
    const executePayload = task.executePayload ?? defaultPayload
    const executionPromise = task.executeWith === 'retry'
      ? retryTaskRequest
        ? retryTaskRequest(executePayload as RetryTaskRequest)
        : Promise.reject(new Error('缺少任务重试执行器'))
      : executeTask(executePayload as ExecuteTaskRequest)

    // 执行超时和终止由 Main 唯一负责；Renderer 只在 Promise 真正结束时释放槽位。
    void executionPromise.then((result) => {
      if (activeTaskRuns.current.get(task.localTaskId) !== runId || !isMountedRef.current) return
      activeTaskRuns.current.delete(task.localTaskId)

      const wasCancelled = cancelledTaskIds.current.has(task.localTaskId)
      setTasks((current) => applyReviewTaskQueueCommand(current, {
        type: 'complete-run',
        localTaskId: task.localTaskId,
        result
      }))

      if (result.status === 'success' && !wasCancelled) {
        const completed = applyReviewTaskQueueCommand(tasksRef.current, {
          type: 'complete-run',
          localTaskId: task.localTaskId,
          result
        }).find((candidate) => candidate.localTaskId === task.localTaskId)
        if (completed) onTaskSuccess?.(completed, result)
      }
    }).catch((error: unknown) => {
      if (activeTaskRuns.current.get(task.localTaskId) !== runId || !isMountedRef.current) return
      activeTaskRuns.current.delete(task.localTaskId)
      dispatch({ type: 'fail-run', localTaskId: task.localTaskId, message: getErrorMessage(error) })
    })
  }, [dispatch, executeTask, onTaskSuccess, retryTaskRequest])

  const projection = useMemo(
    () => projectReviewTaskQueue(tasks, MAX_CONCURRENT_REVIEW_TASKS),
    [tasks]
  )

  useEffect(() => {
    if (projection.tasksToStart.length === 0) return
    const localTaskIds = projection.tasksToStart.map((task) => task.localTaskId)
    dispatch({ type: 'mark-starting', localTaskIds })
    projection.tasksToStart.forEach((task) => startTask({
      ...task,
      origin: 'local-run',
      localQueueState: 'starting',
      isLocallyExecuting: true
    }))
  }, [dispatch, projection.tasksToStart, startTask])

  const submitTask = useCallback((payload: ExecuteTaskRequest): Promise<void> => {
    localTaskSequence.current += 1
    const localTaskId = `local-${Date.now()}-${localTaskSequence.current}`
    const task: TaskViewItem = {
      id: localTaskId,
      localTaskId,
      svn_url: payload.svn_url,
      old_revision: payload.old_revision,
      new_revision: payload.new_revision,
      review_item_ids: payload.review_items?.map((item) => item.id) ?? [],
      review_items: payload.review_items,
      template_key: payload.template_key,
      skill_name: payload.skill_name,
      requirement_file_path: payload.requirement_file_path,
      requirement_file_name: payload.requirement_file_name,
      focus_direction_id: payload.focus_direction_id,
      focus_direction_snapshot: payload.focus_direction_snapshot,
      status: 'created',
      localQueueState: 'queued',
      queueIndex: 0,
      createdAtMs: Date.now() + localTaskSequence.current,
      origin: 'local-run',
      isLocalOnly: true,
      isLocallyExecuting: false,
      executeWith: 'create',
      executePayload: { ...payload, client_task_id: localTaskId }
    }
    dispatch({ type: 'append', task })
    return Promise.resolve()
  }, [dispatch])

  const retryTask = useCallback((task: TaskViewItem): Promise<void> => {
    cancelledTaskIds.current.delete(task.localTaskId)
    dispatch({ type: 'retry', task })
    return Promise.resolve()
  }, [dispatch])

  const cancelTask = useCallback(async (task: TaskViewItem): Promise<void> => {
    cancelledTaskIds.current.add(task.localTaskId)
    dispatch({ type: 'cancel', localTaskId: task.localTaskId })
    const shouldCancelRemote =
      task.localQueueState === 'starting' ||
      task.localQueueState === 'running' ||
      activeTaskRuns.current.has(task.localTaskId)
    if (!shouldCancelRemote) return

    try {
      await cancelTaskRequest?.({ client_task_id: task.localTaskId, task_id: task.id })
    } catch {
      // 取消锁继续保护用户已看到的结果；Main 的运行 Promise 结束后才释放槽位。
    }
  }, [cancelTaskRequest, dispatch])

  const applyProgressEvent = useCallback((event: TaskProgressEvent): void => {
    dispatch({ type: 'apply-progress', event })
  }, [dispatch])

  const setServerTasks = useCallback((serverTasks: ReviewTask[]): void => {
    dispatch({ type: 'reconcile-server-snapshot', tasks: serverTasks })
  }, [dispatch])

  const setTaskReportContent = useCallback((taskId: string, markdown: string): void => {
    dispatch({ type: 'set-report-content', taskId, markdown })
  }, [dispatch])

  const setTaskReportFeedback = useCallback((
    taskId: string,
    helpful: boolean,
    usefulIssuesText: string | null
  ): void => {
    dispatch({ type: 'set-report-feedback', taskId, helpful, usefulIssuesText })
  }, [dispatch])

  const setTaskIssueFeedback = useCallback((
    taskId: string,
    feedbackSubmittedAt: string,
    pdfPath: string,
    pdfReportName: string
  ): void => {
    dispatch({ type: 'set-issue-feedback', taskId, feedbackSubmittedAt, pdfPath, pdfReportName })
  }, [dispatch])

  const hideTask = useCallback((taskId: string): void => {
    dispatch({ type: 'hide', taskId })
  }, [dispatch])

  return {
    tasks: projection.tasks,
    runningTasks: projection.runningTasks,
    queuedTasks: projection.queuedTasks,
    historyTasks: projection.historyTasks,
    submitTask,
    retryTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks,
    setTaskReportContent,
    setTaskReportFeedback,
    setTaskIssueFeedback,
    hideTask
  }
}
