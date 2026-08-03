import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '../api-client'
import { submitIssueFeedback } from '../issue-feedback-submitter'
import type { GeneratePdfReportDependencies } from '../report-pdf-generator'
import { extractReviewIssues } from '../../shared/review-issues'
import type { ReviewTask, ReviewTaskIssue } from '../../shared/types'
import { templateOneReportFixture } from '../../shared/__tests__/fixtures/review-report-fixtures'

const toServerIssues = (markdown: string): ReviewTaskIssue[] =>
  extractReviewIssues(markdown).map((issue) => ({
    id: `issue-${issue.order}`,
    task_id: 'task-1',
    issue_text: issue.issueText,
    description_text: issue.descriptionText,
    display_snapshot: issue.displaySnapshot,
    order: issue.order,
    source: issue.source,
    location: {
      start_offset: issue.location.startOffset,
      end_offset: issue.location.endOffset,
      feedback_insertion_offset: issue.location.feedbackInsertionOffset,
      anchor_line: issue.location.anchorLine,
      heading_level: issue.location.headingLevel
    },
    helpful: issue.order !== 1,
    feedback_text: issue.order === 0 ? '已完成修复' : '已记录验证结果'
  }))

const makeTask = (overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id: 'task-1',
  svn_url: 'svn://repo/project',
  old_revision: '1',
  new_revision: '2',
  status: 'success',
  report_name: '本地报告.md',
  feedback_protocol_version: 1,
  ...overrides
})

describe('submitIssueFeedback', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  const createRuntime = async () => {
    const root = await mkdtemp(join(tmpdir(), 'issue-feedback-submit-'))
    tempDirs.push(root)
    const workspace = join(root, 'task-1')
    return {
      workspace,
      runtimePaths: {
        runtimeRoot: root,
        skillPackagesDir: join(root, 'skills'),
        skillManifestPath: join(root, 'skills', 'manifest.json'),
        workspacesDir: root,
        workspaceForTask: () => workspace,
        reportPathForTask: (_taskId: string, reportName = '代码审查报告.md') =>
          join(workspace, reportName),
        imagesDirForTask: () => join(workspace, 'images')
      }
    }
  }

  it('使用服务端原始报告和草稿生成最终PDF且不改写本地Markdown', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    const localReportPath = runtimePaths.reportPathForTask('task-1', '本地报告.md')
    await mkdir(workspace, { recursive: true })
    await writeFile(localReportPath, '本地原始Markdown字节不得改变')
    const issues = toServerIssues(templateOneReportFixture)
    const downloadReportAsset = vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer)
    const uploadPdfReport = vi.fn(async () =>
      makeTask({
        feedback_submitted_at: '2026-07-29T12:00:00Z',
        pdf_report_name: '本地报告.pdf'
      })
    )
    let renderingMarkdown = ''
    const generatePdf = vi.fn(async (
      reportPath: string,
      options?: GeneratePdfReportDependencies
    ) => {
      renderingMarkdown = options?.markdown ?? ''
      await expect(readFile(join(workspace, 'images', 'null-pointer.png'))).resolves.toEqual(
        Buffer.from([1, 2, 3])
      )
      const pdfPath = reportPath.replace(/\.md$/i, '.pdf')
      await writeFile(pdfPath, '%PDF-1.4\nfinal')
      return { status: 'ready' as const, reportPath, pdfPath }
    })

    const result = await submitIssueFeedback({
      api: {
        readTask: vi.fn(async () => makeTask()),
        readTaskReport: vi.fn(async () => templateOneReportFixture),
        readTaskIssues: vi.fn(async () => ({
          data: issues,
          count: issues.length,
          evaluated_count: issues.length,
          feedback_submitted_at: null
        })),
        downloadReportAsset,
        uploadPdfReport
      },
      token: 'token-123',
      taskId: 'task-1',
      runtimePaths,
      generatePdf
    })

    expect(renderingMarkdown).toContain('> 是否有效：有效')
    expect(renderingMarkdown).toContain('> 用户反馈：`已完成修复`')
    await expect(readFile(localReportPath, 'utf8')).resolves.toBe('本地原始Markdown字节不得改变')
    expect(downloadReportAsset).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      'images/null-pointer.png'
    )
    expect(uploadPdfReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({ pdf_name: '本地报告.pdf' })
    )
    expect(result).toEqual({
      status: 'submitted',
      taskId: 'task-1',
      feedbackSubmittedAt: '2026-07-29T12:00:00Z',
      pdfPath: join(workspace, '本地报告.pdf'),
      pdfReportName: '本地报告.pdf'
    })
  })

  it('已有 BOM 报告可按服务端原偏移生成并提交最终 PDF', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    const markdown =
      '\uFEFF# 代码审查报告\r\n\r\n### 高风险问题\r\n\r\n- **问题描述：** BOM 偏移回归。\r\n'
    const issues = toServerIssues(markdown)
    const fetchMock = vi.fn(async () =>
      new Response(Buffer.from(markdown, 'utf8'), {
        status: 200,
        headers: { 'content-type': 'text/markdown' }
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)
    const uploadPdfReport = vi.fn(async () =>
      makeTask({
        feedback_submitted_at: '2026-08-03T12:00:00Z',
        pdf_report_name: '本地报告.pdf'
      })
    )
    let renderingMarkdown = ''
    const generatePdf = vi.fn(async (
      reportPath: string,
      options?: GeneratePdfReportDependencies
    ) => {
      renderingMarkdown = options?.markdown ?? ''
      const pdfPath = reportPath.replace(/\.md$/i, '.pdf')
      await writeFile(pdfPath, '%PDF-1.4\nfinal')
      return { status: 'ready' as const, reportPath, pdfPath }
    })

    await expect(
      submitIssueFeedback({
        api: {
          readTask: vi.fn(async () => makeTask()),
          readTaskReport: client.readTaskReport.bind(client),
          readTaskIssues: vi.fn(async () => ({
            data: issues,
            count: issues.length,
            evaluated_count: issues.length,
            feedback_submitted_at: null
          })),
          downloadReportAsset: vi.fn(),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'submitted' }))

    expect(renderingMarkdown.startsWith('\uFEFF')).toBe(false)
    expect(renderingMarkdown).toContain('# 代码审查报告')
    expect(renderingMarkdown).toContain('> 用户反馈：`已完成修复`')
    expect(uploadPdfReport).toHaveBeenCalledTimes(1)
    await expect(readFile(join(workspace, '本地报告.pdf'), 'utf8')).resolves.toContain('%PDF-1.4')
  })

  it('图片缺失或PDF生成失败时不上传也不锁定', async () => {
    const { runtimePaths } = await createRuntime()
    const issues = toServerIssues(templateOneReportFixture)
    const uploadPdfReport = vi.fn()
    const generatePdf = vi.fn()
    const api = {
      readTask: vi.fn(async () => makeTask()),
      readTaskReport: vi.fn(async () => templateOneReportFixture),
      readTaskIssues: vi.fn(async () => ({
        data: issues,
        count: issues.length,
        evaluated_count: issues.length,
        feedback_submitted_at: null
      })),
      downloadReportAsset: vi.fn(async () => {
        throw new Error('图片资产不存在')
      }),
      uploadPdfReport
    }

    await expect(
      submitIssueFeedback({
        api,
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).rejects.toThrow('图片资产不存在')
    expect(generatePdf).not.toHaveBeenCalled()
    expect(uploadPdfReport).not.toHaveBeenCalled()
  })

  it('反馈说明为空白时在生成PDF前拒绝并指出审查问题序号', async () => {
    const { runtimePaths } = await createRuntime()
    const issues = toServerIssues(templateOneReportFixture)
    issues[1].feedback_text = ' \n '
    const readTaskReport = vi.fn(async () => templateOneReportFixture)
    const generatePdf = vi.fn(async () => {
      throw new Error('不应生成PDF')
    })
    const uploadPdfReport = vi.fn()

    await expect(
      submitIssueFeedback({
        api: {
          readTask: vi.fn(async () => makeTask()),
          readTaskReport,
          readTaskIssues: vi.fn(async () => ({
            data: issues,
            count: issues.length,
            evaluated_count: issues.length,
            feedback_submitted_at: null
          })),
          downloadReportAsset: vi.fn(),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).rejects.toThrow('请填写第 2 个审查问题的反馈说明')
    expect(readTaskReport).not.toHaveBeenCalled()
    expect(generatePdf).not.toHaveBeenCalled()
    expect(uploadPdfReport).not.toHaveBeenCalled()
  })

  it('拒绝通过本地符号链接把远程图片写到报告目录外', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    const outsideDirectory = join(dirname(workspace), 'outside')
    await mkdir(join(workspace, 'images'), { recursive: true })
    await mkdir(outsideDirectory, { recursive: true })
    await symlink(outsideDirectory, join(workspace, 'images', 'nested'))
    const markdown = '# 代码审查报告-模版一\n\n![证据](images/nested/evidence.png)\n'
    const generatePdf = vi.fn()
    const uploadPdfReport = vi.fn()

    await expect(
      submitIssueFeedback({
        api: {
          readTask: vi.fn(async () => makeTask()),
          readTaskReport: vi.fn(async () => markdown),
          readTaskIssues: vi.fn(async () => ({
            data: [], count: 0, evaluated_count: 0, feedback_submitted_at: null
          })),
          downloadReportAsset: vi.fn(async () => Uint8Array.from([1]).buffer),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).rejects.toThrow('不能指向 images 目录外')
    await expect(readFile(join(outsideDirectory, 'evidence.png'))).rejects.toThrow()
    expect(generatePdf).not.toHaveBeenCalled()
    expect(uploadPdfReport).not.toHaveBeenCalled()
  })

  it('PDF生成失败时保留草稿且不调用服务端完成接口', async () => {
    const { runtimePaths } = await createRuntime()
    const markdown = '# 代码审查报告-模版一\n\n没有审查问题。\n'
    const uploadPdfReport = vi.fn()
    const generatePdf = vi.fn(async () => {
      throw new Error('PDF打印失败')
    })

    await expect(
      submitIssueFeedback({
        api: {
          readTask: vi.fn(async () => makeTask()),
          readTaskReport: vi.fn(async () => markdown),
          readTaskIssues: vi.fn(async () => ({
            data: [],
            count: 0,
            evaluated_count: 0,
            feedback_submitted_at: null
          })),
          downloadReportAsset: vi.fn(),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).rejects.toThrow('PDF打印失败')
    expect(uploadPdfReport).not.toHaveBeenCalled()
  })

  it('PDF上传失败后保留唯一的本地PDF并允许原路径重试', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    const markdown = '# 代码审查报告-模版一\n\n没有审查问题。\n'
    const uploadPdfReport = vi
      .fn()
      .mockRejectedValueOnce(new Error('上传中断'))
      .mockResolvedValueOnce(
        makeTask({
          feedback_submitted_at: '2026-07-29T12:00:00Z',
          pdf_report_name: '本地报告.pdf'
        })
      )
    const generatePdf = vi.fn(async (reportPath: string) => {
      const pdfPath = reportPath.replace(/\.md$/i, '.pdf')
      await writeFile(pdfPath, '%PDF-1.4\nretry')
      return { status: 'ready' as const, reportPath, pdfPath }
    })
    const api = {
      readTask: vi.fn(async () => makeTask()),
      readTaskReport: vi.fn(async () => markdown),
      readTaskIssues: vi.fn(async () => ({
        data: [],
        count: 0,
        evaluated_count: 0,
        feedback_submitted_at: null
      })),
      downloadReportAsset: vi.fn(),
      uploadPdfReport
    }

    await expect(
      submitIssueFeedback({ api, token: 'token-123', taskId: 'task-1', runtimePaths, generatePdf })
    ).rejects.toThrow('上传中断')
    await expect(
      submitIssueFeedback({ api, token: 'token-123', taskId: 'task-1', runtimePaths, generatePdf })
    ).resolves.toEqual(expect.objectContaining({ status: 'submitted' }))

    expect(generatePdf).toHaveBeenCalledTimes(2)
    expect(new Set(generatePdf.mock.calls.map(([reportPath]) => reportPath))).toEqual(
      new Set([join(workspace, '本地报告.md')])
    )
    await expect(readFile(join(workspace, '本地报告.pdf'), 'utf8')).resolves.toBe(
      '%PDF-1.4\nretry'
    )
  })

  it('PDF上传响应丢失但服务端已锁定时恢复为提交成功', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    const markdown = '# 代码审查报告-模版一\n\n没有审查问题。\n'
    const readTask = vi
      .fn()
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(
        makeTask({
          feedback_submitted_at: '2026-07-29T12:00:00Z',
          pdf_report_name: '本地报告.pdf'
        })
      )
    const uploadPdfReport = vi.fn(async () => {
      throw new Error('上传响应中断')
    })
    const generatePdf = vi.fn(async (reportPath: string) => {
      const pdfPath = reportPath.replace(/\.md$/i, '.pdf')
      await writeFile(pdfPath, '%PDF-1.4\nfinal')
      return { status: 'ready' as const, reportPath, pdfPath }
    })

    await expect(
      submitIssueFeedback({
        api: {
          readTask,
          readTaskReport: vi.fn(async () => markdown),
          readTaskIssues: vi.fn(async () => ({
            data: [], count: 0, evaluated_count: 0, feedback_submitted_at: null
          })),
          downloadReportAsset: vi.fn(),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).resolves.toEqual({
      status: 'submitted',
      taskId: 'task-1',
      feedbackSubmittedAt: '2026-07-29T12:00:00Z',
      pdfPath: join(workspace, '本地报告.pdf'),
      pdfReportName: '本地报告.pdf'
    })
    expect(readTask).toHaveBeenCalledTimes(2)
  })

  it('重试时服务端已提交且本地最终PDF存在则直接恢复成功', async () => {
    const { workspace, runtimePaths } = await createRuntime()
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, '本地报告.pdf'), '%PDF-1.4\nfinal')
    const generatePdf = vi.fn()
    const uploadPdfReport = vi.fn()

    await expect(
      submitIssueFeedback({
        api: {
          readTask: vi.fn(async () =>
            makeTask({
              feedback_submitted_at: '2026-07-29T12:00:00Z',
              pdf_report_name: '本地报告.pdf'
            })
          ),
          readTaskReport: vi.fn(),
          readTaskIssues: vi.fn(async () => ({
            data: [],
            count: 0,
            evaluated_count: 0,
            feedback_submitted_at: '2026-07-29T12:00:00Z'
          })),
          downloadReportAsset: vi.fn(),
          uploadPdfReport
        },
        token: 'token-123',
        taskId: 'task-1',
        runtimePaths,
        generatePdf
      })
    ).resolves.toEqual({
      status: 'submitted',
      taskId: 'task-1',
      feedbackSubmittedAt: '2026-07-29T12:00:00Z',
      pdfPath: join(workspace, '本地报告.pdf'),
      pdfReportName: '本地报告.pdf'
    })
    expect(generatePdf).not.toHaveBeenCalled()
    expect(uploadPdfReport).not.toHaveBeenCalled()
  })
})
