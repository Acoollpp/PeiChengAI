// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi } from '../code-review-api'
import type { TaskProgressEvent } from '../../../shared/types'
import { ProductionReviewWorkbench } from './ProductionReviewWorkbench'
import type { ReviewItemDefinition } from './types'

const reportMarkdown = `# DS-03 状态机审核报告

## 一、审查问题

### P01 [高风险] 状态恢复事件缺失

**问题描述：** 恢复分支没有发送完成事件。
`

const createDeferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const taskStats = (running: number, failedOrError: number, success: number) => ({
  range: 'today' as const,
  total: running + failedOrError + success,
  success,
  running,
  failed_or_error: failedOrError,
  average_duration_seconds: null,
  by_status: {},
  reports_by_user: [],
  trend: []
})

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    getTodayTaskStats: vi.fn(async () => ({
      range: 'today' as const,
      total: 0,
      success: 0,
      running: 0,
      failed_or_error: 0,
      average_duration_seconds: null,
      by_status: {},
      reports_by_user: [],
      trend: []
    })),
    readTaskReport: vi.fn(async () => reportMarkdown),
    preflightTask: vi.fn(async () => ({ status: 'valid' as const })),
    executeTask: vi.fn(async () => ({
      taskId: 'task-production-1',
      status: 'success' as const,
      reportMarkdown,
      reportPath: '/reports/task-production-1.md',
      pdfPath: '/reports/task-production-1.pdf',
      pdfReportName: 'task-production-1.pdf',
      feedbackProtocolVersion: 1
    })),
    retryTask: vi.fn(),
    cancelTask: vi.fn(async () => ({ status: 'cancelled' as const })),
    onTaskProgress: vi.fn(() => vi.fn()),
    selectReviewMaterialFile: vi.fn(async () => ({ status: 'cancelled' as const })),
    openPdfReport: vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/reports/task-production-1.pdf'
    })),
    openReportFeedbackWindow: vi.fn(async () => true),
    submitNegativeReportFeedback: vi.fn(async (taskId: string) => ({
      taskId, helpful: false, usefulIssuesText: null
    })),
    openTaskLog: vi.fn(async () => ({ status: 'ready' as const, logPath: '/logs/task.log' })),
    readReportAsset: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,aW1hZ2U=' })),
    showTaskCompletionNotification: vi.fn(async () => ({ status: 'shown' as const })),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' as const })),
    onReportFeedbackSubmitted: vi.fn(() => vi.fn()),
    onIssueFeedbackSubmitted: vi.fn(() => vi.fn()),
    onReportFeedbackFocusAnchor: vi.fn(() => vi.fn())
  } as unknown as CodeReviewApi
}

const productionProps = {
  currentUser: {
    id: 'user-1',
    full_name: '王工程师',
    department_id: 'dept-1',
    department_name: 'BMS 软件部'
  },
  environment: { status: 'ready' as const },
  isCheckingEnvironment: false,
  isInstallingSkillDuringCheck: false,
  isInstallingCodex: false,
  isInstallingSvn: false,
  onRefreshEnvironment: vi.fn(),
  onInstallCodex: vi.fn(),
  onInstallSvn: vi.fn(),
  onInstallSkill: vi.fn()
}

const longNameStressCatalog: ReviewItemDefinition[] = [
  {
    id: 'DS-03',
    category: '设计与安全',
    name: '状态机审核与故障恢复及跨模式安全降级边界条件完整性联合审查（超长名称视觉压力样例）',
    summary: '仅用于开发验收长名称布局，不改变正式目录。',
    goal: '验证长审查项名称的布局。',
    process: ['使用真实生产组件渲染'],
    specification: '仅用于视觉验收。',
    materialFields: []
  }
]

const submitMinimalDs03Task = async (svnUrl: string): Promise<void> => {
  const user = userEvent.setup()
  const svnInput = await screen.findByLabelText('SVN 地址')
  const oldRevisionInput = screen.getByLabelText('旧 revision')
  const newRevisionInput = screen.getByLabelText('新 revision')
  await user.clear(svnInput)
  await user.clear(oldRevisionInput)
  await user.clear(newRevisionInput)
  await user.type(svnInput, svnUrl)
  await user.type(oldRevisionInput, '0')
  await user.type(newRevisionInput, '12')
  const selectButton = screen.queryByRole('button', { name: '选择' })
  if (selectButton) {
    await user.click(selectButton)
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
  }
  await user.click(screen.getByRole('button', { name: '创建审查任务' }))
}

const mockRendererForeground = (foreground: boolean): void => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(foreground ? 'visible' : 'hidden')
  vi.spyOn(document, 'hasFocus').mockReturnValue(foreground)
}

beforeEach(() => {
  setupCodeReviewApi()
  mockRendererForeground(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProductionReviewWorkbench', () => {
  it('总览使用今日服务端统计，但本机等待始终取自当前 renderer 队列', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(199)
    const pendingRuns = [
      new Promise<never>(() => undefined),
      new Promise<never>(() => undefined),
      new Promise<never>(() => undefined)
    ]
    vi.mocked(window.codeReview.executeTask).mockImplementation(
      () => pendingRuns[vi.mocked(window.codeReview.executeTask).mock.calls.length - 1]
    )
    vi.mocked(window.codeReview.getTodayTaskStats).mockResolvedValueOnce({
      range: 'today',
      total: 23,
      success: 11,
      running: 8,
      failed_or_error: 4,
      average_duration_seconds: 321,
      by_status: { success: 11, running_codex: 8, failed: 4 },
      reports_by_user: [],
      trend: [{ label: '14:00', count: 99 }]
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/stats-queue-1')
    await submitMinimalDs03Task('svn://server/stats-queue-2')
    await submitMinimalDs03Task('svn://server/stats-queue-3')

    const overview = await screen.findByLabelText('任务总览')
    expect(within(overview).getByText('正在执行').closest('div')).toHaveTextContent('8')
    expect(within(overview).getByText('本机等待').closest('div')).toHaveTextContent('1')
    expect(within(overview).getByText('需要处理').closest('div')).toHaveTextContent('4')
    expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('11')
    expect(within(overview).queryByText(/321|99|预计|趋势|%/)).not.toBeInTheDocument()
    expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2)
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
  })

  it('统计加载失败时明确降级且不阻断任务创建，并可独立重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.getTodayTaskStats)
      .mockRejectedValueOnce(new Error('统计服务暂不可用'))
      .mockResolvedValueOnce({
        range: 'today', total: 6, success: 3, running: 2, failed_or_error: 1,
        average_duration_seconds: null, by_status: {}, reports_by_user: [], trend: []
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    const statsError = await screen.findByRole('alert')
    expect(statsError).toHaveTextContent('今日任务统计加载失败')
    expect(statsError).toHaveTextContent('任务创建与本机队列仍可使用')
    expect(screen.queryByLabelText('本地环境状态')).not.toBeInTheDocument()

    await submitMinimalDs03Task('svn://server/stats-fallback')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: '重新加载统计' }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('今日服务端完成')).toBeInTheDocument()
    expect(within(screen.getByLabelText('任务总览')).getByText('可查看报告').closest('div')).toHaveTextContent('3')
  })

  it('真实任务绑定和进入终态时后台刷新统计，日志与重复阶段不重复请求', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    const backgroundRefresh = createDeferred<Awaited<ReturnType<CodeReviewApi['getTodayTaskStats']>>>()
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.getTodayTaskStats)
      .mockResolvedValueOnce(taskStats(2, 1, 5))
      .mockImplementationOnce(() => backgroundRefresh.promise)
      .mockResolvedValueOnce(taskStats(1, 1, 7))
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    const overview = await screen.findByLabelText('任务总览')
    await waitFor(() => expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('5'))
    await submitMinimalDs03Task('svn://server/stats-refresh')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    const clientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[0][0].client_task_id
    if (!clientTaskId) throw new Error('本地任务 ID 未生成')

    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'created', message: '服务端任务已创建'
    }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('5')
    expect(screen.queryByText('正在加载今日服务端统计。')).not.toBeInTheDocument()

    act(() => {
      progressListener?.({
        taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'created', message: '重复创建阶段'
      })
      progressListener?.({
        taskId: 'server-stats-refresh', clientTaskId, type: 'codex_output', stream: 'stdout', message: 'Codex 日志'
      })
      progressListener?.({
        taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'running_codex', message: '执行 Skill'
      })
    })
    await waitFor(() => expect(screen.getAllByText('执行 Skill').length).toBeGreaterThan(0))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2)

    await act(async () => {
      backgroundRefresh.resolve(taskStats(2, 1, 6))
      await backgroundRefresh.promise
    })
    await waitFor(() => expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('6'))
    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'success', message: '审查完成'
    }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('7'))

    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'success', message: '重复完成事件'
    }))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(3)
  })

  it('后发统计请求先返回时忽略初始请求的陈旧响应', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    const initialRequest = createDeferred<Awaited<ReturnType<CodeReviewApi['getTodayTaskStats']>>>()
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.getTodayTaskStats)
      .mockImplementationOnce(() => initialRequest.promise)
      .mockResolvedValueOnce(taskStats(4, 2, 9))
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findByText('正在加载今日服务端统计。')).toBeInTheDocument()
    await submitMinimalDs03Task('svn://server/stats-race')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[0][0].client_task_id
    if (!clientTaskId) throw new Error('本地任务 ID 未生成')
    act(() => progressListener?.({
      taskId: 'server-stats-race', clientTaskId, type: 'stage', stage: 'created', message: '服务端任务已创建'
    }))

    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    const overview = await screen.findByLabelText('任务总览')
    await waitFor(() => expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('9'))
    await act(async () => {
      initialRequest.resolve(taskStats(1, 0, 1))
      await initialRequest.promise
    })
    await waitFor(() => expect(within(overview).getByText('可查看报告').closest('div')).toHaveTextContent('9'))
  })

  it('失败任务重试在服务端真实阶段事件到达后才刷新统计', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'retry-stats', svn_url: 'svn://server/retry-stats', old_revision: '12', new_revision: '13',
        review_item_ids: ['DS-03'], status: 'failed', error_message: '首次执行失败'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.retryTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: '从头重试 retry-stats' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledTimes(1))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

    act(() => progressListener?.({
      taskId: 'retry-stats', clientTaskId: 'retry-stats',
      type: 'stage', stage: 'checking_environment', message: '重试任务已进入环境检查'
    }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))

    act(() => {
      progressListener?.({
        taskId: 'retry-stats', clientTaskId: 'retry-stats',
        type: 'stage', stage: 'checking_environment', message: '重复环境检查事件'
      })
      progressListener?.({
        taskId: 'retry-stats', clientTaskId: 'retry-stats',
        type: 'stage', stage: 'running_codex', message: '重试任务执行 Skill'
      })
    })
    await waitFor(() => expect(screen.getByText('重试任务执行 Skill')).toBeInTheDocument())
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2)
  })

  it('真实任务事件依次映射环境检查、准备工作区、执行 Skill 和上传报告', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    const execution = new Promise<never>(() => undefined)
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => execution)
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await submitMinimalDs03Task('svn://server/stage-events')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[0][0].client_task_id
    if (!clientTaskId) throw new Error('本地任务 ID 未生成')

    const assertStage = async (
      stage: Extract<TaskProgressEvent, { type: 'stage' }>['stage'],
      expectedLabel: string
    ): Promise<void> => {
      act(() => progressListener?.({
        taskId: 'server-stage-task', clientTaskId, type: 'stage', stage, message: `事件：${expectedLabel}`
      }))
      const row = await screen.findByRole('article', { name: /server-stage-task/ })
      expect(within(row).getByText(expectedLabel)).toBeInTheDocument()
      expect(within(row).getByText(`事件：${expectedLabel}`)).toBeInTheDocument()
    }

    await assertStage('created', '环境检查')
    await assertStage('checking_environment', '环境检查')
    await assertStage('preparing_workspace', '准备工作区')
    await assertStage('running_codex', '执行 Skill')
    await assertStage('uploading_report', '上传报告')
  })

  it('真实队列和任务事件映射本机等待、完成、失败、环境异常和已取消', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/terminal-success')
    await submitMinimalDs03Task('svn://server/terminal-failed')
    await submitMinimalDs03Task('svn://server/terminal-cancelled')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2))
    const firstClientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[0][0].client_task_id
    const secondClientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[1][0].client_task_id
    if (!firstClientTaskId || !secondClientTaskId) throw new Error('本地任务 ID 未生成')

    const waitingRow = screen.getByText('svn://server/terminal-cancelled').closest('article')
    expect(waitingRow).not.toBeNull()
    expect(within(waitingRow as HTMLElement).getByText('本机等待')).toBeInTheDocument()
    expect(within(waitingRow as HTMLElement).getByText('本机等待第 1 位')).toBeInTheDocument()
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    await userEvent.setup().click(within(waitingRow as HTMLElement).getByRole('button', { name: /取消任务/ }))
    expect(within(waitingRow as HTMLElement).getByText('已取消')).toBeInTheDocument()
    expect(window.codeReview.cancelTask).not.toHaveBeenCalled()
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

    act(() => progressListener?.({
      taskId: 'server-success', clientTaskId: firstClientTaskId,
      type: 'stage', stage: 'success', message: '报告上传完成'
    }))
    expect(screen.queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalled()

    act(() => progressListener?.({
      taskId: 'server-failed', clientTaskId: secondClientTaskId,
      type: 'stage', stage: 'failed', message: 'Skill 执行失败'
    }))
    const failedRow = await screen.findByRole('article', { name: /server-failed/ })
    expect(within(failedRow).getByText('失败')).toBeInTheDocument()
    expect(within(failedRow).getByText('Skill 执行失败')).toBeInTheDocument()

    await submitMinimalDs03Task('svn://server/terminal-environment-error')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(3))
    const thirdClientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[2][0].client_task_id
    if (!thirdClientTaskId) throw new Error('本地任务 ID 未生成')
    act(() => progressListener?.({
      taskId: 'server-environment-error', clientTaskId: thirdClientTaskId,
      type: 'stage', stage: 'environment_error', message: '环境检查失败'
    }))
    const environmentErrorRow = await screen.findByRole('article', { name: /server-environment-error/ })
    expect(within(environmentErrorRow).getByText('失败')).toBeInTheDocument()
    expect(within(environmentErrorRow).getByText('环境检查失败')).toBeInTheDocument()
  })

  it('默认使用正式目录，只在显式注入时渲染长名称压力目录', async () => {
    const user = userEvent.setup()
    const firstRender = render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('button', { name: '选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    expect(screen.queryByText(longNameStressCatalog[0].name)).not.toBeInTheDocument()

    firstRender.unmount()
    render(
      <ProductionReviewWorkbench
        {...productionProps}
        catalogOverride={longNameStressCatalog}
      />
    )
    await user.click(await screen.findByRole('button', { name: '选择' }))
    expect(
      screen.getByRole('checkbox', {
        name: `选择 DS-03 ${longNameStressCatalog[0].name}`
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('编码规范审核')).not.toBeInTheDocument()
  })

  it('从生产工作台原样提交 r0 和 DS-03 规则，并打开真实 Markdown、PDF 与逐问题反馈', async () => {
    const user = userEvent.setup()
    render(
      <ProductionReviewWorkbench {...productionProps} />
    )

    expect(await screen.findByRole('heading', { name: '创建审查任务' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '填入验收样例' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '推进任务阶段' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://server/project')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), '10772')
    await user.click(screen.getByRole('button', { name: '选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    await user.type(screen.getByLabelText('DS-03 额外规则'), '重点检查故障恢复路径')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => {
      expect(window.codeReview.preflightTask).toHaveBeenCalledWith({
        svn_url: 'svn://server/project',
        old_revision: '0',
        new_revision: '10772'
      })
      expect(window.codeReview.executeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          svn_url: 'svn://server/project',
          old_revision: '0',
          new_revision: '10772',
          review_items: [{ id: 'DS-03', user_extra_rules: '重点检查故障恢复路径' }],
          skill_name: 'bms-code-reviewer'
        })
      )
    })

    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
    const completionMessage = await screen.findByText('任务 task-production-1 已完成，可查看报告。')
    const completionNotice = completionMessage.closest('[role="status"]')
    expect(completionNotice).not.toBeNull()
    expect(completionNotice).toHaveTextContent('任务 task-production-1 已完成，可查看报告。')
    await user.click(within(completionNotice as HTMLElement).getByRole('button', { name: '查看报告' }))
    expect(await screen.findByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    const preview = screen.getByRole('article', { name: 'Markdown 报告预览' })
    expect(within(preview).getByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
    expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)

    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '反馈报告问题' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'issues',
      taskId: 'task-production-1',
      anchors: expect.any(Array)
    })
  })

  it('从正式目录单独提交 DS-02，原样保留 revision 且不产生材料字段', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds02-only')
    await user.type(screen.getByLabelText('旧 revision'), 'r0')
    await user.type(screen.getByLabelText('新 revision'), 'R42')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '代码质量')
    expect(screen.getByText('代码质量')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 DS-01 变更点审查' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    expect(screen.getByRole('article', { name: 'DS-02 编码规范审核 详情' })).toHaveTextContent(
      '具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护'
    )
    expect(screen.getByText('此审查项不需要专项材料。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择文件' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('DS-02 额外规则'), '仅检查本次新增的诊断模块')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(screen.getByText('DS-02').closest('.wb-selected-item')).toHaveTextContent('无需专项材料')
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds02-only',
        old_revision: 'r0',
        new_revision: 'R42',
        skill_name: 'bms-code-reviewer',
        review_items: [{ id: 'DS-02', user_extra_rules: '仅检查本次新增的诊断模块' }]
      })
    ))
    expect(window.codeReview.selectReviewMaterialFile).not.toHaveBeenCalled()
  })

  it('通过系统文件选择器提交 DS-01 的 Excel、PDF 和独立额外规则', async () => {
    const user = userEvent.setup()
    const longRequirementName = 'BMS_平台_V2.7_低压上下电与故障恢复产品开发需求表_最终评审修订版_20260806.xlsx'
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: `/local/materials/${longRequirementName}`,
        fileName: longRequirementName,
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/产品规格书.pdf',
        fileName: '产品规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), '130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对本次协议导入')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    const longName = await screen.findByText(longRequirementName)
    expect(longName).toHaveAttribute('title', longRequirementName)
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('已选 1 项 · 2 个材料文件')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds01',
        old_revision: '120',
        new_revision: '130',
        skill_name: 'bms-code-reviewer',
        review_items: [{
          id: 'DS-01',
          user_extra_rules: '仅核对本次协议导入',
          materials: [
            {
              field_id: 'requirement-sheet',
              file_paths: [`/local/materials/${longRequirementName}`]
            },
            { field_id: 'product-spec', file_paths: ['/local/materials/产品规格书.pdf'] }
          ]
        }]
      })
    ))
  })

  it('同时提交 DS-01 和 DS-03，并保留各自额外规则与材料边界', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/组合审查需求表.xlsx',
        fileName: '组合审查需求表.xlsx',
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/组合审查规格书.pdf',
        fileName: '组合审查规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/multi-items')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), 'R130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '只核对协议导入与第五章')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    expect(screen.getByText('此审查项不需要专项材料。')).toBeInTheDocument()
    await user.type(screen.getByLabelText('DS-03 额外规则'), '只检查故障恢复状态')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))

    expect(screen.getByText('已选 2 项 · 2 个材料文件')).toBeInTheDocument()
    expect(screen.getByText('DS-01').closest('.wb-selected-item')).toHaveTextContent('2 个材料文件已就绪')
    expect(screen.getByText('DS-03').closest('.wb-selected-item')).toHaveTextContent('无需专项材料')
    expect(screen.queryByText('当前版本每个任务只能选择一个审查项。')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/multi-items',
        old_revision: '120',
        new_revision: 'R130',
        skill_name: 'bms-code-reviewer',
        review_items: [
          {
            id: 'DS-01',
            user_extra_rules: '只核对协议导入与第五章',
            materials: [
              {
                field_id: 'requirement-sheet',
                file_paths: ['/local/materials/组合审查需求表.xlsx']
              },
              {
                field_id: 'product-spec',
                file_paths: ['/local/materials/组合审查规格书.pdf']
              }
            ]
          },
          { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
        ]
      })
    ))
  })

  it('提交 DS-01 + DS-02 时 Excel/PDF 只归属 DS-01', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/DS01-DS02-需求表.xlsx',
        fileName: 'DS01-DS02-需求表.xlsx',
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/DS01-DS02-规格书.pdf',
        fileName: 'DS01-DS02-规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01-ds02')
    await user.type(screen.getByLabelText('旧 revision'), '220')
    await user.type(screen.getByLabelText('新 revision'), 'R230')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对产品需求')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '仅检查新增诊断代码')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds01-ds02',
        old_revision: '220',
        new_revision: 'R230',
        review_items: [
          {
            id: 'DS-01',
            user_extra_rules: '仅核对产品需求',
            materials: [
              {
                field_id: 'requirement-sheet',
                file_paths: ['/local/materials/DS01-DS02-需求表.xlsx']
              },
              {
                field_id: 'product-spec',
                file_paths: ['/local/materials/DS01-DS02-规格书.pdf']
              }
            ]
          },
          { id: 'DS-02', user_extra_rules: '仅检查新增诊断代码' }
        ]
      })
    ))
  })

  it('提交 DS-02 + DS-03 时逐项额外规则隔离且均无材料', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds02-ds03')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), 'R330')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '只检查命名一致性')
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    await user.type(screen.getByLabelText('DS-03 额外规则'), '只检查故障恢复状态')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds02-ds03',
        old_revision: '0',
        new_revision: 'R330',
        review_items: [
          { id: 'DS-02', user_extra_rules: '只检查命名一致性' },
          { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
        ]
      })
    ))
    expect(window.codeReview.selectReviewMaterialFile).not.toHaveBeenCalled()
  })

  it('生产分类工具操作真实草稿，取消后不回填', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await screen.findByRole('heading', { name: '创建审查任务' })
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '代码质量')
    await user.click(screen.getByRole('checkbox', { name: '选择代码质量全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 1 项')
    await user.clear(screen.getByPlaceholderText('搜索 ID、名称或分类'))
    await user.click(screen.getByRole('checkbox', { name: '选择设计与安全全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 2 项')
    await user.click(screen.getByRole('checkbox', { name: '仅看已选' }))
    const catalogList = screen.getByLabelText('审查项列表')
    expect(within(catalogList).getByText('编码规范审核')).toBeInTheDocument()
    expect(within(catalogList).getByText('状态机审核')).toBeInTheDocument()
    expect(within(catalogList).queryByText('变更点审查')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空选择' }))
    expect(within(catalogList).getByText('没有匹配的审查项')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByText('尚未确定本次审查范围')).toBeInTheDocument()
  })

  it('只有完成选择回填；取消、关闭、Escape 和遮罩退出均恢复已确认草稿', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await screen.findByRole('heading', { name: '创建审查任务' })
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '上一次已确认规则')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('DS-02').closest('.wb-selected-item')).toHaveTextContent('已填写额外规则')

    const assertConfirmedDraftRestored = async (): Promise<void> => {
      expect(screen.getByLabelText('DS-02 额外规则')).toHaveValue('上一次已确认规则')
      expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' })).not.toBeChecked()
    }
    const changeDraft = async (): Promise<void> => {
      await user.clear(screen.getByLabelText('DS-02 额外规则'))
      await user.type(screen.getByLabelText('DS-02 额外规则'), '本轮未确认规则')
      await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    }

    let adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.click(screen.getByRole('button', { name: '取消' }))

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.click(screen.getByRole('button', { name: '取消并关闭' }))

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(adjustButton).toHaveFocus())

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    const backdrop = screen.getByRole('dialog').parentElement
    if (!backdrop) throw new Error('选择器应存在遮罩层')
    fireEvent.mouseDown(backdrop)

    await user.click(screen.getByRole('button', { name: '调整' }))
    await assertConfirmedDraftRestored()
  })

  it('DS-01 一次显示缺失材料和错误扩展名', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile).mockResolvedValueOnce({
      status: 'selected',
      filePath: '/local/materials/错误格式.txt',
      fileName: '错误格式.txt',
      fileSize: 128
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01-invalid')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), '130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(screen.getByRole('alert')).toHaveTextContent('DS-01 产品开发需求表仅支持 .xlsx、.xls 文件')
    expect(screen.getByRole('alert')).toHaveTextContent('DS-01 产品规格书未选择')
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    expect(window.codeReview.executeTask).not.toHaveBeenCalled()
  })

  it('后台系统通知成功时不显示应用内完成提醒，点击通知可打开对应 Markdown', async () => {
    let notificationClick: Parameters<CodeReviewApi['onTaskCompletionNotificationClicked']>[0] | undefined
    mockRendererForeground(false)
    vi.mocked(window.codeReview.onTaskCompletionNotificationClicked).mockImplementation((listener) => {
      notificationClick = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await submitMinimalDs03Task('svn://server/background-shown')

    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('任务 task-production-1 已完成，可查看报告。')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    const payload = vi.mocked(window.codeReview.showTaskCompletionNotification).mock.calls[0][0]
    act(() => notificationClick?.(payload))
    expect(await screen.findByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Markdown 报告预览' }))
      .getByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
  })

  it.each([
    ['前台', true],
    ['后台', false]
  ])('执行器返回成功但无 Markdown 路径时在%s不产生可查看报告通知', async (_label, foreground) => {
    mockRendererForeground(foreground)
    vi.mocked(window.codeReview.executeTask).mockResolvedValueOnce({
      taskId: 'success-without-report-path',
      status: 'success'
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/success-without-report-path')
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))

    expect(await screen.findByText(
      '任务已完成，但未生成可查看的 Markdown 报告。'
    )).toBeInTheDocument()
    expect(screen.getByText('0 执行 · 0 等待 · 0 失败 · 1 无报告')).toBeInTheDocument()
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
    expect(screen.queryByText(
      '任务 success-without-report-path 已完成，可查看报告。'
    )).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()
  })

  it.each([
    ['系统不支持', async () => ({ status: 'unsupported' as const })],
    ['系统调用失败', async () => { throw new Error('系统通知失败') }]
  ])('后台%s时降级为可操作的应用内完成提醒', async (_label, notificationResult) => {
    mockRendererForeground(false)
    vi.mocked(window.codeReview.showTaskCompletionNotification).mockImplementationOnce(notificationResult)
    render(<ProductionReviewWorkbench {...productionProps} />)
    await submitMinimalDs03Task('svn://server/background-fallback')

    const completionMessage = await screen.findByText('任务 task-production-1 已完成，可查看报告。')
    const completionNotice = completionMessage.closest('[role="status"]')
    expect(completionNotice).not.toBeNull()
    expect(completionNotice).toHaveTextContent('任务 task-production-1 已完成，可查看报告。')
    expect(within(completionNotice as HTMLElement).getByRole('button', { name: '查看报告' })).toBeInTheDocument()
    expect(screen.queryByText(/系统通知发送失败/)).not.toBeInTheDocument()
    await userEvent.setup().click(within(completionNotice as HTMLElement).getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('兼容缺少新字段的历史任务，并从真实阶段事件显示准备工作区', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'legacy-success',
          svn_url: 'svn://server/legacy',
          old_revision: '0',
          new_revision: '12',
          status: 'success',
          report_path: '/reports/legacy-success.md',
          finished_at: '2026-08-06T08:00:00Z'
        },
        {
          id: 'running-1',
          svn_url: 'svn://server/running',
          old_revision: '20',
          new_revision: '21',
          review_item_ids: ['DS-03'],
          status: 'checking_environment'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findByText('legacy · r0 → r12')).toBeInTheDocument()
    expect(screen.getByText('r0 → r12')).toBeInTheDocument()
    expect(screen.getAllByText(/历史任务未记录审查项/).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)
    })
    progressListener?.({
      taskId: 'running-1',
      type: 'stage',
      stage: 'preparing_workspace',
      message: '正在准备真实工作区'
    })
    expect(await screen.findByText('准备工作区')).toBeInTheDocument()
    expect(screen.getByText('正在准备真实工作区')).toBeInTheDocument()
  })

  it('报告列表先展示真实元数据且只预读首份正文，多审查项显示 ID、名称并保留未知 ID', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'multi-report',
          svn_url: 'svn://server/platform/very-long-project-name',
          old_revision: '100',
          new_revision: '120',
          review_item_ids: ['DS-01', 'DS-02', 'DS-FUTURE'],
          status: 'success',
          report_name: '多审查项真实报告.md',
          report_path: '/reports/multi-report.md',
          feedback_protocol_version: 1,
          issue_count: 1,
          highest_issue_severity: 'high',
          finished_at: '2026-08-06T08:00:00Z'
        },
        {
          id: 'zero-report', svn_url: 'svn://server/zero', old_revision: '120', new_revision: '121',
          review_item_ids: ['DS-03'], status: 'success', report_name: '零问题报告.md',
          report_path: '/reports/zero-report.md',
          feedback_protocol_version: 1, issue_count: 0, highest_issue_severity: null
        }
      ],
      count: 2
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findByText('多审查项真实报告')).toBeInTheDocument()
    expect(screen.getAllByText(/DS-01 · 变更点审查/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/DS-02 · 编码规范审核/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/DS-FUTURE/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)
    expect(screen.getByText('零问题报告')).toBeInTheDocument()
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledTimes(1))
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('multi-report')
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalledWith('zero-report')

    await user.click(screen.getAllByRole('button', { name: /查看报告/ })[0])
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('multi-report'))
    expect(await screen.findByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
  })

  it('新旧混合列表只纳入成功且有 Markdown 路径的任务，并跳过无报告任务选择首份', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'success-without-report', svn_url: 'svn://server/no-report',
          old_revision: '1', new_revision: '2', status: 'success', report_name: '仅有报告名.md'
        },
        {
          id: 'legacy-with-report', svn_url: 'svn://server/legacy-report',
          old_revision: '2', new_revision: '3', status: 'success',
          report_path: '/reports/legacy-report.md'
        },
        {
          id: 'modern-with-report', svn_url: 'svn://server/modern-report',
          old_revision: '3', new_revision: '4', status: 'success',
          report_name: '新版真实报告.md', report_path: '/reports/modern-report.md',
          review_item_ids: ['DS-03'], feedback_protocol_version: 1,
          issue_count: 1, highest_issue_severity: 'high'
        }
      ],
      count: 3
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findAllByRole('button', { name: /查看报告/ })).toHaveLength(2)
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledTimes(1))
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('legacy-with-report')
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalledWith('success-without-report')

    await user.click(screen.getByRole('button', { name: '报告中心' }))
    const reportIndex = screen.getByLabelText('任务和报告列表')
    expect(within(reportIndex).queryByText('仅有报告名')).not.toBeInTheDocument()
    expect(within(reportIndex).getByText('legacy-report · r2 → r3')).toBeInTheDocument()
    expect(within(reportIndex).getByText('新版真实报告')).toBeInTheDocument()
  })

  it('React StrictMode 重建 effect 后仍接收报告列表响应', async () => {
    vi.mocked(window.codeReview.listTasks).mockResolvedValue({
      data: [{
        id: 'strict-report', svn_url: 'svn://server/strict', old_revision: '1', new_revision: '2',
        status: 'success', report_name: 'StrictMode 报告.md', report_path: '/reports/strict.md'
      }],
      count: 1
    })

    render(<StrictMode><ProductionReviewWorkbench {...productionProps} /></StrictMode>)

    expect(await screen.findByText('StrictMode 报告')).toBeInTheDocument()
  })

  it('报告列表失败不阻断任务创建并可独立重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks)
      .mockRejectedValueOnce(new Error('报告服务暂不可用'))
      .mockResolvedValueOnce({ data: [], count: 0 })

    render(<ProductionReviewWorkbench {...productionProps} />)

    const reportError = await screen.findByRole('alert', { name: '报告列表加载失败' })
    expect(reportError).toHaveTextContent('报告服务暂不可用')
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    await user.click(within(reportError).getByRole('button', { name: '重新加载报告列表' }))
    await waitFor(() => expect(window.codeReview.listTasks).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('暂无可查看报告')).toBeInTheDocument()
  })

  it('单份报告读取失败只影响当前预览并可重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'retry-report', svn_url: 'svn://server/retry', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', feedback_protocol_version: 1,
        issue_count: 1, highest_issue_severity: 'high', report_path: '/reports/retry.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readTaskReport)
      .mockRejectedValueOnce(new Error('Markdown 下载失败'))
      .mockResolvedValueOnce(reportMarkdown)

    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: /查看报告/ }))

    const reportError = await screen.findByRole('alert', { name: '报告加载失败' })
    expect(reportError).toHaveTextContent('Markdown 下载失败')
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
    await user.click(within(reportError).getByRole('button', { name: '重新加载此报告' }))
    expect(await screen.findByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
    expect(window.codeReview.readTaskReport).toHaveBeenCalledTimes(2)
  })

  it('新版报告结构解析失败时显示明确状态但仍呈现原始 Markdown', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'invalid-report', svn_url: 'svn://server/invalid', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', feedback_protocol_version: 1,
        issue_count: 1, highest_issue_severity: 'high', report_path: '/reports/invalid.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readTaskReport).mockResolvedValueOnce(
      '# 原始报告\n\n## 三、审查问题\n\n### 覆盖摘要\n\n正文仍然可查看。'
    )

    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: /查看报告/ }))

    const parseError = await screen.findByRole('alert', { name: '报告结构解析失败' })
    expect(parseError).toHaveTextContent('不符合 bms-code-reviewer 固定模板')
    expect(screen.getByRole('heading', { name: '原始报告' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
  })

  it('revision 接受可选 r 前缀，展示保持单个 r 且提交保留用户输入', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/prefixed')
    await user.type(screen.getByLabelText('旧 revision'), 'r0')
    await user.type(screen.getByLabelText('新 revision'), 'R12')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.preflightTask).toHaveBeenCalledWith({
      svn_url: 'svn://server/prefixed', old_revision: 'r0', new_revision: 'R12'
    }))
    expect(window.codeReview.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      old_revision: 'r0', new_revision: 'R12'
    }))
    expect(await screen.findByText('r0 → r12')).toBeInTheDocument()
    expect(screen.queryByText(/rr0|rR12/)).not.toBeInTheDocument()
  })

  it('生产报告通过 MarkdownPreview 读取相对图片资源', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'asset-task', svn_url: 'svn://server/assets', old_revision: '0', new_revision: 'r12',
        review_item_ids: ['DS-03'], status: 'success', report_path: '/reports/asset/report.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readTaskReport).mockResolvedValueOnce(
      '# 状态机报告\n\n![状态图](images/state.png)'
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[0])
    await waitFor(() => expect(window.codeReview.readReportAsset).toHaveBeenCalledWith({
      reportPath: '/reports/asset/report.md', assetPath: 'images/state.png'
    }))
    expect(await screen.findByRole('img', { name: '状态图' })).toHaveAttribute(
      'src', 'data:image/png;base64,aW1hZ2U='
    )
  })

  it('快速切换报告时迟到加载结果不会串到当前报告', async () => {
    const user = userEvent.setup()
    let resolveReportB: ((value: string) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'task-a', svn_url: 'svn://server/a', old_revision: '1', new_revision: '2',
          status: 'success', report_path: '/reports/a.md'
        },
        {
          id: 'task-b', svn_url: 'svn://server/b', old_revision: '2', new_revision: '3',
          status: 'success', report_path: '/reports/b.md'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.readTaskReport).mockImplementation((taskId) => {
      if (taskId === 'task-a') return Promise.resolve('# 报告 A')
      return new Promise((resolve) => { resolveReportB = resolve })
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[1])
    await user.click(screen.getByRole('button', { name: /task-a/ }))
    expect(await screen.findByRole('heading', { name: '报告 A' })).toBeInTheDocument()
    act(() => resolveReportB?.('# 报告 B'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '报告 A' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '报告 B' })).not.toBeInTheDocument()
  })

  it('把生产任务取消和失败任务重试交给本地队列', async () => {
    const user = userEvent.setup()
    const cancelRequest = createDeferred<Awaited<ReturnType<CodeReviewApi['cancelTask']>>>()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'running-1', svn_url: 'svn://server/running', old_revision: '1', new_revision: '2',
          review_item_ids: ['DS-03'], status: 'running_codex'
        },
        {
          id: 'failed-1', svn_url: 'svn://server/failed', old_revision: '2', new_revision: '3',
          review_item_ids: ['DS-03'], status: 'failed', error_message: '执行失败'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.retryTask).mockResolvedValueOnce({
      taskId: 'failed-1', status: 'success', reportMarkdown
    })
    vi.mocked(window.codeReview.cancelTask).mockImplementationOnce(() => cancelRequest.promise)
    render(<ProductionReviewWorkbench {...productionProps} />)

    vi.mocked(window.codeReview.openTaskLog).mockResolvedValueOnce({ status: 'missing' })
    await user.click(await screen.findByRole('button', { name: '打开任务日志 failed-1' }))
    expect(window.codeReview.openTaskLog).toHaveBeenCalledWith('failed-1')
    expect(await screen.findByRole('status')).toHaveTextContent('未找到该任务的本地 Codex 执行日志。')
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    await user.click(await screen.findByRole('button', { name: '取消任务 running-1' }))
    expect(window.codeReview.cancelTask).toHaveBeenCalledWith({
      client_task_id: 'running-1', task_id: 'running-1'
    })
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    await act(async () => {
      cancelRequest.resolve({ status: 'cancelled' })
      await cancelRequest.promise
    })
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '从头重试 failed-1' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledWith({
      task_id: 'failed-1', client_task_id: 'failed-1',
      old_revision: '2', new_revision: '3',
      requirement_file_path: undefined, review_items: undefined
    }))
  })

  it('意见反馈只提交用户实际选择的文件，不生成 fixture 截图', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.type(screen.getByLabelText('问题描述'), '生产任务阶段显示异常')
    const screenshot = new File(['image'], '真实截图.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择反馈截图'), [screenshot, screenshot])
    expect(screen.getByText('真实截图.png')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '移除 真实截图.png' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '提交意见' }))
    await waitFor(() => expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
      description: '生产任务阶段显示异常', screenshots: [screenshot]
    }))
  })

  it('环境未就绪时保留安装入口并禁止提交生产任务', async () => {
    render(<ProductionReviewWorkbench {...productionProps} environment={{ status: 'missing_skill' }} />)
    expect(await screen.findByLabelText('本地环境状态')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    expect(screen.getByText('本地环境就绪后才可发起审查。')).toBeInTheDocument()
  })

  it('问题反馈提交事件更新反馈版 PDF 路径', async () => {
    const user = userEvent.setup()
    let issueFeedbackListener: Parameters<CodeReviewApi['onIssueFeedbackSubmitted']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'feedback-task', svn_url: 'svn://server/feedback', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', feedback_protocol_version: 1,
        report_path: '/reports/feedback-task.md', pdf_report_name: '原始报告.pdf'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.onIssueFeedbackSubmitted).mockImplementation((listener) => {
      issueFeedbackListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await screen.findByRole('button', { name: /查看报告/ })
    await user.click(screen.getByRole('button', { name: /查看报告/ }))
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    act(() => issueFeedbackListener?.({
      taskId: 'feedback-task',
      feedbackSubmittedAt: '2026-08-06T09:00:00Z',
      pdfPath: '/reports/feedback-task-reviewed.pdf',
      pdfReportName: '反馈版报告.pdf'
    }))
    expect(await screen.findByRole('button', { name: '查看已提交反馈' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '反馈报告问题' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看已提交反馈' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'issues', taskId: 'feedback-task', anchors: expect.any(Array)
    })
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'feedback-task',
      localPdfPath: '/reports/feedback-task-reviewed.pdf',
      pdfReportName: '反馈版报告.pdf',
      action: 'reveal'
    })
  })

  it('只响应当前报告的反馈锚点并在切换报告时清理高亮', async () => {
    const user = userEvent.setup()
    let focusAnchorListener: Parameters<CodeReviewApi['onReportFeedbackFocusAnchor']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'anchor-a', svn_url: 'svn://server/a', old_revision: '1', new_revision: '2',
          status: 'success', feedback_protocol_version: 1, report_path: '/reports/anchor-a.md'
        },
        {
          id: 'anchor-b', svn_url: 'svn://server/b', old_revision: '2', new_revision: '3',
          status: 'success', feedback_protocol_version: 1, report_path: '/reports/anchor-b.md'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.onReportFeedbackFocusAnchor).mockImplementation((listener) => {
      focusAnchorListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[0])
    await screen.findByRole('heading', { name: 'DS-03 状态机审核报告' })
    const previewScroll = document.querySelector('.preview-scroll') as HTMLDivElement
    previewScroll.scrollTo = vi.fn()
    const issueHeading = document.querySelector<HTMLElement>('[data-report-anchor-id]')
    const issueAnchorId = issueHeading?.dataset.reportAnchorId
    if (!issueAnchorId) throw new Error('新版问题标题应提供反馈锚点')
    expect(issueHeading).not.toHaveClass('report-anchor-highlight')

    act(() => focusAnchorListener?.({ taskId: 'anchor-b', anchorId: issueAnchorId }))
    expect(issueHeading).not.toHaveClass('report-anchor-highlight')
    act(() => focusAnchorListener?.({ taskId: 'anchor-a', anchorId: issueAnchorId }))
    await waitFor(() => expect(document.querySelector(`[data-report-anchor-id="${issueAnchorId}"]`)).toHaveClass('report-anchor-highlight'))

    await user.click(screen.getByRole('button', { name: /anchor-b/ }))
    await waitFor(() => expect(document.querySelector('.report-anchor-highlight')).not.toBeInTheDocument())
  })

  it('旧协议只由当前报告的反馈提交事件自动打开 PDF', async () => {
    const user = userEvent.setup()
    let feedbackSubmittedListener: Parameters<CodeReviewApi['onReportFeedbackSubmitted']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'legacy-feedback', svn_url: 'svn://server/legacy-feedback', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', report_feedback_helpful: null,
        report_path: '/reports/legacy-feedback.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.onReportFeedbackSubmitted).mockImplementation((listener) => {
      feedbackSubmittedListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: /查看报告/ }))
    await user.click(screen.getByRole('button', { name: '报告有帮助' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'legacy', taskId: 'legacy-feedback', options: expect.any(Array)
    })
    await user.click(screen.getByRole('button', { name: '报告没帮助' }))
    expect(window.codeReview.submitNegativeReportFeedback).toHaveBeenCalledTimes(1)
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    expect(await screen.findByText('反馈已提交')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '报告有帮助' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '报告没帮助' })).not.toBeInTheDocument()

    act(() => feedbackSubmittedListener?.({
      taskId: 'other-task', helpful: false, usefulIssuesText: null
    }))
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    act(() => feedbackSubmittedListener?.({
      taskId: 'legacy-feedback', helpful: false, usefulIssuesText: null
    }))
    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'legacy-feedback', localPdfPath: undefined, pdfReportName: undefined
    }))
  })

  it('任务创建和通用意见反馈提交中均防止重复调用', async () => {
    const user = userEvent.setup()
    let resolvePreflight: ((value: { status: 'valid' }) => void) | undefined
    vi.mocked(window.codeReview.preflightTask).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreflight = resolve
    }))
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/no-duplicate')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), '12')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    const createButton = screen.getByRole('button', { name: '创建审查任务' })
    fireEvent.click(createButton)
    fireEvent.click(createButton)
    expect(window.codeReview.preflightTask).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '创建中...' })).toBeDisabled()
    act(() => resolvePreflight?.({ status: 'valid' }))
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    let resolveFeedback: ((value: { id: string; status: 'pending' }) => void) | undefined
    vi.mocked(window.codeReview.submitFeedback).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFeedback = resolve
    }))
    await user.click(screen.getByRole('button', { name: '意见反馈' }))
    await user.type(screen.getByLabelText('问题描述'), '防重复提交')
    const feedbackButton = screen.getByRole('button', { name: '提交意见' })
    fireEvent.click(feedbackButton)
    fireEvent.click(feedbackButton)
    expect(window.codeReview.submitFeedback).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled()
    act(() => resolveFeedback?.({ id: 'feedback-once', status: 'pending' }))
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toHaveValue(''))
  })
})
