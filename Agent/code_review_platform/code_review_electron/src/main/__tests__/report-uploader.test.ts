import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ensurePdfReportReady,
  ensureReportReady,
  ensureRequirementFileReady,
  uploadPdfReportFile,
  uploadRequirementFile,
  uploadReportFile
} from '../report-uploader'
import { templateOneReportFixture } from '../../shared/__tests__/fixtures/review-report-fixtures'

const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415408d763f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex'
)

const loadSharedMarkdownImageCorpus = async (): Promise<{
  markdown: string
  expected_paths: string[]
}> =>
  JSON.parse(
    await readFile(
      resolve(process.cwd(), '..', 'tests', 'fixtures', 'report-image-markdown-corpus.json'),
      'utf8'
    )
  )

describe('report uploader', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('rejects missing and empty report files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-'))
    tempDirs.push(dir)
    const missingReportPath = join(dir, 'missing.md')
    const emptyReportPath = join(dir, 'empty.md')
    await writeFile(emptyReportPath, '')

    await expect(ensureReportReady(missingReportPath)).rejects.toThrow('审查报告不存在')
    await expect(ensureReportReady(emptyReportPath)).rejects.toThrow('审查报告为空')
  })

  it('从磁盘路径上传报告内容、文件名和零问题新协议', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-'))
    tempDirs.push(dir)
    const reportPath = join(dir, 'r12_r14审查报告_20260610_142530.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, '# report\n')

    await uploadReportFile(api, 'token-123', 'task-1', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', {
      report_content: '# report\n',
      report_path: reportPath,
      report_name: 'r12_r14审查报告_20260610_142530.md',
      feedback_protocol_version: 1,
      issues: [],
      assets: []
    })
  })

  it('上传新报告时提交有序问题快照和 Markdown 引用的相对图片资产', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-new-protocol-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const imagePath = join(dir, 'images', 'null-pointer.png')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, templateOneReportFixture)
    await writeFile(imagePath, VALID_PNG_BYTES)

    await uploadReportFile(api, 'token-123', 'task-1', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        feedback_protocol_version: 1,
        issues: [
          expect.objectContaining({
            issue_text: '高风险：空指针解引用',
            description_text: '未校验返回值即解引用，错误分支会触发崩溃。',
            order: 0,
            source: 'template_1_heading'
          }),
          expect.objectContaining({ order: 1 }),
          expect.objectContaining({ order: 2 })
        ],
        assets: [
          {
            relative_path: 'images/null-pointer.png',
            content: VALID_PNG_BYTES,
            content_type: 'image/png'
          }
        ]
      })
    )
  })

  it('按共享 CommonMark 语料识别图片并忽略转义与代码中的伪引用', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-markdown-images-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    const corpus = await loadSharedMarkdownImageCorpus()
    await Promise.all(
      corpus.expected_paths.map(async (relativePath) => {
        const imagePath = join(dir, ...relativePath.split('/'))
        await mkdir(resolve(imagePath, '..'), { recursive: true })
        await writeFile(imagePath, VALID_PNG_BYTES)
      })
    )
    await writeFile(reportPath, corpus.markdown)

    await uploadReportFile(api, 'token-123', 'task-1', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        assets: corpus.expected_paths.map((relativePath) => ({
          relative_path: relativePath,
          content: VALID_PNG_BYTES,
          content_type: 'image/png'
        }))
      })
    )
  })

  it('拒绝 images 目录符号链接到报告目录外', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-symlink-root-'))
    tempDirs.push(dir)
    const reportDirectory = join(dir, 'report')
    const outsideDirectory = join(dir, 'outside-images')
    const reportPath = join(reportDirectory, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(reportDirectory, { recursive: true })
    await mkdir(outsideDirectory, { recursive: true })
    await writeFile(join(outsideDirectory, 'evidence.png'), VALID_PNG_BYTES)
    await symlink(outsideDirectory, join(reportDirectory, 'images'), 'dir')
    await writeFile(reportPath, '# 报告\n\n![证据](images/evidence.png)\n')

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '报告图片目录不能指向报告目录外'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: '绝对路径',
      imageReference: '/tmp/evidence.png',
      prepare: async (_dir: string) => undefined,
      message: '报告图片必须使用相对路径'
    },
    {
      name: '图片目录外路径',
      imageReference: 'evidence.png',
      prepare: async (dir: string) => writeFile(join(dir, 'evidence.png'), 'png-content'),
      message: '报告图片必须位于 images 目录'
    },
    {
      name: '空图片',
      imageReference: 'images/evidence.png',
      prepare: async (dir: string) => {
        await mkdir(join(dir, 'images'), { recursive: true })
        await writeFile(join(dir, 'images', 'evidence.png'), '')
      },
      message: '报告图片为空'
    }
  ])('上传前拒绝$name', async ({ imageReference, prepare, message }) => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-invalid-asset-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await prepare(dir)
    await writeFile(reportPath, `# 代码审查报告\n\n![证据](${imageReference})\n`)

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(message)
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('上传前拒绝伪造的图片内容', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-invalid-content-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# Review\n\n![证据](images/evidence.png)\n')
    await writeFile(join(dir, 'images', 'evidence.png'), 'not-a-real-png')

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '报告图片内容与文件格式不一致'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('上传前拒绝超过大小限制的 Markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-large-markdown-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '审查报告超过大小限制'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('上传前拒绝超过数量限制的图片', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-too-many-images-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    const imagePaths = Array.from({ length: 51 }, (_, index) => `images/${index}.png`)
    await mkdir(join(dir, 'images'), { recursive: true })
    await Promise.all(
      imagePaths.map((imagePath) => writeFile(join(dir, imagePath), VALID_PNG_BYTES))
    )
    await writeFile(
      reportPath,
      imagePaths.map((imagePath) => `![证据](${imagePath})`).join('\n')
    )

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '报告图片数量超过限制'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('发布前只清理报告输出元数据并保留正文普通路径和代码块内容', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-metadata-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = [
      '# 代码审查报告',
      '**报告输出路径：** C:\\review\\代码审查报告.md',
      '- **报告输出地址:** /tmp/review/report.md',
      '正文中的普通路径：`src/main.c:42`',
      '**项目路径：** svn://repo/project',
      '    报告输出路径：/docs/indented-example.md',
      '```markdown',
      '**报告输出路径：** /docs/example.md',
      '```',
      '## 风险问题',
      '**报告输出路径：** 用户输入未经过滤，可能覆盖其他文件。',
      ''
    ].join('\r\n')
    const expectedReport = [
      '# 代码审查报告',
      '正文中的普通路径：`src/main.c:42`',
      '**项目路径：** svn://repo/project',
      '    报告输出路径：/docs/indented-example.md',
      '```markdown',
      '**报告输出路径：** /docs/example.md',
      '```',
      '## 风险问题',
      '**报告输出路径：** 用户输入未经过滤，可能覆盖其他文件。',
      ''
    ].join('\r\n')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, originalReport)

    await uploadReportFile(api, 'token-123', 'task-1', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', {
      report_content: expectedReport,
      report_path: reportPath,
      report_name: '代码审查报告.md',
      feedback_protocol_version: 1,
      issues: [],
      assets: []
    })
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(expectedReport)
  })

  it('rejects missing and empty PDF report files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-pdf-'))
    tempDirs.push(dir)
    const missingReportPath = join(dir, 'missing.pdf')
    const emptyReportPath = join(dir, 'empty.pdf')
    await writeFile(emptyReportPath, '')

    await expect(ensurePdfReportReady(missingReportPath)).rejects.toThrow('PDF报告不存在')
    await expect(ensurePdfReportReady(emptyReportPath)).rejects.toThrow('PDF报告为空')
  })

  it('uploads PDF report bytes and file name from disk path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-pdf-'))
    tempDirs.push(dir)
    const pdfPath = join(dir, 'r12_r14审查报告_20260610_142530.pdf')
    const api = {
      uploadPdfReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(pdfPath, '%PDF-1.4\n')

    await uploadPdfReportFile(api, 'token-123', 'task-1', pdfPath)

    expect(api.uploadPdfReport).toHaveBeenCalledWith('token-123', 'task-1', {
      pdf_content: Buffer.from('%PDF-1.4\n'),
      pdf_name: 'r12_r14审查报告_20260610_142530.pdf'
    })
  })

  it('rejects missing and empty requirement files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'requirement-uploader-'))
    tempDirs.push(dir)
    const missingPath = join(dir, 'missing.xls')
    const emptyPath = join(dir, 'empty.xlsx')
    await writeFile(emptyPath, '')

    await expect(ensureRequirementFileReady(missingPath)).rejects.toThrow('产品开发需求表不存在')
    await expect(ensureRequirementFileReady(emptyPath)).rejects.toThrow('产品开发需求表为空')
  })

  it('uploads requirement file bytes and file name from disk path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'requirement-uploader-'))
    tempDirs.push(dir)
    const filePath = join(dir, '产品开发需求表.xls')
    const api = {
      uploadRequirementFile: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(filePath, 'excel-content')

    await uploadRequirementFile(api, 'token-123', 'task-1', filePath)

    expect(api.uploadRequirementFile).toHaveBeenCalledWith('token-123', 'task-1', {
      file_content: Buffer.from('excel-content'),
      file_name: '产品开发需求表.xls'
    })
  })
})
