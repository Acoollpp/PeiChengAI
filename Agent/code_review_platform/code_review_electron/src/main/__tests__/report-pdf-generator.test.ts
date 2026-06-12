import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generatePdfReport } from '../report-pdf-generator'

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
})
