// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskForm } from './TaskForm'

afterEach(() => {
  cleanup()
})

describe('TaskForm', () => {
  it('提交成功后清空 SVN 字段并保留选中的审查模板', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    expect(screen.getByLabelText('SVN 地址')).toBeInTheDocument()
    expect(screen.getByLabelText('旧版本号')).toBeInTheDocument()
    expect(screen.getByLabelText('新版本号')).toBeInTheDocument()
    expect(screen.getByLabelText('模板一')).toBeChecked()
    expect(screen.getByLabelText('模板二')).not.toBeChecked()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByLabelText('模板二'))
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(onSubmit).toHaveBeenCalledWith({
      svn_url: 'svn://repo/project',
      old_revision: '12',
      new_revision: '14',
      template_key: 'template_2',
      skill_name: '通用-代码审查-模版二'
    })
    expect(screen.getByLabelText('SVN 地址')).toHaveValue('')
    expect(screen.getByLabelText('旧版本号')).toHaveValue('')
    expect(screen.getByLabelText('新版本号')).toHaveValue('')
    expect(screen.getByLabelText('模板二')).toBeChecked()
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
  })
})
