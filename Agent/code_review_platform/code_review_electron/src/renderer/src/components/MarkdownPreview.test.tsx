// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractDetailedHeadingOptions, MarkdownPreview } from './MarkdownPreview'

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

  it('extracts detailed heading options for report feedback', () => {
    const options = extractDetailedHeadingOptions(
      [
        '# 审查报告',
        '## 高风险问题',
        '### 空指针风险',
        '正文',
        '### 越界访问风险',
        '正文',
        '```',
        '### 代码块标题不应识别',
        '```'
      ].join('\n')
    )

    expect(options.map((option) => option.text)).toEqual(['空指针风险', '越界访问风险'])
    expect(options.map((option) => option.anchorId)).toEqual([
      'report-option-2',
      'report-option-4'
    ])
  })

  it('模板二报告优先从有效表格行提取具体问题选项', () => {
    const options = extractDetailedHeadingOptions(
      [
          '# 代码审查报告模板二',
          '## 二、流程节点详细审查报告',
          '### 1. 部门自检项结果',
          '| 检查方式 | 涉及文件及行号 | 风险级别 | 触发规则/缺陷描述 | 整改建议 / 闭环方案 | 对应变更图 |',
          '|---|---|---|---|---|---|',
          '| 广用 SVN 远程自检 | 工程级 | 中风险 | 软件版本与工程配置不一致，采样电阻未识别。 | 补齐工程配置并回归验证。 | 无 |',
          '### 2. 部门专项风险检查',
          '| 涉及文件及行号 | 风险级别 | 专项检查方向 | 缺陷描述 (Root Cause) | 缺陷可能造成的风险 | 整改建议与闭环方案 | 对应变更图 |',
          '|---|---|---|---|---|---|---|',
          '| `source/Bms_Config.h` | 高风险 | SOH 容量映射 | SOH 字段映射缺失。 | 导致容量显示异常。 | 增加映射并做协议回归。 | 无 |'
      ].join('\n')
    )

    expect(options.map((option) => option.text)).toEqual([
      '部门自检项结果 · 中风险 · 软件版本与工程配置不一致，采样电阻未识别。',
      '部门专项风险检查 · 高风险 · SOH 容量映射 · SOH 字段映射缺失。'
    ])
    expect(options.map((option) => option.anchorId)).toEqual([
      'report-option-5',
      'report-option-9'
    ])
  })

  it('renders report anchors for feedback option targets', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '## 高风险问题',
          '### 空指针风险',
          '正文',
          '### 越界访问风险'
        ].join('\n')}
        activeFeedbackAnchorId="report-option-2"
      />
    )

    expect(screen.getByRole('heading', { name: '空指针风险' })).toHaveAttribute(
      'data-report-anchor-id',
      'report-option-2'
    )
    expect(screen.getByRole('heading', { name: '空指针风险' })).toHaveClass(
      'report-anchor-highlight'
    )
    expect(screen.getByRole('heading', { name: '越界访问风险' })).toHaveAttribute(
      'data-report-anchor-id',
      'report-option-4'
    )
  })

  it('重复问题标题使用共享识别结果获得独立锚点', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 审查报告',
          '## 高风险问题',
          '### 1. 重复问题标题',
          '- **问题描述：** 模块 A 的问题。',
          '### 2. 重复问题标题',
          '- **问题描述：** 模块 B 的问题。'
        ].join('\n')}
        activeFeedbackAnchorId="report-option-4"
      />
    )

    const headings = screen.getAllByRole('heading', { name: /重复问题标题/ })
    expect(headings).toHaveLength(2)
    expect(headings[0]).toHaveAttribute('data-report-anchor-id', 'report-option-2')
    expect(headings[1]).toHaveAttribute('data-report-anchor-id', 'report-option-4')
    expect(headings[0]).not.toHaveClass('report-anchor-highlight')
    expect(headings[1]).toHaveClass('report-anchor-highlight')
  })

  it('renders report anchors for template two table row option targets', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 代码审查报告模板二',
          '## 二、流程节点详细审查报告',
          '### 1. 部门自检项结果',
          '| 检查方式 | 涉及文件及行号 | 风险级别 | 触发规则/缺陷描述 | 整改建议 / 闭环方案 | 对应变更图 |',
          '|---|---|---|---|---|---|',
          '| 广用 SVN 远程自检 | 工程级 | 中风险 | 软件版本与工程配置不一致，采样电阻未识别。 | 补齐工程配置并回归验证。 | 无 |'
        ].join('\n')}
        activeFeedbackAnchorId="report-option-5"
      />
    )

    const table = screen.getByRole('table')
    const row = within(table).getByRole('row', {
      name: /广用 SVN 远程自检 工程级 中风险 软件版本与工程配置不一致/
    })
    expect(row).toHaveAttribute('data-report-anchor-id', 'report-option-5')
    expect(row).toHaveClass('report-anchor-highlight')
  })

  it('renders report anchors for template two table rows with html line breaks', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 代码审查报告模板二',
          '## 二、流程节点详细审查报告',
          '### 1. 部门自检项结果',
          '| 检查方式 | 涉及文件及行号 | 风险级别 | 触发规则/缺陷描述 | 整改建议 / 闭环方案 | 对应变更图 |',
          '|---|---|---|---|---|---|',
          '| 广用 SVN 远程自检 | 工程级 | 中风险 | 软件版本: P00S000A-00000-0.0-000<br>工程配置: PCB=0000V000, AFE=unknown, 电流=未识别, 采样电阻=0 | 补齐配置。 | 无 |'
        ].join('\n')}
        activeFeedbackAnchorId="report-option-5"
      />
    )

    const table = screen.getByRole('table')
    const row = within(table).getByRole('row', {
      name: /广用 SVN 远程自检 工程级 中风险 软件版本/
    })
    expect(row).toHaveAttribute('data-report-anchor-id', 'report-option-5')
    expect(row).toHaveClass('report-anchor-highlight')
  })

  it('模板二结论兜底列表项使用共享识别结果定位和高亮', () => {
    render(
      <MarkdownPreview
        markdown={[
          '# 代码审查报告模板二',
          '## 三、结论',
          '### 1. 高风险项总结',
          '- 未校验数组下标，可能发生越界访问。'
        ].join('\n')}
        activeFeedbackAnchorId="report-option-3"
      />
    )

    const item = screen.getByRole('listitem')
    expect(item).toHaveAttribute('data-report-anchor-id', 'report-option-3')
    expect(item).toHaveClass('report-anchor-highlight')
  })

  it('does not render report feedback checkboxes by default', () => {
    render(<MarkdownPreview markdown={'## 高风险问题\n\n### 空指针风险'} />)

    expect(screen.queryByRole('checkbox', { name: '空指针风险' })).not.toBeInTheDocument()
  })
})
