import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureReportReady, uploadReportFile } from '../report-uploader'

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
})
