// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskViewItem } from '../hooks/useTaskQueue'
import { TaskBoard } from './TaskBoard'

const runningTasks: TaskViewItem[] = [
  {
    id: 'task-current',
    localTaskId: 'task-current',
    svn_url: 'https://svn.example.com/project/current',
    old_revision: '100',
    new_revision: '101',
    status: 'running_codex',
    localQueueState: 'running',
    queueIndex: 0,
    createdAtMs: 1000,
    progress_message: 'Codex 正在审查',
    codex_log: [
      {
        taskId: 'task-current',
        type: 'codex_output',
        stream: 'stdout',
        message: 'analyzing src/current.c\n'
      }
    ]
  }
]

const queuedTasks: TaskViewItem[] = [
  {
    id: 'local-queued-1',
    localTaskId: 'local-queued-1',
    svn_url: 'https://svn.example.com/project/queued',
    old_revision: '101',
    new_revision: '102',
    status: 'created',
    localQueueState: 'queued',
    queueIndex: 1,
    createdAtMs: 1001
  }
]

const historyTasks: TaskViewItem[] = [
  {
    id: 'task-history',
    localTaskId: 'task-history',
    svn_url: 'https://svn.example.com/project/history',
    old_revision: '90',
    new_revision: '91',
    status: 'success',
    localQueueState: 'finished',
    queueIndex: 0,
    createdAtMs: 900,
    progress_message: '审查完成',
    codex_log: [
      {
        taskId: 'task-history',
        type: 'codex_output',
        stream: 'stdout',
        message: 'old noisy output\n'
      }
    ]
  }
]

const renderTaskBoard = (
  props: Partial<React.ComponentProps<typeof TaskBoard>> = {}
): ReturnType<typeof render> =>
  render(
    <TaskBoard
      runningTasks={runningTasks}
      queuedTasks={queuedTasks}
      historyTasks={historyTasks}
      {...props}
    />
  )

afterEach(() => {
  cleanup()
})

describe('TaskBoard', () => {
  it('默认显示运行中任务并保留原有切换式看板', () => {
    renderTaskBoard()

    expect(screen.queryByRole('tab', { name: '当前任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '运行中 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '等待中 1' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '历史任务 1' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('task-current')).toBeInTheDocument()
    expect(screen.queryByText('local-queued-1')).not.toBeInTheDocument()
    expect(screen.queryByText('task-history')).not.toBeInTheDocument()
  })

  it('任务卡片优先显示软件版本加检出版本', () => {
    const taskWithReportName: TaskViewItem = {
      ...runningTasks[0],
      id: '550e8400-e29b-41d4-a716-446655440000',
      report_name: 'P16S100A-41662-1.30-000_审查报告.md',
      new_revision: '45216'
    }

    renderTaskBoard({ runningTasks: [taskWithReportName], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('P16S100A-41662-1.30-000_r45216')).toBeInTheDocument()
    expect(screen.queryByText('550e8400-e29b-41d4-a716-446655440000')).not.toBeInTheDocument()
  })

  it('任务卡片可从 PDF 报告名兜底显示软件版本', () => {
    const taskWithPdfReportName: TaskViewItem = {
      ...runningTasks[0],
      id: 'task-with-pdf-name',
      pdf_report_name: 'P16S200A-41662-1.30-000_审查报告_20260615_143000.pdf',
      new_revision: 'r45217'
    }

    renderTaskBoard({ runningTasks: [taskWithPdfReportName], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('P16S200A-41662-1.30-000_r45217')).toBeInTheDocument()
  })

  it('切换到等待中任务后显示排队序号', async () => {
    const user = userEvent.setup()
    renderTaskBoard()

    await user.click(screen.getByRole('tab', { name: '等待中 1' }))

    expect(screen.getByRole('tab', { name: '等待中 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('local-queued-1')).toBeInTheDocument()
    expect(screen.getByText('排队第 1 位')).toBeInTheDocument()
    expect(screen.queryByText('task-current')).not.toBeInTheDocument()
  })

  it('只在运行中任务显示 Codex 日志，历史任务隐藏日志', async () => {
    const user = userEvent.setup()
    renderTaskBoard()

    expect(screen.getByText('analyzing src/current.c')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))

    expect(screen.getByText('task-history')).toBeInTheDocument()
    expect(screen.queryByText('old noisy output')).not.toBeInTheDocument()
    expect(screen.queryByText('analyzing src/current.c')).not.toBeInTheDocument()
  })

  it('历史任务成功时可以查看报告', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    renderTaskBoard({ onViewReport })

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))
    await user.click(screen.getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(historyTasks[0])
  })

  it('历史任务失败时显示重试按钮并回传该任务', async () => {
    const user = userEvent.setup()
    const onRetryTask = vi.fn()
    const failedTask: TaskViewItem = {
      ...historyTasks[0],
      id: 'task-failed',
      localTaskId: 'task-failed',
      status: 'failed',
      error_message: 'Codex 执行失败'
    }

    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [failedTask], onRetryTask })

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(onRetryTask).toHaveBeenCalledWith(failedTask)
    expect(screen.queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()
  })

  it('历史任务卡片用右上角状态显示报告反馈状态', async () => {
    const user = userEvent.setup()
    const tasks: TaskViewItem[] = [
      {
        ...historyTasks[0],
        id: 'task-feedback-pending',
        localTaskId: 'task-feedback-pending',
        report_feedback_helpful: null
      },
      {
        ...historyTasks[0],
        id: 'task-feedback-helpful',
        localTaskId: 'task-feedback-helpful',
        report_feedback_helpful: true
      },
      {
        ...historyTasks[0],
        id: 'task-feedback-not-helpful',
        localTaskId: 'task-feedback-not-helpful',
        report_feedback_helpful: false
      }
    ]

    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: tasks })

    await user.click(screen.getByRole('tab', { name: '历史任务 3' }))

    expect(screen.getByText('已完成 · 未提交')).toBeInTheDocument()
    expect(screen.getByText('已完成 · 有帮助')).toBeInTheDocument()
    expect(screen.getByText('已完成 · 没帮助')).toBeInTheDocument()
    expect(screen.queryByText('反馈：未提交')).not.toBeInTheDocument()
  })

  it('全量审查任务显示目标版本', async () => {
    const user = userEvent.setup()
    const fullReviewTask: TaskViewItem = {
      ...historyTasks[0],
      id: 'task-full-review',
      old_revision: 'r0',
      new_revision: 'r123'
    }

    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [fullReviewTask] })

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))

    expect(screen.getByText('全量审查 r123')).toBeInTheDocument()
    expect(screen.getByText('审查范围')).toBeInTheDocument()
  })

  it('空列表切换后显示对应空状态', async () => {
    const user = userEvent.setup()
    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('暂无运行中任务。')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '等待中 0' }))
    expect(screen.getByText('暂无等待中的任务。')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '历史任务 0' }))
    expect(screen.getByText('暂无历史任务。')).toBeInTheDocument()
  })

  it('加载状态显示任务加载文案', () => {
    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [], isLoading: true })

    expect(screen.getByText('正在加载任务...')).toBeInTheDocument()
  })

  it('运行中任务成功时查看报告按钮使用该任务', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    const successTasks: TaskViewItem[] = [{ ...runningTasks[0], status: 'success' }]
    renderTaskBoard({ runningTasks: successTasks, queuedTasks: [], historyTasks: [], onViewReport })

    const runningPanel = screen.getByRole('tabpanel', { name: '运行中' })
    await user.click(within(runningPanel).getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(successTasks[0])
  })

  it('运行中任务显示取消按钮并回传该任务', async () => {
    const user = userEvent.setup()
    const onCancelTask = vi.fn()
    renderTaskBoard({ onCancelTask })

    await user.click(screen.getByRole('button', { name: '取消任务' }))

    expect(onCancelTask).toHaveBeenCalledWith(runningTasks[0])
  })

  it('等待中任务显示取消按钮并回传该任务', async () => {
    const user = userEvent.setup()
    const onCancelTask = vi.fn()
    renderTaskBoard({ onCancelTask })

    await user.click(screen.getByRole('tab', { name: '等待中 1' }))
    await user.click(screen.getByRole('button', { name: '取消任务' }))

    expect(onCancelTask).toHaveBeenCalledWith(queuedTasks[0])
  })

  it('任务卡片显示开始时间和结束时间', () => {
    const startedAt = '2026-06-11T14:03:20'
    const finishedAt = '2026-06-11T14:15:01'
    const taskWithTimes: TaskViewItem = {
      ...runningTasks[0],
      started_at: startedAt,
      finished_at: finishedAt
    }

    renderTaskBoard({ runningTasks: [taskWithTimes], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('开始时间')).toBeInTheDocument()
    expect(screen.getByText('结束时间')).toBeInTheDocument()
    expect(screen.getByText('2026-06-11 14:03:20')).toBeInTheDocument()
    expect(screen.getByText('2026-06-11 14:15:01')).toBeInTheDocument()
  })

  it('任务时间为空时显示占位符', async () => {
    const user = userEvent.setup()
    renderTaskBoard()

    await user.click(screen.getByRole('tab', { name: '等待中 1' }))

    const waitingPanel = screen.getByRole('tabpanel', { name: '等待中' })
    expect(within(waitingPanel).getByText('开始时间')).toBeInTheDocument()
    expect(within(waitingPanel).getByText('结束时间')).toBeInTheDocument()
    expect(within(waitingPanel).getAllByText('-')).toHaveLength(2)
  })

  it('运行中任务只有开始时间时结束时间显示占位符', () => {
    const taskWithStartOnly: TaskViewItem = {
      ...runningTasks[0],
      started_at: '2026-06-11T14:03:20',
      finished_at: null
    }

    renderTaskBoard({ runningTasks: [taskWithStartOnly], queuedTasks: [], historyTasks: [] })

    const runningPanel = screen.getByRole('tabpanel', { name: '运行中' })
    expect(within(runningPanel).getByText('2026-06-11 14:03:20')).toBeInTheDocument()
    expect(within(runningPanel).getByText('-')).toBeInTheDocument()
  })

  it('历史任务不显示取消按钮', async () => {
    const user = userEvent.setup()
    renderTaskBoard({ onCancelTask: vi.fn() })

    await user.click(screen.getByRole('tab', { name: '历史任务 1' }))

    expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument()
  })
})
