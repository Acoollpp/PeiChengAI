import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings, list items, and inline code', () => {
    expect(renderMarkdown('# 审查报告\n- 文件 `src/App.tsx` 已更新')).toBe(
      '<h1>审查报告</h1><ul><li>文件 <code>src/App.tsx</code> 已更新</li></ul>'
    )
  })

  it('escapes embedded html before rendering markdown marks', () => {
    expect(renderMarkdown('**<script>alert(1)</script>**')).toBe(
      '<p><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong></p>'
    )
  })
})
