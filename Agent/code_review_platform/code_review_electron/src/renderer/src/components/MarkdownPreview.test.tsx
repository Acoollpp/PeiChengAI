// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MarkdownPreview } from './MarkdownPreview'

afterEach(() => {
  cleanup()
})

describe('MarkdownPreview', () => {
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

  it('表格被横向滚动容器包裹', () => {
    const { container } = render(
      <MarkdownPreview markdown={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />
    )

    const wrapper = container.querySelector('.markdown-table-wrapper')
    expect(wrapper).toBeInTheDocument()
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
})
