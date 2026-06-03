// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReviewTask } from '../../../shared/types'
import { TaskBoard } from './TaskBoard'

const tasks: ReviewTask[] = [
  {
    id: 'task-current',
    svn_url: 'https://svn.example.com/project/current',
    old_revision: '100',
    new_revision: '101',
    status: 'running_codex',
    progress_message: 'Codex 正在审查',
    codex_log: [
      {
        taskId: 'task-current',
        type: 'codex_output',
        stream: 'stdout',
        message: 'analyzing src/current.c\n'
      }
    ]
  },
  {
    id: 'task-history',
    svn_url: 'https://svn.example.com/project/history',
    old_revision: '90',
    new_revision: '91',
    status: 'success',
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

afterEach(() => {
  cleanup()
})

describe('TaskBoard', () => {
  it('默认显示当前任务并展示 Codex 日志', () => {
    render(<TaskBoard tasks={tasks} />)

    expect(screen.getByRole('tab', { name: '当前任务' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('task-current')).toBeInTheDocument()
    expect(screen.getByText('https://svn.example.com/project/current')).toBeInTheDocument()
    expect(screen.getByText('analyzing src/current.c')).toBeInTheDocument()
    expect(screen.queryByText('task-history')).not.toBeInTheDocument()
  })

  it('切换到历史任务后隐藏当前任务和 Codex 日志', async () => {
    const user = userEvent.setup()
    render(<TaskBoard tasks={tasks} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))

    expect(screen.getByRole('tab', { name: '历史任务' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('task-history')).toBeInTheDocument()
    expect(screen.getByText('https://svn.example.com/project/history')).toBeInTheDocument()
    expect(screen.queryByText('old noisy output')).not.toBeInTheDocument()
    expect(screen.queryByText('task-current')).not.toBeInTheDocument()
  })

  it('历史任务成功时可以查看报告', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    render(<TaskBoard tasks={tasks} onViewReport={onViewReport} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))
    await user.click(screen.getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(tasks[1])
  })

  it('当前任务为空时显示当前任务空状态', () => {
    render(<TaskBoard tasks={[]} />)

    expect(screen.getByText('暂无当前任务，填写上方表单后开始审查。')).toBeInTheDocument()
  })

  it('历史任务为空时显示历史任务空状态', async () => {
    const user = userEvent.setup()
    render(<TaskBoard tasks={[tasks[0]]} />)

    await user.click(screen.getByRole('tab', { name: '历史任务' }))

    expect(screen.getByText('暂无历史任务。')).toBeInTheDocument()
  })

  it('加载状态显示任务加载文案', () => {
    render(<TaskBoard tasks={[]} isLoading />)

    expect(screen.getByText('正在加载任务...')).toBeInTheDocument()
  })

  it('当前任务成功时查看报告按钮使用当前任务', async () => {
    const user = userEvent.setup()
    const onViewReport = vi.fn()
    const successTasks: ReviewTask[] = [{ ...tasks[0], status: 'success' }]
    render(<TaskBoard tasks={successTasks} onViewReport={onViewReport} />)

    const currentPanel = screen.getByRole('tabpanel', { name: '当前任务' })
    await user.click(within(currentPanel).getByRole('button', { name: '查看报告' }))

    expect(onViewReport).toHaveBeenCalledWith(successTasks[0])
  })
})
