import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

  it('uploads report content and file name from disk path', async () => {
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
      report_name: 'r12_r14审查报告_20260610_142530.md'
    })
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
