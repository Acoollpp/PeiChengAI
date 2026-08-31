import type { ReviewTask, TaskProgressEvent } from '../../../shared/types'
import type { SelectedReviewItemInput } from '../../../shared/review-items'
import type {
  ExecuteTaskRequest,
  ExecuteTaskResult,
  RetryTaskRequest
} from '../code-review-api'

export type LocalTaskQueueState = 'queued' | 'starting' | 'running' | 'finished'
export type ReviewTaskOrigin = 'local-run' | 'server-snapshot'
export type ReviewTaskUserIntent = 'cancelled' | 'hidden'

// status、isLocallyExecuting、userIntent 分别属于服务端业务记录、本地 Promise 生命周期和当前会话用户意图，不能互相推导。
export type TaskViewItem = ReviewTask & {
  localTaskId: string
  localQueueState: LocalTaskQueueState
  queueIndex: number
  createdAtMs: number
  requirement_file_path?: string
  review_items?: SelectedReviewItemInput[]
  reportMarkdown?: string
  localReportPath?: string
  pdfPath?: string
  isLocalOnly?: boolean
  isLocallyExecuting?: boolean
  executePayload?: ExecuteTaskRequest | RetryTaskRequest
  executeWith?: 'create' | 'retry'
  localProgressStage?: Extract<TaskProgressEvent, { type: 'stage' }>['stage']
  origin?: ReviewTaskOrigin
  userIntent?: ReviewTaskUserIntent
}

export type ReviewTaskQueueCommand =
  | { type: 'replace'; tasks: TaskViewItem[] }
  | { type: 'append'; task: TaskViewItem }
  | { type: 'mark-starting'; localTaskIds: string[] }
  | { type: 'retry'; task: TaskViewItem }
  | { type: 'cancel'; localTaskId: string }
  | { type: 'apply-progress'; event: TaskProgressEvent }
  | { type: 'reconcile-server-snapshot'; tasks: ReviewTask[] }
  | {
      type: 'complete-run'
      localTaskId: string
      result: ExecuteTaskResult
    }
  | { type: 'fail-run'; localTaskId: string; message: string }
  | { type: 'hide'; taskId: string }
  | { type: 'set-report-content'; taskId: string; markdown: string }
  | {
      type: 'set-report-feedback'
      taskId: string
      helpful: boolean
      usefulIssuesText: string | null
    }
  | {
      type: 'set-issue-feedback'
      taskId: string
      feedbackSubmittedAt: string
      pdfPath: string
      pdfReportName: string
    }

export type ReviewTaskQueueProjection = {
  tasks: TaskViewItem[]
  runningTasks: TaskViewItem[]
  queuedTasks: TaskViewItem[]
  historyTasks: TaskViewItem[]
  tasksToStart: TaskViewItem[]
}

const terminalStatuses = new Set<ReviewTask['status']>([
  'success',
  'failed',
  'environment_error',
  'cancelled'
])

const isTerminalTaskStatus = (status: ReviewTask['status']): boolean =>
  terminalStatuses.has(status)

const isRecoverableReportUpload = (
  task: Pick<ReviewTask, 'status' | 'report_upload_recovery'>
): boolean => task.status === 'uploading_report' && task.report_upload_recovery !== undefined

export const toTaskViewItem = (task: ReviewTask, createdAtMs = Date.now()): TaskViewItem => ({
  ...task,
  localTaskId: task.id,
  localQueueState:
    isTerminalTaskStatus(task.status) || isRecoverableReportUpload(task) ? 'finished' : 'running',
  queueIndex: 0,
  createdAtMs,
  isLocallyExecuting: false,
  review_items: undefined,
  origin: 'server-snapshot'
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

const nowIso = (): string => new Date().toISOString()

const mapProgressStageToTaskStatus = (
  stage: Extract<TaskProgressEvent, { type: 'stage' }>['stage']
): ReviewTask['status'] => stage === 'preparing_workspace' ? 'checking_environment' : stage

const taskSortTime = (task: TaskViewItem): number => {
  for (const value of [task.finished_at, task.started_at]) {
    if (!value) continue
    const timestamp = new Date(value).getTime()
    if (!Number.isNaN(timestamp)) return timestamp
  }
  return task.createdAtMs
}

const preserveLocalFields = (existing: TaskViewItem, serverTask: ReviewTask): TaskViewItem => ({
  ...existing,
  ...serverTask,
  localTaskId: existing.localTaskId,
  createdAtMs: existing.createdAtMs,
  origin: existing.origin,
  userIntent: existing.userIntent,
  old_revision: existing.origin === 'local-run' ? existing.old_revision : serverTask.old_revision,
  new_revision: existing.origin === 'local-run' ? existing.new_revision : serverTask.new_revision,
  requirement_file_path:
    existing.origin === 'local-run'
      ? existing.requirement_file_path
      : serverTask.requirement_file_path,
  review_items: existing.origin === 'local-run' ? existing.review_items : undefined,
  // Markdown 正文和本地 PDF fallback 从不出现在 task:list 中，刷新服务端权威字段时必须保留 Renderer 缓存。
  reportMarkdown: existing.reportMarkdown,
  localReportPath: existing.localReportPath,
  pdfPath: existing.pdfPath,
  report_upload_recovery: serverTask.report_upload_recovery,
  codex_log: existing.origin === 'local-run' ? existing.codex_log : serverTask.codex_log,
  codex_log_path:
    existing.origin === 'local-run'
      ? (existing.codex_log_path ?? serverTask.codex_log_path)
      : serverTask.codex_log_path,
  isLocalOnly: existing.isLocalOnly,
  executePayload: existing.executePayload,
  executeWith: existing.executeWith,
  localProgressStage: existing.localProgressStage,
  // 服务端状态只回答业务结果；本地 Promise 是否结束由运行命令独立维护。
  isLocallyExecuting: existing.isLocallyExecuting,
  localQueueState: isTerminalTaskStatus(serverTask.status) || isRecoverableReportUpload(serverTask)
    ? 'finished'
    : existing.origin === 'local-run'
      ? existing.localQueueState
      : 'running'
})

const reconcileServerSnapshot = (
  current: TaskViewItem[],
  serverTasks: ReviewTask[]
): TaskViewItem[] => {
  const serverIds = new Set(serverTasks.map((task) => task.id))
  const serverViewItems = serverTasks.map((serverTask) => {
    const existing = current.find((task) => task.id === serverTask.id)
    if (!existing) return toTaskViewItem(serverTask)

    const merged = preserveLocalFields(existing, serverTask)
    if (existing.userIntent !== 'cancelled') return merged

    // 取消锁只保护当前会话中取消前已在途的旧状态，服务端时间仍可用于展示。
    return {
      ...merged,
      status: 'cancelled' as const,
      progress_message: '任务已取消',
      error_message: undefined,
      localQueueState: 'finished' as const
    }
  })

  // task:list 有分页并过滤本机隐藏项，不是全量事实；当前会话产生的任务必须保留。
  const sessionTasks = current.filter(
    (task) =>
      (task.origin === 'local-run' || task.userIntent === 'hidden') &&
      !serverIds.has(task.id)
  )
  return normalizeQueueIndexes([...serverViewItems, ...sessionTasks])
}

const applyProgress = (current: TaskViewItem[], event: TaskProgressEvent, now: string): TaskViewItem[] => {
  const targetIndex = current.findIndex((task) => {
    if (event.clientTaskId) return task.localTaskId === event.clientTaskId
    const isUnboundLocalTask = task.origin === 'local-run' && task.id === task.localTaskId
    return task.id === event.taskId && !isUnboundLocalTask
  })
  if (targetIndex < 0) return current

  const target = current[targetIndex]
  const serverShadow = event.clientTaskId
    ? current.find((task, index) => index !== targetIndex && task.id === event.taskId)
    : undefined
  const merged = serverShadow ? preserveLocalFields(target, serverShadow) : target
  const progressStatus =
    event.type === 'stage' ? mapProgressStageToTaskStatus(event.stage) : merged.status
  const status = target.userIntent === 'cancelled'
    ? 'cancelled'
    : isTerminalTaskStatus(merged.status) && !isTerminalTaskStatus(progressStatus)
      ? merged.status
      : progressStatus
  const updated: TaskViewItem = {
    ...merged,
    id: event.taskId,
    origin: target.origin ?? 'server-snapshot',
    isLocalOnly: false,
    status,
    ...(event.type === 'stage' ? { localProgressStage: event.stage } : {}),
    progress_message: target.userIntent === 'cancelled'
      ? '任务已取消'
      : event.type === 'stage' ? event.message : target.progress_message ?? merged.progress_message,
    error_message: target.userIntent === 'cancelled' ? undefined : merged.error_message,
    codex_log: event.type === 'codex_output'
      ? [...(target.codex_log ?? []), event].slice(-20)
      : target.codex_log,
    started_at: target.started_at ?? merged.started_at ?? now,
    finished_at: isTerminalTaskStatus(status)
      ? (merged.finished_at ?? target.finished_at ?? now)
      : merged.finished_at,
    localQueueState: isTerminalTaskStatus(status) ? 'finished' : 'running',
    isLocallyExecuting: target.isLocallyExecuting
  }

  // 公共参数不能证明身份；只有双 ID 进度才能把本地卡片与服务端占位卡精确去重。
  return normalizeQueueIndexes(
    current
      .map((task, index) => index === targetIndex ? updated : task)
      .filter((task, index) => index === targetIndex || task.id !== event.taskId)
  )
}

const completeRun = (
  current: TaskViewItem[],
  localTaskId: string,
  result: ExecuteTaskResult,
  now: string
): TaskViewItem[] => {
  const latest = current.find((task) => task.localTaskId === localTaskId)
  if (!latest) return current
  if (latest.userIntent === 'cancelled') {
    const serverShadow = current.find(
      (task) => task.id === result.taskId && task.localTaskId !== localTaskId
    )
    const merged = serverShadow ? preserveLocalFields(latest, serverShadow) : latest
    const cancelled: TaskViewItem = {
      ...merged,
      id: result.taskId,
      localTaskId,
      origin: 'local-run',
      userIntent: 'cancelled',
      status: 'cancelled',
      progress_message: '任务已取消',
      error_message: undefined,
      localQueueState: 'finished',
      isLocallyExecuting: false
    }
    return normalizeQueueIndexes(
      current
        .filter((task) => task.localTaskId === localTaskId || task.id !== result.taskId)
        .map((task) => task.localTaskId === localTaskId ? cancelled : task)
    )
  }

  const serverShadow = current.find(
    (task) => task.id === result.taskId && task.localTaskId !== localTaskId
  )
  const serverTask = result.serverTask?.id === result.taskId ? result.serverTask : undefined
  const completed: TaskViewItem = {
    ...latest,
    ...serverShadow,
    ...serverTask,
    id: result.taskId,
    origin: 'local-run',
    old_revision: latest.old_revision,
    new_revision: latest.new_revision,
    status: result.status,
    report_path:
      serverTask?.report_path ?? serverShadow?.report_path ?? latest.report_path,
    pdf_report_name:
      serverTask?.pdf_report_name ??
      serverShadow?.pdf_report_name ??
      result.pdfReportName ??
      latest.pdf_report_name,
    codex_log_path: result.codexLogPath ?? latest.codex_log_path,
    codex_log: latest.codex_log,
    reportMarkdown: result.reportMarkdown ?? latest.reportMarkdown,
    localReportPath: result.reportPath ?? latest.localReportPath,
    pdfPath: result.pdfPath ?? latest.pdfPath,
    requirement_file_path: latest.requirement_file_path,
    review_items: latest.review_items,
    feedback_protocol_version: serverTask?.feedback_protocol_version !== undefined
      ? serverTask.feedback_protocol_version
      : serverShadow?.feedback_protocol_version !== undefined
        ? serverShadow.feedback_protocol_version
      : result.feedbackProtocolVersion !== undefined
        ? result.feedbackProtocolVersion
        : latest.feedback_protocol_version,
    report_upload_recovery: result.status === 'success'
      ? undefined
      : result.reportUploadRecovery ?? serverTask?.report_upload_recovery ?? latest.report_upload_recovery,
    progress_message: result.status === 'success' ? '审查完成' : latest.progress_message,
    started_at: serverTask?.started_at ?? latest.started_at ?? now,
    finished_at: isTerminalTaskStatus(result.status)
      ? (serverTask?.finished_at ?? latest.finished_at ?? now)
      : (serverTask?.finished_at ?? latest.finished_at),
    localQueueState: 'finished',
    localTaskId,
    createdAtMs: latest.createdAtMs,
    queueIndex: latest.queueIndex,
    isLocalOnly: false,
    isLocallyExecuting: false,
    executePayload: latest.executePayload,
    executeWith: latest.executeWith
  }

  return normalizeQueueIndexes(
    current
      .filter((task) => task.localTaskId === localTaskId || task.id !== result.taskId)
      .map((task) => task.localTaskId === localTaskId ? completed : task)
  )
}

export const applyReviewTaskQueueCommand = (
  current: TaskViewItem[],
  command: ReviewTaskQueueCommand,
  now = nowIso()
): TaskViewItem[] => {
  switch (command.type) {
    case 'replace': return normalizeQueueIndexes(command.tasks)
    case 'append': return normalizeQueueIndexes([...current, { ...command.task, origin: 'local-run' }])
    case 'mark-starting': {
      const ids = new Set(command.localTaskIds)
      return normalizeQueueIndexes(current.map((task) => ids.has(task.localTaskId) ? {
        ...task,
        origin: 'local-run',
        started_at: task.started_at ?? now,
        localQueueState: 'starting',
        isLocallyExecuting: true
      } : task))
    }
    case 'retry': {
      const task = command.task
      // 创建阶段失败的历史兼容补偿必须重放原创建载荷，不能拿尚未绑定的本地 ID 调服务端重试。
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
        userIntent: undefined,
        status: 'created',
        error_message: undefined,
        progress_message: '等待重试',
        reportMarkdown: undefined,
        localReportPath: undefined,
        report_path: undefined,
        pdf_report_name: undefined,
        pdfPath: undefined,
        codex_log: undefined,
        issue_count: undefined,
        highest_issue_severity: undefined,
        feedback_protocol_version: undefined,
        report_upload_failure_code: undefined,
        report_upload_recovery: undefined,
        started_at: undefined,
        finished_at: undefined,
        localQueueState: 'queued',
        queueIndex: 0,
        origin: 'local-run',
        isLocalOnly: shouldRetryCreate,
        isLocallyExecuting: false,
        executeWith: shouldRetryCreate ? 'create' : 'retry',
        executePayload: shouldRetryCreate ? task.executePayload : retryPayload
      }
      return normalizeQueueIndexes(current.map((candidate) =>
        candidate.localTaskId === task.localTaskId ? retryingTask : candidate
      ))
    }
    case 'cancel': return normalizeQueueIndexes(current.map((task) =>
      task.localTaskId === command.localTaskId ? {
        ...task,
        userIntent: 'cancelled',
        status: 'cancelled',
        progress_message: '任务已取消',
        error_message: undefined,
        started_at: task.started_at ?? now,
        finished_at: task.finished_at ?? now,
        localQueueState: 'finished'
      } : task
    ))
    case 'apply-progress': return applyProgress(current, command.event, now)
    case 'reconcile-server-snapshot': return reconcileServerSnapshot(current, command.tasks)
    case 'complete-run': return completeRun(current, command.localTaskId, command.result, now)
    case 'fail-run': return normalizeQueueIndexes(current.map((task) =>
      task.localTaskId !== command.localTaskId ? task : task.userIntent === 'cancelled'
        ? { ...task, isLocallyExecuting: false }
        : {
            ...task,
            status: 'failed',
            error_message: command.message,
            progress_message: command.message,
            started_at: task.started_at ?? now,
            finished_at: task.finished_at ?? now,
            localQueueState: 'finished',
            isLocallyExecuting: false
          }
    ))
    case 'hide': return normalizeQueueIndexes(current.map((task) =>
      task.id === command.taskId || task.localTaskId === command.taskId
        ? { ...task, userIntent: 'hidden' as const }
        : task
    ))
    case 'set-report-content': return current.map((task) => task.id === command.taskId
      ? { ...task, reportMarkdown: command.markdown }
      : task)
    case 'set-report-feedback': return current.map((task) => task.id === command.taskId ? {
      ...task,
      report_feedback_helpful: command.helpful,
      report_feedback_useful_issues_text: command.usefulIssuesText
    } : task)
    case 'set-issue-feedback': return current.map((task) => task.id === command.taskId ? {
      ...task,
      feedback_submitted_at: command.feedbackSubmittedAt,
      evaluated_issue_count: task.issue_count ?? task.evaluated_issue_count,
      pdf_report_name: command.pdfReportName,
      pdfPath: command.pdfPath
    } : task)
  }
}

export const projectReviewTaskQueue = (
  tasks: TaskViewItem[],
  maxConcurrentTasks: number
): ReviewTaskQueueProjection => {
  const visibleTasks = tasks.filter((task) => task.userIntent !== 'hidden')
  // 本地 Promise 生命周期是槽位唯一事实来源，业务终态和取消展示都不能提前释放它。
  const activeCount = tasks.filter((task) => task.isLocallyExecuting === true).length
  const availableSlots = Math.max(0, maxConcurrentTasks - activeCount)
  const queuedTasks = visibleTasks.filter((task) => task.localQueueState === 'queued')
  const tasksToStart = [...queuedTasks]
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .slice(0, availableSlots)
  const runningTasks = visibleTasks.filter(
    (task) => task.localQueueState === 'starting' || task.localQueueState === 'running'
  )
  const historyTasks = [...visibleTasks.filter((task) => task.localQueueState === 'finished')]
    .sort((left, right) => taskSortTime(right) - taskSortTime(left))

  return { tasks: visibleTasks, runningTasks, queuedTasks, historyTasks, tasksToStart }
}
