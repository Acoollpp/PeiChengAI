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

  it('renders pipe tables with escaped cell content', () => {
    expect(
      renderMarkdown('| Version | Author | Note |\n| --- | --- | --- |\n| r1 | Ada | Fix `SOC` <bug> |')
    ).toBe(
      '<table><thead><tr><th>Version</th><th>Author</th><th>Note</th></tr></thead><tbody><tr><td>r1</td><td>Ada</td><td>Fix <code>SOC</code> &lt;bug&gt;</td></tr></tbody></table>'
    )
  })

  it('keeps incomplete table syntax as paragraphs', () => {
    expect(renderMarkdown('| Version | Author |\n| r1 | Ada |')).toBe(
      '<p>| Version | Author |</p><p>| r1 | Ada |</p>'
    )
  })
})
