import {
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardList,
  FileCheck2,
  FileDown,
  FileText,
  FolderSearch,
  ImagePlus,
  LoaderCircle,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchX,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import paceLogo from '../assets/pace-logo.png'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { ThemeToggleButton } from '../components/ThemeToggleButton'
import { readRecentSvnUrls } from '../recent-svn-urls'
import type { ClientTheme } from '../theme'
import { DEFAULT_CLIENT_THEME } from '../theme'
import { ReviewItemSelector } from './ReviewItemSelector'
import { formatRevisionLabel, isRevisionValue, normalizeRevisionDigits } from './revision'
import type {
  CreateTaskCommand,
  FeedbackScreenshotView,
  ReviewItemDefinition,
  ReviewItemId,
  ReviewReportViewModel,
  ReviewSelection,
  ReviewTaskViewModel,
  WorkbenchAdapter,
  WorkbenchViewId,
  WorkbenchViewModel
} from './types'

interface ReviewWorkbenchPreviewProps {
  adapter: WorkbenchAdapter
  environmentStatus?: ReactNode
  theme?: ClientTheme
  onToggleTheme?: () => void
}

interface FormErrors {
  svnUrl?: string
  oldRevision?: string
  newRevision?: string
  selection?: string
  materials?: string[]
}

const activeStages = [
  'checking_environment',
  'preparing_workspace',
  'running_review',
  'uploading_report'
]

const activeProgressMessages = {
  checking_environment: ['正在检查本机审查环境。', '环境检查进行中，请保持客户端打开。'],
  preparing_workspace: ['正在准备任务专属工作区。', '正在整理本次审查输入。'],
  running_review: ['正在执行审查规则与代码证据。', '审查正在继续，请保持客户端打开。'],
  uploading_report: ['正在整理审查报告并上传。', '报告上传进行中，请保持客户端打开。']
} as const

const isActiveStage = (stage: ReviewTaskViewModel['stage']): stage is keyof typeof activeProgressMessages =>
  activeStages.includes(stage)

const severityLabels: Record<ReviewReportViewModel['highestSeverity'], string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  suggestion: '建议',
  none: '无最高严重度',
  unknown: '严重度未知'
}

const formatIssueSummary = (report: ReviewReportViewModel): string => {
  if (report.contentStatus === 'parse_error') return '报告结构解析失败'
  if (report.issueCount === undefined) return `问题数未记录 · ${severityLabels[report.highestSeverity]}`
  if (
    report.feedbackProtocolVersion === 1 &&
    (report.highestSeverity === 'none' || report.highestSeverity === 'unknown')
  ) {
    return `${report.issueCount} 个问题`
  }
  return `${report.issueCount} 个问题 · ${severityLabels[report.highestSeverity]}`
}

const formatReviewItemScope = (
  reviewItemIds: string[],
  catalog: ReviewItemDefinition[]
): string => {
  if (reviewItemIds.length === 0) return '历史任务未记录审查项'
  return reviewItemIds.map((id) => {
    const item = catalog.find((candidate) => candidate.id === id)
    return item ? `${id} · ${item.name}` : id
  }).join(' / ')
}

const cloneSelection = (selection: ReviewSelection): ReviewSelection => structuredClone(selection)

const validateForm = (
  draft: Omit<CreateTaskCommand, 'selection'>,
  selection: ReviewSelection,
  catalog: ReviewItemDefinition[]
): FormErrors => {
  const errors: FormErrors = {}
  const svnUrl = draft.svnUrl.trim()
  if (!svnUrl) {
    errors.svnUrl = '请输入 SVN 地址。'
  } else if (!/^(svn|https?):\/\//i.test(svnUrl)) {
    errors.svnUrl = 'SVN 地址必须以 svn://、http:// 或 https:// 开头，请检查完整路径后重试。'
  }

  if (!isRevisionValue(draft.oldRevision)) {
    errors.oldRevision = '旧 revision 必须是大于或等于 0 的整数。'
  }
  if (!isRevisionValue(draft.newRevision) || Number(normalizeRevisionDigits(draft.newRevision)) === 0) {
    errors.newRevision = '新 revision 必须是大于 0 的整数。'
  } else if (
    isRevisionValue(draft.oldRevision) &&
    Number(normalizeRevisionDigits(draft.oldRevision)) !== 0 &&
    Number(normalizeRevisionDigits(draft.newRevision)) <= Number(normalizeRevisionDigits(draft.oldRevision))
  ) {
    errors.newRevision = '新 revision 必须大于旧 revision；旧 revision 为 0 时将保持原值交由 Skill 判断。'
  }

  const selectedIds = Object.keys(selection) as ReviewItemId[]
  if (selectedIds.length === 0) {
    errors.selection = '至少选择一个审查项。'
  } else {
    const materialErrors: string[] = []
    selectedIds.forEach((itemId) => {
      const definition = catalog.find((item) => item.id === itemId)
      const input = selection[itemId]
      definition?.materialFields.forEach((field) => {
        const files = input?.materials[field.id] ?? []
        if (field.required && files.length === 0) {
          materialErrors.push(`${itemId} ${field.label}未选择`)
        }
        if (field.multiplicity === 'single' && files.length > 1) {
          materialErrors.push(`${itemId} ${field.label}只能选择一个文件`)
        }
        files.forEach((file) => {
          const normalizedName = file.name.toLowerCase()
          if (!field.extensions.some((extension) => normalizedName.endsWith(extension.toLowerCase()))) {
            materialErrors.push(`${itemId} ${field.label}仅支持 ${field.extensions.join('、')} 文件`)
          }
        })
      })
    })
    if (materialErrors.length > 0) errors.materials = materialErrors
  }
  return errors
}

const selectedItems = (selection: ReviewSelection, catalog: ReviewItemDefinition[]) =>
  (Object.keys(selection) as ReviewItemId[])
    .map((itemId) => catalog.find((item) => item.id === itemId))
    .filter((item): item is ReviewItemDefinition => Boolean(item))

const taskStageClass = (task: ReviewTaskViewModel): string => {
  if (task.stage === 'failed') return 'is-failed'
  if (task.stage === 'cancelled') return 'is-cancelled'
  if (task.stage === 'waiting') return 'is-waiting'
  if (task.stage === 'completed') return 'is-complete'
  return 'is-running'
}

const TaskTableRow = ({
  task,
  adapter,
  catalog,
  reportId,
  onOpenReport
}: {
  task: ReviewTaskViewModel
  adapter: WorkbenchAdapter
  catalog: ReviewItemDefinition[]
  reportId?: string
  onOpenReport: (reportId: string) => void
}): React.JSX.Element => {
  const [activeMessageIndex, setActiveMessageIndex] = useState(0)
  const activeStage = isActiveStage(task.stage) ? task.stage : undefined

  useEffect(() => {
    if (!activeStage) return
    setActiveMessageIndex(0)
    const intervalId = window.setInterval(() => {
      setActiveMessageIndex((current) => (current + 1) % activeProgressMessages[activeStage].length)
    }, 4000)
    return () => window.clearInterval(intervalId)
  }, [activeStage])

  const progressMessage = activeStage
    ? activeProgressMessages[activeStage][activeMessageIndex]
    : task.queueIndex ? `本机等待第 ${task.queueIndex} 位` : task.message

  return (
  <article className={`wb-task-table-row ${taskStageClass(task)}`} aria-label={`${task.id} ${task.title}`}>
    <div className="wb-task-identity">
      <strong title={task.title}>{task.title}</strong>
      <span className="wb-row-svn" title={task.svnUrl}>{task.svnUrl}</span>
      <span className="wb-row-meta">{task.id} · {formatRevisionLabel(task.oldRevision)} → {formatRevisionLabel(task.newRevision)} · {formatReviewItemScope(task.reviewItemIds, catalog)}</span>
    </div>
    <span className="wb-status-label">{task.stageLabel}</span>
    <div className="wb-task-progress">
      {activeStage ? (
        <div className="wb-task-activity" aria-live="polite">
          <LoaderCircle className="wb-task-activity-spinner" aria-hidden="true" />
          <strong>{progressMessage}</strong>
        </div>
      ) : <strong>{progressMessage}</strong>}
      {activeStage && (
        <ol className="wb-compact-stage-track" aria-label={`${task.id} 执行阶段`}>
          {task.phaseTrack.map((phase) => (
            <li className={`is-${phase.state}`} key={phase.id} title={phase.label}><span /></li>
          ))}
        </ol>
      )}
    </div>
    <time title={task.updatedAt} aria-label={`更新时间 ${task.updatedAt}`}>
      {task.updatedAt}
    </time>
    <div className="wb-task-actions">
      {['waiting', ...activeStages].includes(task.stage) && (
        <button
          className="wb-icon-button"
          type="button"
          title={`取消任务 ${task.id}`}
          onClick={() => void adapter.commands.cancelTask(task.id)}
        >
          <X aria-hidden="true" />
          <span className="wb-sr-only">取消任务 {task.id}</span>
        </button>
      )}
      {(['failed', ...activeStages].includes(task.stage) && adapter.commands.openTaskLog) && (
        <button className="wb-icon-button" type="button" title={`打开任务日志 ${task.id}`} onClick={() => void adapter.commands.openTaskLog?.(task.id)}>
          <FileText aria-hidden="true" /><span className="wb-sr-only">打开任务日志 {task.id}</span>
        </button>
      )}
      {task.stage === 'failed' && (
        <>
          <button
            className="wb-icon-button"
            type="button"
            title={`从头重试 ${task.id}`}
            onClick={() => void adapter.commands.retryTask(task.id)}
          >
            <RotateCcw aria-hidden="true" />
            <span className="wb-sr-only">从头重试 {task.id}</span>
          </button>
        </>
      )}
      {task.stage === 'completed' && reportId && (
        <button
          className="wb-text-button"
          type="button"
          onClick={() => onOpenReport(reportId)}
        >
          查看报告
        </button>
      )}
      {['failed', 'cancelled'].includes(task.stage) && adapter.commands.hideTask && (
        <button
          className="wb-icon-button"
          type="button"
          title={`从本机列表移除（不影响服务端记录） ${task.id}`}
          onClick={() => void adapter.commands.hideTask?.(task.id)}
        >
          <Trash2 aria-hidden="true" />
          <span className="wb-sr-only">从本机列表移除 {task.id}</span>
        </button>
      )}
    </div>
  </article>
  )
}

interface TaskManagementViewProps {
  viewModel: WorkbenchViewModel
  adapter: WorkbenchAdapter
  runningTasks: ReviewTaskViewModel[]
  waitingTasks: ReviewTaskViewModel[]
  onOpenReportCenter: () => void
  environmentStatus?: ReactNode
}

type TaskLane = 'current' | 'completed' | 'attention'

function TaskManagementView({
  viewModel,
  adapter,
  runningTasks,
  waitingTasks,
  onOpenReportCenter,
  environmentStatus
}: TaskManagementViewProps): React.JSX.Element {
  const currentTasks = [
    ...runningTasks,
    ...[...waitingTasks].sort((left, right) => (left.queueIndex ?? 0) - (right.queueIndex ?? 0))
  ]
  const completedTasks = viewModel.tasks.filter((task) => task.stage === 'completed')
  const failedTasks = viewModel.tasks.filter((task) => task.stage === 'failed')
  const automaticTaskLane: TaskLane =
    currentTasks.length > 0
      ? 'current'
      : failedTasks.length > 0 ? 'attention' : completedTasks.length > 0 ? 'completed' : 'current'
  const [manualTaskLane, setManualTaskLane] = useState<TaskLane>()
  const selectedTaskLane = manualTaskLane ?? automaticTaskLane
  const reportIdsByTaskId = new Map(
    viewModel.reports.flatMap((report) => [
      [report.taskId, report.id],
      [report.id, report.id]
    ] satisfies Array<[string, string]>)
  )

  const selectTaskLane = (nextLane: TaskLane): void => {
    setManualTaskLane(nextLane)
  }
  const visibleTasks =
    selectedTaskLane === 'current'
      ? currentTasks
      : selectedTaskLane === 'completed' ? completedTasks : failedTasks
  const failedCount = failedTasks.length
  const taskStats = viewModel.taskStats
  const serviceFailed = taskStats === undefined
    ? failedCount
    : taskStats.status === 'ready' ? taskStats.failedOrError : '—'
  const serviceSuccess = taskStats === undefined
    ? viewModel.reports.length
    : taskStats.status === 'ready' ? taskStats.success : '—'
  const emptyLaneCopy: Record<TaskLane, { title: string; description: string }> = {
    current: {
      title: '暂无当前任务',
      description: '新任务会按本机队列顺序显示在这里。'
    },
    completed: {
      title: '暂无已完成任务',
      description: '成功生成报告的任务会在这里提供查看入口。'
    },
    attention: {
      title: '暂无待处理失败任务',
      description: '失败任务会保留完整原因和恢复操作。'
    }
  }
  const openTaskReport = (reportId: string): void => {
    void adapter.commands.openReport(reportId)
    onOpenReportCenter()
  }

  return (
    <section className="wb-workspace wb-task-management" aria-labelledby="workbench-title">
      <div className="wb-workspace-title">
        <div><p className="wb-eyebrow">本机任务</p><h2 id="workbench-title">审查任务总览</h2></div>
        {viewModel.mode !== 'production' && (
          <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.advanceTasks()}>
            <RefreshCw aria-hidden="true" />推进任务阶段
          </button>
        )}
      </div>

      <div className="wb-overview-block">
        {environmentStatus && <div className="wb-environment-inline">{environmentStatus}</div>}
        {taskStats?.status === 'loading' && (
          <div className="wb-stats-state" role="status">正在加载今日服务端统计。</div>
        )}
        {taskStats?.status === 'error' && (
          <div className="wb-stats-state is-error" role="alert">
            <span title={taskStats.message}>今日任务统计加载失败，任务创建与本机队列仍可使用。</span>
            {adapter.commands.reloadTaskStats && (
              <button type="button" onClick={() => void adapter.commands.reloadTaskStats?.()}>
                <RefreshCw aria-hidden="true" />重新加载统计
              </button>
            )}
          </div>
        )}
        <section className="wb-overview" aria-label="任务总览">
          <div><span>正在执行</span><strong className="is-running">{runningTasks.length}</strong><small>本机正在执行</small></div>
          <div><span>本机等待</span><strong className="is-waiting">{waitingTasks.length}</strong><small>按创建顺序执行</small></div>
          <div><span>今日失败</span><strong className="is-failed">{serviceFailed}</strong><small>{taskStats ? '今日服务端失败或环境异常' : '失败任务可重试'}</small></div>
          <button className="wb-completed-link" type="button" onClick={onOpenReportCenter}>
            <span>今日完成</span><strong>{serviceSuccess}</strong><small>进入报告中心查看</small><ArrowRight aria-hidden="true" />
          </button>
        </section>
      </div>

      <section className="wb-task-section wb-execution-section" aria-labelledby="execution-heading">
        <div className="wb-band-heading">
          <div><h3 id="execution-heading">单轨任务台</h3><span>一次只关注一类任务</span></div>
          <div className="wb-task-lane-tabs" role="tablist" aria-label="任务列表视图">
            <button
              id="current-task-tab"
              type="button"
              role="tab"
              aria-selected={selectedTaskLane === 'current'}
              aria-controls="current-task-panel"
              className={selectedTaskLane === 'current' ? 'is-active' : ''}
              onClick={() => selectTaskLane('current')}
            >
              当前任务 <span>{currentTasks.length}</span>
            </button>
            <button
              id="completed-task-tab"
              type="button"
              role="tab"
              aria-selected={selectedTaskLane === 'completed'}
              aria-controls="completed-task-panel"
              className={selectedTaskLane === 'completed' ? 'is-active' : ''}
              onClick={() => selectTaskLane('completed')}
            >
              已完成任务 <span>{completedTasks.length}</span>
            </button>
            <button
              id="attention-task-tab"
              type="button"
              role="tab"
              aria-selected={selectedTaskLane === 'attention'}
              aria-controls="attention-task-panel"
              className={selectedTaskLane === 'attention' ? 'is-active' : ''}
              onClick={() => selectTaskLane('attention')}
            >
              待处理失败任务 <span>{failedCount}</span>
            </button>
          </div>
        </div>
        <div className="wb-table-head wb-task-table-head" aria-hidden="true">
          <span>任务</span><span>状态</span><span>当前进度</span><span>更新</span><span>操作</span>
        </div>
        <div
          id={`${selectedTaskLane}-task-panel`}
          role="tabpanel"
          aria-labelledby={`${selectedTaskLane}-task-tab`}
          className="wb-task-lane-panel"
        >
          {visibleTasks.length === 0 ? (
            <div className="wb-empty-band"><SearchX aria-hidden="true" /><div><strong>{emptyLaneCopy[selectedTaskLane].title}</strong><span>{emptyLaneCopy[selectedTaskLane].description}</span></div></div>
          ) : (
            <div className="wb-task-table-body">
              {visibleTasks.map((task) => (
                <TaskTableRow
                  key={task.id}
                  task={task}
                  adapter={adapter}
                  catalog={viewModel.catalog}
                  reportId={reportIdsByTaskId.get(task.id)}
                  onOpenReport={openTaskReport}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </section>
  )
}

function ReportCenterView({
  reports,
  selectedReport,
  onSelect,
  adapter,
  viewModel
}: {
  reports: ReviewReportViewModel[]
  selectedReport?: ReviewReportViewModel
  onSelect: (reportId: string) => void
  adapter: WorkbenchAdapter
  viewModel: WorkbenchViewModel
}): React.JSX.Element {
  const feedbackSubmitted = Boolean(
    selectedReport?.feedbackProtocolVersion === 1
      ? selectedReport.feedbackSubmittedAt
      : selectedReport?.reportFeedbackHelpful !== null && selectedReport?.reportFeedbackHelpful !== undefined
  )
  const usesIssueFeedback = selectedReport?.feedbackProtocolVersion === 1
  return (
    <section className="wb-workspace wb-report-center" aria-labelledby="report-center-title">
      <div className="wb-workspace-title">
        <div><p className="wb-eyebrow">审查结果</p><h2 id="report-center-title">报告中心</h2></div>
        <div className="wb-report-actions">
          {selectedReport && adapter.commands.openReportFeedback && !feedbackSubmitted && selectedReport.feedbackProtocolVersion === 1 && (
            <button className="wb-secondary-button" type="button" disabled={!selectedReport} onClick={() => selectedReport && void adapter.commands.openReportFeedback?.(selectedReport.id)}>
              <MessageSquareText aria-hidden="true" />反馈报告问题
            </button>
          )}
          {selectedReport && adapter.commands.openReportFeedback && feedbackSubmitted && usesIssueFeedback && (
            <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.openReportFeedback?.(selectedReport.id)}>
              <MessageSquareText aria-hidden="true" />查看已提交反馈
            </button>
          )}
          {selectedReport && adapter.commands.openReportFeedback && !feedbackSubmitted && selectedReport.feedbackProtocolVersion !== 1 && (
            <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.openReportFeedback?.(selectedReport.id)}>
              <MessageSquareText aria-hidden="true" />报告有帮助
            </button>
          )}
          {selectedReport && adapter.commands.submitNegativeReportFeedback && !feedbackSubmitted && selectedReport.feedbackProtocolVersion !== 1 && (
            <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.submitNegativeReportFeedback?.(selectedReport.id)}>
              <X aria-hidden="true" />报告没帮助
            </button>
          )}
          {selectedReport && feedbackSubmitted && !usesIssueFeedback && (
            <span className="wb-feedback-submitted">反馈已提交</span>
          )}
          {selectedReport && (!usesIssueFeedback || feedbackSubmitted) && (
            <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.viewPdfReport(selectedReport.id)}>
              <FileDown aria-hidden="true" />查看PDF报告
            </button>
          )}
        </div>
      </div>
      <div className="wb-report-center-grid">
        <aside className="wb-report-index" aria-label="任务和报告列表">
          <header><strong>任务 / 报告</strong><span>{reports.length} 份</span></header>
          <div>
            {viewModel.reportListState?.status === 'loading' && (
              <div className="wb-report-state" role="status">正在加载报告列表。</div>
            )}
            {viewModel.reportListState?.status === 'error' && (
              <div className="wb-report-state is-error" role="alert" aria-label="报告列表加载失败">
                <div><strong>报告列表加载失败</strong><span>{viewModel.reportListState.message}</span></div>
                {adapter.commands.reloadReportList && (
                  <button type="button" onClick={() => void adapter.commands.reloadReportList?.()}>
                    <RefreshCw aria-hidden="true" />重新加载报告列表
                  </button>
                )}
              </div>
            )}
            {reports.map((report) => (
              <button className={selectedReport?.id === report.id ? 'is-active' : ''} type="button" aria-current={selectedReport?.id === report.id ? 'page' : undefined} key={report.id} onClick={() => onSelect(report.id)}>
                <span className="wb-report-index-title"><FileText aria-hidden="true" /><strong title={report.title}>{report.title}</strong></span>
                <span className="wb-report-index-svn" title={report.svnUrl}>{report.svnUrl}</span>
                <small>{report.taskId} · {report.revisionRange}</small>
                <small title={formatReviewItemScope(report.reviewItemIds, viewModel.catalog)}>{formatReviewItemScope(report.reviewItemIds, viewModel.catalog)}</small>
                <span className="wb-report-index-meta"><span>{report.completedAt}</span><strong className={`is-${report.highestSeverity}`}>{formatIssueSummary(report)}</strong></span>
              </button>
            ))}
          </div>
        </aside>
        <article className={`wb-markdown-panel${selectedReport?.contentStatus === 'parse_error' ? ' has-parse-warning' : ''}`} aria-label="Markdown 报告预览">
          {selectedReport?.contentStatus === 'loading' ? (
            <div className="wb-report-content-state" role="status"><RefreshCw aria-hidden="true" /><strong>正在加载报告正文</strong></div>
          ) : selectedReport?.contentStatus === 'error' ? (
            <div className="wb-report-content-state is-error" role="alert" aria-label="报告加载失败">
              <CircleAlert aria-hidden="true" />
              <div><strong>报告加载失败</strong><span>{selectedReport.contentMessage}</span></div>
              {adapter.commands.retryReport && (
                <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.retryReport?.(selectedReport.id)}>
                  <RefreshCw aria-hidden="true" />重新加载此报告
                </button>
              )}
            </div>
          ) : selectedReport ? (
            <>
              {selectedReport.contentStatus === 'parse_error' && (
                <div className="wb-report-parse-warning" role="alert" aria-label="报告结构解析失败">
                  <CircleAlert aria-hidden="true" />
                  <div><strong>报告结构解析失败</strong><span>{selectedReport.contentMessage}</span></div>
                  {adapter.commands.retryReport && (
                    <button type="button" onClick={() => void adapter.commands.retryReport?.(selectedReport.id)}>
                      <RefreshCw aria-hidden="true" />重新加载此报告
                    </button>
                  )}
                </div>
              )}
              {adapter.getViewModel().mode === 'production'
                ? <MarkdownPreview
                    markdown={selectedReport.markdown}
                    reportPath={selectedReport.reportPath}
                    activeFeedbackAnchorId={adapter.getViewModel().activeFeedbackAnchorId}
                    feedbackAnchorScrollRequest={adapter.getViewModel().feedbackAnchorScrollRequest}
                  />
                : <div className="wb-markdown-scroll"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedReport.markdown}</ReactMarkdown></div>}
            </>
          ) : (
            <div className="wb-empty-band"><FileText aria-hidden="true" /><div><strong>{reports.length > 0 ? '请选择一份报告' : '暂无可预览报告'}</strong><span>{reports.length > 0 ? '从左侧列表选择报告后按需加载正文。' : '任务完成后可在此查看 Markdown 报告。'}</span></div></div>
          )}
        </article>
      </div>
    </section>
  )
}

function FeedbackView({ adapter }: { adapter: WorkbenchAdapter }): React.JSX.Element {
  const [description, setDescription] = useState('')
  const [screenshots, setScreenshots] = useState<FeedbackScreenshotView[]>([])
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submitInFlightRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const formatFileSize = (size: number): string =>
    size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`

  const addProductionScreenshots = (files: File[]): void => {
    const remaining = 5 - screenshots.length
    if (remaining <= 0) {
      setError('最多只能添加 5 张截图。')
      return
    }
    const selected = files.slice(0, remaining)
    const invalid = selected.find(
      (file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024
    )
    if (invalid) {
      setError('仅支持不超过 5MB 的 PNG、JPG 或 WEBP 截图。')
      return
    }
    const existingKeys = new Set(screenshots.map((value) => `${value.name}:${value.file?.size ?? ''}`))
    const unique = selected.filter((file) => {
      const key = `${file.name}:${file.size}`
      if (existingKeys.has(key)) return false
      existingKeys.add(key)
      return true
    })
    setScreenshots((value) => [
      ...value,
      ...unique.map((file, index) => ({
        id: `production-screenshot-${Date.now()}-${index}`,
        name: file.name,
        sizeLabel: formatFileSize(file.size),
        file
      }))
    ])
    setError(selected.length < files.length ? '最多只能添加 5 张截图。' : '')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addScreenshot = async (): Promise<void> => {
    if (screenshots.length >= 5) {
      setError('最多只能添加 5 张截图。')
      return
    }
    if (adapter.getViewModel().mode === 'production') {
      fileInputRef.current?.click()
      return
    }
    const next = await adapter.commands.chooseFeedbackScreenshot(screenshots.map((value) => value.id))
    setScreenshots((value) => [...value, next])
    setError('')
  }

  const submit = async (): Promise<void> => {
    if (submitInFlightRef.current) return
    if (!description.trim()) {
      setError('请填写问题描述。')
      return
    }
    submitInFlightRef.current = true
    setIsSubmitting(true)
    try {
      await adapter.commands.submitFeedback({ description, screenshots })
      setDescription('')
      setScreenshots([])
      setError('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '意见提交失败，请稍后重试。')
    } finally {
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }

  const reset = (): void => {
    setDescription('')
    setScreenshots([])
    setError('')
  }

  return (
    <section className="wb-workspace wb-feedback-page" aria-labelledby="feedback-title">
      <div className="wb-workspace-title"><div><p className="wb-eyebrow">使用反馈</p><h2 id="feedback-title">意见反馈</h2></div></div>
      <form className="wb-feedback-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="wb-feedback-intro"><MessageSquareText aria-hidden="true" /><div><strong>提交意见</strong><span>描述问题现象、操作步骤或期望结果，截图可通过下方入口添加。</span></div></div>
        <label className="wb-form-field wb-feedback-description"><span>问题描述</span><textarea rows={8} value={description} placeholder="请描述问题现象、操作步骤或期望结果" onChange={(event) => { setDescription(event.target.value); setError('') }} /></label>
        <section className="wb-feedback-screenshots" aria-labelledby="feedback-screenshot-title">
          <div className="wb-section-heading"><div><h3 id="feedback-screenshot-title">问题截图</h3><p>支持 PNG、JPG、WEBP，最多 5 张，每张最大 5MB</p></div><button className="wb-secondary-button" type="button" onClick={() => void addScreenshot()}><ImagePlus aria-hidden="true" />添加截图</button></div>
          {adapter.getViewModel().mode === 'production' && (
            <input
              ref={fileInputRef}
              className="wb-sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              aria-label="选择反馈截图"
              onChange={(event) => addProductionScreenshots(Array.from(event.target.files ?? []))}
            />
          )}
          {screenshots.length === 0 ? <div className="wb-feedback-empty"><ImagePlus aria-hidden="true" /><span>尚未添加截图</span></div> : <div className="wb-feedback-file-list">{screenshots.map((screenshot) => <div key={screenshot.id}><FileText aria-hidden="true" /><span><strong>{screenshot.name}</strong><small>{screenshot.sizeLabel}</small></span><button className="wb-icon-button" type="button" title={`移除 ${screenshot.name}`} onClick={() => setScreenshots((value) => value.filter((item) => item.id !== screenshot.id))}><X aria-hidden="true" /><span className="wb-sr-only">移除 {screenshot.name}</span></button></div>)}</div>}
        </section>
        {error && <p className="wb-inline-error" role="alert">{error}</p>}
        <div className="wb-feedback-actions"><button className="wb-secondary-button" type="button" disabled={isSubmitting || (!description && screenshots.length === 0)} onClick={reset}>清空内容</button><button className="wb-primary-button" type="submit" disabled={isSubmitting}><Send aria-hidden="true" />{isSubmitting ? '提交中...' : '提交意见'}</button></div>
      </form>
    </section>
  )
}

export function ReviewWorkbenchPreview({
  adapter,
  environmentStatus,
  theme = DEFAULT_CLIENT_THEME,
  onToggleTheme = () => undefined
}: ReviewWorkbenchPreviewProps): React.JSX.Element {
  const [viewModel, setViewModel] = useState<WorkbenchViewModel>(() => adapter.getViewModel())
  const [activeView, setActiveView] = useState<WorkbenchViewId>('task-management')
  const [draft, setDraft] = useState({ svnUrl: '', oldRevision: '', newRevision: '' })
  const [selection, setSelection] = useState<ReviewSelection>({})
  const [fieldTouched, setFieldTouched] = useState<Record<string, boolean>>({})
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [isCreatingTask, setIsCreatingTask] = useState(false)
  // 最近 SVN 地址历史：挂载时读取一次，成功提交由 ProductionReviewWorkbench 写入。
  const [recentSvnUrls, setRecentSvnUrls] = useState<string[]>(() => readRecentSvnUrls())
  const [isSvnHistoryOpen, setIsSvnHistoryOpen] = useState(false)
  const [activeSvnHistoryIndex, setActiveSvnHistoryIndex] = useState<number | null>(null)
  const createTaskInFlightRef = useRef(false)
  const selectorReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const selectorWasOpenRef = useRef(false)

  // 按当前输入做忽略大小写的包含匹配；与历史完全一致时无需再提示，直接收起。
  const visibleRecentSvnUrls = useMemo(() => {
    const query = draft.svnUrl.trim().toLocaleLowerCase()
    if (!query) {
      return recentSvnUrls
    }
    if (recentSvnUrls.some((item) => item.toLocaleLowerCase() === query)) {
      return []
    }
    return recentSvnUrls.filter((item) => item.toLocaleLowerCase().includes(query))
  }, [draft.svnUrl, recentSvnUrls])
  const showSvnHistory = isSvnHistoryOpen && visibleRecentSvnUrls.length > 0

  const selectSvnHistoryItem = (selectedSvnUrl: string): void => {
    setDraft((value) => ({ ...value, svnUrl: selectedSvnUrl }))
    setActiveSvnHistoryIndex(null)
    setIsSvnHistoryOpen(false)
  }

  // 历史列表的键盘导航：↑↓ 循环高亮，Enter 回填，Escape/Tab 收起。
  const handleSvnHistoryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!showSvnHistory) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveSvnHistoryIndex((currentIndex) =>
        currentIndex === null
          ? 0
          : (currentIndex + 1) % visibleRecentSvnUrls.length
      )
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveSvnHistoryIndex((currentIndex) =>
        currentIndex === null
          ? visibleRecentSvnUrls.length - 1
          : (currentIndex - 1 + visibleRecentSvnUrls.length) % visibleRecentSvnUrls.length
      )
      return
    }
    if (event.key === 'Enter' && activeSvnHistoryIndex !== null) {
      event.preventDefault()
      selectSvnHistoryItem(visibleRecentSvnUrls[activeSvnHistoryIndex])
      return
    }
    // Escape/Tab 仅收起列表，不拦截默认行为（Tab 继续移动到旧 revision 输入框）。
    if (event.key === 'Escape' || event.key === 'Tab') {
      setActiveSvnHistoryIndex(null)
      setIsSvnHistoryOpen(false)
    }
  }

  useEffect(() => adapter.subscribe(setViewModel), [adapter])
  useEffect(() => {
    if (viewModel.requestedView) setActiveView(viewModel.requestedView.id)
  }, [viewModel.requestedView])
  useEffect(() => {
    if (!selectorOpen && selectorWasOpenRef.current) {
      selectorWasOpenRef.current = false
      selectorReturnFocusRef.current?.focus()
    }
  }, [selectorOpen])

  const errors = validateForm(
    draft,
    selection,
    viewModel.catalog
  )
  const formValid = Object.keys(errors).length === 0
  const chosenItems = selectedItems(selection, viewModel.catalog)
  const catalogIdLabel = viewModel.catalog.map((item) => item.id).join('、')
  const avatarText = viewModel.userName.trim().slice(0, 1) || '?'
  const formEmpty =
    draft.svnUrl.length === 0 &&
    draft.oldRevision.length === 0 &&
    draft.newRevision.length === 0 &&
    chosenItems.length === 0
  const materialCount = chosenItems.reduce(
    (total, item) =>
      total + Object.values(selection[item.id]?.materials ?? {}).reduce((count, files) => count + files.length, 0),
    0
  )
  const hasTouchedError =
    (fieldTouched.svnUrl && Boolean(errors.svnUrl)) ||
    (fieldTouched.oldRevision && Boolean(errors.oldRevision)) ||
    (fieldTouched.newRevision && Boolean(errors.newRevision)) ||
    (selectionTouched && Boolean(errors.selection || errors.materials))

  const runningTasks = viewModel.tasks.filter((task) => activeStages.includes(task.stage))
  const waitingTasks = viewModel.tasks.filter((task) => task.stage === 'waiting')
  const selectedReport =
    viewModel.reports.find((report) => report.id === viewModel.selectedReportId) ??
    (viewModel.mode === 'production' ? undefined : viewModel.reports[0])

  const resetForm = (): void => {
    setDraft({ svnUrl: '', oldRevision: '', newRevision: '' })
    setSelection({})
    setFieldTouched({})
    setSelectionTouched(false)
  }

  const fillSample = (): void => {
    const sample = structuredClone(viewModel.sampleTask)
    setDraft({
      svnUrl: sample.svnUrl,
      oldRevision: sample.oldRevision,
      newRevision: sample.newRevision
    })
    setSelection(sample.selection)
    setFieldTouched({ svnUrl: true, oldRevision: true, newRevision: true })
    setSelectionTouched(true)
  }

  const submitTask = async (): Promise<void> => {
    if (!formValid || createTaskInFlightRef.current) return
    createTaskInFlightRef.current = true
    setIsCreatingTask(true)
    try {
      await adapter.commands.createTask({ ...draft, selection })
    } finally {
      createTaskInFlightRef.current = false
      setIsCreatingTask(false)
    }
  }

  const openReport = (reportId: string): void => {
    void adapter.commands.openReport(reportId)
    setActiveView('report-center')
  }

  const openSelector = (trigger: HTMLButtonElement): void => {
    selectorReturnFocusRef.current = trigger
    selectorWasOpenRef.current = true
    setSelectorOpen(true)
  }

  const closeSelector = (): void => {
    setSelectorOpen(false)
  }

  return (
    <main className="wb-shell">
      <header className="wb-app-header">
        <div className="wb-brand">
          <img className="wb-brand-logo" src={paceLogo} alt="沛城科技" />
          <span>{viewModel.previewLabel}</span>
        </div>
        <nav className="wb-preview-controls" aria-label="工作台视图">
          <button type="button" className={activeView === 'task-management' ? 'is-active' : ''} aria-current={activeView === 'task-management' ? 'page' : undefined} onClick={() => setActiveView('task-management')}><ClipboardList aria-hidden="true" />任务管理</button>
          <button type="button" className={activeView === 'report-center' ? 'is-active' : ''} aria-current={activeView === 'report-center' ? 'page' : undefined} onClick={() => setActiveView('report-center')}><FileText aria-hidden="true" />报告中心</button>
          <button type="button" className={activeView === 'feedback' ? 'is-active' : ''} aria-current={activeView === 'feedback' ? 'page' : undefined} onClick={() => setActiveView('feedback')}><MessageSquareText aria-hidden="true" />意见反馈</button>
        </nav>
        <div className="wb-user">
          <div><strong>{viewModel.userName}</strong><span>{viewModel.departmentName}</span></div>
          <ThemeToggleButton theme={theme} onToggle={onToggleTheme} className="wb-theme-toggle" />
          <span className="wb-avatar" aria-hidden="true">{avatarText}</span>
        </div>
      </header>

      <div className={`wb-layout${activeView === 'task-management' ? '' : ' is-full-view'}`}>
        {activeView === 'task-management' && (
        <aside className="wb-create-panel" aria-labelledby="create-task-title">
          <div className="wb-panel-heading">
            <div>
              <p className="wb-eyebrow">新任务</p>
              <h1 id="create-task-title">创建审查任务</h1>
            </div>
            <button
              className="wb-icon-button"
              type="button"
              title="清空任务输入"
              disabled={formEmpty}
              onClick={resetForm}
            >
              <Trash2 aria-hidden="true" />
              <span className="wb-sr-only">清空任务输入</span>
            </button>
          </div>

          {viewModel.mode !== 'production' && (
            <div className="wb-preview-sample">
              <span>需要快速检查完整状态？</span>
              <button type="button" onClick={fillSample}><Sparkles aria-hidden="true" />填入验收样例</button>
            </div>
          )}

          <div className="wb-form-fields">
            {/* SVN 字段带最近地址历史下拉：不用 label 包裹输入，避免点击历史项触发 label 激活。 */}
            <div className="wb-form-field wb-svn-url-field">
              <label htmlFor="wb-svn-url-input">SVN 地址</label>
              <div className="wb-svn-url-input-wrap">
                <input
                  id="wb-svn-url-input"
                  value={draft.svnUrl}
                  aria-invalid={fieldTouched.svnUrl && Boolean(errors.svnUrl)}
                  placeholder="svn://server/repository/project"
                  aria-haspopup="listbox"
                  aria-expanded={showSvnHistory}
                  aria-activedescendant={
                    activeSvnHistoryIndex === null
                      ? undefined
                      : `wb-svn-url-history-option-${activeSvnHistoryIndex}`
                  }
                  onBlur={() => {
                    setActiveSvnHistoryIndex(null)
                    setIsSvnHistoryOpen(false)
                    setFieldTouched((value) => ({ ...value, svnUrl: true }))
                  }}
                  onClick={() => {
                    setActiveSvnHistoryIndex(null)
                    setIsSvnHistoryOpen(true)
                  }}
                  onFocus={() => {
                    setActiveSvnHistoryIndex(null)
                    setIsSvnHistoryOpen(true)
                  }}
                  onKeyDown={handleSvnHistoryKeyDown}
                  onChange={(event) => {
                    setDraft((value) => ({ ...value, svnUrl: event.target.value }))
                    setActiveSvnHistoryIndex(null)
                    setIsSvnHistoryOpen(true)
                  }}
                />
                {showSvnHistory ? (
                  <div className="wb-svn-url-history" role="listbox" aria-label="最近 SVN 地址">
                    {visibleRecentSvnUrls.map((recentSvnUrl, index) => (
                      <button
                        id={`wb-svn-url-history-option-${index}`}
                        key={recentSvnUrl}
                        type="button"
                        tabIndex={-1}
                        className="wb-svn-url-history-item"
                        role="option"
                        aria-selected={activeSvnHistoryIndex === index}
                        // 阻止 mousedown 默认行为，防止点击历史项时输入框先失焦收起列表。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSvnHistoryItem(recentSvnUrl)}
                      >
                        {recentSvnUrl}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {fieldTouched.svnUrl && errors.svnUrl && <small className="wb-field-error" role="alert">{errors.svnUrl}</small>}
            </div>
            <div className="wb-revision-row">
              <label className="wb-form-field">
                <span>旧 revision</span>
                <input
                  inputMode="numeric"
                  value={draft.oldRevision}
                  aria-invalid={fieldTouched.oldRevision && Boolean(errors.oldRevision)}
                  placeholder="可填 0"
                  onBlur={() => setFieldTouched((value) => ({ ...value, oldRevision: true }))}
                  onChange={(event) => setDraft((value) => ({ ...value, oldRevision: event.target.value }))}
                />
                {fieldTouched.oldRevision && errors.oldRevision && <small className="wb-field-error" role="alert">{errors.oldRevision}</small>}
              </label>
              <ArrowRight className="wb-revision-arrow" aria-hidden="true" />
              <label className="wb-form-field">
                <span>新 revision</span>
                <input
                  inputMode="numeric"
                  value={draft.newRevision}
                  aria-invalid={fieldTouched.newRevision && Boolean(errors.newRevision)}
                  placeholder="例如 18437"
                  onBlur={() => setFieldTouched((value) => ({ ...value, newRevision: true }))}
                  onChange={(event) => setDraft((value) => ({ ...value, newRevision: event.target.value }))}
                />
                {fieldTouched.newRevision && errors.newRevision && <small className="wb-field-error" role="alert">{errors.newRevision}</small>}
              </label>
            </div>
          </div>

          <section className="wb-selection-summary" aria-labelledby="selection-summary-title">
            <div className="wb-section-heading">
              <div>
                <h2 id="selection-summary-title">审查项</h2>
                <p>{chosenItems.length > 0 ? `已选 ${chosenItems.length} 项 · ${materialCount} 个材料文件` : '尚未确定本次审查范围'}</p>
              </div>
              <button
                className="wb-secondary-button"
                type="button"
                onClick={(event) => openSelector(event.currentTarget)}
              >
                <Plus aria-hidden="true" />
                {chosenItems.length > 0 ? '调整' : '选择'}
              </button>
            </div>

            {chosenItems.length === 0 ? (
              <button
                className="wb-selection-empty"
                type="button"
                onClick={(event) => openSelector(event.currentTarget)}
              >
                <FolderSearch aria-hidden="true" />
                <span><strong>选择 {catalogIdLabel || '可用审查项'}</strong><small>额外规则与材料按审查项分别保存</small></span>
              </button>
            ) : (
              <div className="wb-selected-items">
                {chosenItems.map((item) => {
                  const input = selection[item.id]
                  const itemMaterialCount = Object.values(input?.materials ?? {}).reduce((count, files) => count + files.length, 0)
                  const requiredCount = item.materialFields.filter((field) => field.required).length
                  const missingCount = item.materialFields.filter(
                    (field) => field.required && (input?.materials[field.id]?.length ?? 0) === 0
                  ).length
                  return (
                    <div className="wb-selected-item" key={item.id}>
                      <span className="wb-item-id">{item.id}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {requiredCount === 0
                            ? '无需专项材料'
                            : missingCount > 0
                              ? `缺少 ${missingCount} 项必填材料`
                              : `${itemMaterialCount} 个材料文件已就绪`}
                          {input?.extraRules.trim() ? ' · 已填写额外规则' : ''}
                        </small>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {selectionTouched && errors.selection && <p className="wb-inline-error" role="alert">{errors.selection}</p>}
            {selectionTouched && errors.materials && (
              <p className="wb-inline-error" role="alert">{errors.materials.join('；')}。</p>
            )}
          </section>

          <div className="wb-submit-zone">
            <div className={`wb-form-state${formValid ? ' is-ready' : hasTouchedError ? ' is-error' : ''}`}>
              {formValid ? <Check aria-hidden="true" /> : hasTouchedError ? <CircleAlert aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}
              <div>
                <strong>{formValid ? '可以创建' : hasTouchedError ? '需要修正' : '信息未完整'}</strong>
                <span>{formValid ? '任务将进入本机执行队列' : hasTouchedError ? '请处理上方标记的输入问题' : '填写公共输入并选择审查项'}</span>
              </div>
            </div>
            <button className="wb-primary-button wb-submit-button" type="button" disabled={!formValid || viewModel.canCreateTask === false || isCreatingTask} onClick={() => void submitTask()}>
              <Play aria-hidden="true" />
              {isCreatingTask ? '创建中...' : '创建审查任务'}
            </button>
            {viewModel.taskCreationDisabledReason && <p className="wb-inline-error">{viewModel.taskCreationDisabledReason}</p>}
          </div>
        </aside>
        )}

        {activeView === 'task-management' && (
          <TaskManagementView viewModel={viewModel} adapter={adapter} runningTasks={runningTasks} waitingTasks={waitingTasks} onOpenReportCenter={() => setActiveView('report-center')} environmentStatus={environmentStatus} />
        )}
        {activeView === 'report-center' && (
          <ReportCenterView reports={viewModel.reports} selectedReport={selectedReport} onSelect={(reportId) => void adapter.commands.openReport(reportId)} adapter={adapter} viewModel={viewModel} />
        )}
        {activeView === 'feedback' && <FeedbackView adapter={adapter} />}
      </div>

      {selectorOpen && (
        <ReviewItemSelector
          catalog={viewModel.catalog}
          initialSelection={selection}
          commands={adapter.commands}
          onCancel={closeSelector}
          onConfirm={(nextSelection) => {
            setSelection(cloneSelection(nextSelection))
            setSelectionTouched(true)
            closeSelector()
          }}
        />
      )}

      {viewModel.notice && (
        <div className="wb-toast" role="status">
          <Check aria-hidden="true" />
          <span className="wb-toast-content">
            <span>{viewModel.notice}</span>
            {viewModel.noticeAction && (
              <button type="button" onClick={() => {
                void adapter.commands.dismissNotice()
                openReport(viewModel.noticeAction?.reportId ?? '')
              }}>
                {viewModel.noticeAction.label}
              </button>
            )}
          </span>
          <button className="wb-icon-button" type="button" title="关闭提示" onClick={() => void adapter.commands.dismissNotice()}>
            <X aria-hidden="true" /><span className="wb-sr-only">关闭提示</span>
          </button>
        </div>
      )}
    </main>
  )
}
