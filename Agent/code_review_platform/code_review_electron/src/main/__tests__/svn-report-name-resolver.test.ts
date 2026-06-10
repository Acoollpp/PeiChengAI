import { describe, expect, it, vi } from 'vitest'

import {
  buildSvnLogArgs,
  extractSoftwareVersionFromSvnLogXml,
  resolveReviewReportFileName
} from '../svn-report-name-resolver'

describe('svn report name resolver', () => {
  it('builds SVN log args for the new revision with a peg revision URL', () => {
    expect(
      buildSvnLogArgs({
        svnUrl: 'https://192.168.0.233/svn/src_home/PCB_31154V110/SST24-1662',
        revision: 'r28957'
      })
    ).toEqual([
      'log',
      '--xml',
      '-r',
      '28957',
      'https://192.168.0.233/svn/src_home/PCB_31154V110/SST24-1662@28957'
    ])
  })

  it('builds report file name from the new revision SVN log code field', async () => {
    const runSvnLog = vi.fn(async () => `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="28957">
    <msg>代码：
P16S100A-41662-1.30-000

变更说明：
1、取消充电末端降流策略。</msg>
  </logentry>
</log>`)

    const reportFileName = await resolveReviewReportFileName({
      svnUrl: 'https://192.168.0.233/svn/src_home/PCB_31154V110/SST24-1662',
      oldRevision: '16701',
      newRevision: '28957',
      generatedAt: new Date(2026, 5, 10, 14, 25, 30),
      runSvnLog
    })

    expect(reportFileName).toBe('P16S100A-41662-1.30-000_审查报告.md')
    expect(runSvnLog).toHaveBeenCalledWith({
      svnUrl: 'https://192.168.0.233/svn/src_home/PCB_31154V110/SST24-1662',
      revision: '28957'
    })
  })

  it('falls back to the SVN URL last path segment when the new revision log has no code field', async () => {
    const runSvnLog = vi.fn(async () => `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="42977">
    <msg>该版本位于比较区间终点。</msg>
  </logentry>
</log>`)

    await expect(
      resolveReviewReportFileName({
        svnUrl: 'https://192.168.0.233/svn/src_home/PCB_1447V330/SST23-1144-T',
        oldRevision: '42634',
        newRevision: '42977',
        generatedAt: new Date(2026, 5, 10, 14, 25, 30),
        runSvnLog
      })
    ).resolves.toBe('SST23-1144-T_审查报告.md')
  })

  it('falls back to the old revision based name when SVN log and URL naming both fail', async () => {
    const runSvnLog = vi.fn(async () => {
      throw new Error('svn unavailable')
    })

    await expect(
      resolveReviewReportFileName({
        svnUrl: 'https://192.168.0.233/',
        oldRevision: 'r12',
        newRevision: '14',
        generatedAt: new Date(2026, 5, 10, 14, 25, 30),
        runSvnLog
      })
    ).resolves.toBe('r12_r14审查报告_20260610_142530.md')
  })

  it('extracts XML escaped code field values safely', () => {
    expect(
      extractSoftwareVersionFromSvnLogXml(`
<log>
  <logentry revision="1">
    <msg>代码：A100-B200-1.00-000&amp;draft</msg>
  </logentry>
</log>`)
    ).toBe('A100-B200-1.00-000&draft')
  })
})
