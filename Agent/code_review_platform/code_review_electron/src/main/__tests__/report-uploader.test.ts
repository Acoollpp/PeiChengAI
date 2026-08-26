import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'
import log from 'electron-log/main'

vi.mock('electron', () => ({
  nativeImage: {
    createFromDataURL: (dataUrl: string) => {
      const [metadata, encoded = ''] = dataUrl.split(',', 2)
      const content = Buffer.from(encoded, 'base64')
      const contentType = /^data:([^;]+)/.exec(metadata)?.[1]
      const isDecodable =
        (contentType === 'image/png' &&
          content.length > 40 &&
          content.subarray(-8).equals(Buffer.from('49454e44ae426082', 'hex'))) ||
        (contentType === 'image/jpeg' &&
          content.length > 100 &&
          content.subarray(-2).equals(Buffer.from('ffd9', 'hex'))) ||
        (contentType === 'image/gif' && content.length > 20 && content.at(-1) === 0x3b) ||
        (contentType === 'image/webp' &&
          content.length > 20 &&
          content.readUInt32LE(4) + 8 === content.length) ||
        (contentType === 'image/svg+xml' &&
          /<svg\b/i.test(content.toString('utf8')) &&
          /<\/svg>/i.test(content.toString('utf8')) &&
          !/<script\b/i.test(content.toString('utf8')))
      return {
        getSize: () => (isDecodable ? { width: 1, height: 1 } : { width: 0, height: 0 }),
        isEmpty: () => !isDecodable
      }
    }
  }
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn()
  }
}))

import {
  ensurePdfReportReady,
  ensureReportReady,
  ensureRequirementFileReady,
  uploadPdfReportFile,
  uploadRequirementFile,
  uploadReportFile
} from '../report-uploader'
import {
  bmsCodeReviewerHistoricalDs02ReportFixture,
  bmsCodeReviewerHistoricalPcBmsReportFixture,
  bmsCodeReviewerMissingReviewIssuesReportFixture,
  bmsCodeReviewerNoSeverityReportFixture,
  bmsCodeReviewerPcBmsReportFixture,
  bmsCodeReviewerSearchEvidenceReportFixture,
  bmsCodeReviewerZeroIssuesFixture,
  templateOneReportFixture
} from '../../shared/__tests__/fixtures/review-report-fixtures'

const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082',
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

type ImageValidationCorpusEntry = {
  name: string
  extension: string
  content_type: string
  valid_base64: string
  additional_valid_base64?: string[]
  invalid_base64: string
  additional_invalid_base64?: string[]
  server_only_invalid_base64?: string[]
  animated_base64?: string
}

const loadSharedImageValidationCorpus = async (): Promise<ImageValidationCorpusEntry[]> =>
  JSON.parse(
    await readFile(
      resolve(process.cwd(), '..', 'tests', 'fixtures', 'report-image-validation-corpus.json'),
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

  it('上传带中文句号的 bms-code-reviewer 零问题报告并提交零问题快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-zero-issues-'))
    tempDirs.push(dir)
    const reportPath = join(dir, 'DS-03零问题报告.md')
    const report = bmsCodeReviewerZeroIssuesFixture.replace(
      '本次未发现能够闭环的问题',
      '本次未发现能够闭环的问题。'
    )
    const api = {
      uploadReport: vi.fn(async () => ({
        feedback_protocol_version: 1,
        issue_count: 0,
        highest_issue_severity: null
      }))
    }
    await writeFile(reportPath, report)

    const uploaded = await uploadReportFile(api, 'token-123', 'task-zero', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-zero',
      expect.objectContaining({
        report_content: report,
        feedback_protocol_version: 1,
        issues: []
      })
    )
    expect(uploaded).toEqual({
      feedback_protocol_version: 1,
      issue_count: 0,
      highest_issue_severity: null
    })
  })

  it('发布新报告前只移除开头 UTF-8 BOM 并基于规范化正文计算偏移', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-bom-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    const originalReport =
      '\uFEFF# 代码审查报告\r\n\r\n### 高风险问题\r\n\r\n- **问题描述：** 保留正文中的 \uFEFF 字符。\r\n'
    const expectedReport = originalReport.slice(1)
    const expectedStartOffset = expectedReport.indexOf('### 高风险问题')
    await writeFile(reportPath, originalReport, 'utf8')

    await uploadReportFile(api, 'token-123', 'task-1', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        report_content: expectedReport,
        issues: [
          expect.objectContaining({
            issue_text: '高风险问题',
            description_text: '保留正文中的 \uFEFF 字符。',
            location: expect.objectContaining({ start_offset: expectedStartOffset })
          })
        ]
      })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(expectedReport)
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

  it('标准图片缺失时上传同名 IPGSD 加密候选中的真实 SVG 内容', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-svg-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/issue-01.svg)\n')
    await writeFile(join(dir, 'images', 'issue-01.svg.IPGSD'), svg)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-svg', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-svg',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/issue-01.svg)\n',
        assets: [{
          relative_path: 'images/issue-01.svg',
          content: svg,
          content_type: 'image/svg+xml'
        }]
      })
    )
    expect(log.info).toHaveBeenCalledWith(
      '[REPORT_IMAGE_ENCRYPTED_CANDIDATE_UPLOADED]',
      expect.objectContaining({
        relativePath: 'images/issue-01.svg',
        extension: '.svg',
        result: 'UPLOADED',
        reasonCode: 'VALID_ORIGINAL_CONTENT'
      })
    )
  })

  it('加密候选内容无效时用内存 SVG 占位并同步上传副本路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-placeholder-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = '# 报告\n\n![证据](images/issue-01.png)\n'
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', 'issue-01.png.IPGSD'), 'ciphertext')

    await uploadReportFile(api, 'token-123', 'task-ipgsd-placeholder', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-placeholder',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/issue-01.png.ipgsd-placeholder.svg)\n',
        assets: [expect.objectContaining({
          relative_path: 'images/issue-01.png.ipgsd-placeholder.svg',
          content_type: 'image/svg+xml',
          content: expect.any(Buffer)
        })]
      })
    )
    expect(log.warn).toHaveBeenCalledWith(
      '[REPORT_IMAGE_ENCRYPTED_CANDIDATE_PLACEHOLDER]',
      expect.objectContaining({
        relativePath: 'images/issue-01.png',
        extension: '.png',
        result: 'PLACEHOLDER',
        reasonCode: 'INVALID_IMAGE_CONTENT'
      })
    )
    const uploadReportCall = (api.uploadReport.mock.calls as unknown as Array<
      [string, string, { assets: Array<{ content: Uint8Array }> }]
    >)[0]
    if (!uploadReportCall) {
      throw new Error('缺少报告上传调用')
    }
    const placeholderAsset = uploadReportCall[2].assets[0]
    expect(Buffer.from(placeholderAsset.content).toString('utf8')).toContain(
      '代码图片因终端加密无法读取，已省略'
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it('无效 SVG 加密候选也使用内存 SVG 占位且保持 SVG 路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-svg-placeholder-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = '# 报告\n\n![证据](images/issue-01.svg)\n'
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', 'issue-01.svg.IPGSD'), 'ciphertext')

    await uploadReportFile(api, 'token-123', 'task-ipgsd-svg-placeholder', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-svg-placeholder',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/issue-01.svg.ipgsd-placeholder.svg)\n',
        assets: [expect.objectContaining({
          relative_path: 'images/issue-01.svg.ipgsd-placeholder.svg',
          content_type: 'image/svg+xml',
          content: expect.any(Buffer)
        })]
      })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it.each([
    {
      name: '脚本',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      reasonCode: 'UNSAFE_SVG_CONTENT'
    },
    {
      name: '外链',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.svg"/></svg>',
      reasonCode: 'UNSAFE_SVG_CONTENT'
    },
    {
      name: 'DOCTYPE',
      content: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
      reasonCode: 'FORBIDDEN_XML_DECLARATION'
    }
  ])('加密候选为危险 SVG（$name）时阻断上传而不降级占位', async ({ content, reasonCode }) => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-dangerous-svg-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/issue-01.svg)\n')
    await writeFile(join(dir, 'images', 'issue-01.svg.IPGSD'), content)

    await expect(uploadReportFile(api, 'token-123', 'task-ipgsd-dangerous-svg', reportPath)).rejects.toThrow(
      '报告图片内容与文件格式不一致'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(
      '[REPORT_IMAGE_ENCRYPTED_CANDIDATE_REJECTED]',
      expect.objectContaining({
        relativePath: 'images/issue-01.svg',
        extension: '.svg',
        result: 'REJECTED',
        reasonCode
      })
    )
  })

  it('非 SVG 加密候选的占位路径不会与已有 SVG 冲突', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-placeholder-name-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/a.png)\n')
    await writeFile(join(dir, 'images', 'a.png.IPGSD'), 'ciphertext')
    await writeFile(join(dir, 'images', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')

    await uploadReportFile(api, 'token-123', 'task-ipgsd-placeholder-name', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-placeholder-name',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/a.png.ipgsd-placeholder.svg)\n',
        assets: [expect.objectContaining({
          relative_path: 'images/a.png.ipgsd-placeholder.svg',
          content_type: 'image/svg+xml'
        })]
      })
    )
  })

  it('加密候选占位路径已存在时明确阻断', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-placeholder-conflict-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/a.png)\n')
    await writeFile(join(dir, 'images', 'a.png.IPGSD'), 'ciphertext')
    await writeFile(join(dir, 'images', 'a.png.ipgsd-placeholder.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')

    await expect(uploadReportFile(api, 'token-123', 'task-ipgsd-placeholder-conflict', reportPath)).rejects.toThrow(
      '报告图片占位路径冲突'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('只替换图片 URL 和图片 definition，不改写正文或代码中的同字串', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-markdown-ranges-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = [
      '正文提及 images/issue-01.svg.IPGSD，不能改写。',
      '',
      '`行内代码 images/issue-01.svg.IPGSD`',
      '',
      '```text',
      '代码块 images/issue-01.svg.IPGSD',
      '```',
      '',
      '![直接图片](images/issue-01.svg.IPGSD)',
      '![引用图片][evidence]',
      '',
      '[evidence]: images/issue-01.svg.IPGSD',
      ''
    ].join('\n')
    const expectedUploadedReport = originalReport
      .replace('![直接图片](images/issue-01.svg.IPGSD)', '![直接图片](images/issue-01.svg)')
      .replace('[evidence]: images/issue-01.svg.IPGSD', '[evidence]: images/issue-01.svg')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', 'issue-01.svg.IPGSD'), svg)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-markdown-ranges', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-markdown-ranges',
      expect.objectContaining({ report_content: expectedUploadedReport })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it.each([
    {
      name: '百分号编码',
      sourceUrl: 'images/a%20b.svg.IPGSD',
      diskName: 'a b.svg.IPGSD',
      expectedSourceUrl: 'images/a%20b.svg',
      expectedRelativePath: 'images/a b.svg'
    },
    {
      name: 'HTML 实体',
      sourceUrl: 'images/a&amp;b.svg.IPGSD',
      diskName: 'a&b.svg.IPGSD',
      expectedSourceUrl: 'images/a&amp;b.svg',
      expectedRelativePath: 'images/a&b.svg'
    }
  ])('IPGSD 图片 URL 保留原始$name语法且资产路径使用解析结果', async ({
    sourceUrl,
    diskName,
    expectedSourceUrl,
    expectedRelativePath
  }) => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-encoded-url-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = `# 报告\n\n![证据](${sourceUrl})\n`
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', diskName), svg)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-encoded-url', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-encoded-url',
      expect.objectContaining({
        report_content: `# 报告\n\n![证据](${expectedSourceUrl})\n`,
        assets: [expect.objectContaining({ relative_path: expectedRelativePath })]
      })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it('同一规范化路径同时引用标准文件和直接 IPGSD 时阻断', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-source-conflict-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(
      reportPath,
      '# 报告\n\n![标准](images/a.svg)\n![加密](images/a.svg.IPGSD)\n'
    )
    await writeFile(join(dir, 'images', 'a.svg'), svg)
    await writeFile(join(dir, 'images', 'a.svg.IPGSD'), svg)

    await expect(uploadReportFile(api, 'token-123', 'task-ipgsd-source-conflict', reportPath)).rejects.toThrow(
      '报告图片规范化路径冲突'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('同一 IPGSD 候选被标准和直接路径引用时去重上传一个标准资产', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-same-source-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(
      reportPath,
      '# 报告\n\n![标准](images/a.svg)\n![加密](images/a.svg.IPGSD)\n'
    )
    await writeFile(join(dir, 'images', 'a.svg.IPGSD'), svg)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-same-source', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-same-source',
      expect.objectContaining({
        report_content: '# 报告\n\n![标准](images/a.svg)\n![加密](images/a.svg)\n',
        assets: [expect.objectContaining({
          relative_path: 'images/a.svg',
          content: svg,
          content_type: 'image/svg+xml'
        })]
      })
    )
  })

  it('直接 IPGSD 图片 URL 含嵌套括号时仅规范化上传副本', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-nested-parentheses-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = '# 报告\n\n![证据](images/call(chain).svg.IPGSD)\n'
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', 'call(chain).svg.IPGSD'), svg)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-nested-parentheses', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-nested-parentheses',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/call(chain).svg)\n',
        assets: [expect.objectContaining({ relative_path: 'images/call(chain).svg' })]
      })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it('同名 IPGSD 候选符号链接到 images 外时继续阻断', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-symlink-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const outsidePath = join(dir, 'outside.png.IPGSD')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/issue-01.png)\n')
    await writeFile(outsidePath, VALID_PNG_BYTES)
    await symlink(outsidePath, join(dir, 'images', 'issue-01.png.IPGSD'), 'file')

    await expect(uploadReportFile(api, 'token-123', 'task-ipgsd-symlink', reportPath)).rejects.toThrow(
      '报告图片不能指向 images 目录外'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('直接引用 IPGSD 时仅规范化上传副本而不改写本地 Markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-direct-ipgsd-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const originalReport = '# 报告\n\n![证据](images/issue-01.svg.iPgSd)\n'
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, originalReport)
    await writeFile(join(dir, 'images', 'issue-01.svg.iPgSd'), svg)

    await uploadReportFile(api, 'token-123', 'task-direct-ipgsd', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-direct-ipgsd',
      expect.objectContaining({
        report_content: '# 报告\n\n![证据](images/issue-01.svg)\n',
        assets: [expect.objectContaining({
          relative_path: 'images/issue-01.svg',
          content: svg,
          content_type: 'image/svg+xml'
        })]
      })
    )
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(originalReport)
  })

  it('标准原图优先于同名 IPGSD 候选', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-prefer-standard-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const candidate = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>candidate</text></svg>')
    const standard = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>standard</text></svg>')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n\n![证据](images/issue-01.svg)\n')
    await writeFile(join(dir, 'images', 'issue-01.svg'), standard)
    await writeFile(join(dir, 'images', 'issue-01.svg.IPGSD'), candidate)

    await uploadReportFile(api, 'token-123', 'task-ipgsd-standard', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-ipgsd-standard',
      expect.objectContaining({
        assets: [expect.objectContaining({ content: standard })]
      })
    )
  })

  it('接受同名 IPGSD 候选中的 PNG、JPEG、JPG、GIF 与 WebP 真实内容', async () => {
    const corpus = await loadSharedImageValidationCorpus()
    for (const entry of corpus.filter((entry) => entry.extension !== '.svg')) {
      const dir = await mkdtemp(join(tmpdir(), `report-uploader-ipgsd-${entry.name}-`))
      tempDirs.push(dir)
      const reportPath = join(dir, '代码审查报告.md')
      const relativePath = `images/evidence${entry.extension}`
      const content = Buffer.from(entry.valid_base64, 'base64')
      const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
      await mkdir(join(dir, 'images'), { recursive: true })
      await writeFile(reportPath, `# 报告\n\n![证据](${relativePath})\n`)
      await writeFile(join(dir, `${relativePath}.IPGSD`), content)

      await uploadReportFile(api, 'token-123', `task-ipgsd-${entry.name}`, reportPath)

      expect(api.uploadReport).toHaveBeenCalledWith(
        'token-123',
        `task-ipgsd-${entry.name}`,
        expect.objectContaining({
          assets: [expect.objectContaining({
            relative_path: relativePath,
            content,
            content_type: entry.content_type
          })]
        })
      )
    }
  })

  it('拒绝基名大小写不匹配、多层后缀和无效原始格式的 IPGSD 路径', async () => {
    const cases = [
      { reference: 'images/Issue-01.png', candidate: 'issue-01.png.IPGSD' },
      { reference: 'images/issue-01.png.backup.IPGSD', candidate: 'issue-01.png.backup.IPGSD' },
      { reference: 'images/issue-01.bmp.IPGSD', candidate: 'issue-01.bmp.IPGSD' }
    ]
    for (const testCase of cases) {
      const dir = await mkdtemp(join(tmpdir(), 'report-uploader-ipgsd-reject-'))
      tempDirs.push(dir)
      const reportPath = join(dir, '代码审查报告.md')
      const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
      await mkdir(join(dir, 'images'), { recursive: true })
      await writeFile(reportPath, `# 报告\n\n![证据](${testCase.reference})\n`)
      await writeFile(join(dir, 'images', testCase.candidate), VALID_PNG_BYTES)

      await expect(uploadReportFile(api, 'token-123', 'task-ipgsd-reject', reportPath)).rejects.toThrow(
        testCase.reference === 'images/Issue-01.png'
          ? '报告图片不存在'
          : '不支持的报告图片格式'
      )
      expect(api.uploadReport).not.toHaveBeenCalled()
    }
  })

  it('上传新版 Skill images/issue-<NN>.svg 代码图片并保持相对路径和 MIME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-issue-svg-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const imagePath = join(dir, 'images', 'issue-01.svg')
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360"><rect width="900" height="360" fill="#fff"/><text x="24" y="48">issue 01</text></svg>'
    )
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, `# 代码审查报告\n\n![问题 01 代码证据](images/issue-01.svg)\n`)
    await writeFile(imagePath, svg)

    await uploadReportFile(api, 'token-123', 'task-issue-svg', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-issue-svg',
      expect.objectContaining({
        assets: [{
          relative_path: 'images/issue-01.svg',
          content: svg,
          content_type: 'image/svg+xml'
        }]
      })
    )
  })

  it('上传包含合法 XML 实体的 Skill SVG 属性和代码文本', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-escaped-svg-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const imagePath = join(dir, 'images', 'issue-01.svg')
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360"><text x="24" y="48" font-family="Microsoft YaHei, &#x27;Segoe UI&#x27;, sans-serif">if (left &lt; right &amp;&amp; enabled)</text></svg>'
    )
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, `# 代码审查报告\n\n![问题 01 代码证据](images/issue-01.svg)\n`)
    await writeFile(imagePath, svg)

    await expect(uploadReportFile(api, 'token-123', 'task-escaped-svg', reportPath)).resolves.toEqual({
      ok: true
    })
    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-escaped-svg',
      expect.objectContaining({
        assets: [{
          relative_path: 'images/issue-01.svg',
          content: svg,
          content_type: 'image/svg+xml'
        }]
      })
    )
  })

  it('拒绝用 XML 实体混淆的 SVG 外部资源', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-escaped-svg-url-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const imagePath = join(dir, 'images', 'issue-01.svg')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await mkdir(join(dir, 'images'), { recursive: true })
    await writeFile(reportPath, `# 代码审查报告\n\n![问题 01 代码证据](images/issue-01.svg)\n`)
    await writeFile(
      imagePath,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#x72;l(https://example.com/image.svg)"/></svg>'
    )

    await expect(uploadReportFile(api, 'token-123', 'task-escaped-svg-url', reportPath)).rejects.toThrow(
      '报告图片内容与文件格式不一致'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(
      '[REPORT_IMAGE_VALIDATION_FAILED]',
      expect.objectContaining({
        relativePath: 'images/issue-01.svg',
        extension: '.svg',
        reasonCode: 'UNSAFE_SVG_CONTENT',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    )
  })

  it('上传真实 PC-BMS 报告时提交三个有序问题快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-pc-bms-'))
    tempDirs.push(dir)
    const reportPath = join(dir, 'trunk_审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, bmsCodeReviewerPcBmsReportFixture)

    await uploadReportFile(api, 'token-123', 'task-pc-bms', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-pc-bms',
      expect.objectContaining({
        report_content: bmsCodeReviewerPcBmsReportFixture,
        feedback_protocol_version: 1,
        issues: [
          expect.objectContaining({
            issue_text:
              'PC-BMS-001 [重要] 状态处理函数新增分支后圈复杂度继续超限并使文件平均复杂度超限',
            description_text:
              'BmsState_Handle 在 r2 中按公司编码规范口径计算的圈复杂度为 14，超过单函数不超过 9 的要求；文件平均复杂度约 5.33，也超过不超过 5 的要求。',
            display_snapshot: expect.stringContaining(
              '| `bms_state.c` | 12 | `BmsState_Handle` 状态处理入口 |'
            ),
            order: 0,
            source: 'bms_code_reviewer_heading',
            location: expect.objectContaining({
              start_offset: bmsCodeReviewerPcBmsReportFixture.indexOf('### PC-BMS-001 [重要]')
            })
          }),
          expect.objectContaining({
            issue_text: 'PC-BMS-002 [一般] 新增分支未按 Allman 风格换行放置大括号',
            order: 1
          }),
          expect.objectContaining({
            issue_text: 'PC-BMS-003 [一般] 新增 SLEEP 状态判断缺少 else 分支',
            order: 2
          })
        ],
        assets: []
      })
    )
  })

  it('上传最新无严重度报告时提交任意标题的完整有序问题快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-no-severity-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '无严重度审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await writeFile(reportPath, bmsCodeReviewerNoSeverityReportFixture)

    await uploadReportFile(api, 'token-123', 'task-no-severity', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-no-severity',
      expect.objectContaining({
        report_content: bmsCodeReviewerNoSeverityReportFixture,
        feedback_protocol_version: 1,
        issues: [
          expect.objectContaining({
            issue_text: 'STATE-17 休眠高风险路径仍可打开充电 MOS',
            order: 0,
            source: 'bms_code_reviewer_heading',
            display_snapshot: expect.stringContaining('**材料或生成证据：**'),
            location: expect.objectContaining({
              start_offset: bmsCodeReviewerNoSeverityReportFixture.indexOf('### STATE-17')
            })
          }),
          expect.objectContaining({
            issue_text: '编号-任意-42 建议路径缺少故障恢复一致性校验',
            order: 1
          })
        ]
      })
    )
  })

  it('上传完全缺失型报告时仍按协议 1 提交问题快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-search-evidence-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '缺失型审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await writeFile(reportPath, bmsCodeReviewerSearchEvidenceReportFixture)

    await uploadReportFile(api, 'token-123', 'task-search-evidence', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-search-evidence',
      expect.objectContaining({
        feedback_protocol_version: 1,
        issues: [
          expect.objectContaining({
            issue_text: '辅助说明：低压状态下未恢复运行状态',
            description_text: '唤醒路径没有恢复运行状态的实现，否定性检索证据表明该功能完全缺失。'
          }),
          expect.objectContaining({
            issue_text: 'DS-04 混合证据问题仍保留代码位置'
          })
        ],
        assets: []
      })
    )
  })

  it('新版 BMS 报告缺少审查问题章节时只上传 Markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-missing-bms-issues-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '缺少审查问题报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await writeFile(reportPath, bmsCodeReviewerMissingReviewIssuesReportFixture)

    await uploadReportFile(api, 'token-123', 'task-missing-bms-issues', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith('token-123', 'task-missing-bms-issues', {
      report_content: bmsCodeReviewerMissingReviewIssuesReportFixture,
      report_path: reportPath,
      report_name: '缺少审查问题报告.md'
    })
  })

  it('上传未识别问题描述的报告时仍按协议 1 提交空描述快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-empty-description-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '空描述审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    const reportWithoutDescription = bmsCodeReviewerNoSeverityReportFixture.replace(
      /^\*\*问题描述：\*\*.*\n/m,
      ''
    )
    await writeFile(reportPath, reportWithoutDescription)

    await uploadReportFile(api, 'token-123', 'task-empty-description', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-empty-description',
      expect.objectContaining({
        feedback_protocol_version: 1,
        issues: [
          expect.objectContaining({
            issue_text: 'STATE-17 休眠高风险路径仍可打开充电 MOS',
            description_text: ''
          }),
          expect.objectContaining({
            issue_text: '编号-任意-42 建议路径缺少故障恢复一致性校验'
          })
        ]
      })
    )
  })

  it.each([
    {
      name: 'PC-BMS 历史风险词',
      markdown: bmsCodeReviewerHistoricalPcBmsReportFixture,
      expectedIssueTexts: [
        'PC-BMS-001 [高] FAULT 分支将 RESET 判断写成赋值表达式，非 RESET 事件会隐式清除故障态',
        'PC-BMS-002 [高] 充电超时保护只新增事件枚举，CHARGING 状态未在 1800 秒或 TIMEOUT 事件进入 FAULT'
      ]
    },
    {
      name: 'DS-02 历史编号',
      markdown: bmsCodeReviewerHistoricalDs02ReportFixture,
      expectedIssueTexts: [
        'DS-02-001 [高] FAULT 分支条件由比较表达式误改为赋值表达式',
        'DS-02-002 [中] 新增 SLEEP 状态分支的 if 缺少 else 分支',
        'DS-02-003 [低] 新增控制语句未采用 Allman 大括号风格'
      ]
    }
  ])('上传真实 $name 报告时建立完整有序问题快照', async ({ markdown, expectedIssueTexts }) => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-historical-bms-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '历史审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    await writeFile(reportPath, markdown)

    await uploadReportFile(api, 'token-123', 'task-historical', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-historical',
      expect.objectContaining({
        report_content: markdown,
        issues: expectedIssueTexts.map((issueText, order) =>
          expect.objectContaining({
            issue_text: issueText,
            order,
            display_snapshot: expect.stringContaining(`### ${issueText}`),
            location: expect.objectContaining({
              start_offset: markdown.indexOf(`### ${issueText}`)
            })
          })
        )
      })
    )
  })

  it.each([
    {
      name: '混入占位问题标题',
      markdown: bmsCodeReviewerNoSeverityReportFixture.replace(
        '## 四、审查覆盖',
        '### <问题编号> <问题标题>\n\n这不是合法问题块。\n\n## 四、审查覆盖'
      )
    }
  ])('结构无效 BMS 报告（$name）只上传 Markdown 且不声明反馈协议', async ({ markdown }) => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-invalid-pc-bms-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '无效历史审查报告.md')
    const api = { uploadReport: vi.fn(async () => ({ ok: true })) }
    const invalidMarkdown = `${markdown}\n![不随历史上传提交](images/missing.png)\n`
    await writeFile(reportPath, invalidMarkdown)

    await uploadReportFile(api, 'token-123', 'task-invalid-pc-bms', reportPath)

    expect(api.uploadReport).toHaveBeenCalledWith('token-123', 'task-invalid-pc-bms', {
      report_content: invalidMarkdown,
      report_path: reportPath,
      report_name: '无效历史审查报告.md'
    })
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
        report_content: corpus.markdown,
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

  it('按共享语料接受可解码图片并拒绝只有正确文件头的损坏图片', async () => {
    const corpus = await loadSharedImageValidationCorpus()
    for (const entry of corpus) {
      const dir = await mkdtemp(join(tmpdir(), `report-uploader-${entry.name}-`))
      tempDirs.push(dir)
      const reportPath = join(dir, '代码审查报告.md')
      const relativePath = `images/evidence${entry.extension}`
      const imagePath = join(dir, relativePath)
      const api = {
        uploadReport: vi.fn(async () => ({ ok: true }))
      }
      await mkdir(join(dir, 'images'), { recursive: true })
      await writeFile(reportPath, `# Review\n\n![证据](${relativePath})\n`)
      for (const validBase64 of [entry.valid_base64, ...(entry.additional_valid_base64 ?? [])]) {
        await writeFile(imagePath, Buffer.from(validBase64, 'base64'))
        await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).resolves.toEqual({
          ok: true
        })
      }

      for (const invalidBase64 of [
        entry.invalid_base64,
        ...(entry.additional_invalid_base64 ?? [])
      ]) {
        await writeFile(imagePath, Buffer.from(invalidBase64, 'base64'))
        await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
          '报告图片内容与文件格式不一致'
        )
      }
      if (entry.animated_base64) {
        await writeFile(imagePath, Buffer.from(entry.animated_base64, 'base64'))
        await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
          '报告图片内容与文件格式不一致'
        )
      }
    }
  })

  it('问题快照数量达到上限时允许上传并在超限时拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-too-many-issues-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    const buildReport = (count: number): string =>
      Array.from(
        { length: count },
        (_, index) => `### ${index + 1}. 问题 ${index + 1}\n\n- **问题描述：** 用于验证数量限制。\n`
      ).join('\n')
    await writeFile(reportPath, buildReport(200))

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).resolves.toEqual({
      ok: true
    })

    await writeFile(reportPath, buildReport(201))
    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '问题快照数量超过限制'
    )
    expect(api.uploadReport).toHaveBeenCalledTimes(1)
  })

  it('上传前拒绝超过字段和 JSON 大小限制的问题快照', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-large-issues-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, `### ${'x'.repeat(8 * 1024 + 1)}\n`)

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '问题快照内容超过限制'
    )

    const report = Array.from(
      { length: 5 },
      (_, index) => `### ${index + 1}. 问题 ${index + 1}\n\n- **问题描述：** 用于验证数量限制。\n`
    )
      .map((heading) => `${heading}\n${'x'.repeat(220 * 1024)}\n`)
      .join('\n')
    await writeFile(reportPath, report)

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).rejects.toThrow(
      '问题快照总大小超过限制'
    )
    expect(api.uploadReport).not.toHaveBeenCalled()
  })

  it('使用 UTF-16 偏移的表情符号报告可正常上传', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'report-uploader-utf16-offsets-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '代码审查报告.md')
    const api = {
      uploadReport: vi.fn(async () => ({ ok: true }))
    }
    await writeFile(reportPath, '### 😀问题\n\n- **问题描述：** 表情符号偏移测试。\n')

    await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).resolves.toEqual({
      ok: true
    })
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
    await writeFile(reportPath, imagePaths.map((imagePath) => `![证据](${imagePath})`).join('\n'))

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
      uploadPdfReport: vi.fn(async () => ({
        id: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'success' as const
      }))
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
