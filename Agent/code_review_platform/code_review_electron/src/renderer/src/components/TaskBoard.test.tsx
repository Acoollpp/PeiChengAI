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
  it('展示运行中、等待中、历史任务三分区', () => {
    renderTaskBoard()

    expect(screen.queryByRole('tab', { name: '当前任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '运行中' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '等待中' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '历史任务' })).toBeInTheDocument()
    expect(screen.getByText('task-current')).toBeInTheDocument()
    expect(screen.getByText('local-queued-1')).toBeInTheDocument()
    expect(screen.getByText('task-history')).toBeInTheDocument()
    expect(screen.getByText('排队第 1 位')).toBeInTheDocument()
  })

  it('只在运行中任务显示 Codex 日志', () => {
    renderTaskBoard()

    const runningRegion = screen.getByRole('region', { name: '运行中' })
    const historyRegion = screen.getByRole('region', { name: '历史任务' })

    expect(within(runningRegion).getByText('analyzing src/current.c')).toBeInTheDocument()
    expect(within(historyRegion).queryByText('old noisy output')).not.toBeInTheDocument()
  })

  it('历史任务成功时可以查看报告', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    renderTaskBoard({ onViewReport })

    const historyRegion = screen.getByRole('region', { name: '历史任务' })
    await user.click(within(historyRegion).getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(historyTasks[0])
  })

  it('三分区为空时分别显示空状态', () => {
    renderTaskBoard({ runningTasks: [], queuedTasks: [], historyTasks: [] })

    expect(screen.getByText('暂无运行中任务。')).toBeInTheDocument()
    expect(screen.getByText('暂无等待中的任务。')).toBeInTheDocument()
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

    const runningRegion = screen.getByRole('region', { name: '运行中' })
    await user.click(within(runningRegion).getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(successTasks[0])
  })
})
