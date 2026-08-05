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
})
