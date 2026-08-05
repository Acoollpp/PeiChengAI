import {
  ArrowRight,
  Check,
  CircleAlert,
  FileCheck2,
  FileText,
  FolderSearch,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchX,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ReviewItemSelector } from './ReviewItemSelector'
import type {
  CreateTaskCommand,
  ReviewItemDefinition,
  ReviewItemId,
  ReviewSelection,
  ReviewTaskViewModel,
  WorkbenchAdapter,
  WorkbenchViewModel
} from './types'

interface ReviewWorkbenchPreviewProps {
  adapter: WorkbenchAdapter
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

  if (!/^\d+$/.test(draft.oldRevision.trim())) {
    errors.oldRevision = '旧 revision 必须是大于或等于 0 的整数。'
  }
  if (!/^[1-9]\d*$/.test(draft.newRevision.trim())) {
    errors.newRevision = '新 revision 必须是大于 0 的整数。'
  } else if (
    /^\d+$/.test(draft.oldRevision.trim()) &&
    Number(draft.oldRevision) !== 0 &&
    Number(draft.newRevision) <= Number(draft.oldRevision)
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
        if (field.required && (input?.materials[field.id]?.length ?? 0) === 0) {
          materialErrors.push(`${itemId} ${field.label}未选择`)
        }
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

const TaskRow = ({
  task,
  adapter,
  onOpenReport
}: {
  task: ReviewTaskViewModel
  adapter: WorkbenchAdapter
  onOpenReport: (taskId: string) => void
}): React.JSX.Element => (
  <article className={`wb-task-row ${taskStageClass(task)}`}>
    <div className="wb-task-main">
      <div className="wb-task-title-line">
        <span className="wb-task-id">{task.id}</span>
        <h4>{task.title}</h4>
        <span className="wb-status-label">{task.stageLabel}</span>
      </div>
      <p className="wb-task-url" title={task.svnUrl}>{task.svnUrl}</p>
      <div className="wb-task-meta">
        <span>r{task.oldRevision} → r{task.newRevision}</span>
        <span>{task.reviewItemIds.join(' · ')}</span>
        <span>{task.updatedAt}</span>
        {task.queueIndex && <strong>本机等待第 {task.queueIndex} 位</strong>}
      </div>
      {activeStages.includes(task.stage) && (
        <ol className="wb-stage-track" aria-label={`${task.id} 执行阶段`}>
          {task.phaseTrack.map((phase) => (
            <li className={`is-${phase.state}`} key={phase.id}>
              <span aria-hidden="true" />
              <small>{phase.label}</small>
            </li>
          ))}
        </ol>
      )}
      <p className="wb-task-message">{task.message}</p>
    </div>
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
      {task.stage === 'failed' && (
        <button
          className="wb-icon-button"
          type="button"
          title={`从头重试 ${task.id}`}
          onClick={() => void adapter.commands.retryTask(task.id)}
        >
          <RotateCcw aria-hidden="true" />
          <span className="wb-sr-only">从头重试 {task.id}</span>
        </button>
      )}
      {task.stage === 'completed' && (
        <button
          className="wb-icon-button"
          type="button"
          title={`查看任务 ${task.id} 的报告`}
          onClick={() => onOpenReport(task.id)}
        >
          <FileText aria-hidden="true" />
          <span className="wb-sr-only">查看任务 {task.id} 的报告</span>
        </button>
      )}
    </div>
  </article>
)

export function ReviewWorkbenchPreview({ adapter }: ReviewWorkbenchPreviewProps): React.JSX.Element {
  const [viewModel, setViewModel] = useState<WorkbenchViewModel>(() => adapter.getViewModel())
  const [draft, setDraft] = useState({ svnUrl: '', oldRevision: '', newRevision: '' })
  const [selection, setSelection] = useState<ReviewSelection>({})
  const [fieldTouched, setFieldTouched] = useState<Record<string, boolean>>({})
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const selectorReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const selectorWasOpenRef = useRef(false)

  useEffect(() => adapter.subscribe(setViewModel), [adapter])
  useEffect(() => {
    if (!selectorOpen && selectorWasOpenRef.current) {
      selectorWasOpenRef.current = false
      selectorReturnFocusRef.current?.focus()
    }
  }, [selectorOpen])

  const errors = validateForm(draft, selection, viewModel.catalog)
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
  const recentTasks = viewModel.tasks.filter((task) =>
    ['failed', 'cancelled', 'completed'].includes(task.stage)
  )
  const selectedReport = viewModel.reports.find((report) => report.id === viewModel.selectedReportId)

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
    if (!formValid) return
    await adapter.commands.createTask({ ...draft, selection })
  }

  const openReportForTask = (taskId: string): void => {
    const report = viewModel.reports.find((value) => value.taskId === taskId)
    if (report) void adapter.commands.openReport(report.id)
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
          <div className="wb-brand-mark" aria-hidden="true"><FileCheck2 /></div>
          <div>
            <strong>{viewModel.productName}</strong>
            <span>{viewModel.previewLabel}</span>
          </div>
        </div>
        <div className="wb-preview-controls" aria-label="预览数据场景">
          {viewModel.scenarios.map((scenario) => (
            <button
              type="button"
              className={viewModel.activeScenario === scenario.id ? 'is-active' : ''}
              aria-pressed={viewModel.activeScenario === scenario.id}
              key={scenario.id}
              onClick={() => void adapter.commands.setScenario(scenario.id)}
            >
              {scenario.label}
            </button>
          ))}
        </div>
        <div className="wb-user">
          <div><strong>{viewModel.userName}</strong><span>{viewModel.departmentName}</span></div>
          <span className="wb-avatar" aria-hidden="true">{avatarText}</span>
        </div>
      </header>

      <div className="wb-layout">
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

          <div className="wb-preview-sample">
            <span>需要快速检查完整状态？</span>
            <button type="button" onClick={fillSample}><Sparkles aria-hidden="true" />填入验收样例</button>
          </div>

          <div className="wb-form-fields">
            <label className="wb-form-field">
              <span>SVN 地址</span>
              <input
                value={draft.svnUrl}
                aria-invalid={fieldTouched.svnUrl && Boolean(errors.svnUrl)}
                placeholder="svn://server/repository/project"
                onBlur={() => setFieldTouched((value) => ({ ...value, svnUrl: true }))}
                onChange={(event) => setDraft((value) => ({ ...value, svnUrl: event.target.value }))}
              />
              {fieldTouched.svnUrl && errors.svnUrl && <small className="wb-field-error" role="alert">{errors.svnUrl}</small>}
            </label>
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
            <button className="wb-primary-button wb-submit-button" type="button" disabled={!formValid} onClick={() => void submitTask()}>
              <Play aria-hidden="true" />
              创建审查任务
            </button>
          </div>
        </aside>

        <section className="wb-workspace" aria-labelledby="workbench-title">
          <div className="wb-workspace-title">
            <div>
              <p className="wb-eyebrow">本机任务</p>
              <h2 id="workbench-title">任务工作台</h2>
            </div>
            <button className="wb-secondary-button" type="button" onClick={() => void adapter.commands.advanceTasks()}>
              <RefreshCw aria-hidden="true" />
              推进模拟阶段
            </button>
          </div>

          <section className="wb-overview" aria-label="任务总览">
            <div><span>正在执行</span><strong className="is-running">{runningTasks.length}</strong></div>
            <div><span>本机等待</span><strong className="is-waiting">{waitingTasks.length}</strong></div>
            <div><span>需要处理</span><strong className="is-failed">{recentTasks.filter((task) => task.stage === 'failed').length}</strong></div>
            <div><span>可查看报告</span><strong>{viewModel.reports.length}</strong></div>
          </section>

          <div className="wb-workspace-grid">
            <section className="wb-task-section wb-execution-section" aria-labelledby="execution-heading">
              <div className="wb-band-heading">
                <div><h3 id="execution-heading">执行与等待</h3><span>每台客户端最多同时执行两个任务</span></div>
                <span>{runningTasks.length} 执行 · {waitingTasks.length} 等待</span>
              </div>
              {runningTasks.length + waitingTasks.length === 0 ? (
                <div className="wb-empty-band"><SearchX aria-hidden="true" /><div><strong>暂无执行或等待任务</strong><span>从左侧创建任务后，阶段会显示在这里。</span></div></div>
              ) : (
                <div className="wb-task-groups">
                  {runningTasks.length > 0 && <div className="wb-task-group"><p>正在执行</p>{runningTasks.map((task) => <TaskRow key={task.id} task={task} adapter={adapter} onOpenReport={openReportForTask} />)}</div>}
                  {waitingTasks.length > 0 && <div className="wb-task-group"><p>本机等待</p>{waitingTasks.map((task) => <TaskRow key={task.id} task={task} adapter={adapter} onOpenReport={openReportForTask} />)}</div>}
                </div>
              )}
            </section>

            <div className="wb-side-stack">
              <section className="wb-task-section wb-recent-section" aria-labelledby="recent-heading">
                <div className="wb-band-heading"><div><h3 id="recent-heading">最近状态</h3><span>失败任务从头重试，取消任务不会恢复</span></div></div>
                {recentTasks.length === 0 ? (
                  <div className="wb-empty-band"><SearchX aria-hidden="true" /><div><strong>暂无最近状态</strong><span>完成、失败和取消任务会显示在这里。</span></div></div>
                ) : (
                  <div className="wb-recent-list">
                    {recentTasks.map((task) => <TaskRow key={task.id} task={task} adapter={adapter} onOpenReport={openReportForTask} />)}
                  </div>
                )}
              </section>

              <section className="wb-report-section" aria-labelledby="reports-heading">
                <div className="wb-band-heading"><div><h3 id="reports-heading">可查看报告</h3><span>按完成时间展示本机可查看结果</span></div><span>{viewModel.reports.length} 份</span></div>
                {viewModel.reports.length === 0 ? (
                  <div className="wb-empty-band"><FileText aria-hidden="true" /><div><strong>暂无可查看报告</strong><span>任务完成后，报告摘要会出现在这里。</span></div></div>
                ) : (
                  <div className="wb-report-list">
                    {viewModel.reports.map((report) => (
                      <article className="wb-report-row" key={report.id}>
                        <FileText aria-hidden="true" />
                        <div className="wb-report-main">
                          <strong>{report.title}</strong>
                          <span className="wb-report-url" title={report.svnUrl}>{report.svnUrl}</span>
                          <small>{report.revisionRange} · {report.reviewItemIds.join(' · ')} · {report.completedAt}</small>
                        </div>
                        <div className={`wb-issue-count is-${report.highestSeverity}`}>
                          <strong>{report.issueCount}</strong>
                          <span>{report.issueCount === 0 ? '未发现问题' : '个问题'}</span>
                        </div>
                        <button className="wb-icon-button" type="button" title={`查看 ${report.title} 报告摘要`} onClick={() => void adapter.commands.openReport(report.id)}>
                          <ArrowRight aria-hidden="true" />
                          <span className="wb-sr-only">查看 {report.title} 报告摘要</span>
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </section>
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

      {selectedReport && (
        <aside className="wb-report-drawer" role="complementary" aria-labelledby="report-drawer-title">
          <header>
            <div><p className="wb-eyebrow">{selectedReport.taskId}</p><h2 id="report-drawer-title">{selectedReport.title}</h2></div>
            <button className="wb-icon-button" type="button" title="关闭报告摘要" onClick={() => void adapter.commands.closeReport()}>
              <X aria-hidden="true" /><span className="wb-sr-only">关闭报告摘要</span>
            </button>
          </header>
          <p className="wb-drawer-url">{selectedReport.svnUrl}</p>
          <dl>
            <div><dt>审查范围</dt><dd>{selectedReport.revisionRange}</dd></div>
            <div><dt>审查项</dt><dd>{selectedReport.reviewItemIds.join(' · ')}</dd></div>
            <div><dt>完成时间</dt><dd>{selectedReport.completedAt}</dd></div>
            <div><dt>问题结论</dt><dd>{selectedReport.issueCount === 0 ? '未发现问题' : `${selectedReport.issueCount} 个问题`}</dd></div>
          </dl>
          <section><h3>报告摘要</h3><p>{selectedReport.summary}</p></section>
          <div className="wb-drawer-note"><CircleAlert aria-hidden="true" /><span>这是 2.0 开发预览中的模拟摘要，不会读取生产报告。</span></div>
        </aside>
      )}

      {viewModel.notice && (
        <div className="wb-toast" role="status">
          <Check aria-hidden="true" />
          <span>{viewModel.notice}</span>
          <button className="wb-icon-button" type="button" title="关闭提示" onClick={() => void adapter.commands.dismissNotice()}>
            <X aria-hidden="true" /><span className="wb-sr-only">关闭提示</span>
          </button>
        </div>
      )}
    </main>
  )
}
