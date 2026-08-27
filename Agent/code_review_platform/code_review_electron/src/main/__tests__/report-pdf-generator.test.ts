import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generatePdfReport } from '../report-pdf-generator'
import { SAFE_SVG_PLACEHOLDER } from '../report-svg-safety'

const expectMissing = async (path: string): Promise<void> => {
  await expect(access(path)).rejects.toThrow()
}

describe('report pdf generator', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('generates a PDF next to a markdown report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-'))
    tempDirs.push(dir)
    const reportPath = join(dir, 'r1_r2审查报告.md')
    await writeFile(reportPath, '# 审查报告\n\n正文内容\n')
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async () => undefined),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4\nfake-pdf'))
      },
      close: vi.fn()
    }))

    const result = await generatePdfReport(reportPath, { createWindow })

    expect(result).toEqual({
      status: 'ready',
      reportPath,
      pdfPath: join(dir, 'r1_r2审查报告.pdf')
    })
    await expect(readFile(result.pdfPath, 'utf8')).resolves.toBe('%PDF-1.4\nfake-pdf')
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        })
      })
    )
  })

  it('使用内存Markdown生成PDF且不改写本地原始报告', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-memory-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalMarkdown = '# 原始报告\n\n### 问题一\n'
    const renderingMarkdown = [
      originalMarkdown,
      '> 是否有效：有效',
      '>',
      '> 用户反馈：`已完成修复`'
    ].join('\n')
    await writeFile(reportPath, originalMarkdown)
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4\nmemory'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow, markdown: renderingMarkdown })

    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalMarkdown)
    expect(loadedHtml).toContain('是否有效：有效')
    expect(loadedHtml).toContain('<code>已完成修复</code>')
  })

  it('将正文中的 Markdown 分隔线渲染为水平线', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-thematic-break-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '# 审查报告\n\n第一部分\n\n---\n\n第二部分\n')
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('<hr/>')
    expect(loadedHtml).not.toContain('<p>---</p>')
  })

  it('PDF 打印 HTML 显式固定白底浅色，不继承客户端主题', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-light-theme-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '# 审查报告\n\n正文内容\n')
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('html, body { background: #ffffff; }')
    expect(loadedHtml).toContain('body { color: #111827;')
    expect(loadedHtml).not.toContain('data-theme')
    expect(loadedHtml).not.toContain('--pc-')
  })

  it('忽略报告末尾没有后续内容的 Markdown 分隔线', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-trailing-break-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '# 审查报告\n\n正文内容\n\n---\n\n')
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).not.toContain('<hr>')
    expect(loadedHtml).not.toContain('<p>---</p>')
  })

  it('allows existing relative image references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-image-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![流程图](images/diagram.png)\n')
    await writeFile(join(dir, 'images', 'diagram.png'), Buffer.from('png-bytes'))
    let loadedHtmlPath = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtmlPath = path
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadFile).toHaveBeenCalled()
    expect(extname(loadedHtmlPath)).toBe('.html')
    await expectMissing(loadedHtmlPath)
  })

  it('inlines relative image references with spaces, encoded spaces, and titles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-image-spaces-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(
      reportPath,
      [
        '![空格路径](images/my diagram.png)',
        '![编码路径](images/my%20diagram.png)',
        '![标题路径](images/diagram.png "标题")'
      ].join('\n')
    )
    await writeFile(join(dir, 'images', 'my diagram.png'), Buffer.from('space-image'))
    await writeFile(join(dir, 'images', 'diagram.png'), Buffer.from('title-image'))
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('data:image/png;base64,c3BhY2UtaW1hZ2U=')
    expect(loadedHtml).toContain('data:image/png;base64,dGl0bGUtaW1hZ2U=')
    expect(loadedHtml).not.toContain('src="images/my diagram.png"')
    expect(loadedHtml).not.toContain('src="images/my%20diagram.png"')
  })

  it('keeps literal percent signs in image paths without throwing URI errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-percent-image-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![覆盖率](images/coverage-100%.png)\n')
    await writeFile(join(dir, 'images', 'coverage-100%.png'), Buffer.from('percent-image'))
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('data:image/png;base64,cGVyY2VudC1pbWFnZQ==')
  })

  it('loads a temporary HTML file for large inline images and cleans it up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-large-image-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![大图](images/large.png)\n')
    await writeFile(join(dir, 'images', 'large.png'), Buffer.alloc(128 * 1024, 7))
    let loadedHtmlPath = ''
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtmlPath = path
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadFile).toHaveBeenCalledTimes(1)
    expect(loadedHtmlPath).not.toContain('data:text/html')
    expect(extname(loadedHtmlPath)).toBe('.html')
    expect(loadedHtml).toContain('data:image/png;base64')
    await expectMissing(loadedHtmlPath)
  })

  it('preserves print errors when temporary HTML cleanup fails and closes the window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-print-fail-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '# 审查报告\n')
    const printError = new Error('print failed')
    const close = vi.fn()
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async () => undefined),
      webContents: {
        printToPDF: vi.fn(async () => {
          throw printError
        })
      },
      close
    }))
    const removeFile = vi.fn(async () => {
      throw new Error('cleanup failed')
    })

    await expect(generatePdfReport(reportPath, { createWindow, removeFile })).rejects.toThrow(
      'print failed'
    )
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ignores image syntax inside fenced code blocks and inline code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-code-image-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(
      reportPath,
      [
        '# 审查报告',
        '',
        '```md',
        '![示例](missing.png)',
        '```',
        '',
        '行内代码 `![示例](missing.png)` 不应校验。',
        '',
        '~~~md',
        '![示例](missing.png)',
        '~~~~',
        '',
        '多反引号 `` 这里有 ` 和 ![示例](missing.png) `` 不应校验。',
        '',
        '![真实图片](images/diagram.png)'
      ].join('\n')
    )
    await writeFile(join(dir, 'images', 'diagram.png'), Buffer.from('real-image'))
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('data:image/png;base64,cmVhbC1pbWFnZQ==')
    expect(loadedHtml).not.toContain('src="missing.png"')
    expect(loadedHtml.match(/data:image\/png;base64/g)).toHaveLength(1)
  })

  it('keeps table cells intact when pipes are escaped or inside inline code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-table-pipes-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(
      reportPath,
      [
        '| 类型 | 内容 |',
        '| --- | --- |',
        '| 代码 | `a|b` |',
        '| 转义 | a\\|b |',
        '| 路径 | C:\\temp\\report.md |',
        '| 多反引号 | ``a ` | b`` |'
      ].join('\n')
    )
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('<td><code>a|b</code></td>')
    expect(loadedHtml).toContain('<td>a|b</td>')
    expect(loadedHtml).toContain('<td>C:\\temp\\report.md</td>')
    expect(loadedHtml).toContain('<td><code>a ` | b</code></td>')
    expect(loadedHtml).not.toContain('<td><code>a</code></td>')
    expect(loadedHtml).not.toContain('<td>b`</td>')
  })

  it('rejects missing relative image references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-missing-image-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![流程图](images/missing.png)\n')

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      'PDF生成失败：报告图片不存在：images/missing.png'
    )
  })

  it('rejects image references outside the report directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-escape-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![流程图](../secret.png)\n')

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      'PDF生成失败：报告图片路径不能指向报告目录外：../secret.png'
    )
  })

  it('rejects absolute image references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-absolute-image-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const imagePath = join(dir, 'images', 'absolute.png')
    await writeFile(reportPath, `![绝对路径](${imagePath})\n`)

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      `PDF生成失败：报告图片必须使用相对路径：${imagePath}`
    )
  })

  it('rejects image references with schemes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-url-image-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![远程图片](http://example.com/a.png)\n')

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      'PDF生成失败：报告图片必须使用相对路径：http://example.com/a.png'
    )
  })

  it('rejects image symlinks that point outside the report directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-symlink-'))
    tempDirs.push(dir)
    const outsideDir = await mkdtemp(join(tmpdir(), 'report-pdf-outside-'))
    tempDirs.push(outsideDir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![流程图](images/outside.png)\n')
    await writeFile(join(outsideDir, 'outside.png'), Buffer.from('outside-image'))
    await symlink(join(outsideDir, 'outside.png'), join(dir, 'images', 'outside.png'))

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      'PDF生成失败：报告图片路径不能指向报告目录外：images/outside.png'
    )
  })

  it('rejects empty and non-markdown reports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-invalid-'))
    tempDirs.push(dir)
    const emptyReportPath = join(dir, 'empty.md')
    const textReportPath = join(dir, 'report.txt')
    await writeFile(emptyReportPath, '')
    await writeFile(textReportPath, 'plain text')

    await expect(generatePdfReport(emptyReportPath)).rejects.toThrow(
      'PDF生成失败：报告文件为空'
    )
    await expect(generatePdfReport(textReportPath)).rejects.toThrow(
      'PDF生成失败：请选择 Markdown 报告文件'
    )
  })

  it('renders single line breaks inside a paragraph as line breaks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-soft-break-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(
      reportPath,
      ['**项目路径：** svn://repo/bms', '**所属部门：** 软件开发部', '**新版本：** r49072'].join(
        '\n'
      )
    )
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml.match(/<br\s*\/>/g) ?? []).toHaveLength(2)
    expect(loadedHtml).not.toContain('&lt;br /&gt;')
  })

  it('keeps hard line breaks from legacy reports from doubling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-hard-break-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '**项目路径：** svn://repo/bms  \n**所属部门：** 软件开发部')
    let loadedHtml = ''
    const loadFile = vi.fn<(path: string) => Promise<void>>(async (path) => {
      loadedHtml = await readFile(path, 'utf8')
    })
    const createWindow = vi.fn(() => ({
      loadFile,
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml.match(/<br\s*\/>/g) ?? []).toHaveLength(1)
  })

  it('renders standard Markdown and GFM inline syntax in headings, tables, and lists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-gfm-inline-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(
      reportPath,
      [
        '# **代码审查报告**',
        '',
        '**项目路径：** https://example.com/review',
        '',
        '| **字段** | 说明 |',
        '| --- | --- |',
        '| *状态* | ~~已废弃~~ |',
        '',
        '- **列表粗体**',
        '- *列表斜体*',
        '- ~~列表删除线~~',
        '',
        '`**代码中不是粗体**`',
        '',
        '第一行<br />第二行',
        '',
        '[安全链接](https://example.com) [受限链接](ftp://example.com)'
      ].join('\n')
    )
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain('<strong>代码审查报告</strong>')
    expect(loadedHtml).toContain('<strong>项目路径：</strong>')
    expect(loadedHtml).toContain('<em>状态</em>')
    expect(loadedHtml).toContain('<del>已废弃</del>')
    expect(loadedHtml).toContain('<li><strong>列表粗体</strong></li>')
    expect(loadedHtml).toContain('<li><em>列表斜体</em></li>')
    expect(loadedHtml).toContain('<code>**代码中不是粗体**</code>')
    expect(loadedHtml).toMatch(/第一行<br\s*\/>\s*第二行/)
    expect(loadedHtml).toContain('<a href="https://example.com">安全链接</a>')
    expect(loadedHtml).not.toContain('ftp://example.com')
    expect(loadedHtml).not.toContain('<p>**项目路径：**')
  })

  it('inlines 新版 Skill images/issue-<NN>.svg report images for PDF rendering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-svg-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360"><rect width="900" height="360" fill="#ffffff"/><text x="24" y="48">代码对比</text></svg>'
    await writeFile(reportPath, '![问题1代码对比](images/issue-01.svg)\n')
    await writeFile(join(dir, 'images', 'issue-01.svg'), svg)
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('pdf-bytes'))
      },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).toContain(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    expect(loadedHtml).toContain('alt="问题1代码对比"')
    expect(loadedHtml).toContain('height: auto')
    expect(loadedHtml).toContain('break-inside: avoid')
  })

  it('不将不安全 SVG 原图嵌入 PDF，而是使用安全占位图', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-unsafe-svg-'))
    tempDirs.push(dir)
    await mkdir(join(dir, 'images'), { recursive: true })
    const reportPath = join(dir, '代码审查报告.md')
    const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    await writeFile(reportPath, '![问题1代码对比](images/issue-01.svg)\n')
    await writeFile(join(dir, 'images', 'issue-01.svg'), unsafeSvg)
    let loadedHtml = ''
    const createWindow = vi.fn(() => ({
      loadFile: vi.fn(async (path: string) => {
        loadedHtml = await readFile(path, 'utf8')
      }),
      webContents: { printToPDF: vi.fn(async () => Buffer.from('pdf-bytes')) },
      close: vi.fn()
    }))

    await generatePdfReport(reportPath, { createWindow })

    expect(loadedHtml).not.toContain(Buffer.from(unsafeSvg).toString('base64'))
    expect(loadedHtml).toContain(SAFE_SVG_PLACEHOLDER.toString('base64'))
  })

  it('keeps SVG image path safety checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-pdf-svg-escape-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    await writeFile(reportPath, '![问题1代码对比](../issue-01.svg)\n')

    await expect(generatePdfReport(reportPath)).rejects.toThrow(
      'PDF生成失败：报告图片路径不能指向报告目录外：../issue-01.svg'
    )
  })
})
