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
})
