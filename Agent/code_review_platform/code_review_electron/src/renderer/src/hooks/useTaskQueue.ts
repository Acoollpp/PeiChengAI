import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import type {
  CancelTaskRequest,
  CancelTaskResult,
  ExecuteTaskRequest,
  ExecuteTaskResult
} from '../code-review-api'

export const MAX_CONCURRENT_REVIEW_TASKS = 2
export const REVIEW_TASK_TIMEOUT_MS = 30 * 60 * 1000
export const REVIEW_TASK_TIMEOUT_MESSAGE = '任务执行超时，请联系管理员处理。'

export type LocalTaskQueueState = 'queued' | 'starting' | 'running' | 'finished'

export type TaskViewItem = ReviewTask & {
  localTaskId: string
  localQueueState: LocalTaskQueueState
  queueIndex: number
  createdAtMs: number
  reportMarkdown?: string
  pdfPath?: string
  isLocalOnly?: boolean
  isLocallyExecuting?: boolean
}

type UseTaskQueueOptions = {
  executeTask: (payload: ExecuteTaskRequest) => Promise<ExecuteTaskResult>
  cancelTask?: (payload: CancelTaskRequest) => Promise<CancelTaskResult>
  initialTasks?: ReviewTask[]
  onTaskSuccess?: (task: TaskViewItem, result: ExecuteTaskResult) => void
  taskTimeoutMs?: number
}

type UseTaskQueueResult = {
  tasks: TaskViewItem[]
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  submitTask: (payload: ExecuteTaskRequest) => Promise<void>
  cancelTask: (task: TaskViewItem) => Promise<void>
  applyProgressEvent: (event: TaskProgressEvent) => void
  setServerTasks: (serverTasks: ReviewTask[]) => void
}

const terminalStatuses = new Set<ReviewTask['status']>([
  'success',
  'failed',
  'environment_error',
  'cancelled'
])

const toTaskViewItem = (task: ReviewTask, createdAtMs = Date.now()): TaskViewItem => ({
  ...task,
  localTaskId: task.id,
  localQueueState: terminalStatuses.has(task.status) ? 'finished' : 'running',
  queueIndex: 0,
  createdAtMs,
  isLocallyExecuting: false
})

const normalizeQueueIndexes = (tasks: TaskViewItem[]): TaskViewItem[] => {
  let queueIndex = 0

  return tasks.map((task) => {
    if (task.localQueueState !== 'queued') {
      return { ...task, queueIndex: 0 }
    }

    queueIndex += 1
    return { ...task, queueIndex }
  })
}

const mapProgressStageToTaskStatus = (
  stage: Extract<TaskProgressEvent, { type: 'stage' }>['stage']
): ReviewTask['status'] => {
  if (stage === 'preparing_workspace') {
    return 'checking_environment'
  }

  return stage
}

const isTerminalStatus = (status: ReviewTask['status']): boolean => terminalStatuses.has(status)

const isMatchingUnboundLocalTask = (
  localTask: TaskViewItem,
  serverTask: ReviewTask
): boolean =>
  Boolean(localTask.localTaskId) &&
  !isTerminalStatus(serverTask.status) &&
  localTask.id === localTask.localTaskId &&
  (localTask.localQueueState === 'starting' || localTask.localQueueState === 'running') &&
  localTask.svn_url === serverTask.svn_url &&
  localTask.old_revision === serverTask.old_revision &&
  localTask.new_revision === serverTask.new_revision &&
  localTask.template_key === serverTask.template_key &&
  localTask.skill_name === serverTask.skill_name

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '审查任务执行失败。'

type ActiveTaskRun = {
  runId: symbol
  timeoutId: ReturnType<typeof setTimeout>
}

export function useTaskQueue({
  executeTask,
  cancelTask: cancelTaskRequest,
  initialTasks = [],
  onTaskSuccess,
  taskTimeoutMs = REVIEW_TASK_TIMEOUT_MS
}: UseTaskQueueOptions): UseTaskQueueResult {
  const localTaskSequence = useRef(0)
  const activeTaskRuns = useRef(new Map<string, ActiveTaskRun>())
  const isMountedRef = useRef(true)
  const [tasks, setTasks] = useState<TaskViewItem[]>(() =>
    normalizeQueueIndexes(initialTasks.map((task) => toTaskViewItem(task)))
  )
  const tasksRef = useRef(tasks)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeTaskRuns.current.forEach(({ timeoutId }) => clearTimeout(timeoutId))
      activeTaskRuns.current.clear()
    }
  }, [])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const startTask = useCallback(
    (task: TaskViewItem): void => {
      const runId = Symbol(task.localTaskId)
      const timeoutId = setTimeout(() => {
        const activeRun = activeTaskRuns.current.get(task.localTaskId)
        if (activeRun?.runId !== runId || !isMountedRef.current) {
          return
        }

        activeTaskRuns.current.delete(task.localTaskId)
        setTasks((current) =>
          normalizeQueueIndexes(
            current.map((currentTask) =>
              currentTask.localTaskId === task.localTaskId
                ? {
                    ...currentTask,
                    status: 'failed',
                    error_message: REVIEW_TASK_TIMEOUT_MESSAGE,
                    progress_message: REVIEW_TASK_TIMEOUT_MESSAGE,
                    localQueueState: 'finished',
                    isLocallyExecuting: false
                  }
                : currentTask
            )
          )
        )
      }, taskTimeoutMs)

      activeTaskRuns.current.set(task.localTaskId, { runId, timeoutId })

      void executeTask({
        svn_url: task.svn_url,
        old_revision: task.old_revision,
        new_revision: task.new_revision,
        template_key: task.template_key,
        skill_name: task.skill_name,
        client_task_id: task.localTaskId
      })
        .then((result) => {
          const activeRun = activeTaskRuns.current.get(task.localTaskId)
          if (activeRun?.runId !== runId || !isMountedRef.current) {
            return
          }

          clearTimeout(activeRun.timeoutId)
          activeTaskRuns.current.delete(task.localTaskId)
          const latestTask =
            tasksRef.current.find((currentTask) => currentTask.localTaskId === task.localTaskId) ??
            task
          const completedTask: TaskViewItem = {
            ...latestTask,
            id: result.taskId,
            status: result.status,
            report_path: result.reportPath,
            reportMarkdown: result.reportMarkdown,
            pdfPath: result.pdfPath,
            progress_message:
              result.status === 'success' ? '审查完成' : latestTask.progress_message,
            localQueueState: 'finished',
            isLocalOnly: false,
            isLocallyExecuting: false
          }

          setTasks((current) =>
            normalizeQueueIndexes(
              current.map((currentTask) =>
                currentTask.localTaskId === task.localTaskId ? completedTask : currentTask
              )
            )
          )

          if (result.status === 'success') {
            onTaskSuccess?.(completedTask, result)
          }
        })
        .catch((error: unknown) => {
          const activeRun = activeTaskRuns.current.get(task.localTaskId)
          if (activeRun?.runId !== runId || !isMountedRef.current) {
            return
          }

          clearTimeout(activeRun.timeoutId)
          activeTaskRuns.current.delete(task.localTaskId)
          const message = getErrorMessage(error)

          setTasks((current) =>
            normalizeQueueIndexes(
              current.map((currentTask) =>
                currentTask.localTaskId === task.localTaskId
                  ? {
                      ...currentTask,
                      status: 'failed',
                      error_message: message,
                      progress_message: message,
                      localQueueState: 'finished',
                      isLocallyExecuting: false
                    }
                  : currentTask
              )
            )
          )
        })
    },
    [executeTask, onTaskSuccess, taskTimeoutMs]
  )

  useEffect(() => {
    const activeCount = tasks.filter(
      (task) => task.isLocallyExecuting === true && !isTerminalStatus(task.status)
    ).length
    const slots = MAX_CONCURRENT_REVIEW_TASKS - activeCount

    if (slots <= 0) {
      return
    }

    const tasksToStart = tasks
      .filter((task) => task.localQueueState === 'queued')
      .sort((left, right) => left.createdAtMs - right.createdAtMs)
      .slice(0, slots)

    if (tasksToStart.length === 0) {
      return
    }

    const localTaskIdsToStart = new Set(tasksToStart.map((task) => task.localTaskId))
    setTasks((current) =>
      normalizeQueueIndexes(
        current.map((task) =>
          localTaskIdsToStart.has(task.localTaskId)
            ? { ...task, localQueueState: 'starting', isLocallyExecuting: true }
            : task
        )
      )
    )

    tasksToStart.forEach((task) =>
      startTask({ ...task, localQueueState: 'starting', isLocallyExecuting: true })
    )
  }, [startTask, tasks])

  const submitTask = useCallback((payload: ExecuteTaskRequest): Promise<void> => {
    localTaskSequence.current += 1
    const localTaskId = `local-${Date.now()}-${localTaskSequence.current}`
    const createdAtMs = Date.now() + localTaskSequence.current
    const task: TaskViewItem = {
      id: localTaskId,
      localTaskId,
      svn_url: payload.svn_url,
      old_revision: payload.old_revision,
      new_revision: payload.new_revision,
      template_key: payload.template_key,
      skill_name: payload.skill_name,
      status: 'created',
      localQueueState: 'queued',
      queueIndex: 0,
      createdAtMs,
      isLocalOnly: true,
      isLocallyExecuting: false
    }

    setTasks((current) => normalizeQueueIndexes([...current, task]))
    return Promise.resolve()
  }, [])

  const cancelTask = useCallback(
    async (task: TaskViewItem): Promise<void> => {
      const activeRun = activeTaskRuns.current.get(task.localTaskId)
      if (activeRun) {
        clearTimeout(activeRun.timeoutId)
        activeTaskRuns.current.delete(task.localTaskId)
      }

      setTasks((current) =>
        normalizeQueueIndexes(
          current.map((currentTask) =>
            currentTask.localTaskId === task.localTaskId
              ? {
                  ...currentTask,
                  status: 'cancelled',
                  progress_message: '任务已取消',
                  error_message: undefined,
                  localQueueState: 'finished',
                  isLocallyExecuting: false
                }
              : currentTask
          )
        )
      )

      const shouldCancelRemote =
        task.localQueueState === 'starting' || task.localQueueState === 'running' || activeRun

      if (!shouldCancelRemote) {
        return
      }

      try {
        await cancelTaskRequest?.({
          client_task_id: task.localTaskId,
          task_id: task.id
        })
      } catch {
        // 本地已取消并释放队列；后台取消失败时保留本地终态，避免迟到结果覆盖用户操作。
      }
    },
    [cancelTaskRequest]
  )

  const applyProgressEvent = useCallback((event: TaskProgressEvent): void => {
    setTasks((current) => {
      const targetIndex = current.findIndex((task) => {
        if (event.clientTaskId && task.localTaskId === event.clientTaskId) {
          return true
        }

        const isUnboundLocalTask = Boolean(task.isLocalOnly && task.id === task.localTaskId)
        return task.id === event.taskId && !isUnboundLocalTask
      })

      if (targetIndex < 0) {
        return current
      }

      return normalizeQueueIndexes(
        current.map((task, index) => {
          if (index !== targetIndex) {
            return task
          }

          if (task.status === 'cancelled') {
            return task
          }

          const status =
            event.type === 'stage' ? mapProgressStageToTaskStatus(event.stage) : task.status
          const codexLog =
            event.type === 'codex_output'
              ? [...(task.codex_log ?? []), event].slice(-20)
              : task.codex_log

          const localQueueState = isTerminalStatus(status) ? 'finished' : 'running'

          return {
            ...task,
            id: event.taskId,
            isLocalOnly: false,
            status,
            progress_message: event.message,
            codex_log: codexLog,
            localQueueState,
            isLocallyExecuting: isTerminalStatus(status) ? false : task.isLocallyExecuting
          }
        })
      )
    })
  }, [])

  const setServerTasks = useCallback((serverTasks: ReviewTask[]): void => {
    setTasks((current) => {
      const serverIds = new Set(serverTasks.map((task) => task.id))
      const matchedLocalTaskIds = new Set<string>()
      const serverViewItems = serverTasks.map((task) => {
        const existing =
          current.find((currentTask) => currentTask.id === task.id) ??
          current.find(
            (currentTask) =>
              !matchedLocalTaskIds.has(currentTask.localTaskId) &&
              isMatchingUnboundLocalTask(currentTask, task)
          )
        const localQueueState: LocalTaskQueueState = isTerminalStatus(task.status)
          ? 'finished'
          : 'running'

        if (existing) {
          matchedLocalTaskIds.add(existing.localTaskId)
        }

        return {
          ...toTaskViewItem(task, existing?.createdAtMs ?? Date.now()),
          localTaskId: existing?.localTaskId ?? task.id,
          localQueueState,
          isLocallyExecuting: isTerminalStatus(task.status)
            ? false
            : existing?.isLocallyExecuting === true,
          reportMarkdown: existing?.reportMarkdown,
          codex_log: existing?.codex_log
        }
      })
      serverViewItems.forEach((task) => matchedLocalTaskIds.add(task.localTaskId))
      const localOnlyTasks = current.filter(
        (task) => !serverIds.has(task.id) && !matchedLocalTaskIds.has(task.localTaskId)
      )

      return normalizeQueueIndexes([...serverViewItems, ...localOnlyTasks])
    })
  }, [])

  const runningTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.localQueueState === 'starting' || task.localQueueState === 'running'
      ),
    [tasks]
  )
  const queuedTasks = useMemo(
    () => tasks.filter((task) => task.localQueueState === 'queued'),
    [tasks]
  )
  const historyTasks = useMemo(
    () => tasks.filter((task) => task.localQueueState === 'finished'),
    [tasks]
  )

  return {
    tasks,
    runningTasks,
    queuedTasks,
    historyTasks,
    submitTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks
  }
}
