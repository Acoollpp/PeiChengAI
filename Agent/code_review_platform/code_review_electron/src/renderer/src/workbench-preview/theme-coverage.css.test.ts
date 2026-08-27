import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(currentDir, '..')
const workbenchCss = readFileSync(resolve(currentDir, 'workbench-preview.css'), 'utf8')
const appCss = readFileSync(resolve(rendererRoot, 'styles.css'), 'utf8')
const reviewWorkbenchSource = readFileSync(resolve(currentDir, 'ReviewWorkbenchPreview.tsx'), 'utf8')

const extractBlocks = (css: string, selector: string): string[] => {
  const blocks: string[] = []
  let searchFrom = 0

  while (searchFrom < css.length) {
    const index = css.indexOf(selector, searchFrom)
    if (index === -1) {
      break
    }

    const openBrace = css.indexOf('{', index)
    if (openBrace === -1) {
      break
    }

    let depth = 0
    for (let cursor = openBrace; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') {
        depth += 1
      } else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) {
          blocks.push(css.slice(openBrace + 1, cursor))
          searchFrom = cursor + 1
          break
        }
      }
    }

    if (searchFrom <= index) {
      break
    }
  }

  return blocks
}

const expectBlockContains = (css: string, selector: string, snippets: string[]): void => {
  const blocks = extractBlocks(css, selector)
  expect(blocks, `缺少选择器 ${selector}`).not.toHaveLength(0)
  const matchingBlock = blocks.find((block) =>
    snippets.every((snippet) => block.includes(snippet))
  )
  expect(matchingBlock, `${selector} 缺少 ${snippets.join(' / ')}`).toBeDefined()
}

describe('Issue #88 主题覆盖 CSS 契约', () => {
  it('工作台定义浅/深两套语义 token，Markdown 不再依赖固定浅色底', () => {
    expectBlockContains(workbenchCss, '.wb-shell', [
      '--wb-markdown-bg: #ffffff;',
      '--wb-markdown-text: #34444e;',
      '--wb-control-placeholder: #61737c;',
      '--wb-link: #056b61;'
    ])
    expectBlockContains(workbenchCss, 'html[data-theme="dark"] .wb-shell', [
      '--wb-markdown-bg: #0e151b;',
      '--wb-markdown-text: #dce6eb;',
      '--wb-control-placeholder: #96a6ae;',
      '--wb-link: #8eeadd;'
    ])
    expectBlockContains(workbenchCss, '.wb-markdown-panel,\n.wb-markdown-panel > .preview-scroll,\n.wb-markdown-scroll', [
      'background: var(--wb-markdown-bg);'
    ])
  })

  it('Markdown 表格、代码块、引用、链接和反馈锚点都消费主题变量', () => {
    expectBlockContains(workbenchCss, '.wb-markdown-panel .markdown-preview blockquote,\n.wb-markdown-scroll blockquote', [
      'border-color: var(--wb-quote-border);',
      'background: var(--wb-quote-bg);'
    ])
    expectBlockContains(workbenchCss, '.wb-markdown-panel .markdown-preview a,\n.wb-markdown-scroll a', [
      'color: var(--wb-link);',
      'text-decoration: underline;'
    ])
    expectBlockContains(workbenchCss, '.wb-markdown-panel .markdown-code-block,\n.wb-markdown-panel .markdown-preview pre,\n.wb-markdown-scroll pre', [
      'background: var(--wb-code-bg);'
    ])
    expectBlockContains(workbenchCss, '.wb-markdown-panel .markdown-preview th,\n.wb-markdown-scroll th', [
      'background: var(--wb-table-head-bg);'
    ])
    expectBlockContains(workbenchCss, '.report-anchor-highlight,\n.report-issue-block-active', [
      'outline: 2px solid var(--wb-focus);',
      'background: var(--wb-anchor-bg);'
    ])
  })

  it('任务管理关键阅读文本不再使用 9-11px 的低可读字号', () => {
    expectBlockContains(workbenchCss, '.wb-task-identity strong,\n.wb-management-report-row > div:first-child strong,\n.wb-report-index-title strong,\n.wb-feedback-intro strong', [
      'font-size: 14px;'
    ])
    expectBlockContains(workbenchCss, '.wb-row-svn,\n.wb-task-progress > strong,\n.wb-feedback-file-list strong', [
      'font-size: 13px;',
      'color: var(--wb-text-soft);'
    ])
    expectBlockContains(workbenchCss, '.wb-status-label,\n.wb-task-table-row .wb-status-label', [
      'font-size: 12px;',
      'background: var(--wb-control-bg-muted);'
    ])
    expectBlockContains(workbenchCss, '.wb-environment-inline .dependency-card strong', [
      'font-size: 13px;'
    ])
    expectBlockContains(workbenchCss, '.wb-environment-inline .dependency-card p,\n.wb-environment-inline .dependency-help', [
      'font-size: 13px;',
      'color: var(--wb-readable-muted);'
    ])
  })

  it('成功、等待、失败、完成状态都有非颜色通道和主题化底色', () => {
    expect(reviewWorkbenchSource).toContain('<span className="wb-status-label">{task.stageLabel}</span>')
    expect(reviewWorkbenchSource).toContain('<ol className="wb-compact-stage-track"')
    expect(reviewWorkbenchSource).toContain('<CircleAlert aria-hidden="true" />')
    expect(reviewWorkbenchSource).toContain('<Check aria-hidden="true" />')
    expectBlockContains(workbenchCss, '.is-running .wb-status-label', [
      'background: var(--wb-accent-soft);'
    ])
    expectBlockContains(workbenchCss, '.is-waiting .wb-status-label', [
      'background: var(--wb-waiting-soft);'
    ])
    expectBlockContains(workbenchCss, '.is-failed .wb-status-label', [
      'background: var(--wb-danger-soft);'
    ])
    expectBlockContains(workbenchCss, '.is-complete .wb-status-label', [
      'background: var(--pc-success-soft);'
    ])
  })

  it('styles 后导入时仍会恢复生产工作台深色 Markdown，而登录类弹窗保持独立主题', () => {
    expectBlockContains(appCss, 'html[data-theme="dark"] .production-shell .wb-markdown-panel,\nhtml[data-theme="dark"] .production-shell .wb-markdown-panel > .preview-scroll', [
      'background: var(--wb-markdown-bg);'
    ])
    expectBlockContains(appCss, 'html[data-theme="dark"] .production-shell .wb-markdown-panel .markdown-preview blockquote', [
      'background: var(--wb-quote-bg);'
    ])
    expect(appCss).toContain('.production-shell .dialog-overlay:not(.login-dialog-overlay)')
    expect(appCss).toContain('.production-shell .dialog-card:not(.login-dialog-card)')
    expect(appCss).toContain('.login-dialog-overlay,')
    expect(appCss).toContain('html[data-theme="dark"] .login-dialog-overlay')
  })

  it('独立报告问题反馈窗口继续使用固定浅色 CSS，不接入 data-theme 或主题按钮', () => {
    const reportFeedbackCss = readFileSync(resolve(rendererRoot, 'report-feedback.css'), 'utf8')
    const reportFeedbackMain = readFileSync(resolve(rendererRoot, 'report-feedback-main.tsx'), 'utf8')

    expect(reportFeedbackCss).not.toContain('data-theme')
    expect(reportFeedbackCss).toContain('background: #f5f6f8;')
    expect(reportFeedbackCss).toContain('background: #ffffff;')
    expect(reportFeedbackMain).not.toContain('ThemeToggleButton')
  })

  it('窄窗口下意见列表不保留固定表格宽度，并隐藏次要列', () => {
    expectBlockContains(workbenchCss, '.wb-feedback-table', [
      'min-width: 0;',
      'width: 100%;'
    ])
    expect(workbenchCss).toContain('@media (max-width: 720px)')
    expect(workbenchCss).toContain('.wb-feedback-table-row > :nth-child(3)')
    expect(workbenchCss).toContain('.wb-feedback-table-row > :nth-child(4)')
  })
})
