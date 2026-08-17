import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
  bmsCodeReviewerNoSeverityReportFixture,
  bmsCodeReviewerPcBmsReportFixture,
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
      name: '缺少问题描述',
      markdown: bmsCodeReviewerNoSeverityReportFixture.replace(/^\*\*问题描述：\*\*.*\n/m, '')
    },
    {
      name: '缺少代码位置表',
      markdown: bmsCodeReviewerNoSeverityReportFixture.replace(
        '**涉及文件及行号：**',
        '**相关位置：**'
      )
    },
    {
      name: '混入普通三级标题',
      markdown: bmsCodeReviewerNoSeverityReportFixture.replace(
        '## 四、审查覆盖',
        '### 普通说明\n\n这不是合法问题块。\n\n## 四、审查覆盖'
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
      await writeFile(imagePath, Buffer.from(entry.valid_base64, 'base64'))

      await expect(uploadReportFile(api, 'token-123', 'task-1', reportPath)).resolves.toEqual({
        ok: true
      })

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
