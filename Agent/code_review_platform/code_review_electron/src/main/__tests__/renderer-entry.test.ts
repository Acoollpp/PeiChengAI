import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  getDevelopmentRendererUrl,
  getRendererDocumentName,
  isWorkbenchPreviewEnabled
} from '../renderer-entry'

describe('2.0 工作台预览入口隔离', () => {
  it('默认始终保留生产任务页入口', () => {
    expect(isWorkbenchPreviewEnabled(undefined)).toBe(false)
    expect(isWorkbenchPreviewEnabled('0')).toBe(false)
    expect(getRendererDocumentName(false)).toBe('index.html')
    expect(getDevelopmentRendererUrl('http://127.0.0.1:5173', false)).toBe(
      'http://127.0.0.1:5173'
    )
  })

  it('只有显式开发开关才进入独立预览文档', () => {
    expect(isWorkbenchPreviewEnabled('1')).toBe(true)
    expect(getRendererDocumentName(true)).toBe('preview.html')
    expect(getDevelopmentRendererUrl('http://127.0.0.1:5173', true)).toBe(
      'http://127.0.0.1:5173/preview.html'
    )
  })

  it('生产入口不引用预览 fixture，两个验收入口各自显式加载目标组件', async () => {
    const rendererRoot = resolve(process.cwd(), 'src', 'renderer', 'src')
    const [productionMain, app, productionWorkbench, previewMain, productionHarnessMain, productionHarnessHtml] = await Promise.all([
      readFile(resolve(rendererRoot, 'main.tsx'), 'utf8'),
      readFile(resolve(rendererRoot, 'App.tsx'), 'utf8'),
      readFile(resolve(rendererRoot, 'workbench-preview', 'ProductionReviewWorkbench.tsx'), 'utf8'),
      readFile(resolve(rendererRoot, 'preview-main.tsx'), 'utf8'),
      readFile(resolve(rendererRoot, 'production-harness-main.tsx'), 'utf8'),
      readFile(resolve(rendererRoot, '..', 'production-harness.html'), 'utf8')
    ])

    expect(`${productionMain}\n${app}\n${productionWorkbench}`).not.toContain('fixture-adapter')
    expect(productionWorkbench).toContain('REVIEW_ITEM_CATALOG')
    expect(previewMain).toContain("from './workbench-preview/fixture-adapter'")
    expect(previewMain).toContain('createFixtureWorkbenchAdapter()')
    expect(productionHarnessMain).toContain(
      "from './workbench-preview/ProductionReviewWorkbench'"
    )
    expect(productionHarnessMain).toContain('<ProductionReviewWorkbench')
    expect(productionHarnessMain).not.toContain('fixture-adapter')
    expect(productionHarnessMain).toContain('catalogOverride={catalogOverride}')
    expect(productionHarnessMain).toContain('getTodayTaskStats')
    expect(productionHarnessMain).toContain("harnessScenario === 'stats-error'")
    expect(productionHarnessMain).toContain("harnessScenario === 'multi-task'")
    expect(app).not.toContain('catalogOverride')
    expect(productionHarnessHtml).toContain('src="/src/production-harness-main.tsx"')
  })
})
