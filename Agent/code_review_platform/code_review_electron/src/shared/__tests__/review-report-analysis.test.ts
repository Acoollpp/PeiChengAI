import { describe, expect, it } from 'vitest'

import {
  analyzeLoadedReviewReport,
  summarizeReviewReport
} from '../review-report-analysis'
import {
  bmsCodeReviewerHistoricalDs02ReportFixture,
  bmsCodeReviewerHistoricalPcBmsReportFixture,
  bmsCodeReviewerPcBmsReportFixture,
  bmsCodeReviewerReportRealVariantsFixture,
  bmsCodeReviewerReportWithIssuesFixture,
  bmsCodeReviewerZeroIssuesFixture,
  templateOneReportFixture,
  templateTwoTableReportFixture
} from './fixtures/review-report-fixtures'

describe('报告摘要分析', () => {
  it('服务端快照摘要完整表达四级严重度、新版零问题和未知严重度', () => {
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toEqual({
      issueCount: 2,
      highestSeverity: 'high',
      summary: '报告包含 2 个审查问题，最高严重度为高风险。'
    })
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 1,
      highestIssueSeverity: 'medium'
    }).highestSeverity).toBe('medium')
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 1,
      highestIssueSeverity: 'low'
    }).highestSeverity).toBe('low')
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 1,
      highestIssueSeverity: 'suggestion'
    }).highestSeverity).toBe('suggestion')
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 0,
      highestIssueSeverity: null
    })).toEqual({
      issueCount: 0,
      highestSeverity: 'none',
      summary: '本次审查未发现能够闭环的问题。'
    })
    expect(summarizeReviewReport({
      feedbackProtocolVersion: 1,
      issueCount: 1,
      highestIssueSeverity: null
    }).highestSeverity).toBe('unknown')
  })

  it('历史任务忽略服务端默认零值并显示问题数未记录', () => {
    expect(summarizeReviewReport({
      feedbackProtocolVersion: null,
      issueCount: 0,
      highestIssueSeverity: null
    })).toEqual({
      issueCount: undefined,
      highestSeverity: 'unknown',
      summary: '历史任务未记录结构化问题摘要，可查看原始报告。'
    })
  })

  it('选中报告按真实正文校验固定模板并兼容历史报告解析结果', () => {
    expect(analyzeLoadedReviewReport(bmsCodeReviewerReportWithIssuesFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 2, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerZeroIssuesFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 0,
      highestIssueSeverity: null
    })).toMatchObject({ status: 'ready', issueCount: 0, highestSeverity: 'none' })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerReportRealVariantsFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 2, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerPcBmsReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 3,
      highestIssueSeverity: 'medium'
    })).toMatchObject({ status: 'ready', issueCount: 3, highestSeverity: 'medium' })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerHistoricalPcBmsReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 2, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerHistoricalDs02ReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 3,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 3, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(templateOneReportFixture, {
      feedbackProtocolVersion: null,
      issueCount: 0,
      highestIssueSeverity: null
    })).toMatchObject({ status: 'ready', issueCount: 3, highestSeverity: 'high' })
  })

  it('反馈协议 v1 不代表固定模板，合法 template_1/2 继续旧解析并校验快照计数', () => {
    expect(analyzeLoadedReviewReport(templateOneReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 3,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 3, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(templateTwoTableReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({ status: 'ready', issueCount: 2, highestSeverity: 'high' })
    expect(analyzeLoadedReviewReport(templateOneReportFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({
      status: 'parse_error',
      message: '报告正文提取到 3 个问题，但服务端问题快照记录为 2 个。'
    })
  })

  it('新版结构损坏或快照计数不一致时返回明确解析失败', () => {
    const malformed = bmsCodeReviewerReportWithIssuesFixture.replace(
      '**问题描述：** 休眠状态分支未阻断充电 MOS 开启路径，满足远程唤醒条件时会绕过休眠保护。',
      '**影响风险：** 缺少问题描述字段。'
    )
    expect(analyzeLoadedReviewReport(malformed, {
      feedbackProtocolVersion: 1,
      issueCount: 2,
      highestIssueSeverity: 'high'
    })).toMatchObject({
      status: 'parse_error',
      highestSeverity: 'unknown',
      message: expect.stringContaining('固定模板')
    })
    expect(analyzeLoadedReviewReport(bmsCodeReviewerReportWithIssuesFixture, {
      feedbackProtocolVersion: 1,
      issueCount: 3,
      highestIssueSeverity: 'high'
    })).toMatchObject({
      status: 'parse_error',
      highestSeverity: 'unknown',
      message: '报告正文提取到 2 个问题，但服务端问题快照记录为 3 个。'
    })
  })
})
