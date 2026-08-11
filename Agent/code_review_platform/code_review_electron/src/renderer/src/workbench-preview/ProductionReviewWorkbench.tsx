import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BMS_CODE_REVIEW_SKILL_NAME, REVIEW_ITEM_CATALOG } from '../../../shared/review-items'
import {
  analyzeLoadedReviewReport,
  summarizeReviewReport
} from '../../../shared/review-report-analysis'
import type { CurrentUser } from '../../../shared/types'
import type { EnvironmentCheckResult } from '../code-review-api'
import { EnvironmentStatus } from '../components/EnvironmentStatus'
import { extractDetailedHeadingOptions } from '../components/MarkdownPreview'
import { useTaskQueue, type TaskViewItem } from '../hooks/useTaskQueue'
import { ReviewWorkbenchPreview } from './ReviewWorkbenchPreview'
import { formatRevisionLabel } from './revision'
import { applyWorkbenchReviewItemPresentation } from './review-item-presentation'
import type {
  CreateTaskCommand,
  PreviewCommandResult,
  ReviewItemDefinition,
  ReviewItemId,
  ReviewReportViewModel,
  ReviewTaskViewModel,
  StageTrackItem,
  SubmitFeedbackCommand,
  TaskStage,
  WorkbenchAdapter,
  WorkbenchCommands,
  WorkbenchReportListState,
  WorkbenchTaskStats,
  WorkbenchViewModel
} from './types'
import './workbench-preview.css'

interface ProductionReviewWorkbenchProps {
  currentUser: CurrentUser
  environment: EnvironmentCheckResult | null
  isCheckingEnvironment: boolean
  isInstallingSkillDuringCheck: boolean
  isInstallingCodex: boolean
  isInstallingSvn: boolean
  onRefreshEnvironment: () => Promise<void>
  onInstallCodex: () => Promise<void>
  onInstallSvn: () => Promise<void>
  onInstallSkill: () => Promise<void>
  catalogOverride?: ReviewItemDefinition[]
}

export const PRODUCTION_REVIEW_ITEM_CATALOG: ReviewItemDefinition[] = REVIEW_ITEM_CATALOG
  .filter((item) => item.enabled)
  .sort((left, right) => left.sortOrder - right.sortOrder)
  .map((item): ReviewItemDefinition => ({
    id: item.id,
    category: item.category.name,
    name: item.name,
    summary: item.summary,
    goal: item.details.target,
    process: [item.details.process],
    specification: item.details.specification,
    materialFields: item.materialFields.map((field) => ({
      id: field.id,
      label: field.name,
      description: field.description,
      required: field.required,
      extensions: [...field.allowedExtensions],
      multiplicity: field.multiple ? 'multiple' : 'single'
    }))
  }))
  .map(applyWorkbenchReviewItemPresentation)
const productionReviewItemIds = new Set<ReviewItemId>(
  PRODUCTION_REVIEW_ITEM_CATALOG.map((item) => item.id)
)
const isProductionReviewItemId = (id: string): id is ReviewItemId =>
  productionReviewItemIds.has(id as ReviewItemId)

const phaseOrder: Array<Exclude<TaskStage, 'waiting' | 'failed' | 'cancelled'>> = [
  'checking_environment', 'preparing_workspace', 'running_review', 'uploading_report', 'completed'
]
const phaseLabels: Record<(typeof phaseOrder)[number], string> = {
  checking_environment: '环境检查', preparing_workspace: '准备工作区',
  running_review: '执行 Skill', uploading_report: '上传报告', completed: '完成'
}
const stageLabels: Record<TaskStage, string> = {
  waiting: '本机等待', checking_environment: '环境检查', preparing_workspace: '准备工作区',
  running_review: '执行 Skill', uploading_report: '上传报告', completed: '完成',
  failed: '失败', cancelled: '已取消'
}

type TaskStatsSemanticState = 'local' | 'active' | `terminal:${TaskViewItem['status']}`
const taskStatsTerminalStatuses = new Set<TaskViewItem['status']>([
  'success', 'failed', 'environment_error', 'cancelled'
])
const taskStatsSemanticState = (task: TaskViewItem): TaskStatsSemanticState => {
  if (
    task.localQueueState === 'queued' ||
    task.isLocalOnly === true ||
    (task.executeWith === 'retry' && task.localQueueState === 'starting')
  ) return 'local'
  if (taskStatsTerminalStatuses.has(task.status)) return `terminal:${task.status}`
  return 'active'
}

const taskStage = (task: TaskViewItem): TaskStage => {
  if (task.localQueueState === 'queued') return 'waiting'
  if (task.status === 'success') return 'completed'
  if (task.status === 'failed' || task.status === 'environment_error') return 'failed'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.localProgressStage === 'preparing_workspace') return 'preparing_workspace'
  if (task.status === 'running_codex') return 'running_review'
  if (task.status === 'uploading_report') return 'uploading_report'
  return 'checking_environment'
}

const phaseTrack = (stage: TaskStage): StageTrackItem[] => {
  const currentIndex = phaseOrder.indexOf(stage as (typeof phaseOrder)[number])
  const terminalIndex = stage === 'completed' ? phaseOrder.length - 1 : currentIndex
  return phaseOrder.map((id, index) => ({
    id, label: phaseLabels[id],
    state: index < terminalIndex ? 'complete' : index === terminalIndex && currentIndex >= 0 ? 'current' : 'upcoming'
  }))
}

const formatTime = (task: TaskViewItem): string => {
  const value = task.finished_at ?? task.started_at
  if (!value) return '刚刚'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  })
}
const itemIds = (task: TaskViewItem): string[] =>
  (task.review_item_ids ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
const repositoryName = (svnUrl: string): string => {
  const segments = svnUrl.replace(/[?#].*$/, '').split('/').filter(Boolean)
  return segments.at(-1) ?? svnUrl
}
const taskTitle = (task: TaskViewItem): string => {
  const reportName = task.report_name?.replace(/\.(md|markdown)$/i, '').trim()
  if (reportName) return reportName
  return `${repositoryName(task.svn_url)} · ${formatRevisionLabel(task.old_revision)} → ${formatRevisionLabel(task.new_revision)}`
}
const hasReadableMarkdownReport = (
  task: Pick<TaskViewItem, 'status' | 'report_path'>
): boolean =>
  task.status === 'success' &&
  typeof task.report_path === 'string' &&
  task.report_path.trim().length > 0
const toTaskViewModel = (task: TaskViewItem): ReviewTaskViewModel => {
  const stage = taskStage(task)
  const message = stage === 'completed' && !hasReadableMarkdownReport(task)
    ? '任务已完成，但未生成可查看的 Markdown 报告。'
    : task.progress_message ?? task.error_message ?? (
      stage === 'completed' ? '报告已生成，可查看。' : stageLabels[stage]
    )
  return {
    id: task.id, title: taskTitle(task), svnUrl: task.svn_url,
    oldRevision: task.old_revision, newRevision: task.new_revision,
    reviewItemIds: itemIds(task), stage, stageLabel: stageLabels[stage],
    message,
    updatedAt: formatTime(task), ...(stage === 'waiting' ? { queueIndex: task.queueIndex } : {}),
    phaseTrack: phaseTrack(stage)
  }
}
type ReportContentState = Pick<ReviewReportViewModel, 'contentStatus' | 'contentMessage'>
const reportSummaryInput = (task: TaskViewItem) => ({
  feedbackProtocolVersion: task.feedback_protocol_version,
  issueCount: task.issue_count,
  highestIssueSeverity: task.highest_issue_severity
})
const toReportViewModel = (
  task: TaskViewItem,
  contentState?: ReportContentState
): ReviewReportViewModel => {
  const loadedAnalysis = task.reportMarkdown
    ? analyzeLoadedReviewReport(task.reportMarkdown, reportSummaryInput(task))
    : undefined
  const analysis = loadedAnalysis ?? summarizeReviewReport(reportSummaryInput(task))
  const contentStatus = contentState?.contentStatus ?? (
    loadedAnalysis?.status ?? 'idle'
  )
  return {
    id: task.id, taskId: task.id, title: taskTitle(task), svnUrl: task.svn_url,
    revisionRange: `${formatRevisionLabel(task.old_revision)} → ${formatRevisionLabel(task.new_revision)}`,
    reviewItemIds: itemIds(task), completedAt: formatTime(task),
    issueCount: analysis.issueCount, highestSeverity: analysis.highestSeverity,
    summary: analysis.summary, markdown: task.reportMarkdown ?? '',
    contentStatus,
    contentMessage: contentState?.contentMessage ?? loadedAnalysis?.message,
    reportPath: task.report_path,
    feedbackProtocolVersion: task.feedback_protocol_version,
    feedbackSubmittedAt: task.feedback_submitted_at,
    reportFeedbackHelpful: task.report_feedback_helpful
  }
}
const emptySample: CreateTaskCommand = { svnUrl: '', oldRevision: '', newRevision: '', selection: {} }
const commandResult = (message: string): PreviewCommandResult => ({ message })
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
const isRendererForeground = (): boolean =>
  document.visibilityState === 'visible' && document.hasFocus()

export function ProductionReviewWorkbench(props: ProductionReviewWorkbenchProps): React.JSX.Element {
  const {
    currentUser, environment, isCheckingEnvironment, isInstallingSkillDuringCheck,
    isInstallingCodex, isInstallingSvn, onRefreshEnvironment, onInstallCodex,
    onInstallSvn, onInstallSkill, catalogOverride
  } = props
  const catalog = catalogOverride ?? PRODUCTION_REVIEW_ITEM_CATALOG
  const [notice, setNotice] = useState<string>()
  const [noticeAction, setNoticeAction] = useState<WorkbenchViewModel['noticeAction']>()
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [activeFeedbackAnchorId, setActiveFeedbackAnchorId] = useState<string>()
  const [feedbackAnchorScrollRequest, setFeedbackAnchorScrollRequest] = useState<WorkbenchViewModel['feedbackAnchorScrollRequest']>()
  const [requestedView, setRequestedView] = useState<WorkbenchViewModel['requestedView']>()
  const [taskStats, setTaskStats] = useState<WorkbenchTaskStats>({ status: 'loading' })
  const [reportListState, setReportListState] = useState<WorkbenchReportListState>({ status: 'loading' })
  const [reportContentStates, setReportContentStates] = useState<Record<string, ReportContentState>>({})
  const reportContentStatesRef = useRef<Record<string, ReportContentState>>({})
  const selectedReportIdRef = useRef<string | undefined>(undefined)
  const requestedViewSequenceRef = useRef(0)
  const taskStatsRequestRef = useRef(0)
  const reportListRequestRef = useRef(0)
  const reportContentRequestRef = useRef(new Map<string, number>())
  const mountedRef = useRef(true)
  const observedTaskStatsStateRef = useRef(new Map<string, TaskStatsSemanticState>())
  const createTaskInFlightRef = useRef(false)
  const feedbackInFlightRef = useRef(false)
  const negativeFeedbackInFlightRef = useRef(new Set<string>())
  const canCreateTask = environment?.status === 'ready' && !environment.skillError
  const showNotice = useCallback((message: string): void => {
    setNotice(message)
    setNoticeAction(undefined)
  }, [])
  const showCompletionNotice = useCallback((task: TaskViewItem): void => {
    setNotice(`任务 ${task.id} 已完成，可查看报告。`)
    setNoticeAction({ label: '查看报告', reportId: task.id })
  }, [])
  const handleTaskSuccess = useCallback((task: TaskViewItem): void => {
    if (!hasReadableMarkdownReport(task)) return
    if (isRendererForeground()) {
      showCompletionNotice(task)
      return
    }
    setNotice(undefined)
    setNoticeAction(undefined)
    try {
      void window.codeReview.showTaskCompletionNotification({
        taskId: task.id,
        localTaskId: task.localTaskId,
        svn_url: task.svn_url,
        old_revision: task.old_revision,
        new_revision: task.new_revision,
        reportPath: task.report_path,
        pdfPath: task.pdfPath,
        pdfReportName: task.pdf_report_name ?? undefined
      }).then((result) => {
        if (result.status !== 'shown') showCompletionNotice(task)
      }).catch(() => showCompletionNotice(task))
    } catch {
      showCompletionNotice(task)
    }
  }, [showCompletionNotice])
  const queue = useTaskQueue({
    executeTask: window.codeReview.executeTask,
    retryTask: window.codeReview.retryTask,
    cancelTask: window.codeReview.cancelTask,
    onTaskSuccess: handleTaskSuccess
  })
  const tasksRef = useRef(queue.tasks)
  tasksRef.current = queue.tasks
  const updateReportContentState = useCallback((taskId: string, state: ReportContentState): void => {
    reportContentStatesRef.current = { ...reportContentStatesRef.current, [taskId]: state }
    setReportContentStates(reportContentStatesRef.current)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reportListRequestRef.current += 1
    }
  }, [])

  const loadTaskStats = useCallback(async (
    { showLoading = true }: { showLoading?: boolean } = {}
  ): Promise<void> => {
    taskStatsRequestRef.current += 1
    const requestId = taskStatsRequestRef.current
    if (showLoading) setTaskStats({ status: 'loading' })
    try {
      const stats = await window.codeReview.getTodayTaskStats()
      if (taskStatsRequestRef.current !== requestId) return
      setTaskStats({
        status: 'ready',
        range: 'today',
        running: stats.running,
        failedOrError: stats.failed_or_error,
        success: stats.success
      })
    } catch (error) {
      if (taskStatsRequestRef.current !== requestId) return
      setTaskStats({
        status: 'error',
        message: error instanceof Error ? error.message : '统计服务暂不可用。'
      })
    }
  }, [])

  useEffect(() => {
    void loadTaskStats()
    return () => {
      taskStatsRequestRef.current += 1
    }
  }, [loadTaskStats])

  useEffect(() => {
    const observedStates = observedTaskStatsStateRef.current
    const currentTaskIds = new Set<string>()
    let shouldRefresh = false

    queue.tasks.forEach((task) => {
      const taskId = task.localTaskId
      const nextState = taskStatsSemanticState(task)
      const previousState = observedStates.get(taskId)
      currentTaskIds.add(taskId)
      observedStates.set(taskId, nextState)

      if (previousState === undefined) {
        // 本地任务可能在一次提交批次内已收到首个服务端事件；历史任务没有执行载荷。
        if (nextState !== 'local' && task.executePayload !== undefined) shouldRefresh = true
        return
      }
      if (previousState === nextState) return
      if (
        previousState !== 'active' &&
        nextState === 'active' &&
        task.localQueueState === 'running'
      ) shouldRefresh = true
      if (nextState.startsWith('terminal:') && nextState !== 'terminal:cancelled') {
        shouldRefresh = true
      }
    })

    observedStates.forEach((_state, taskId) => {
      if (!currentTaskIds.has(taskId)) observedStates.delete(taskId)
    })
    if (shouldRefresh) void loadTaskStats({ showLoading: false })
  }, [loadTaskStats, queue.tasks])

  const loadReportList = useCallback(async (): Promise<void> => {
    reportListRequestRef.current += 1
    const requestId = reportListRequestRef.current
    setReportListState({ status: 'loading' })
    try {
      const response = await window.codeReview.listTasks()
      if (!mountedRef.current || reportListRequestRef.current !== requestId) return
      queue.setServerTasks(response.data)
      setReportListState({ status: 'ready' })
      const reportTasks = response.data.filter(hasReadableMarkdownReport)
      const currentSelection = selectedReportIdRef.current
      const nextSelection = currentSelection && reportTasks.some((task) => task.id === currentSelection)
        ? currentSelection
        : reportTasks[0]?.id
      if (nextSelection !== currentSelection) {
        selectedReportIdRef.current = nextSelection
        setSelectedReportId(nextSelection)
      }
    } catch (error) {
      if (!mountedRef.current || reportListRequestRef.current !== requestId) return
      setReportListState({
        status: 'error',
        message: error instanceof Error ? error.message : '任务列表加载失败。'
      })
    }
  }, [queue.setServerTasks])

  useEffect(() => {
    void loadReportList()
  }, [loadReportList])

  useEffect(() => window.codeReview.onTaskProgress(queue.applyProgressEvent), [queue.applyProgressEvent])
  useEffect(() => window.codeReview.onIssueFeedbackSubmitted(({ taskId, feedbackSubmittedAt, pdfPath, pdfReportName }) => {
    queue.updateTask(taskId, (task) => ({
      ...task, feedback_submitted_at: feedbackSubmittedAt,
      evaluated_issue_count: task.issue_count ?? task.evaluated_issue_count,
      pdfPath, pdf_report_name: pdfReportName
    }))
    showNotice('问题反馈已提交，反馈版 PDF 已生成。')
  }), [queue.updateTask, showNotice])
  useEffect(() => window.codeReview.onReportFeedbackSubmitted(({ taskId, helpful, usefulIssuesText }) => {
    const task = tasksRef.current.find((candidate) => candidate.id === taskId)
    if (!task || task.feedback_protocol_version === 1) return
    queue.updateTask(taskId, (task) => ({
      ...task, report_feedback_helpful: helpful, report_feedback_useful_issues_text: usefulIssuesText
    }))
    if (selectedReportIdRef.current !== taskId) return
    setActiveFeedbackAnchorId(undefined)
    setFeedbackAnchorScrollRequest(undefined)
    void window.codeReview.openPdfReport({
      taskId: task.id,
      localPdfPath: task.pdfPath,
      pdfReportName: task.pdf_report_name ?? undefined
    }).catch((error: unknown) => {
      showNotice(error instanceof Error ? error.message : 'PDF 报告打开失败。')
    })
  }), [queue.updateTask, showNotice])
  useEffect(() => window.codeReview.onReportFeedbackFocusAnchor(({ taskId, anchorId }) => {
    if (selectedReportIdRef.current !== taskId) return
    setActiveFeedbackAnchorId(anchorId)
    if (!anchorId) {
      setFeedbackAnchorScrollRequest(undefined)
      return
    }
    setFeedbackAnchorScrollRequest((current) => ({
      anchorId,
      requestId: (current?.requestId ?? 0) + 1
    }))
  }), [])

  const findTask = useCallback((taskId: string): TaskViewItem | undefined =>
    tasksRef.current.find((task) => task.id === taskId || task.localTaskId === taskId), [])

  const selectReport = useCallback(async (
    task: TaskViewItem,
    { force = false }: { force?: boolean } = {}
  ): Promise<string | undefined> => {
    selectedReportIdRef.current = task.id
    setSelectedReportId(task.id)
    setActiveFeedbackAnchorId(undefined)
    setFeedbackAnchorScrollRequest(undefined)
    if (task.reportMarkdown && !force) {
      const analysis = analyzeLoadedReviewReport(task.reportMarkdown, reportSummaryInput(task))
      updateReportContentState(task.id, {
        contentStatus: analysis.status,
        contentMessage: analysis.message
      })
      return task.reportMarkdown
    }
    const currentContentState = reportContentStatesRef.current[task.id]
    if (!force && (currentContentState?.contentStatus === 'loading' || currentContentState?.contentStatus === 'error')) {
      return undefined
    }
    const nextRequestId = (reportContentRequestRef.current.get(task.id) ?? 0) + 1
    reportContentRequestRef.current.set(task.id, nextRequestId)
    updateReportContentState(task.id, { contentStatus: 'loading' })
    try {
      const markdown = await window.codeReview.readTaskReport(task.id)
      if (
        !mountedRef.current ||
        reportContentRequestRef.current.get(task.id) !== nextRequestId
      ) return undefined
      const analysis = analyzeLoadedReviewReport(markdown, reportSummaryInput(task))
      queue.updateTask(task.id, (current) => ({ ...current, reportMarkdown: markdown }))
      updateReportContentState(task.id, {
        contentStatus: analysis.status,
        contentMessage: analysis.message
      })
      return markdown
    } catch (error) {
      if (
        mountedRef.current &&
        reportContentRequestRef.current.get(task.id) === nextRequestId
      ) {
        updateReportContentState(task.id, {
          contentStatus: 'error',
          contentMessage: error instanceof Error ? error.message : '报告加载失败。'
        })
      }
      return undefined
    }
  }, [queue.updateTask, updateReportContentState])

  useEffect(() => {
    if (!selectedReportId) return
    const task = findTask(selectedReportId)
    if (!task || !hasReadableMarkdownReport(task)) return
    if (task.reportMarkdown || reportContentStatesRef.current[task.id] !== undefined) return
    void selectReport(task)
  }, [findTask, queue.tasks, selectReport, selectedReportId])

  useEffect(() => window.codeReview.onTaskCompletionNotificationClicked((payload) => {
    const task = findTask(payload.localTaskId ?? payload.taskId) ?? findTask(payload.taskId)
    if (!task || !hasReadableMarkdownReport(task)) return
    requestedViewSequenceRef.current += 1
    setRequestedView({ id: 'report-center', requestId: requestedViewSequenceRef.current })
    void selectReport(task)
  }), [findTask, selectReport])

  const createTask = useCallback(async (input: CreateTaskCommand): Promise<PreviewCommandResult> => {
    if (createTaskInFlightRef.current) return commandResult('任务正在创建，请勿重复提交。')
    const selectedIds = Object.keys(input.selection) as ReviewItemId[]
    if (selectedIds.length === 0) {
      showNotice('请至少选择一个审查项。')
      return commandResult('请至少选择一个审查项。')
    }
    if (selectedIds.some((selectedId) => !isProductionReviewItemId(selectedId))) {
      showNotice('生产任务包含不存在或未启用的审查项。')
      return commandResult('生产任务包含不存在或未启用的审查项。')
    }
    if (!canCreateTask) {
      showNotice('本地环境就绪后才可发起审查。')
      return commandResult('本地环境就绪后才可发起审查。')
    }
    const payload = {
      svn_url: input.svnUrl.trim(), old_revision: input.oldRevision.trim(), new_revision: input.newRevision.trim(),
      review_items: selectedIds.map((selectedId) => {
        const selectedInput = input.selection[selectedId]
        const materials = Object.entries(selectedInput?.materials ?? {}).map(([fieldId, files]) => ({
          field_id: fieldId,
          file_paths: files.map((file) => file.id)
        }))
        return {
          id: selectedId,
          ...(selectedInput?.extraRules.trim()
            ? { user_extra_rules: selectedInput.extraRules.trim() }
            : {}),
          ...(materials.length > 0 ? { materials } : {})
        }
      }),
      skill_name: BMS_CODE_REVIEW_SKILL_NAME
    }
    createTaskInFlightRef.current = true
    try {
      const preflight = await window.codeReview.preflightTask({
        svn_url: payload.svn_url, old_revision: payload.old_revision, new_revision: payload.new_revision
      })
      if (preflight.status === 'invalid') {
        const message = Object.values(preflight.errors).filter(Boolean).join('；') || 'SVN 地址或 revision 校验失败。'
        showNotice(message)
        return commandResult(message)
      }
      await queue.submitTask(payload)
      showNotice('任务已加入本机执行队列。')
      return commandResult('任务已加入本机执行队列。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '任务创建失败。'
      showNotice(message)
      return commandResult(message)
    } finally {
      createTaskInFlightRef.current = false
    }
  }, [canCreateTask, queue.submitTask, showNotice])

  const commands = useMemo<WorkbenchCommands>(() => ({
    async setScenario() { return commandResult('生产工作台不使用预览场景。') },
    createTask,
    async cancelTask(taskId) {
      const task = findTask(taskId)
      if (!task) return commandResult('未找到任务。')
      const shouldRefreshTaskStats =
        task.localQueueState === 'starting' || task.localQueueState === 'running'
      await queue.cancelTask(task)
      if (shouldRefreshTaskStats) await loadTaskStats({ showLoading: false })
      showNotice(`已取消任务 ${task.id}。`)
      return commandResult(`已取消任务 ${task.id}。`)
    },
    async retryTask(taskId) {
      const task = findTask(taskId)
      if (!task) return commandResult('未找到任务。')
      await queue.retryTask(task)
      showNotice(`任务 ${task.id} 已加入本机重试队列。`)
      return commandResult(`任务 ${task.id} 已加入本机重试队列。`)
    },
    async advanceTasks() { return commandResult('生产任务阶段由真实执行事件更新。') },
    async reloadTaskStats() {
      await loadTaskStats()
      return commandResult('今日任务统计已重新加载。')
    },
    async reloadReportList() {
      await loadReportList()
      return commandResult('报告列表已重新加载。')
    },
    async openReport(reportId) {
      const task = findTask(reportId)
      if (!task || !hasReadableMarkdownReport(task)) return commandResult('未找到报告。')
      return commandResult((await selectReport(task)) ? '报告已打开。' : '报告加载失败。')
    },
    async retryReport(reportId) {
      const task = findTask(reportId)
      if (!task || !hasReadableMarkdownReport(task)) return commandResult('未找到报告。')
      return commandResult((await selectReport(task, { force: true })) ? '报告已重新加载。' : '报告加载失败。')
    },
    async closeReport() {
      selectedReportIdRef.current = undefined
      setSelectedReportId(undefined)
      setActiveFeedbackAnchorId(undefined)
      setFeedbackAnchorScrollRequest(undefined)
      return commandResult('报告已关闭。')
    },
    async viewPdfReport(reportId) {
      const task = findTask(reportId)
      if (!task) return commandResult('未找到报告。')
      try {
        await window.codeReview.openPdfReport({
          taskId: task.id, localPdfPath: task.pdfPath, pdfReportName: task.pdf_report_name ?? undefined,
          ...(task.feedback_protocol_version === 1 ? { action: 'reveal' as const } : {})
        })
        return commandResult('PDF 报告已打开。')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PDF 报告打开失败。'
        showNotice(message)
        return commandResult(message)
      }
    },
    async openReportFeedback(reportId) {
      const task = findTask(reportId)
      if (!task) return commandResult('未找到报告。')
      if (task.feedback_protocol_version !== 1 && task.report_feedback_helpful !== null && task.report_feedback_helpful !== undefined) return commandResult('该报告反馈已提交。')
      try {
        const markdown = task.reportMarkdown ?? await window.codeReview.readTaskReport(task.id)
        if (!task.reportMarkdown) queue.updateTask(task.id, (current) => ({ ...current, reportMarkdown: markdown }))
        const options = extractDetailedHeadingOptions(markdown)
        await window.codeReview.openReportFeedbackWindow(task.feedback_protocol_version === 1 ? {
          mode: 'issues', taskId: task.id,
          anchors: options.map((option, order) => ({ order, anchorId: option.anchorId }))
        } : { mode: 'legacy', taskId: task.id, options })
        return commandResult('报告反馈窗口已打开。')
      } catch (error) {
        const message = error instanceof Error ? error.message : '反馈窗口打开失败，请重试。'
        showNotice(message)
        return commandResult(message)
      }
    },
    async submitNegativeReportFeedback(reportId) {
      const task = findTask(reportId)
      if (!task) return commandResult('未找到报告。')
      if (task.feedback_protocol_version === 1) return commandResult('逐问题反馈不支持整份报告没帮助。')
      if (task.report_feedback_helpful !== null && task.report_feedback_helpful !== undefined) return commandResult('该报告反馈已提交。')
      if (negativeFeedbackInFlightRef.current.has(task.id)) return commandResult('反馈正在提交。')
      negativeFeedbackInFlightRef.current.add(task.id)
      try {
        const event = await window.codeReview.submitNegativeReportFeedback(task.id)
        queue.updateTask(task.id, (current) => ({
          ...current,
          report_feedback_helpful: event.helpful,
          report_feedback_useful_issues_text: event.usefulIssuesText
        }))
        showNotice('报告反馈已提交。')
        return commandResult('报告反馈已提交。')
      } catch (error) {
        const message = error instanceof Error ? error.message : '报告反馈提交失败。'
        showNotice(message)
        return commandResult(message)
      } finally {
        negativeFeedbackInFlightRef.current.delete(task.id)
      }
    },
    async openTaskLog(taskId) {
      const task = findTask(taskId)
      if (!task) return commandResult('未找到任务。')
      try {
        const openResult = await window.codeReview.openTaskLog(task.id)
        const message = openResult.status === 'missing' ? '未找到该任务的本地 Codex 执行日志。' : '任务日志已打开。'
        showNotice(message)
        return commandResult(message)
      } catch (error) {
        const message = error instanceof Error ? error.message : '打开任务日志失败。'
        showNotice(message)
        return commandResult(message)
      }
    },
    async hideTask(taskId) {
      const task = findTask(taskId)
      if (!task) return commandResult('未找到任务。')
      try {
        // 只隐藏本机展示，服务端任务与报告保持不变。
        await window.codeReview.hideTask(task.id)
        queue.removeTask(task.id)
        const message = '任务已从本机列表移除，服务端记录保留。'
        showNotice(message)
        return commandResult(message)
      } catch (error) {
        const message = error instanceof Error ? error.message : '移除任务失败。'
        showNotice(message)
        return commandResult(message)
      }
    },
    async chooseFeedbackScreenshot() { throw new Error('生产工作台通过本机文件选择器添加截图。') },
    async submitFeedback(input: SubmitFeedbackCommand) {
      if (feedbackInFlightRef.current) return commandResult('意见正在提交，请勿重复操作。')
      const screenshots = input.screenshots.map((screenshot) => screenshot.file).filter((file): file is File => Boolean(file))
      feedbackInFlightRef.current = true
      try {
        await window.codeReview.submitFeedback({
          description: input.description.trim(), ...(screenshots.length > 0 ? { screenshots } : {})
        })
        showNotice(`意见已提交${screenshots.length ? `，包含 ${screenshots.length} 张截图` : ''}。`)
        return commandResult('意见已提交。')
      } finally {
        feedbackInFlightRef.current = false
      }
    },
    async chooseMaterial(itemId, fieldId) {
      const result = await window.codeReview.selectReviewMaterialFile({
        review_item_id: itemId,
        field_id: fieldId
      })
      if (result.status === 'cancelled') return null
      return {
        id: result.filePath,
        name: result.fileName,
        sizeLabel: formatFileSize(result.fileSize)
      }
    },
    async dismissNotice() {
      setNotice(undefined)
      setNoticeAction(undefined)
    }
  }), [createTask, findTask, loadReportList, loadTaskStats, queue.cancelTask, queue.retryTask, queue.updateTask, selectReport, showNotice])

  const viewModel: WorkbenchViewModel = {
    productName: 'AI 代码审查', previewLabel: '2.0 工作台',
    userName: currentUser.full_name || currentUser.svn_username || '当前用户',
    departmentName: currentUser.department_name || '未命名部门',
    scenarios: [], activeScenario: 'active', catalog, sampleTask: emptySample,
    tasks: queue.tasks.map(toTaskViewModel),
    // 必须用 historyTasks（按 finished_at → started_at → createdAtMs 倒序）而非 queue.tasks：
    // 后者是插入顺序，本次会话内新完成的任务会停在数组末尾，导致新报告排到列表最下方。
    reports: queue.historyTasks.filter(hasReadableMarkdownReport).map((task) =>
      toReportViewModel(task, reportContentStates[task.id])
    ),
    selectedReportId, notice, noticeAction, activeFeedbackAnchorId, feedbackAnchorScrollRequest,
    mode: 'production', canCreateTask, requestedView, taskStats, reportListState,
    ...(!canCreateTask ? { taskCreationDisabledReason: '本地环境就绪后才可发起审查。' } : {})
  }
  const viewModelRef = useRef(viewModel); viewModelRef.current = viewModel
  const commandsRef = useRef(commands); commandsRef.current = commands
  const listenersRef = useRef(new Set<(next: WorkbenchViewModel) => void>())
  const adapter = useMemo<WorkbenchAdapter>(() => ({
    getViewModel: () => viewModelRef.current,
    subscribe(listener) { listenersRef.current.add(listener); return () => listenersRef.current.delete(listener) },
    commands: new Proxy({} as WorkbenchCommands, {
      get: (_target, property) => commandsRef.current[property as keyof WorkbenchCommands]
    })
  }), [])
  useEffect(() => { listenersRef.current.forEach((listener) => listener(viewModel)) }, [viewModel])

  return <div className="wb-production-shell">
    <ReviewWorkbenchPreview
      adapter={adapter}
      environmentStatus={
      <EnvironmentStatus result={environment} isChecking={isCheckingEnvironment}
        isInstallingSkillDuringCheck={isInstallingSkillDuringCheck} isInstallingCodex={isInstallingCodex}
        isInstallingSvn={isInstallingSvn} onRefresh={onRefreshEnvironment} onInstallCodex={onInstallCodex}
        onInstallSvn={onInstallSvn} onInstallSkill={onInstallSkill} />
      }
    />
  </div>
}
