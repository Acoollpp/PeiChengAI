import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import type { SelectedReviewItemInput } from '../../../shared/review-items'
import type {
  CancelTaskRequest,
  CancelTaskResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  RetryTaskRequest
} from '../code-review-api'
import { toUserFacingIpcErrorMessage } from '../../../shared/ipc-error'

export const MAX_CONCURRENT_REVIEW_TASKS = 2
export const REVIEW_TASK_TIMEOUT_MS = 60 * 60 * 1000
export const REVIEW_TASK_TIMEOUT_MESSAGE = '任务执行超时，请联系管理员处理。'

export type LocalTaskQueueState = 'queued' | 'starting' | 'running' | 'finished'

export type TaskViewItem = ReviewTask & {
  localTaskId: string
  localQueueState: LocalTaskQueueState
  queueIndex: number
  createdAtMs: number
  requirement_file_path?: string
  review_items?: SelectedReviewItemInput[]
  reportMarkdown?: string
  pdfPath?: string
  isLocalOnly?: boolean
  isLocallyExecuting?: boolean
  executePayload?: ExecuteTaskRequest | RetryTaskRequest
  executeWith?: 'create' | 'retry'
  localProgressStage?: Extract<TaskProgressEvent, { type: 'stage' }>['stage']
}

type UseTaskQueueOptions = {
  executeTask: (payload: ExecuteTaskRequest) => Promise<ExecuteTaskResult>
  retryTask?: (payload: RetryTaskRequest) => Promise<ExecuteTaskResult>
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
  retryTask: (task: TaskViewItem) => Promise<void>
  cancelTask: (task: TaskViewItem) => Promise<void>
  applyProgressEvent: (event: TaskProgressEvent) => void
  setServerTasks: (serverTasks: ReviewTask[]) => void
  updateTask: (taskId: string, updater: (task: TaskViewItem) => TaskViewItem) => void
  removeTask: (taskId: string) => void
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

const taskSortTime = (task: TaskViewItem): number => {
  for (const value of [task.finished_at, task.started_at]) {
    if (!value) {
      continue
    }

    const timestamp = new Date(value).getTime()
    if (!Number.isNaN(timestamp)) {
      return timestamp
    }
  }

  return task.createdAtMs
}

const isMatchingUnboundLocalTask = (
  localTask: TaskViewItem,
  serverTask: ReviewTask
): boolean =>
  Boolean(localTask.localTaskId) &&
  !isTerminalStatus(serverTask.status) &&
  localTask.id === localTask.localTaskId &&
  (localTask.localQueueState === 'starting' || localTask.localQueueState === 'running') &&
  // 2.0 私有逐项输入不在服务端，必须等待 clientTaskId 进度事件精确绑定。
  (serverTask.review_item_ids?.length ?? 0) === 0 &&
  localTask.svn_url === serverTask.svn_url &&
  revisionsMatch(localTask.old_revision, serverTask.old_revision) &&
  revisionsMatch(localTask.new_revision, serverTask.new_revision) &&
  localTask.template_key === serverTask.template_key &&
  localTask.skill_name === serverTask.skill_name &&
  arraysEqual(localTask.review_item_ids ?? [], serverTask.review_item_ids ?? []) &&
  (localTask.focus_direction_id ?? undefined) === (serverTask.focus_direction_id ?? undefined) &&
  (localTask.focus_direction_snapshot ?? undefined) ===
    (serverTask.focus_direction_snapshot ?? undefined) &&
  (!serverTask.requirement_file_name ||
    (localTask.requirement_file_name ?? undefined) === serverTask.requirement_file_name)

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const revisionsMatch = (left: string, right: string): boolean => {
  const normalize = (value: string): string => value.trim().replace(/^r/i, '')
  return left === right || normalize(left) === normalize(right)
}

const getErrorMessage = (error: unknown): string =>
  toUserFacingIpcErrorMessage(error, '审查任务执行失败。')

const nowIso = (): string => new Date().toISOString()

type ActiveTaskRun = {
  runId: symbol
  timeoutId: ReturnType<typeof setTimeout>
}

export function useTaskQueue({
  executeTask,
  retryTask: retryTaskRequest,
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
                    started_at: currentTask.started_at ?? nowIso(),
                    finished_at: currentTask.finished_at ?? nowIso(),
                    localQueueState: 'finished',
                    isLocallyExecuting: false
                  }
                : currentTask
            )
          )
        )
      }, taskTimeoutMs)

      activeTaskRuns.current.set(task.localTaskId, { runId, timeoutId })

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

      const executionPromise =
        task.executeWith === 'retry'
          ? retryTaskRequest
            ? retryTaskRequest(executePayload as RetryTaskRequest)
            : Promise.reject(new Error('缺少任务重试执行器'))
          : executeTask(executePayload as ExecuteTaskRequest)

      void executionPromise
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
          const serverTask = result.serverTask?.id === result.taskId ? result.serverTask : undefined
          const completedTask: TaskViewItem = {
            ...latestTask,
            ...serverTask,
            id: result.taskId,
            status: result.status,
            report_path: serverTask?.report_path ?? result.reportPath ?? latestTask.report_path,
            pdf_report_name:
              serverTask?.pdf_report_name ?? result.pdfReportName ?? latestTask.pdf_report_name,
            codex_log_path: result.codexLogPath ?? latestTask.codex_log_path,
            codex_log: latestTask.codex_log,
            reportMarkdown: result.reportMarkdown ?? latestTask.reportMarkdown,
            pdfPath: result.pdfPath ?? latestTask.pdfPath,
            requirement_file_path: latestTask.requirement_file_path,
            feedback_protocol_version:
              serverTask?.feedback_protocol_version !== undefined
                ? serverTask.feedback_protocol_version
                : result.feedbackProtocolVersion !== undefined
                ? result.feedbackProtocolVersion
                : latestTask.feedback_protocol_version,
            progress_message:
              result.status === 'success' ? '审查完成' : latestTask.progress_message,
            started_at: serverTask?.started_at ?? latestTask.started_at ?? nowIso(),
            finished_at: isTerminalStatus(result.status)
              ? (serverTask?.finished_at ?? latestTask.finished_at ?? nowIso())
              : (serverTask?.finished_at ?? latestTask.finished_at),
            localQueueState: 'finished',
            localTaskId: latestTask.localTaskId,
            createdAtMs: latestTask.createdAtMs,
            queueIndex: latestTask.queueIndex,
            isLocalOnly: false,
            isLocallyExecuting: false
          }

          setTasks((current) =>
            normalizeQueueIndexes(
              current
                .filter((currentTask) =>
                  currentTask.localTaskId === task.localTaskId || currentTask.id !== result.taskId
                )
                .map((currentTask) =>
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
                      started_at: currentTask.started_at ?? nowIso(),
                      finished_at: currentTask.finished_at ?? nowIso(),
                      localQueueState: 'finished',
                      isLocallyExecuting: false
                    }
                  : currentTask
              )
            )
          )
        })
    },
    [executeTask, onTaskSuccess, retryTaskRequest, taskTimeoutMs]
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
            ? {
                ...task,
                started_at: task.started_at ?? nowIso(),
                localQueueState: 'starting',
                isLocallyExecuting: true
              }
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
      createdAtMs,
      isLocalOnly: true,
      isLocallyExecuting: false,
      executeWith: 'create',
      executePayload: {
        ...payload,
        client_task_id: localTaskId
      }
    }

    setTasks((current) => normalizeQueueIndexes([...current, task]))
    return Promise.resolve()
  }, [])

  const retryTask = useCallback((task: TaskViewItem): Promise<void> => {
    const shouldRetryCreate =
      task.isLocalOnly === true &&
      task.executeWith === 'create' &&
      task.executePayload !== undefined &&
      'svn_url' in task.executePayload
    const retryPayload: RetryTaskRequest = {
      task_id: task.id,
      client_task_id: task.localTaskId,
      old_revision: task.old_revision,
      new_revision: task.new_revision,
      requirement_file_path: task.requirement_file_path ?? undefined,
      review_items: task.review_items
    }
    const retryingTask: TaskViewItem = {
      ...task,
      status: 'created',
      error_message: undefined,
      progress_message: '等待重试',
      reportMarkdown: undefined,
      report_path: undefined,
      pdf_report_name: undefined,
      pdfPath: undefined,
      codex_log: undefined,
      issue_count: undefined,
      highest_issue_severity: undefined,
      feedback_protocol_version: undefined,
      started_at: undefined,
      finished_at: undefined,
      localQueueState: 'queued',
      queueIndex: 0,
      isLocalOnly: shouldRetryCreate,
      isLocallyExecuting: false,
      executeWith: shouldRetryCreate ? 'create' : 'retry',
      executePayload: shouldRetryCreate ? task.executePayload : retryPayload
    }

    setTasks((current) =>
      normalizeQueueIndexes(
        current.map((currentTask) =>
          currentTask.localTaskId === task.localTaskId ? retryingTask : currentTask
        )
      )
    )
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
                  started_at: currentTask.started_at ?? nowIso(),
                  finished_at: currentTask.finished_at ?? nowIso(),
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
        if (event.clientTaskId) {
          return task.localTaskId === event.clientTaskId
        }

        const isUnboundLocalTask = Boolean(task.isLocalOnly && task.id === task.localTaskId)
        return task.id === event.taskId && !isUnboundLocalTask
      })

      if (targetIndex < 0) {
        return current
      }

      if (current[targetIndex].status === 'cancelled') {
        return current
      }

      return normalizeQueueIndexes(
        current
          .map((task, index) => {
            if (index !== targetIndex) {
              return task
            }

            const status =
              event.type === 'stage' ? mapProgressStageToTaskStatus(event.stage) : task.status
            const codexLog =
              event.type === 'codex_output'
                ? [...(task.codex_log ?? []), event].slice(-20)
                : task.codex_log

            const localQueueState: LocalTaskQueueState = isTerminalStatus(status)
              ? 'finished'
              : 'running'

            return {
              ...task,
              id: event.taskId,
              isLocalOnly: false,
              status,
              ...(event.type === 'stage' ? { localProgressStage: event.stage } : {}),
              progress_message: event.message,
              codex_log: codexLog,
              started_at: task.started_at ?? nowIso(),
              finished_at: isTerminalStatus(status)
                ? (task.finished_at ?? nowIso())
                : task.finished_at,
              localQueueState,
              isLocallyExecuting: isTerminalStatus(status) ? false : task.isLocallyExecuting
            }
          })
          .filter((task, index) => index === targetIndex || task.id !== event.taskId)
      )
    })
  }, [])

  const updateTask = useCallback(
    (taskId: string, updater: (task: TaskViewItem) => TaskViewItem): void => {
      setTasks((current) =>
        normalizeQueueIndexes(
          current.map((task) => (task.id === taskId ? updater(task) : task))
        )
      )
    },
    []
  )

  const removeTask = useCallback((taskId: string): void => {
    setTasks((current) =>
      normalizeQueueIndexes(
        current.filter((task) => task.id !== taskId && task.localTaskId !== taskId)
      )
    )
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
          old_revision: existing?.old_revision ?? task.old_revision,
          new_revision: existing?.new_revision ?? task.new_revision,
          localQueueState,
          isLocallyExecuting: isTerminalStatus(task.status)
            ? false
            : existing?.isLocallyExecuting === true,
          requirement_file_path: existing?.requirement_file_path,
          review_items: existing?.review_items,
          reportMarkdown: existing?.reportMarkdown,
          codex_log_path: existing?.codex_log_path ?? task.codex_log_path,
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
    () =>
      [...tasks.filter((task) => task.localQueueState === 'finished')].sort(
        (left, right) => taskSortTime(right) - taskSortTime(left)
      ),
    [tasks]
  )

  return {
    tasks,
    runningTasks,
    queuedTasks,
    historyTasks,
    submitTask,
    retryTask,
    cancelTask,
    applyProgressEvent,
    setServerTasks,
    updateTask,
    removeTask
  }
}
