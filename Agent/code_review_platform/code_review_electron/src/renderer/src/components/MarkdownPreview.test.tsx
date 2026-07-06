// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownPreview } from './MarkdownPreview'

afterEach(() => {
  cleanup()
})

describe('MarkdownPreview', () => {
  beforeEach(() => {
    window.codeReview = {
      readReportAsset: vi.fn(async () => ({
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
        contentType: 'image/png'
      }))
    } as never
  })

  it('空内容显示空状态', () => {
    render(<MarkdownPreview markdown="" />)

    expect(screen.getByText('审查完成后，Markdown 报告会显示在这里。')).toBeInTheDocument()
  })

  it('渲染标题、列表、表格和代码块', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '',
          '- 文件 `src/App.tsx` 已更新',
          '',
          '| 文件 | 风险 |',
          '| --- | --- |',
          '| src/App.tsx | 低 |',
          '',
          '```ts',
          'const status = "ok"',
          '```'
        ].join('\n')}
      />
    )

    expect(screen.getByRole('heading', { name: '审查报告', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('文件')).toBeInTheDocument()
    expect(screen.getAllByText('src/App.tsx')).toHaveLength(2)
    expect(screen.getByText('低')).toBeInTheDocument()
    expect(screen.getByText('const status = "ok"')).toBeInTheDocument()
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('安全链接保留 href 并阻止危险协议', () => {
    render(
      <MarkdownPreview markdown="[安全链接](https://example.com)\n\n[危险链接](javascript:alert(1))" />
    )

    expect(screen.getByRole('link', { name: '安全链接' })).toHaveAttribute(
      'href',
      'https://example.com'
    )
    expect(screen.getByText('危险链接')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '危险链接' })).not.toBeInTheDocument()
  })

  it('相对链接和 hash anchor 渲染为普通文本', () => {
    render(
      <MarkdownPreview markdown="[相对链接](/local)\n\n[路径链接](relative/path)\n\n[锚点](#anchor)" />
    )

    expect(screen.getByText('相对链接')).toBeInTheDocument()
    expect(screen.getByText('路径链接')).toBeInTheDocument()
    expect(screen.getByText('锚点')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '相对链接' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '路径链接' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '锚点' })).not.toBeInTheDocument()
  })

  it('使用报告路径加载相对图片', async () => {
    render(
      <MarkdownPreview
        markdown="![问题截图](images/diagram.png)"
        reportPath="/tmp/runtime/workspaces/task-1/代码审查报告.md"
      />
    )

    const image = await screen.findByRole('img', { name: '问题截图' })
    expect(window.codeReview.readReportAsset).toHaveBeenCalledWith({
      reportPath: '/tmp/runtime/workspaces/task-1/代码审查报告.md',
      assetPath: 'images/diagram.png'
    })
    expect(image).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2U=')
  })

  it('表格被横向滚动容器包裹', () => {
    const { container } = render(
      <MarkdownPreview markdown={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />
    )

    const wrapper = container.querySelector('.markdown-table-wrapper')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveStyle({ overflowX: 'auto' })
    expect(within(wrapper as HTMLElement).getByRole('table')).toBeInTheDocument()
  })

  it('遇到渲染异常时显示兜底提示', () => {
    const throwingMarkdown = {
      trim: () => 'not-empty',
      toString: () => {
        throw new Error('render failed')
      }
    } as unknown as string

    render(<MarkdownPreview markdown={throwingMarkdown} />)

    expect(screen.getByText('报告渲染失败，请下载报告查看原始 Markdown。')).toBeInTheDocument()
  })

  it('渲染异常后传入新 Markdown 时恢复预览', () => {
    const throwingMarkdown = {
      trim: () => 'not-empty',
      toString: () => {
        throw new Error('render failed')
      }
    } as unknown as string

    const { rerender } = render(<MarkdownPreview markdown={throwingMarkdown} />)

    expect(screen.getByText('报告渲染失败，请下载报告查看原始 Markdown。')).toBeInTheDocument()

    rerender(<MarkdownPreview markdown="# 新报告" />)

    expect(screen.queryByText('报告渲染失败，请下载报告查看原始 Markdown。')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新报告', level: 1 })).toBeInTheDocument()
  })

  it('renders detailed heading checkboxes when report feedback selection is enabled', async () => {
    const onUsefulIssueToggle = vi.fn()
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '## 高风险问题',
          '### 空指针风险',
          '正文',
          '### 越界访问风险',
          '正文',
          '```',
          '### 代码块标题不应识别',
          '```'
        ].join('\n')}
        usefulIssueSelection={{
          enabled: true,
          selectedIssues: ['空指针风险'],
          onToggle: onUsefulIssueToggle
        }}
      />
    )

    expect(screen.getByRole('checkbox', { name: '空指针风险' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '越界访问风险' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: '代码块标题不应识别' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: '越界访问风险' }))
    expect(onUsefulIssueToggle).toHaveBeenCalledWith('越界访问风险')
  })

  it('does not render report feedback checkboxes by default', () => {
    render(<MarkdownPreview markdown={'## 高风险问题\n\n### 空指针风险'} />)

    expect(screen.queryByRole('checkbox', { name: '空指针风险' })).not.toBeInTheDocument()
  })
})
