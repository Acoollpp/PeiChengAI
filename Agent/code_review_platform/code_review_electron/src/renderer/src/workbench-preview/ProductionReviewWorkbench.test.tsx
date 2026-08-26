// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi, Feedback, FeedbackListResponse } from '../code-review-api'
import type { TaskProgressEvent } from '../../../shared/types'
import { ProductionReviewWorkbench } from './ProductionReviewWorkbench'
import type { ReviewItemDefinition } from './types'

const reportMarkdown = `# DS-03 状态机审核报告

## 一、审查问题

### P01 [高风险] 状态恢复事件缺失

**所属审查项：** DS-03 · 状态机审核
**规则章节：** 故障恢复状态转换

**涉及文件及行号：**

| 文件 | 行号 | 位置说明 |
|------|------|----------|
| \`source/state.c\` | 42 | 状态恢复分支 |

**问题描述：** 恢复分支没有发送完成事件。
**影响风险：** 上层无法感知状态恢复完成。
**整改建议：** 在恢复完成时发送对应事件。
`

const zeroIssueReportMarkdown = `# 代码审查报告

**审查范围：**

| 审查项 ID | 审查项名称 | SVN 证据模式 |
|-----------|------------|---------------|
| DS-03 | 状态机审核 | old_to_new_diff |

## 一、审查问题

本次未发现能够闭环的问题。

## 二、审查覆盖

### 覆盖摘要

此标题不属于审查问题。
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
    hideTask: vi.fn(async () => ({ status: 'hidden' as const })),
    readReportAsset: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,aW1hZ2U=' })),
    showTaskCompletionNotification: vi.fn(async () => ({ status: 'shown' as const })),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' as const })),
    listFeedback: vi.fn(async () => ({ data: [], count: 0 })),
    readFeedback: vi.fn(),
    readFeedbackScreenshot: vi.fn(),
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

const multipleMaterialStressCatalog: ReviewItemDefinition[] = [
  {
    id: 'DS-01',
    category: '测试目录',
    name: '多材料审查',
    summary: '仅用于验证 renderer 多文件摘要，不改变正式目录。',
    goal: '验证多文件材料数量。',
    process: ['使用真实生产组件渲染'],
    specification: '仅用于自动化验收。',
    materialFields: [{
      id: 'evidence',
      label: '审查证据',
      description: '可选择多份 PDF 证据。',
      required: true,
      extensions: ['.pdf'],
      multiplicity: 'multiple'
    }]
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
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
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('ProductionReviewWorkbench', () => {
  it('运行任务进入完成状态后停止轮换并清理活动反馈定时器', async () => {
    vi.useFakeTimers()
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'active-to-success', svn_url: 'svn://server/active-to-success',
        old_revision: '1', new_revision: '2', review_item_ids: ['DS-03'], status: 'running_codex'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const runningRow = screen.getByRole('article', { name: /active-to-success/ })
    expect(within(runningRow).getByText('正在执行审查规则与代码证据。')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)

    act(() => vi.advanceTimersByTime(4000))
    expect(within(runningRow).getByText('审查正在继续，请保持客户端打开。')).toBeInTheDocument()

    act(() => progressListener?.({
      taskId: 'active-to-success', type: 'stage', stage: 'success', message: '报告上传完成'
    }))

    const completedRow = screen.getByRole('article', { name: /active-to-success/ })
    expect(completedRow.querySelector('.wb-task-activity-spinner')).toBeNull()
    expect(within(completedRow).getByText('任务已完成，但未生成可查看的 Markdown 报告。')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)

    act(() => vi.advanceTimersByTime(8000))
    expect(within(completedRow).getByText('任务已完成，但未生成可查看的 Markdown 报告。')).toBeInTheDocument()
  })

  it('服务端运行统计为零时仍显示本机正在执行的任务数', async () => {
    vi.mocked(window.codeReview.executeTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.getTodayTaskStats).mockResolvedValue(taskStats(0, 0, 0))
    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/local-running-count')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    const overview = await screen.findByLabelText('任务总览')
    await waitFor(() => {
      expect(within(overview).getByText('正在执行').closest('div')).toHaveTextContent('1')
      expect(within(overview).getByText('本机等待').closest('div')).toHaveTextContent('0')
    })
  })

  it('成功创建任务后记录 SVN 地址到最近历史，预检失败时不记录', async () => {
    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/recent-history')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    expect(JSON.parse(localStorage.getItem('code-review:recent-svn-urls') ?? '[]')).toEqual([
      'svn://server/recent-history'
    ])

    vi.mocked(window.codeReview.preflightTask).mockResolvedValue({
      status: 'invalid',
      errors: { svn_url: 'SVN 地址无法访问' }
    })
    await submitMinimalDs03Task('svn://server/preflight-fail')

    expect(JSON.parse(localStorage.getItem('code-review:recent-svn-urls') ?? '[]')).toEqual([
      'svn://server/recent-history'
    ])
  })

  it('总览的执行和等待计数始终取自当前 renderer 队列', async () => {
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
    expect(within(overview).getByText('正在执行').closest('div')).toHaveTextContent('2')
    expect(within(overview).getByText('本机等待').closest('div')).toHaveTextContent('1')
    expect(within(overview).getByText('今日失败').closest('div')).toHaveTextContent('4')
    expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('11')
    expect(within(overview).queryByText(/321|99|预计|趋势|%/)).not.toBeInTheDocument()
    expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2)
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
  })

  it('生产任务状态更新不覆盖用户手动选择的任务视图', async () => {
    const user = userEvent.setup()
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'running-lane', svn_url: 'svn://server/running-lane',
          old_revision: '10', new_revision: '11', review_item_ids: ['DS-03'],
          status: 'running_codex'
        },
        {
          id: 'failed-lane', svn_url: 'svn://server/failed-lane',
          old_revision: '11', new_revision: '12', review_item_ids: ['DS-03'],
          status: 'failed', error_message: '生产任务失败，等待用户处理。'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.getTodayTaskStats).mockResolvedValue(taskStats(1, 1, 0))
    vi.mocked(window.codeReview.retryTask).mockImplementation(() => new Promise<never>(() => undefined))
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    const currentTab = await screen.findByRole('tab', { name: '当前任务 1' })
    expect(currentTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('article', { name: /running-lane/ })).toBeInTheDocument()
    expect(screen.queryByText('生产任务失败，等待用户处理。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '待处理失败任务 1' }))
    expect(screen.getByText('生产任务失败，等待用户处理。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开任务日志 failed-lane' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '从头重试 failed-lane' }))

    act(() => progressListener?.({
      taskId: 'failed-lane', clientTaskId: 'failed-lane', type: 'stage',
      stage: 'checking_environment', message: '失败任务重试后进入环境检查'
    }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '待处理失败任务 0' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByText('暂无待处理失败任务')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '当前任务 2' })).toBeInTheDocument()
    expect(screen.queryByText('失败任务重试后进入环境检查')).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('本地环境状态')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看本地依赖状态' })).toHaveAttribute('aria-expanded', 'false')

    await submitMinimalDs03Task('svn://server/stats-fallback')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: '重新加载统计' }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(screen.getByLabelText('任务总览')).getByText('今日完成').closest('button')).toHaveTextContent('3'))
  })

  it('真实任务仅在进入统计终态时后台刷新今日统计，日志和执行阶段不重复请求', async () => {
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
    await waitFor(() => expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('5'))
    await submitMinimalDs03Task('svn://server/stats-refresh')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    const clientTaskId = vi.mocked(window.codeReview.executeTask).mock.calls[0][0].client_task_id
    if (!clientTaskId) throw new Error('本地任务 ID 未生成')

    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'created', message: '服务端任务已创建'
    }))
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
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'success', message: '审查完成'
    }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('5')
    expect(screen.queryByText('正在加载今日服务端统计。')).not.toBeInTheDocument()

    await act(async () => {
      backgroundRefresh.resolve(taskStats(2, 1, 6))
      await backgroundRefresh.promise
    })
    await waitFor(() => expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('6'))

    act(() => progressListener?.({
      taskId: 'server-stats-refresh', clientTaskId, type: 'stage', stage: 'success', message: '重复完成事件'
    }))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2)
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
      taskId: 'server-stats-race', clientTaskId, type: 'stage', stage: 'success', message: '服务端任务已完成'
    }))

    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
    const overview = await screen.findByLabelText('任务总览')
    await waitFor(() => expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('9'))
    await act(async () => {
      initialRequest.resolve(taskStats(1, 0, 1))
      await initialRequest.promise
    })
    await waitFor(() => expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('9'))
  })

  it('失败任务重试仅在重新进入统计终态时刷新统计', async () => {
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

    expect(await screen.findByRole('tab', { name: '待处理失败任务 1' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.setup().click(await screen.findByRole('button', { name: '从头重试 retry-stats' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledTimes(1))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

    act(() => progressListener?.({
      taskId: 'retry-stats', clientTaskId: 'retry-stats',
      type: 'stage', stage: 'checking_environment', message: '重试任务已进入环境检查'
    }))
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

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
    await waitFor(() => expect(screen.getByText('正在执行审查规则与代码证据。')).toBeInTheDocument())
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)

    act(() => progressListener?.({
      taskId: 'retry-stats', clientTaskId: 'retry-stats',
      type: 'stage', stage: 'success', message: '重试任务已完成'
    }))
    await waitFor(() => expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(2))
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
      if (expectedLabel === '环境检查') {
        expect(within(row).getByText('正在检查本机审查环境。')).toBeInTheDocument()
      } else if (expectedLabel === '准备工作区') {
        expect(within(row).getByText('正在准备任务专属工作区。')).toBeInTheDocument()
      } else if (expectedLabel === '执行 Skill') {
        expect(within(row).getByText('正在执行审查规则与代码证据。')).toBeInTheDocument()
      } else {
        expect(within(row).getByText('正在整理审查报告并上传。')).toBeInTheDocument()
      }
      expect(row.querySelector('.wb-task-activity-spinner')).not.toBeNull()
    }

    await assertStage('created', '环境检查')
    await assertStage('checking_environment', '环境检查')
    await assertStage('preparing_workspace', '准备工作区')
    await assertStage('running_codex', '执行 Skill')
    const runningRow = await screen.findByRole('article', { name: /server-stage-task/ })
    await userEvent.setup().click(within(runningRow).getByRole('button', { name: '打开任务日志 server-stage-task' }))
    expect(window.codeReview.openTaskLog).toHaveBeenCalledWith('server-stage-task')
    act(() => progressListener?.({
      taskId: 'server-stage-task', clientTaskId, type: 'codex_output', stream: 'stdout',
      message: 'succeeded in 291ms: 大段原始 Codex 输出'
    }))
    expect(within(runningRow).getByText('正在执行审查规则与代码证据。')).toBeInTheDocument()
    expect(within(runningRow).queryByText(/大段原始 Codex 输出/)).not.toBeInTheDocument()
    await assertStage('uploading_report', '上传报告')
  })

  it('真实队列和任务事件映射本机等待、完成、失败、环境异常和已取消', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    const executions = [
      createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>(),
      createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>(),
      createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
    ]
    vi.mocked(window.codeReview.executeTask).mockImplementation(
      () => executions[vi.mocked(window.codeReview.executeTask).mock.calls.length - 1].promise
    )
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
    expect(waitingRow?.querySelector('.wb-task-activity-spinner')).toBeNull()
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    await userEvent.setup().click(within(waitingRow as HTMLElement).getByRole('button', { name: /取消任务/ }))
    await waitFor(() => expect(screen.queryByText('svn://server/terminal-cancelled')).not.toBeInTheDocument())
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
    expect(failedRow.querySelector('.wb-task-activity-spinner')).toBeNull()

    await submitMinimalDs03Task('svn://server/terminal-environment-error')
    expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2)
    executions[0].resolve({ taskId: 'server-success', status: 'success' })
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
    expect(environmentErrorRow.querySelector('.wb-task-activity-spinner')).toBeNull()
  })

  it('默认使用正式目录，只在显式注入时渲染长名称压力目录', async () => {
    const user = userEvent.setup()
    const firstRender = render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('button', { name: '选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' })).toBeInTheDocument()
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
    expect(screen.queryByText('编码规范审查')).not.toBeInTheDocument()
  })

  it('synthetic 多文件目录确认后显示文件数量摘要', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/第一份证据.pdf',
        fileName: '第一份证据.pdf',
        fileSize: 1024
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/第二份证据.pdf',
        fileName: '第二份证据.pdf',
        fileSize: 2048
      })
    render(
      <ProductionReviewWorkbench
        {...productionProps}
        catalogOverride={multipleMaterialStressCatalog}
      />
    )

    await user.click(await screen.findByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 多材料审查' }))
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(screen.getByText('已选 1 项 · 2 个材料文件')).toBeInTheDocument()
    expect(screen.getByText('DS-01').closest('.wb-selected-item')).toHaveTextContent(
      '2 个材料文件已就绪'
    )
    expect(window.codeReview.selectReviewMaterialFile).toHaveBeenCalledTimes(2)
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
    expect(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-01 需求变更审查' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*MOS 充放电状态机审查/ }))
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
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '编码规范审查')
    expect(screen.getByText('日常提交审核')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 DS-01 需求变更审查' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审查/ }))
    expect(screen.getByRole('article', { name: 'DS-02 编码规范审查 详情' })).toHaveTextContent(
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

  it('通过系统文件选择器提交 DS-01 的 Excel 和独立额外规则', async () => {
    const user = userEvent.setup()
    const longRequirementName = 'BMS_平台_V2.7_低压上下电与故障恢复产品开发需求表_最终评审修订版_20260806.xlsx'
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: `/local/materials/${longRequirementName}`,
        fileName: longRequirementName,
        fileSize: 2048
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), '130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 需求变更审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对本次协议导入')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    const longName = await screen.findByText(longRequirementName)
    expect(longName).toHaveAttribute('title', longRequirementName)
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('已选 1 项 · 1 个材料文件')).toBeInTheDocument()
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
            }
          ]
        }]
      })
    ))
  })

  it('同时提交 DS-01、DS-04 和 DS-06，并保留各自额外规则与材料边界', async () => {
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
        filePath: '/local/materials/AFE-A.pdf',
        fileName: 'AFE-A.pdf',
        fileSize: 4096
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/AFE-B.pdf',
        fileName: 'AFE-B.pdf',
        fileSize: 5120
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/AFE-C.pdf',
        fileName: 'AFE-C.pdf',
        fileSize: 6144
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/产品规格书.pdf',
        fileName: '产品规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/multi-items')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), 'R130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 需求变更审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '只核对协议导入')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-04 AFE 驱动审核' }))
    await user.click(screen.getByRole('button', { name: /DS-04.*AFE 驱动审核/ }))
    await user.type(screen.getByLabelText('DS-04 额外规则'), '只检查 AFE 初始化')
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: `移除 AFE-A.pdf` }))
    expect(screen.queryByText('AFE-A.pdf')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-06 规格书审查' }))
    await user.click(screen.getByRole('button', { name: /DS-06.*规格书审查/ }))
    await user.type(screen.getByLabelText('DS-06 额外规则'), '只核对第五章配置')
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '完成选择（3）' }))

    expect(screen.getByText('已选 3 项 · 4 个材料文件')).toBeInTheDocument()
    expect(screen.getByText('DS-01').closest('.wb-selected-item')).toHaveTextContent('1 个材料文件已就绪')
    expect(screen.getByText('DS-04').closest('.wb-selected-item')).toHaveTextContent('2 个材料文件已就绪')
    expect(screen.getByText('DS-06').closest('.wb-selected-item')).toHaveTextContent('1 个材料文件已就绪')
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
            user_extra_rules: '只核对协议导入',
            materials: [
              {
                field_id: 'requirement-sheet',
                file_paths: ['/local/materials/组合审查需求表.xlsx']
              }
            ]
          },
          {
            id: 'DS-04',
            user_extra_rules: '只检查 AFE 初始化',
            materials: [
              {
                field_id: 'chip-specs',
                file_paths: ['/local/materials/AFE-B.pdf', '/local/materials/AFE-C.pdf']
              }
            ]
          },
          {
            id: 'DS-06',
            user_extra_rules: '只核对第五章配置',
            materials: [
              {
                field_id: 'product-spec',
                file_paths: ['/local/materials/产品规格书.pdf']
              }
            ]
          }
        ]
      })
    ))
  })

  it('提交 DS-01 + DS-02 时需求表只归属 DS-01', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/DS01-DS02-需求表.xlsx',
        fileName: 'DS01-DS02-需求表.xlsx',
        fileSize: 2048
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01-ds02')
    await user.type(screen.getByLabelText('旧 revision'), '220')
    await user.type(screen.getByLabelText('新 revision'), 'R230')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 需求变更审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对产品需求')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审查/ }))
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审查/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '只检查命名一致性')
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*MOS 充放电状态机审查/ }))
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
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '日常提交审核')
    await user.click(screen.getByRole('checkbox', { name: '选择日常提交审核全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 4 项')
    await user.clear(screen.getByPlaceholderText('搜索 ID、名称或分类'))
    await user.click(screen.getByRole('checkbox', { name: '选择控制逻辑专项审核全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 6 项')
    await user.click(screen.getByRole('checkbox', { name: '仅看已选' }))
    const catalogList = screen.getByLabelText('审查项列表')
    expect(within(catalogList).getByText('需求变更审查')).toBeInTheDocument()
    expect(within(catalogList).getByText('编码规范审查')).toBeInTheDocument()
    expect(within(catalogList).getByText('变更点风险检查')).toBeInTheDocument()
    expect(within(catalogList).getByText('MOS 充放电状态机审查')).toBeInTheDocument()
    expect(within(catalogList).getByText('休眠唤醒状态机审查')).toBeInTheDocument()
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审查/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '上一次已确认规则')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('DS-02').closest('.wb-selected-item')).toHaveTextContent('已填写额外规则')

    const assertConfirmedDraftRestored = async (): Promise<void> => {
      expect(screen.getByLabelText('DS-02 额外规则')).toHaveValue('上一次已确认规则')
      expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' })).not.toBeChecked()
    }
    const changeDraft = async (): Promise<void> => {
      await user.clear(screen.getByLabelText('DS-02 额外规则'))
      await user.type(screen.getByLabelText('DS-02 额外规则'), '本轮未确认规则')
      await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
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

  it('DS-01 和 DS-06 一次显示缺失材料和错误扩展名', async () => {
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 需求变更审查' }))
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-06 规格书审查' }))
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))

    expect(screen.getByRole('alert')).toHaveTextContent('DS-01 产品开发需求表仅支持 .xlsx、.xls 文件')
    expect(screen.getByRole('alert')).toHaveTextContent('DS-06 产品规格书未选择')
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

    await waitFor(() => expect(screen.getByRole('tab', { name: '已完成任务 1' })).toHaveAttribute('aria-selected', 'true'))
    const completedRow = screen.getByRole('article', { name: /success-without-report-path/ })
    expect(completedRow).toHaveTextContent('任务已完成，但未生成可查看的 Markdown 报告。')
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
    expect(screen.queryByText(
      '任务 success-without-report-path 已完成，可查看报告。'
    )).not.toBeInTheDocument()
    expect(within(completedRow).queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()
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

    await userEvent.setup().click(await screen.findByRole('button', { name: '报告中心' }))
    const legacyReportRow = (await screen.findByText('legacy · r0 → r12')).closest('button')
    expect(legacyReportRow).not.toBeNull()
    expect(legacyReportRow).toHaveTextContent('r0 → r12')
    expect(screen.getAllByText(/历史任务未记录审查项/).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)
    })
    await userEvent.setup().click(screen.getByRole('button', { name: '任务管理' }))
    progressListener?.({
      taskId: 'running-1',
      type: 'stage',
      stage: 'preparing_workspace',
      message: '正在准备真实工作区'
    })
    expect(await screen.findByText('准备工作区')).toBeInTheDocument()
    expect(screen.getByText('正在准备任务专属工作区。')).toBeInTheDocument()
  })

  it('任务台显示服务端已完成任务，并仅对有 Markdown 路径的任务提供查看报告入口', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'success-without-report',
          svn_url: 'svn://server/no-report',
          old_revision: '1',
          new_revision: '2',
          status: 'success',
          report_name: '无 Markdown 路径报告.md',
          finished_at: '2026-08-06T08:00:00Z'
        },
        {
          id: 'success-with-report-a',
          svn_url: 'svn://server/report-a',
          old_revision: '2',
          new_revision: '3',
          review_item_ids: ['DS-02'],
          status: 'success',
          report_name: '首个可读报告.md',
          report_path: '/reports/report-a.md',
          finished_at: '2026-08-06T08:05:00Z'
        },
        {
          id: 'success-with-report-b',
          svn_url: 'svn://server/report-b',
          old_revision: '3',
          new_revision: '4',
          review_item_ids: ['DS-03'],
          status: 'success',
          report_name: '任务台跳转目标报告.md',
          report_path: '/reports/report-b.md',
          finished_at: '2026-08-06T08:10:00Z'
        }
      ],
      count: 3
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: '已完成任务 3' }))
    expect(screen.queryByRole('article', { name: 'Markdown 报告预览' })).not.toBeInTheDocument()

    const taskWithoutReport = screen.getByRole('article', { name: /success-without-report/ })
    expect(taskWithoutReport).toHaveTextContent('任务已完成，但未生成可查看的 Markdown 报告。')
    expect(within(taskWithoutReport).queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()

    const taskWithReport = screen.getByRole('article', { name: /success-with-report-b/ })
    expect(taskWithReport).toHaveTextContent('任务台跳转目标报告')
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('success-with-report-a'))
    vi.mocked(window.codeReview.readTaskReport).mockClear()

    await user.click(within(taskWithReport).getByRole('button', { name: '查看报告' }))

    expect(await screen.findByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('success-with-report-b'))
    const preview = screen.getByRole('article', { name: 'Markdown 报告预览' })
    expect(within(preview).getByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
  })

  it('同屏区分协议 1 无严重度摘要与历史严重度、历史未知摘要', async () => {
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
          finished_at: '2026-08-06T08:00:00Z'
        },
        {
          id: 'zero-report', svn_url: 'svn://server/zero', old_revision: '120', new_revision: '121',
          review_item_ids: ['DS-03'], status: 'success', report_name: '零问题报告.md',
          report_path: '/reports/zero-report.md',
          feedback_protocol_version: 1, issue_count: 0, highest_issue_severity: null
        },
        {
          id: 'no-severity-report', svn_url: 'svn://server/no-severity',
          old_revision: '121', new_revision: '122', review_item_ids: ['DS-01', 'DS-03'],
          status: 'success', report_name: '无严重度报告.md',
          report_path: '/reports/no-severity-report.md',
          feedback_protocol_version: 1, issue_count: 2, highest_issue_severity: null
        },
        {
          id: 'legacy-unknown-summary', svn_url: 'svn://server/legacy-unknown',
          old_revision: '122', new_revision: '123', review_item_ids: ['DS-02'],
          status: 'success', report_name: '历史未知摘要.md',
          report_path: '/reports/legacy-unknown-summary.md'
        }
      ],
      count: 4
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    expect(await screen.findByText('多审查项真实报告')).toBeInTheDocument()
    expect(screen.getAllByText(/DS-01 · 需求变更审查/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/DS-02 · 编码规范审查/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/DS-FUTURE/).length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)
    })
    const zeroReportRow = screen.getByText('零问题报告').closest('button')
    expect(zeroReportRow).not.toBeNull()
    expect(within(zeroReportRow as HTMLElement).getByText('0 个问题')).toBeInTheDocument()
    expect(zeroReportRow).not.toHaveTextContent('严重度未知')
    expect(screen.queryByText(/无最高严重度/)).not.toBeInTheDocument()
    const noSeverityReportRow = screen.getByText('无严重度报告').closest('button')
    expect(noSeverityReportRow).not.toBeNull()
    expect(within(noSeverityReportRow as HTMLElement).getByText('2 个问题')).toBeInTheDocument()
    expect(noSeverityReportRow).not.toHaveTextContent('严重度未知')
    const legacyUnknownRow = screen.getByText('历史未知摘要').closest('button')
    expect(legacyUnknownRow).not.toBeNull()
    expect(within(legacyUnknownRow as HTMLElement).getByText(
      '问题数未记录 · 严重度未知'
    )).toBeInTheDocument()
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledTimes(1))
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('multi-report')
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalledWith('zero-report')

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

    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    await waitFor(() => expect(window.codeReview.readTaskReport).toHaveBeenCalledTimes(1))
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('legacy-with-report')
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalledWith('success-without-report')

    const reportIndex = screen.getByLabelText('任务和报告列表')
    expect(within(reportIndex).getAllByRole('button')).toHaveLength(2)
    expect(within(reportIndex).queryByText('仅有报告名')).not.toBeInTheDocument()
    expect(within(reportIndex).getByText('legacy-report · r2 → r3')).toBeInTheDocument()
    expect(within(reportIndex).getByText('新版真实报告')).toBeInTheDocument()
  })

  it('本次会话内新完成的报告排在报告列表首位', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'older-report', svn_url: 'svn://server/older-report',
          old_revision: '1', new_revision: '2', status: 'success',
          report_name: '较早的报告.md', report_path: '/reports/older-report.md',
          started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:10:00.000Z'
        }
      ],
      count: 1
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    await submitMinimalDs03Task('svn://server/newer-report')
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    const reportIndex = await screen.findByLabelText('任务和报告列表')
    await waitFor(() =>
      expect(within(reportIndex).getAllByRole('button')).toHaveLength(2)
    )

    // 新完成的任务在 queue.tasks 里被追加到末尾，只有按完成时间倒序才会回到首位。
    const reportButtons = within(reportIndex).getAllByRole('button')
    expect(reportButtons[0]).toHaveTextContent('task-production-1')
    expect(reportButtons[1]).toHaveTextContent('older-report')
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

    await userEvent.setup().click(await screen.findByRole('button', { name: '报告中心' }))
    expect(await screen.findByText('StrictMode 报告')).toBeInTheDocument()
  })

  it('报告列表失败不阻断任务创建并可独立重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks)
      .mockRejectedValueOnce(new Error('报告服务暂不可用'))
      .mockResolvedValueOnce({ data: [], count: 0 })

    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findByRole('button', { name: '创建审查任务' })).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    const reportError = await screen.findByRole('alert', { name: '报告列表加载失败' })
    expect(reportError).toHaveTextContent('报告服务暂不可用')
    await user.click(within(reportError).getByRole('button', { name: '重新加载报告列表' }))
    await waitFor(() => expect(window.codeReview.listTasks).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('暂无可预览报告')).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: '报告中心' }))

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
      '# 原始报告\n\n## 三、审查问题\n\n### <问题编号> <问题标题>\n\n正文仍然可查看。'
    )

    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '报告中心' }))

    const parseError = await screen.findByRole('alert', { name: '报告结构解析失败' })
    expect(parseError).toHaveTextContent('不符合 bms-code-reviewer 固定模板')
    expect(screen.getByRole('heading', { name: '原始报告' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
  })

  it('报告中心将带中文句号的固定零问题报告显示为 0 个问题', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'zero-report-punctuation', svn_url: 'svn://server/zero-punctuation',
        old_revision: '1', new_revision: '2', review_item_ids: ['DS-03'],
        status: 'success', feedback_protocol_version: 1, issue_count: 0,
        highest_issue_severity: null, report_path: '/reports/zero-punctuation.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readTaskReport).mockResolvedValueOnce(zeroIssueReportMarkdown)

    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '报告中心' }))

    await waitFor(() => {
      expect(screen.getAllByText(/0 个问题/).length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('alert', { name: '报告结构解析失败' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
  })

  it('revision 接受可选 r 前缀，展示保持单个 r 且提交保留用户输入', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/prefixed')
    await user.type(screen.getByLabelText('旧 revision'), 'r0')
    await user.type(screen.getByLabelText('新 revision'), 'R12')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.preflightTask).toHaveBeenCalledWith({
      svn_url: 'svn://server/prefixed', old_revision: 'r0', new_revision: 'R12'
    }))
    expect(window.codeReview.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      old_revision: 'r0', new_revision: 'R12'
    }))
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    const prefixedReportRow = (await screen.findByText('prefixed · r0 → r12')).closest('button')
    expect(prefixedReportRow).not.toBeNull()
    expect(prefixedReportRow).toHaveTextContent('r0 → r12')
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
    vi.mocked(window.codeReview.readReportAsset).mockResolvedValueOnce({
      dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      contentType: 'image/svg+xml'
    })
    vi.mocked(window.codeReview.readTaskReport).mockResolvedValueOnce(
      '# 状态机报告\n\n![问题 01 代码证据](images/issue-01.svg)'
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    await waitFor(() => expect(window.codeReview.readReportAsset).toHaveBeenCalledWith({
      taskId: 'asset-task', assetPath: 'images/issue-01.svg'
    }))
    expect(await screen.findByRole('img', { name: '问题 01 代码证据' })).toHaveAttribute(
      'src', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
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
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    await user.click(screen.getByRole('button', { name: /task-b/ }))
    await user.click(screen.getByRole('button', { name: /task-a/ }))
    expect(await screen.findByRole('heading', { name: '报告 A' })).toBeInTheDocument()
    act(() => resolveReportB?.('# 报告 B'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '报告 A' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '报告 B' })).not.toBeInTheDocument()
  })

  it('DS-99 跨会话重试锁定原规则和模式，并要求重新选择原有材料', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'ds99-failed', svn_url: 'svn://server/ds99', old_revision: '2', new_revision: '3',
        review_item_ids: ['DS-99'], status: 'failed', error_message: '执行失败',
        custom_review_rule: '保护状态必须具备恢复路径。', custom_review_mode: 'dual_revision',
        has_custom_review_word_material: true, has_custom_review_excel_material: false,
        has_custom_review_pdf_material: false
      }],
      count: 1
    })
    vi.mocked(window.codeReview.selectReviewMaterialFile).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则.docx', fileName: '规则.docx', fileSize: 1024
    })
    vi.mocked(window.codeReview.retryTask).mockResolvedValueOnce({ taskId: 'ds99-failed', status: 'failed' })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: /待处理失败任务 1/ }))
    await user.click(screen.getByRole('button', { name: '从头重试 ds99-failed' }))

    expect(window.codeReview.retryTask).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: '补充重试材料' })).toBeInTheDocument()
    expect(screen.getByLabelText('原审查规则（不可修改）')).toHaveValue('保护状态必须具备恢复路径。')
    expect(screen.getByLabelText('原审查规则（不可修改）')).toHaveAttribute('readonly')
    expect(screen.getByText('变更代码审查模式')).toBeInTheDocument()
    expect(screen.queryByText('Excel 材料')).not.toBeInTheDocument()
    expect(screen.queryByText('PDF 材料')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '选择材料' }))
    expect(window.codeReview.selectReviewMaterialFile).toHaveBeenCalledWith({
      review_item_id: 'DS-99', field_id: 'word-materials'
    })
    await user.click(screen.getByRole('button', { name: '按原规则重试' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledWith({
      task_id: 'ds99-failed', client_task_id: 'ds99-failed',
      old_revision: '2', new_revision: '3', requirement_file_path: undefined,
      review_items: [{
        id: 'DS-99', user_extra_rules: '保护状态必须具备恢复路径。',
        custom_mode: 'dual_revision',
        materials: [{ field_id: 'word-materials', file_paths: ['/retry/规则.docx'] }]
      }]
    }))
  })

  it('DS-99 重试材料总大小超过 100 MB 时不进入队列', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'ds99-oversized', svn_url: 'svn://server/ds99', old_revision: '2', new_revision: '3',
        review_item_ids: ['DS-99'], status: 'failed', error_message: '执行失败',
        custom_review_rule: '保护状态必须具备恢复路径。', custom_review_mode: 'dual_revision',
        has_custom_review_word_material: true, has_custom_review_excel_material: false,
        has_custom_review_pdf_material: false
      }],
      count: 1
    })
    const twentyMegabytes = 20 * 1024 * 1024
    vi.mocked(window.codeReview.selectReviewMaterialFile).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-1.docx', fileName: '规则-1.docx', fileSize: twentyMegabytes
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-2.docx', fileName: '规则-2.docx', fileSize: twentyMegabytes
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-3.docx', fileName: '规则-3.docx', fileSize: twentyMegabytes
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-4.docx', fileName: '规则-4.docx', fileSize: twentyMegabytes
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-5.docx', fileName: '规则-5.docx', fileSize: twentyMegabytes
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则-6.docx', fileName: '规则-6.docx', fileSize: twentyMegabytes
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: /待处理失败任务 1/ }))
    await user.click(screen.getByRole('button', { name: '从头重试 ds99-oversized' }))
    for (let index = 0; index < 6; index += 1) {
      await user.click(screen.getByRole('button', { name: '选择材料' }))
    }
    await user.click(screen.getByRole('button', { name: '按原规则重试' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('DS-99 三类材料总大小不能超过 100 MB。')
    expect(window.codeReview.retryTask).not.toHaveBeenCalled()
  })

  it('DS-99 快照部分缺失时明确提示新建任务且不进入重试队列', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'ds99-partial', svn_url: 'svn://server/ds99', old_revision: '2', new_revision: '3',
        review_item_ids: ['DS-99'], status: 'failed', error_message: '执行失败',
        custom_review_rule: '保护状态必须具备恢复路径。', custom_review_mode: 'dual_revision',
        has_custom_review_word_material: true, has_custom_review_excel_material: null,
        has_custom_review_pdf_material: false
      }],
      count: 1
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: /待处理失败任务 1/ }))
    await user.click(screen.getByRole('button', { name: '从头重试 ds99-partial' }))

    expect(await screen.findByRole('status')).toHaveTextContent('历史任务输入快照不完整，请新建任务。')
    expect(screen.queryByRole('dialog', { name: '补充重试材料' })).not.toBeInTheDocument()
    expect(window.codeReview.retryTask).not.toHaveBeenCalled()
  })

  it('DS-99 与 DS-01 组合重试时分别重选自定义和固定材料', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'ds99-ds01', svn_url: 'svn://server/ds99', old_revision: '2', new_revision: '3',
        review_item_ids: ['DS-99', 'DS-01'], status: 'failed', error_message: '执行失败',
        custom_review_rule: '保护状态必须具备恢复路径。', custom_review_mode: 'dual_revision',
        has_custom_review_word_material: true, has_custom_review_excel_material: false,
        has_custom_review_pdf_material: false
      }],
      count: 1
    })
    vi.mocked(window.codeReview.selectReviewMaterialFile).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/规则.docx', fileName: '规则.docx', fileSize: 1024
    }).mockResolvedValueOnce({
      status: 'selected', filePath: '/retry/需求.xlsx', fileName: '需求.xlsx', fileSize: 2048
    })
    vi.mocked(window.codeReview.retryTask).mockResolvedValueOnce({ taskId: 'ds99-ds01', status: 'failed' })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: /待处理失败任务 1/ }))
    await user.click(screen.getByRole('button', { name: '从头重试 ds99-ds01' }))
    expect(screen.getByLabelText('DS-01 固定材料')).toBeInTheDocument()

    const materialButtons = screen.getAllByRole('button', { name: '选择材料' })
    await user.click(materialButtons[0])
    await user.click(materialButtons[1])
    expect(window.codeReview.selectReviewMaterialFile).toHaveBeenNthCalledWith(1, {
      review_item_id: 'DS-99', field_id: 'word-materials'
    })
    expect(window.codeReview.selectReviewMaterialFile).toHaveBeenNthCalledWith(2, {
      review_item_id: 'DS-01', field_id: 'requirement-sheet'
    })
    await user.click(screen.getByRole('button', { name: '按原规则重试' }))

    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledWith({
      task_id: 'ds99-ds01', client_task_id: 'ds99-ds01',
      old_revision: '2', new_revision: '3', requirement_file_path: undefined,
      review_items: [
        {
          id: 'DS-99', user_extra_rules: '保护状态必须具备恢复路径。', custom_mode: 'dual_revision',
          materials: [{ field_id: 'word-materials', file_paths: ['/retry/规则.docx'] }]
        },
        { id: 'DS-01', materials: [{ field_id: 'requirement-sheet', file_paths: ['/retry/需求.xlsx'] }] }
      ]
    }))
  })

  it('把生产任务取消和跨会话失败任务重试交给本地队列', async () => {
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
          review_item_ids: ['DS-03'], status: 'failed', error_message: '执行失败',
          feedback_protocol_version: 1, issue_count: 0, highest_issue_severity: null
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.retryTask).mockResolvedValueOnce({
      taskId: 'failed-1', status: 'success', reportMarkdown,
      serverTask: {
        id: 'failed-1', svn_url: 'svn://server/failed', old_revision: '2', new_revision: '3',
        review_item_ids: ['DS-03'], status: 'success', feedback_protocol_version: 1,
        issue_count: 1, highest_issue_severity: 'high', report_path: '/reports/failed-1.md'
      }
    })
    vi.mocked(window.codeReview.cancelTask).mockImplementationOnce(() => cancelRequest.promise)
    render(<ProductionReviewWorkbench {...productionProps} />)

    vi.mocked(window.codeReview.openTaskLog).mockResolvedValueOnce({ status: 'missing' })
    await user.click(await screen.findByRole('tab', { name: /待处理失败任务/ }))
    await user.click(await screen.findByRole('button', { name: '打开任务日志 failed-1' }))
    expect(window.codeReview.openTaskLog).toHaveBeenCalledWith('failed-1')
    expect(await screen.findByRole('status')).toHaveTextContent('未找到该任务的本地 Codex 执行日志。')
    expect(window.codeReview.getTodayTaskStats).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('tab', { name: /当前任务/ }))
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
    await user.click(screen.getByRole('tab', { name: /待处理失败任务/ }))
    await user.click(screen.getByRole('button', { name: '从头重试 failed-1' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledWith({
      task_id: 'failed-1', client_task_id: 'failed-1',
      old_revision: '2', new_revision: '3',
      requirement_file_path: undefined, review_items: undefined
    }))
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
    await user.click(await screen.findByRole('button', { name: /failed-1/ }))
    expect(await screen.findByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
    expect(screen.getAllByText('1 个问题 · 高风险').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert', { name: '报告结构解析失败' })).not.toBeInTheDocument()
  })

  it('移除失败任务后调用隐藏接口并把该任务移出本机列表', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValue({
      data: [
        {
          id: 'failed-1', svn_url: 'svn://server/failed-1', old_revision: '2', new_revision: '3',
          review_item_ids: ['DS-03'], status: 'failed', error_message: '执行失败'
        },
        {
          id: 'failed-2', svn_url: 'svn://server/failed-2', old_revision: '4', new_revision: '5',
          review_item_ids: ['DS-03'], status: 'failed', error_message: '执行失败'
        }
      ],
      count: 2
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('tab', { name: /待处理失败任务 2/ }))
    await user.click(await screen.findByRole('button', { name: '从本机列表移除 failed-1' }))

    expect(window.codeReview.hideTask).toHaveBeenCalledWith('failed-1')
    expect(await screen.findByRole('status')).toHaveTextContent(
      '任务已从本机列表移除，服务端记录保留。'
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '从本机列表移除 failed-1' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: '从本机列表移除 failed-2' })).toBeInTheDocument()
  })

  it('意见反馈只提交用户实际选择的文件，不生成 fixture 截图', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
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

  it('意见反馈默认展示意见管理列表，并从右上角弹窗提交新意见', async () => {
    const user = userEvent.setup()
    const feedbackApi = window.codeReview as unknown as {
      listFeedback: ReturnType<typeof vi.fn>
    }
    feedbackApi.listFeedback = vi.fn(async () => ({
      data: [{
        id: 'feedback-1',
        description: '创建任务后进度一直停留在准备中。',
        status: 'pending',
        screenshot_count: 1,
        created_at: '2026-08-26T09:00:00Z'
      }],
      count: 1
    }))
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('button', { name: '意见反馈' }))

    expect(await screen.findByRole('heading', { name: '意见管理' })).toBeInTheDocument()
    expect(feedbackApi.listFeedback).toHaveBeenCalledWith({ skip: 0, limit: 10 })
    expect(screen.getByText('创建任务后进度一直停留在准备中。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    expect(screen.getByRole('dialog', { name: '提交新意见' })).toBeInTheDocument()
    expect(screen.getByLabelText('问题描述')).toBeInTheDocument()
  })

  it('从剪贴板图片项添加截图，并随意见一并提交', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    await user.type(screen.getByLabelText('问题描述'), '粘贴截图后应能直接提交')
    const screenshot = new File(['clipboard-image'], 'clipboard.png', { type: 'image/png' })

    fireEvent.paste(screen.getByLabelText('问题描述'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }],
        files: []
      }
    })

    expect(screen.getByText('clipboard.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '提交意见' }))
    await waitFor(() => expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
      description: '粘贴截图后应能直接提交', screenshots: [screenshot]
    }))
  })

  it('兼容从剪贴板文件列表添加截图', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    const screenshot = new File(['clipboard-file'], 'clipboard-file.jpg', { type: 'image/jpeg' })

    fireEvent.paste(screen.getByLabelText('问题描述'), {
      clipboardData: { items: [], files: [screenshot] }
    })

    expect(screen.getByText('clipboard-file.jpg')).toBeInTheDocument()
  })

  it('提交成功刷新时忽略先前过期的意见列表响应', async () => {
    const user = userEvent.setup()
    const feedback = (id: string, description: string, createdAt: string) => ({
      id, user_id: 'user-1', user_name: '王工程师', svn_username: 'wang', description,
      has_screenshot: false, screenshot_count: 0, screenshots: [], status: 'pending' as const,
      created_at: createdAt, updated_at: null
    })
    const staleResponse = createDeferred<FeedbackListResponse>()
    vi.mocked(window.codeReview.listFeedback)
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce({
        data: [feedback('fresh-feedback', '提交成功后的最新意见。', '2026-08-26T10:00:00Z')],
        count: 1
      })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    await user.type(screen.getByLabelText('问题描述'), '触发刷新')
    await user.click(screen.getByRole('button', { name: '提交意见' }))

    expect(await screen.findByText('提交成功后的最新意见。')).toBeInTheDocument()
    act(() => staleResponse.resolve({
      data: [feedback('stale-feedback', '过期响应不应覆盖列表。', '2026-08-26T09:00:00Z')],
      count: 1
    }))
    await waitFor(() => expect(screen.queryByText('过期响应不应覆盖列表。')).not.toBeInTheDocument())
  })

  it('详情首次加载失败时显示错误并允许重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listFeedback).mockResolvedValue({
      data: [{
        id: 'feedback-detail', user_id: 'user-1', user_name: '王工程师', svn_username: 'wang',
        description: '查看详情失败后可重试。', has_screenshot: false, screenshot_count: 0,
        screenshots: [], status: 'pending', created_at: '2026-08-26T09:00:00Z', updated_at: null
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readFeedback)
      .mockRejectedValueOnce(new Error('详情服务暂不可用。'))
      .mockResolvedValueOnce({
        id: 'feedback-detail', user_id: 'user-1', user_name: '王工程师', svn_username: 'wang',
        description: '查看详情失败后可重试。', has_screenshot: false, screenshot_count: 0,
        screenshots: [], status: 'pending', created_at: '2026-08-26T09:00:00Z', updated_at: null
      })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(await screen.findByRole('button', { name: '查看详情' }))

    expect(await screen.findByRole('dialog', { name: '意见详情' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('详情服务暂不可用。')
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '意见详情' })).getByRole('heading', { name: '意见内容' })).toBeInTheDocument())
    expect(window.codeReview.readFeedback).toHaveBeenCalledTimes(2)
  })

  it('多张截图中一张读取失败时仍显示意见内容和其余截图', async () => {
    const user = userEvent.setup()
    const feedback: Feedback = {
      id: 'feedback-images', user_id: 'user-1', user_name: '王工程师', svn_username: 'wang',
      description: '两张截图中一张读取失败不应遮蔽意见内容。', has_screenshot: true, screenshot_count: 2,
      screenshots: [
        { id: 'screenshot-ok', file_name: '正常截图.png', content_type: 'image/png', file_size: 128, sort_order: 0, created_at: null },
        { id: 'screenshot-error', file_name: '失败截图.png', content_type: 'image/png', file_size: 128, sort_order: 1, created_at: null }
      ],
      status: 'pending', created_at: '2026-08-26T09:00:00Z', updated_at: null
    }
    vi.mocked(window.codeReview.listFeedback).mockResolvedValue({ data: [feedback], count: 1 })
    vi.mocked(window.codeReview.readFeedback).mockResolvedValue(feedback)
    vi.mocked(window.codeReview.readFeedbackScreenshot).mockImplementation(({ screenshotId }) =>
      screenshotId === 'screenshot-ok'
        ? Promise.resolve({ dataUrl: 'data:image/png;base64,b2s=', contentType: 'image/png' })
        : Promise.reject(new Error('失败截图无法读取。'))
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(await screen.findByRole('button', { name: '查看详情' }))

    const detailDialog = await screen.findByRole('dialog', { name: '意见详情' })
    expect(await within(detailDialog).findByRole('heading', { name: '意见内容' })).toBeInTheDocument()
    expect(within(detailDialog).getByText('两张截图中一张读取失败不应遮蔽意见内容。')).toBeInTheDocument()
    expect(within(detailDialog).getByAltText('正常截图.png')).toHaveAttribute('src', 'data:image/png;base64,b2s=')
    expect(within(detailDialog).getByRole('alert')).toHaveTextContent('失败截图无法读取。')
    expect(within(detailDialog).getByRole('button', { name: '重试读取截图' })).toBeInTheDocument()
  })

  it('连续重试同一截图时忽略先发后回的旧响应', async () => {
    const user = userEvent.setup()
    const feedback: Feedback = {
      id: 'feedback-retry', user_id: 'user-1', user_name: '王工程师', svn_username: 'wang',
      description: '连续重试截图。', has_screenshot: true, screenshot_count: 1,
      screenshots: [{
        id: 'screenshot-retry', file_name: 'retry.png', content_type: 'image/png', file_size: 128,
        sort_order: 0, created_at: null
      }],
      status: 'pending', created_at: '2026-08-26T09:00:00Z', updated_at: null
    }
    const oldRetry = createDeferred<{ dataUrl: string; contentType: string }>()
    vi.mocked(window.codeReview.listFeedback).mockResolvedValue({ data: [feedback], count: 1 })
    vi.mocked(window.codeReview.readFeedback).mockResolvedValue(feedback)
    vi.mocked(window.codeReview.readFeedbackScreenshot)
      .mockRejectedValueOnce(new Error('首次读取失败。'))
      .mockImplementationOnce(() => oldRetry.promise)
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,bmV3', contentType: 'image/png' })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(await screen.findByRole('button', { name: '查看详情' }))
    const detailDialog = await screen.findByRole('dialog', { name: '意见详情' })
    const retry = await within(detailDialog).findByRole('button', { name: '重试读取截图' })

    await user.click(retry)
    await user.click(retry)
    expect(await within(detailDialog).findByAltText('retry.png')).toHaveAttribute('src', 'data:image/png;base64,bmV3')
    await act(async () => {
      oldRetry.resolve({ dataUrl: 'data:image/png;base64,b2xk', contentType: 'image/png' })
      await Promise.resolve()
    })
    expect(within(detailDialog).getByAltText('retry.png')).toHaveAttribute('src', 'data:image/png;base64,bmV3')
  })

  it('关闭 A 后打开 B 时忽略 A 延迟返回的详情', async () => {
    const user = userEvent.setup()
    const feedback = (id: string, description: string): Feedback => ({
      id, user_id: 'user-1', user_name: '王工程师', svn_username: 'wang', description,
      has_screenshot: false, screenshot_count: 0, screenshots: [], status: 'pending',
      created_at: '2026-08-26T09:00:00Z', updated_at: null
    })
    const delayedA = createDeferred<Feedback>()
    const detailB = feedback('feedback-b', 'B 的详情内容。')
    vi.mocked(window.codeReview.listFeedback).mockResolvedValue({
      data: [feedback('feedback-a', 'A 的列表内容。'), detailB], count: 2
    })
    vi.mocked(window.codeReview.readFeedback).mockImplementation((feedbackId) =>
      feedbackId === 'feedback-a' ? delayedA.promise : Promise.resolve(detailB)
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    const detailButtons = await screen.findAllByRole('button', { name: '查看详情' })
    await user.click(detailButtons[0])
    expect(await screen.findByRole('dialog', { name: '意见详情' })).toHaveTextContent('正在加载意见详情...')
    await user.click(screen.getByRole('button', { name: '关闭意见详情' }))
    await user.click(detailButtons[1])
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '意见详情' })).getByText('B 的详情内容。')).toBeInTheDocument())

    act(() => delayedA.resolve(feedback('feedback-a', 'A 的延迟详情内容。')))
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: '意见详情' })).queryByText('A 的延迟详情内容。')).not.toBeInTheDocument())
  })

  it('关闭含截图的 A 后打开 B 时忽略 A 延迟返回的截图', async () => {
    const user = userEvent.setup()
    const feedback = (id: string, description: string, screenshotId: string, screenshotName: string): Feedback => ({
      id, user_id: 'user-1', user_name: '王工程师', svn_username: 'wang', description,
      has_screenshot: true, screenshot_count: 1,
      screenshots: [{
        id: screenshotId, file_name: screenshotName, content_type: 'image/png', file_size: 128,
        sort_order: 0, created_at: '2026-08-26T09:00:00Z'
      }],
      status: 'pending', created_at: '2026-08-26T09:00:00Z', updated_at: null
    })
    const detailA = feedback('feedback-a', 'A 的详情内容。', 'screenshot-a', 'A.png')
    const detailB = feedback('feedback-b', 'B 的详情内容。', 'screenshot-b', 'B.png')
    const delayedScreenshotA = createDeferred<{ dataUrl: string; contentType: string }>()
    vi.mocked(window.codeReview.listFeedback).mockResolvedValue({ data: [detailA, detailB], count: 2 })
    vi.mocked(window.codeReview.readFeedback).mockImplementation((feedbackId) =>
      Promise.resolve(feedbackId === 'feedback-a' ? detailA : detailB)
    )
    vi.mocked(window.codeReview.readFeedbackScreenshot).mockImplementation(({ screenshotId }) =>
      screenshotId === 'screenshot-a'
        ? delayedScreenshotA.promise
        : Promise.resolve({ dataUrl: 'data:image/png;base64,Yg==', contentType: 'image/png' })
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    const detailButtons = await screen.findAllByRole('button', { name: '查看详情' })
    await user.click(detailButtons[0])
    await waitFor(() => expect(window.codeReview.readFeedbackScreenshot).toHaveBeenCalledWith({
      feedbackId: 'feedback-a', screenshotId: 'screenshot-a'
    }))
    await user.click(screen.getByRole('button', { name: '关闭意见详情' }))
    await user.click(detailButtons[1])
    expect(await screen.findByAltText('B.png')).toHaveAttribute('src', 'data:image/png;base64,Yg==')

    await act(async () => {
      delayedScreenshotA.resolve({ dataUrl: 'data:image/png;base64,YQ==', contentType: 'image/png' })
      await Promise.resolve()
    })
    expect(screen.getByAltText('B.png')).toHaveAttribute('src', 'data:image/png;base64,Yg==')
  })

  it('意见列表展示加载中、空数据、失败重试状态', async () => {
    const user = userEvent.setup()
    const initialResponse = createDeferred<{ data: []; count: number }>()
    vi.mocked(window.codeReview.listFeedback)
      .mockImplementationOnce(() => initialResponse.promise)
      .mockRejectedValueOnce(new Error('网络暂不可用。'))
      .mockResolvedValueOnce({ data: [], count: 0 })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    expect(screen.getByRole('status')).toHaveTextContent('正在加载意见...')
    act(() => initialResponse.resolve({ data: [], count: 0 }))
    expect(await screen.findByText('暂无意见记录')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '任务管理' }))
    await user.click(screen.getByRole('button', { name: '意见反馈' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂不可用。')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('暂无意见记录')).toBeInTheDocument()
  })

  it('有未提交内容时取消、关闭和 Escape 都要求确认放弃', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    await user.type(screen.getByLabelText('问题描述'), '尚未提交的意见')

    await user.click(screen.getByRole('button', { name: '取消' }))
    await user.click(screen.getByRole('button', { name: '关闭提交新意见' }))
    await user.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('dialog', { name: '提交新意见' })).toBeInTheDocument()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '提交新意见' })).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('提交失败后保留问题描述和截图以便重试', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.submitFeedback).mockRejectedValueOnce(new Error('提交服务暂不可用。'))
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    const description = screen.getByLabelText('问题描述')
    const screenshot = new File(['image'], 'retry.png', { type: 'image/png' })
    await user.type(description, '失败后仍需保留')
    await user.upload(screen.getByLabelText('选择反馈截图'), screenshot)
    await user.click(screen.getByRole('button', { name: '提交意见' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('提交服务暂不可用。')
    expect(description).toHaveValue('失败后仍需保留')
    expect(screen.getByText('retry.png')).toBeInTheDocument()
  })

  it('意见列表分页并在详情中读取原始截图', async () => {
    const user = userEvent.setup()
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      id: `feedback-${index + 1}`,
      description: `第 ${index + 1} 条意见`,
      status: 'pending' as const,
      has_screenshot: false,
      screenshot_count: 0,
      screenshots: [],
      created_at: '2026-08-26T09:00:00Z',
      updated_at: null,
      user_id: 'user-1',
      user_name: '王工程师',
      svn_username: 'wang'
    }))
    vi.mocked(window.codeReview.listFeedback).mockImplementation(async ({ skip }) => ({
      data: skip === 0 ? firstPage : [{
        ...firstPage[0], id: 'feedback-11', description: '第 11 条意见'
      }],
      count: 11
    }))
    vi.mocked(window.codeReview.readFeedback).mockResolvedValue({
      ...firstPage[0],
      screenshots: [{
        id: 'screenshot-1', file_name: '现场截图.png', content_type: 'image/png', file_size: 128,
        sort_order: 0, created_at: '2026-08-26T09:00:00Z'
      }],
      screenshot_count: 1,
      has_screenshot: true
    })
    vi.mocked(window.codeReview.readFeedbackScreenshot).mockResolvedValue({
      dataUrl: 'data:image/png;base64,aW1hZ2U=', contentType: 'image/png'
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))

    await user.click((await screen.findAllByRole('button', { name: '查看详情' }))[0])
    expect(await screen.findByRole('dialog', { name: '意见详情' })).toBeInTheDocument()
    expect(await screen.findByAltText('现场截图.png')).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2U=')
    await user.click(screen.getByRole('button', { name: '关闭意见详情' }))
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('第 11 条意见')).toBeInTheDocument()
    expect(window.codeReview.listFeedback).toHaveBeenLastCalledWith({ skip: 10, limit: 10 })
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
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
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
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
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
    await user.click(await screen.findByRole('button', { name: '报告中心' }))
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 MOS 充放电状态机审查' }))
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
    await user.click(screen.getByRole('button', { name: '提交新意见' }))
    await user.type(screen.getByLabelText('问题描述'), '防重复提交')
    const feedbackButton = screen.getByRole('button', { name: '提交意见' })
    fireEvent.click(feedbackButton)
    fireEvent.click(feedbackButton)
    expect(window.codeReview.submitFeedback).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled()
    act(() => resolveFeedback?.({ id: 'feedback-once', status: 'pending' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '提交新意见' })).not.toBeInTheDocument())
    expect(window.codeReview.listFeedback).toHaveBeenLastCalledWith({ skip: 0, limit: 10 })
  })
})
