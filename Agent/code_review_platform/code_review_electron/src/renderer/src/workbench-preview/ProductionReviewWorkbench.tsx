import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BMS_CODE_REVIEW_SKILL_NAME, REVIEW_ITEM_CATALOG } from '../../../shared/review-items'
import { extractReviewIssues } from '../../../shared/review-issues'
import type { CurrentUser } from '../../../shared/types'
import type { EnvironmentCheckResult } from '../code-review-api'
import { EnvironmentStatus } from '../components/EnvironmentStatus'
import { extractDetailedHeadingOptions } from '../components/MarkdownPreview'
import { useTaskQueue, type TaskViewItem } from '../hooks/useTaskQueue'
import { ReviewWorkbenchPreview } from './ReviewWorkbenchPreview'
import { formatRevisionLabel } from './revision'
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
}

const productionReviewItemIds = new Set<ReviewItemId>(['DS-01', 'DS-03'])
const isProductionReviewItemId = (id: string): id is ReviewItemId =>
  productionReviewItemIds.has(id as ReviewItemId)

const productionCatalog: ReviewItemDefinition[] = REVIEW_ITEM_CATALOG.filter(
  (item) => item.enabled && isProductionReviewItemId(item.id)
).map((item) => ({
  id: item.id as ReviewItemId,
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

const phaseOrder: Array<Exclude<TaskStage, 'waiting' | 'failed' | 'cancelled'>> = [
  'checking_environment', 'preparing_workspace', 'running_review', 'uploading_report', 'completed'
]
const phaseLabels: Record<(typeof phaseOrder)[number], string> = {
  checking_environment: '环境检查', preparing_workspace: '准备工作区',
  running_review: '执行 Skill', uploading_report: '整理报告', completed: '完成'
}
const stageLabels: Record<TaskStage, string> = {
  waiting: '本机等待', checking_environment: '环境检查', preparing_workspace: '准备工作区',
  running_review: '执行审查', uploading_report: '整理报告', completed: '已完成',
  failed: '失败', cancelled: '已取消'
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
const itemIds = (task: TaskViewItem): ReviewItemId[] =>
  (task.review_item_ids ?? []).filter(isProductionReviewItemId)
const taskTitle = (task: TaskViewItem): string => {
  const reportName = task.report_name?.replace(/\.(md|markdown)$/i, '').trim()
  if (reportName) return reportName
  const ids = itemIds(task)
  if (ids.length === 1) {
    const definition = productionCatalog.find((item) => item.id === ids[0])
    return definition ? `${definition.id} ${definition.name}` : `审查任务 ${task.id}`
  }
  return ids.length > 1 ? `${ids.join(' + ')} 审查` : `审查任务 ${task.id}`
}
const extractedIssueCount = (markdown: string | undefined): number | undefined => {
  if (!markdown) return undefined
  try {
    return extractReviewIssues(markdown).length
  } catch {
    return undefined
  }
}
const toTaskViewModel = (task: TaskViewItem): ReviewTaskViewModel => {
  const stage = taskStage(task)
  return {
    id: task.id, title: taskTitle(task), svnUrl: task.svn_url,
    oldRevision: task.old_revision, newRevision: task.new_revision,
    reviewItemIds: itemIds(task), stage, stageLabel: stageLabels[stage],
    message: task.progress_message ?? task.error_message ?? (stage === 'completed' ? '报告已生成，可查看。' : stageLabels[stage]),
    updatedAt: formatTime(task), ...(stage === 'waiting' ? { queueIndex: task.queueIndex } : {}),
    phaseTrack: phaseTrack(stage)
  }
}
const toReportViewModel = (task: TaskViewItem): ReviewReportViewModel => ({
  id: task.id, taskId: task.id, title: taskTitle(task), svnUrl: task.svn_url,
  revisionRange: `${formatRevisionLabel(task.old_revision)} → ${formatRevisionLabel(task.new_revision)}`, reviewItemIds: itemIds(task),
  completedAt: formatTime(task),
  issueCount: task.issue_count ?? extractedIssueCount(task.reportMarkdown),
  summary: task.issue_count === undefined
    ? '报告已生成，问题等级以报告正文为准。'
    : task.issue_count === 0 ? '报告未提取到审查问题。' : `报告包含 ${task.issue_count} 个审查问题，问题等级以报告正文为准。`,
  markdown: task.reportMarkdown ?? '',
  reportPath: task.report_path,
  feedbackProtocolVersion: task.feedback_protocol_version,
  feedbackSubmittedAt: task.feedback_submitted_at,
  reportFeedbackHelpful: task.report_feedback_helpful
})
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
    onInstallSvn, onInstallSkill
  } = props
  const [notice, setNotice] = useState<string>()
  const [noticeAction, setNoticeAction] = useState<WorkbenchViewModel['noticeAction']>()
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [activeFeedbackAnchorId, setActiveFeedbackAnchorId] = useState<string>()
  const [feedbackAnchorScrollRequest, setFeedbackAnchorScrollRequest] = useState<WorkbenchViewModel['feedbackAnchorScrollRequest']>()
  const [requestedView, setRequestedView] = useState<WorkbenchViewModel['requestedView']>()
  const selectedReportIdRef = useRef<string | undefined>(undefined)
  const requestedViewSequenceRef = useRef(0)
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

  useEffect(() => {
    let active = true
    void window.codeReview.listTasks().then(async (response) => {
      if (!active) return
      queue.setServerTasks(response.data)
      const firstReportTask = response.data.find((task) => task.status === 'success')
      if (firstReportTask) {
        selectedReportIdRef.current = firstReportTask.id
        setSelectedReportId(firstReportTask.id)
        const markdown = await window.codeReview.readTaskReport(firstReportTask.id)
        if (active) {
          queue.updateTask(firstReportTask.id, (current) => ({ ...current, reportMarkdown: markdown }))
        }
      }
    }).catch((error: unknown) => {
      if (active) showNotice(error instanceof Error ? error.message : '任务列表加载失败。')
    })
    return () => { active = false }
  }, [queue.setServerTasks, queue.updateTask, showNotice])

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

  const selectReport = useCallback(async (task: TaskViewItem): Promise<string | undefined> => {
    selectedReportIdRef.current = task.id
    setSelectedReportId(task.id)
    setActiveFeedbackAnchorId(undefined)
    setFeedbackAnchorScrollRequest(undefined)
    if (task.reportMarkdown) return task.reportMarkdown
    try {
      const markdown = await window.codeReview.readTaskReport(task.id)
      queue.updateTask(task.id, (current) => ({ ...current, reportMarkdown: markdown }))
      return markdown
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '报告加载失败。')
      return undefined
    }
  }, [queue.updateTask, showNotice])

  useEffect(() => window.codeReview.onTaskCompletionNotificationClicked((payload) => {
    const task = findTask(payload.localTaskId ?? payload.taskId) ?? findTask(payload.taskId)
    if (!task || task.status !== 'success') return
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
      await queue.cancelTask(task)
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
    async openReport(reportId) {
      const task = findTask(reportId)
      if (!task) return commandResult('未找到报告。')
      return commandResult((await selectReport(task)) ? '报告已打开。' : '报告加载失败。')
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
  }), [createTask, findTask, queue.cancelTask, queue.retryTask, queue.updateTask, selectReport, showNotice])

  const viewModel: WorkbenchViewModel = {
    productName: 'AI 代码审查', previewLabel: '2.0 工作台',
    userName: currentUser.full_name || currentUser.svn_username || '当前用户',
    departmentName: currentUser.department_name || '未命名部门',
    scenarios: [], activeScenario: 'active', catalog: productionCatalog, sampleTask: emptySample,
    tasks: queue.tasks.map(toTaskViewModel),
    reports: queue.tasks.filter((task) => task.status === 'success').map(toReportViewModel),
    selectedReportId, notice, noticeAction, activeFeedbackAnchorId, feedbackAnchorScrollRequest,
    mode: 'production', canCreateTask, requestedView,
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

  const showEnvironment = !canCreateTask || isCheckingEnvironment || isInstallingSkillDuringCheck || isInstallingCodex || isInstallingSvn
  return <div className="wb-production-shell">
    {showEnvironment && <div className="wb-environment-banner">
      <EnvironmentStatus result={environment} isChecking={isCheckingEnvironment}
        isInstallingSkillDuringCheck={isInstallingSkillDuringCheck} isInstallingCodex={isInstallingCodex}
        isInstallingSvn={isInstallingSvn} onRefresh={onRefreshEnvironment} onInstallCodex={onInstallCodex}
        onInstallSvn={onInstallSvn} onInstallSkill={onInstallSkill} />
    </div>}
    <ReviewWorkbenchPreview adapter={adapter} />
  </div>
}
