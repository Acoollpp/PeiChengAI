// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskForm } from './TaskForm'

beforeEach(() => {
  window.codeReview = {
    selectRequirementFile: vi.fn(async () => ({ status: 'cancelled' as const })),
    getPathForPastedFile: vi.fn()
  } as never
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('TaskForm', () => {
  it('提交成功后清空 SVN 字段并保留选中的 DS-03', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    expect(screen.getByLabelText('SVN 地址')).toBeInTheDocument()
    expect(screen.getByLabelText('旧版本号')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如 0 或 123')).toBeInTheDocument()
    expect(screen.getByLabelText('新版本号')).toBeInTheDocument()
    expect(screen.getByLabelText('DS-03 状态机审核')).toBeChecked()
    expect(screen.queryByText(/无需额外上传材料/)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(onSubmit).toHaveBeenCalledWith({
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14',
      review_items: [{ id: 'DS-03' }]
    })
    expect(screen.getByLabelText('SVN 地址')).toHaveValue('')
    expect(screen.getByLabelText('旧版本号')).toHaveValue('')
    expect(screen.getByLabelText('新版本号')).toHaveValue('')
    expect(screen.getByLabelText('DS-03 状态机审核')).toBeChecked()
  })

  it('提交失败后保留 SVN 字段便于修改重试', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {
      throw new Error('提交失败')
    })
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(screen.getByLabelText('SVN 地址')).toHaveValue('svn://repo/project')
    expect(screen.getByLabelText('旧版本号')).toHaveValue('12')
    expect(screen.getByLabelText('新版本号')).toHaveValue('14')
    expect(localStorage.getItem('code-review:recent-svn-urls')).toBeNull()
    expect(screen.getByText('提交失败')).toBeInTheDocument()
  })

  it('成功提交后只保存最近三条 SVN 地址并去重', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    const submitTask = async (svnUrl: string): Promise<void> => {
      await user.clear(screen.getByLabelText('SVN 地址'))
      await user.clear(screen.getByLabelText('旧版本号'))
      await user.clear(screen.getByLabelText('新版本号'))
      await user.type(screen.getByLabelText('SVN 地址'), svnUrl)
      await user.type(screen.getByLabelText('旧版本号'), '12')
      await user.type(screen.getByLabelText('新版本号'), '14')
      await user.click(screen.getByRole('button', { name: '开始审查' }))
    }

    await submitTask('svn://repo/project-a')
    await submitTask('svn://repo/project-b')
    await submitTask('svn://repo/project-c')
    await submitTask('svn://repo/project-a')
    await submitTask('svn://repo/project-d')

    expect(JSON.parse(localStorage.getItem('code-review:recent-svn-urls') ?? '[]')).toEqual([
      'svn://repo/project-d',
      'svn://repo/project-a',
      'svn://repo/project-c'
    ])
  })

  it('聚焦 SVN 地址输入框时显示最近三条地址并可点击回填', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'code-review:recent-svn-urls',
      JSON.stringify(['svn://repo/project-a', 'svn://repo/project-b', 'svn://repo/project-c'])
    )
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)

    await user.click(screen.getByLabelText('SVN 地址'))

    expect(screen.getByRole('listbox', { name: '最近 SVN 地址' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'svn://repo/project-a' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'svn://repo/project-b' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'svn://repo/project-c' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'svn://repo/project-b' }))

    expect(screen.getByLabelText('SVN 地址')).toHaveValue('svn://repo/project-b')
    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()
  })

  it('输入 SVN 地址时只显示忽略大小写的包含匹配项，完全匹配时收起', async () => {
    localStorage.setItem(
      'code-review:recent-svn-urls',
      JSON.stringify(['https://svn.example.com/Alpha', 'https://svn.example.com/Beta'])
    )
    const user = userEvent.setup()
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('SVN 地址')

    await user.click(input)
    await user.type(input, 'ALPHA')
    expect(screen.getByRole('option', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beta/ })).not.toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'https://svn.example.com/Alpha')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Escape 和 Tab 收起历史列表且 Tab 直接进入旧版本号', async () => {
    localStorage.setItem('code-review:recent-svn-urls', JSON.stringify(['https://svn.example.com/A']))
    const user = userEvent.setup()
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
    const svnInput = screen.getByLabelText('SVN 地址')

    await user.click(svnInput)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(svnInput).toHaveFocus()

    await user.click(svnInput)
    expect(screen.getByRole('option')).toHaveAttribute('tabindex', '-1')
    await user.tab()
    expect(screen.getByLabelText('旧版本号')).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('使用上下方向键高亮历史地址并用 Enter 回填', async () => {
    localStorage.setItem(
      'code-review:recent-svn-urls',
      JSON.stringify(['https://svn.example.com/A', 'https://svn.example.com/B', 'https://svn.example.com/C'])
    )
    const user = userEvent.setup()
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
    const svnInput = screen.getByLabelText('SVN 地址')

    await user.click(svnInput)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'https://svn.example.com/A' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'https://svn.example.com/B' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{ArrowUp}')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: 'https://svn.example.com/C' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{Enter}')
    expect(svnInput).toHaveValue('https://svn.example.com/C')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('点击版本字段不会回填鼠标经过的历史地址', async () => {
    localStorage.setItem('code-review:recent-svn-urls', JSON.stringify(['https://svn.example.com/A']))
    const user = userEvent.setup()
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
    const svnInput = screen.getByLabelText('SVN 地址')

    await user.click(svnInput)
    await user.click(screen.getByLabelText('旧版本号'))
    expect(svnInput).toHaveValue('')
    expect(screen.getByLabelText('旧版本号')).toHaveFocus()
  })

  it('提交时把用户额外规则绑定到 DS-03', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.type(screen.getByLabelText('DS-03 用户额外规则'), '重点检查休眠唤醒状态')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        review_items: [
          {
            id: 'DS-03',
            user_extra_rules: '重点检查休眠唤醒状态'
          }
        ]
      })
    )
  })

  it('未选择审查项时显示明确中文提示且不提交', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '0')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByLabelText('DS-03 状态机审核'))
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(screen.getByText('请至少选择一个审查项。')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('本机未同步 bms-code-reviewer 时禁止提交', () => {
    render(
      <TaskForm
        disabled={false}
        activeSkillNames={['通用-代码审查-模版一']}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByLabelText('DS-03 状态机审核')).toBeDisabled()
    expect(screen.getByText('本机尚未同步 bms-code-reviewer Skill。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始审查' })).toBeDisabled()
  })
})
