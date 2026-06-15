// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
      skill_name: '通用-代码审查-模版二',
      requirement_file_path: undefined,
      requirement_file_name: undefined,
      focus_direction_snapshot: undefined
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

  it('提交时包含产品开发需求表路径和重点审查方向', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(<TaskForm disabled={false} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.type(screen.getByLabelText('产品开发需求表'), '/tmp/产品开发需求表.xls')
    await user.type(screen.getByLabelText('重点审查方向'), '重点检查 SOC 跳变')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        requirement_file_path: '/tmp/产品开发需求表.xls',
        requirement_file_name: '产品开发需求表.xls',
        focus_direction_snapshot: '重点检查 SOC 跳变'
      })
    )
  })

  it('通过选择文件按钮填入产品开发需求表路径', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectRequirementFile).mockResolvedValue({
      status: 'selected',
      filePath: '/tmp/产品开发需求表.xlsx'
    })
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '选择文件' }))

    expect(screen.getByLabelText('产品开发需求表')).toHaveValue('/tmp/产品开发需求表.xlsx')
  })

  it('粘贴 Excel 文件时读取本机路径', async () => {
    vi.mocked(window.codeReview.getPathForPastedFile).mockReturnValue('/tmp/粘贴需求表.xls')
    render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
    const input = screen.getByLabelText('产品开发需求表')
    const file = new File(['excel'], '粘贴需求表.xls', {
      type: 'application/vnd.ms-excel'
    })

    fireEvent.paste(input, {
      clipboardData: {
        files: [file]
      }
    })

    expect(window.codeReview.getPathForPastedFile).toHaveBeenCalledWith(file)
    expect(input).toHaveValue('/tmp/粘贴需求表.xls')
  })
})
