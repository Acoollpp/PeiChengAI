import { describe, expect, it } from 'vitest'

import type { TaskViewItem } from './review-task-queue-model'
import {
  applyReviewTaskQueueCommand,
  projectReviewTaskQueue
} from './review-task-queue-model'

const task = (overrides: Partial<TaskViewItem>): TaskViewItem => ({
  id: 'server-1',
  localTaskId: 'local-1',
  svn_url: 'svn://repo/project',
  old_revision: '1',
  new_revision: '2',
  status: 'running_codex',
  localQueueState: 'running',
  queueIndex: 0,
  createdAtMs: 1,
  isLocallyExecuting: true,
  origin: 'local-run',
  ...overrides
})

describe('ReviewTaskQueueModel', () => {
  it('Codex 原始输出只追加日志，不覆盖当前阶段进度', () => {
    const progressed = applyReviewTaskQueueCommand([task({
      localProgressStage: 'running_codex',
      progress_message: '正在执行 Skill'
    })], {
      type: 'apply-progress',
      event: {
        taskId: 'server-1',
        clientTaskId: 'local-1',
        type: 'codex_output',
        stream: 'stdout',
        message: 'succeeded in 291ms: 大段原始 Codex 输出'
      }
    })

    expect(progressed).toEqual([expect.objectContaining({
      localProgressStage: 'running_codex',
      progress_message: '正在执行 Skill',
      codex_log: [expect.objectContaining({ message: 'succeeded in 291ms: 大段原始 Codex 输出' })]
    })])
  })

  it('服务端终态不会在本地执行结束前提前释放并发槽位', () => {
    const tasks = [
      task({ status: 'success' }),
      task({ id: 'server-2', localTaskId: 'local-2' }),
      task({
        id: 'local-3',
        localTaskId: 'local-3',
        status: 'created',
        localQueueState: 'queued',
        queueIndex: 1,
        createdAtMs: 3,
        isLocallyExecuting: false
      })
    ]

    expect(projectReviewTaskQueue(tasks, 2).tasksToStart).toEqual([])
  })

  it('用户取消锁拒绝迟到快照但在 Promise 结束前仍占用槽位', () => {
    const cancelled = applyReviewTaskQueueCommand(
      [task({ finished_at: undefined })],
      { type: 'cancel', localTaskId: 'local-1' },
      '2026-08-12T06:00:00.000Z'
    )
    const reconciled = applyReviewTaskQueueCommand(
      cancelled,
      {
        type: 'reconcile-server-snapshot',
        tasks: [
          {
            id: 'server-1',
            svn_url: 'svn://repo/project',
            old_revision: '1',
            new_revision: '2',
            status: 'success',
            finished_at: '2026-08-12T06:01:00.000Z'
          }
        ]
      },
      '2026-08-12T06:01:00.000Z'
    )

    expect(reconciled).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        userIntent: 'cancelled',
        isLocallyExecuting: true,
        finished_at: '2026-08-12T06:01:00.000Z'
      })
    ])
    expect(projectReviewTaskQueue(reconciled, 1).tasksToStart).toEqual([])
  })

  it('执行结果按 taskId 去重时保留本地私有输入和更完整服务端结果', () => {
    const reviewItems = [{ id: 'DS-03', user_extra_rules: '只检查故障恢复' }]
    const current = [
      task({
        id: 'local-1',
        review_items: reviewItems,
        requirement_file_path: '/local/requirements.xlsx'
      }),
      task({
        id: 'server-1',
        localTaskId: 'server-1',
        origin: 'server-snapshot',
        isLocallyExecuting: false,
        status: 'success',
        issue_count: 3,
        feedback_protocol_version: 1,
        report_path: '/server/report.md',
        pdf_report_name: '服务端报告.pdf'
      })
    ]

    const completed = applyReviewTaskQueueCommand(current, {
      type: 'complete-run',
      localTaskId: 'local-1',
      result: {
        taskId: 'server-1',
        status: 'success',
        reportMarkdown: '# 本地报告',
        reportPath: '/local/report.md'
      }
    }, '2026-08-12T06:02:00.000Z')

    expect(completed).toEqual([
      expect.objectContaining({
        id: 'server-1',
        localTaskId: 'local-1',
        review_items: reviewItems,
        requirement_file_path: '/local/requirements.xlsx',
        reportMarkdown: '# 本地报告',
        report_path: '/server/report.md',
        localReportPath: '/local/report.md',
        issue_count: 3,
        feedback_protocol_version: 1,
        pdf_report_name: '服务端报告.pdf'
      })
    ])
  })

  it('双 ID 进度合并完整服务端终态且不被迟到运行阶段降级', () => {
    const reviewItems = [{ id: 'DS-03', user_extra_rules: '本地规则' }]
    const progressed = applyReviewTaskQueueCommand([
      task({
        id: 'local-progress',
        localTaskId: 'local-progress',
        review_items: reviewItems,
        requirement_file_path: '/local/spec.pdf'
      }),
      task({
        id: 'server-progress',
        localTaskId: 'server-progress',
        origin: 'server-snapshot',
        status: 'success',
        localQueueState: 'finished',
        isLocallyExecuting: false,
        issue_count: 4,
        pdf_report_name: '完整报告.pdf'
      })
    ], {
      type: 'apply-progress',
      event: {
        taskId: 'server-progress',
        clientTaskId: 'local-progress',
        type: 'stage',
        stage: 'running_codex',
        message: '迟到的运行进度'
      }
    })

    expect(progressed).toEqual([expect.objectContaining({
      id: 'server-progress',
      localTaskId: 'local-progress',
      status: 'success',
      isLocallyExecuting: true,
      issue_count: 4,
      pdf_report_name: '完整报告.pdf',
      review_items: reviewItems,
      requirement_file_path: '/local/spec.pdf'
    })])
  })

  it.each([
    {
      name: '成功态收到带双 ID 的运行进度',
      status: 'success' as const,
      stage: 'running_codex' as const,
      clientTaskId: 'local-bound',
      isLocallyExecuting: true
    },
    {
      name: '失败态收到仅服务端 ID 的环境检查进度',
      status: 'failed' as const,
      stage: 'checking_environment' as const,
      clientTaskId: undefined,
      isLocallyExecuting: false
    },
    {
      name: '环境错误态收到带双 ID 的报告上传进度',
      status: 'environment_error' as const,
      stage: 'uploading_report' as const,
      clientTaskId: 'local-bound',
      isLocallyExecuting: true
    }
  ])('$name时保持已绑定单卡的终态与三类事实所有权', ({
    status,
    stage,
    clientTaskId,
    isLocallyExecuting
  }) => {
    const reviewItems = [{ id: 'DS-03', user_extra_rules: '保留本地规则' }]
    const progressed = applyReviewTaskQueueCommand([
      task({
        id: 'server-bound',
        localTaskId: 'local-bound',
        status,
        localQueueState: 'finished',
        isLocallyExecuting,
        issue_count: 5,
        pdf_report_name: '服务端完整报告.pdf',
        reportMarkdown: '# Renderer 报告缓存',
        pdfPath: '/local/report.pdf',
        review_items: reviewItems,
        requirement_file_path: '/local/requirements.xlsx'
      })
    ], {
      type: 'apply-progress',
      event: {
        taskId: 'server-bound',
        clientTaskId,
        type: 'stage',
        stage,
        message: '迟到的非终态进度'
      }
    })

    expect(progressed).toEqual([expect.objectContaining({
      id: 'server-bound',
      localTaskId: 'local-bound',
      status,
      localQueueState: 'finished',
      isLocallyExecuting,
      issue_count: 5,
      pdf_report_name: '服务端完整报告.pdf',
      reportMarkdown: '# Renderer 报告缓存',
      pdfPath: '/local/report.pdf',
      review_items: reviewItems,
      requirement_file_path: '/local/requirements.xlsx'
    })])
  })

  it('取消后直接收到完成结果也会精确绑定并去重服务端占位卡', () => {
    const reviewItems = [{ id: 'DS-03', user_extra_rules: '取消任务本地规则' }]
    const completed = applyReviewTaskQueueCommand([
      task({
        id: 'local-cancelled',
        localTaskId: 'local-cancelled',
        status: 'cancelled',
        localQueueState: 'finished',
        userIntent: 'cancelled',
        review_items: reviewItems
      }),
      task({
        id: 'server-cancelled',
        localTaskId: 'server-cancelled',
        origin: 'server-snapshot',
        isLocallyExecuting: false,
        issue_count: 2
      })
    ], {
      type: 'complete-run',
      localTaskId: 'local-cancelled',
      result: { taskId: 'server-cancelled', status: 'success' }
    })

    expect(completed).toEqual([expect.objectContaining({
      id: 'server-cancelled',
      localTaskId: 'local-cancelled',
      status: 'cancelled',
      userIntent: 'cancelled',
      isLocallyExecuting: false,
      issue_count: 2,
      review_items: reviewItems
    })])
  })

  it('空快照保留本会话任务但移除纯服务端任务', () => {
    const reconciled = applyReviewTaskQueueCommand([
      task({ id: 'local-queued', localTaskId: 'local-queued', localQueueState: 'queued' }),
      task({ id: 'server-bound', localTaskId: 'local-bound', status: 'failed' }),
      task({
        id: 'server-only',
        localTaskId: 'server-only',
        origin: 'server-snapshot',
        status: 'success',
        isLocallyExecuting: false
      })
    ], { type: 'reconcile-server-snapshot', tasks: [] })

    expect(reconciled.map((candidate) => candidate.id)).toEqual([
      'local-queued',
      'server-bound'
    ])
  })

  it('纯服务端历史任务跨会话重试后按最新快照回到运行视图', () => {
    const reconciled = applyReviewTaskQueueCommand([
      task({
        id: 'server-retry',
        localTaskId: 'server-retry',
        origin: 'server-snapshot',
        old_revision: '10',
        new_revision: '20',
        codex_log_path: '/server/old.log',
        status: 'failed',
        localQueueState: 'finished',
        isLocallyExecuting: false
      })
    ], {
      type: 'reconcile-server-snapshot',
      tasks: [{
        id: 'server-retry',
        svn_url: 'svn://repo/project',
        old_revision: '11',
        new_revision: '21',
        codex_log_path: '/server/new.log',
        status: 'running_codex'
      }]
    })

    expect(projectReviewTaskQueue(reconciled, 2).runningTasks).toEqual([
      expect.objectContaining({
        id: 'server-retry',
        old_revision: '11',
        new_revision: '21',
        codex_log_path: '/server/new.log',
        status: 'running_codex'
      })
    ])
  })

  it('纯服务端任务刷新权威字段时保留 Renderer 报告缓存', () => {
    const reconciled = applyReviewTaskQueueCommand([
      task({
        id: 'server-cache',
        localTaskId: 'server-cache',
        origin: 'server-snapshot',
        old_revision: '10',
        new_revision: '20',
        status: 'success',
        localQueueState: 'finished',
        isLocallyExecuting: false,
        issue_count: 1,
        reportMarkdown: '# 已加载的历史报告',
        pdfPath: '/local/fallback.pdf'
      })
    ], {
      type: 'reconcile-server-snapshot',
      tasks: [{
        id: 'server-cache',
        svn_url: 'svn://repo/project',
        old_revision: '11',
        new_revision: '21',
        status: 'success',
        issue_count: 3,
        report_path: '/server/latest.md'
      }]
    })

    expect(reconciled).toEqual([expect.objectContaining({
      old_revision: '11',
      new_revision: '21',
      issue_count: 3,
      report_path: '/server/latest.md',
      reportMarkdown: '# 已加载的历史报告',
      pdfPath: '/local/fallback.pdf'
    })])
  })

  it('隐藏成功后迟到的旧快照不会让任务重新出现在投影视图', () => {
    const serverTask = task({
      id: 'server-hidden',
      localTaskId: 'server-hidden',
      origin: 'server-snapshot',
      status: 'failed',
      localQueueState: 'finished',
      isLocallyExecuting: false
    })
    const hidden = applyReviewTaskQueueCommand([serverTask], {
      type: 'hide',
      taskId: 'server-hidden'
    })
    const filteredSnapshot = applyReviewTaskQueueCommand(hidden, {
      type: 'reconcile-server-snapshot',
      tasks: []
    })
    const staleSnapshot = applyReviewTaskQueueCommand(filteredSnapshot, {
      type: 'reconcile-server-snapshot',
      tasks: [{
        id: 'server-hidden',
        svn_url: serverTask.svn_url,
        old_revision: serverTask.old_revision,
        new_revision: serverTask.new_revision,
        status: 'failed'
      }]
    })

    expect(filteredSnapshot).toEqual([
      expect.objectContaining({ id: 'server-hidden', userIntent: 'hidden' })
    ])
    expect(projectReviewTaskQueue(staleSnapshot, 2).tasks).toEqual([])
    expect(staleSnapshot).toEqual([
      expect.objectContaining({ id: 'server-hidden', userIntent: 'hidden' })
    ])
  })
})
