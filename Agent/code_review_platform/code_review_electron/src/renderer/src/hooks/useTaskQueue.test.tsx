// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ExecuteTaskRequest,
  ExecuteTaskResult,
  RetryTaskRequest
} from '../code-review-api'
import { REVIEW_TASK_TIMEOUT_MS, useTaskQueue } from './useTaskQueue'

const basePayload = (index: number): ExecuteTaskRequest => ({
  svn_url: `svn://repo/project-${index}`,
  old_revision: `${index}`,
  new_revision: `${index + 1}`,
  template_key: 'template_1',
  skill_name: '通用-代码审查-模版一'
})

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useTaskQueue', () => {
  it('默认任务超时时间为 60 分钟', () => {
    expect(REVIEW_TASK_TIMEOUT_MS).toBe(60 * 60 * 1000)
  })

  it('组合等待任务保留逐项规则和 DS-01 原始材料路径', async () => {
    const executions = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn(() => executions[executeTask.mock.calls.length - 1].promise)
    const { result } = renderHook(() => useTaskQueue({ executeTask }))
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '只核对需求变更',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/source/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/source/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
    ]

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask({
        svn_url: 'svn://repo/ds01',
        old_revision: '120',
        new_revision: '130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(result.current.queuedTasks).toHaveLength(1)
    expect(result.current.queuedTasks[0].executePayload).toEqual(expect.objectContaining({
      review_items: reviewItems,
      client_task_id: expect.stringMatching(/^local-/)
    }))
    expect(JSON.stringify(result.current.queuedTasks[0])).not.toContain('workspace')
  })

  it('组合任务运行中取消和失败都会释放槽位，后续任务仍保留完整逐项输入', async () => {
    const deferreds = Array.from({ length: 4 }, () => createDeferred<ExecuteTaskResult>())
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) =>
      deferreds[executeTask.mock.calls.length - 1].promise
    )
    const cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '只核对需求变更',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/source/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/source/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask, cancelTask }))

    await act(async () => {
      for (let index = 1; index <= 4; index += 1) {
        await result.current.submitTask({
          svn_url: `svn://repo/multi-${index}`,
          old_revision: '120',
          new_revision: '130',
          review_items: reviewItems,
          skill_name: 'bms-code-reviewer'
        })
      }
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(result.current.queuedTasks).toHaveLength(2)

    const firstRunningTask = result.current.runningTasks[0]
    await act(async () => {
      await result.current.cancelTask(firstRunningTask)
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
    expect(executeTask.mock.calls[2][0].review_items).toEqual(reviewItems)

    await act(async () => {
      deferreds[1].reject(new Error('组合任务执行失败'))
      await deferreds[1].promise.catch(() => undefined)
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(4))
    expect(executeTask.mock.calls[3][0].review_items).toEqual(reviewItems)
    expect(result.current.historyTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'cancelled', review_items: reviewItems }),
      expect.objectContaining({ status: 'failed', error_message: '组合任务执行失败', review_items: reviewItems })
    ]))
  })

  it('初始加载 2 个服务端运行任务时新提交任务仍按本地并发上限执行', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })

    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask,
        initialTasks: [
          {
            id: 'server-running-1',
            svn_url: 'svn://repo/server-1',
            old_revision: '1',
            new_revision: '2',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'running_codex'
          },
          {
            id: 'server-running-2',
            svn_url: 'svn://repo/server-2',
            old_revision: '3',
            new_revision: '4',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'checking_environment'
          }
        ]
      })
    )

    expect(result.current.runningTasks).toHaveLength(2)
    expect(result.current.runningTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'server-running-1', isLocallyExecuting: false }),
        expect.objectContaining({ id: 'server-running-2', isLocallyExecuting: false })
      ])
    )

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(executeTask.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        svn_url: 'svn://repo/project-1',
        client_task_id: expect.stringMatching(/^local-/)
      })
    )
    expect(executeTask.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        svn_url: 'svn://repo/project-2',
        client_task_id: expect.stringMatching(/^local-/)
      })
    )
    expect(result.current.queuedTasks).toEqual([
      expect.objectContaining({ svn_url: 'svn://repo/project-3' })
    ])
  })

  it('服务端刷新 2 个运行任务后新提交任务仍按本地并发上限执行', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'server-running-1',
          svn_url: 'svn://repo/server-1',
          old_revision: '1',
          new_revision: '2',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一',
          status: 'running_codex'
        },
        {
          id: 'server-running-2',
          svn_url: 'svn://repo/server-2',
          old_revision: '3',
          new_revision: '4',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一',
          status: 'checking_environment'
        }
      ])
    })

    expect(result.current.runningTasks).toHaveLength(2)
    expect(result.current.runningTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'server-running-1', isLocallyExecuting: false }),
        expect.objectContaining({ id: 'server-running-2', isLocallyExecuting: false })
      ])
    )

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(executeTask.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        svn_url: 'svn://repo/project-1',
        client_task_id: expect.stringMatching(/^local-/)
      })
    )
    expect(executeTask.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        svn_url: 'svn://repo/project-2',
        client_task_id: expect.stringMatching(/^local-/)
      })
    )
    expect(result.current.queuedTasks).toEqual([
      expect.objectContaining({ svn_url: 'svn://repo/project-3' })
    ])
  })

  it('连续提交 3 个任务时最多启动 2 个，第 1 个完成后自动启动第 3 个', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(result.current.runningTasks).toHaveLength(2)
    expect(result.current.queuedTasks).toHaveLength(1)
    expect(result.current.queuedTasks[0].svn_url).toBe('svn://repo/project-3')
    expect(executeTask.mock.calls[0][0].client_task_id).toMatch(/^local-/)
    expect(executeTask.mock.calls[1][0].client_task_id).toMatch(/^local-/)

    await act(async () => {
      deferreds[0].resolve({
        taskId: 'task-1',
        status: 'success',
        reportMarkdown: '# report 1',
        reportPath: '/tmp/report-1.md'
      })
    })

    expect(executeTask).toHaveBeenCalledTimes(3)
    expect(result.current.runningTasks.map((task) => task.svn_url)).toContain('svn://repo/project-3')
    expect(result.current.queuedTasks).toHaveLength(0)
    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-1',
          localQueueState: 'finished',
          status: 'success',
          reportMarkdown: '# report 1'
        })
      ])
    )
  })

  it('本地提交的任务执行和完成时补充开始结束时间', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    expect(result.current.runningTasks[0].started_at).toEqual(expect.any(String))
    expect(result.current.runningTasks[0].finished_at).toBeUndefined()
    const startedAt = result.current.runningTasks[0].started_at

    await act(async () => {
      deferred.resolve({
        taskId: 'task-1',
        status: 'success',
        reportMarkdown: '# report',
        reportPath: '/tmp/report.md'
      })
      await flushMicrotasks()
    })

    expect(result.current.historyTasks[0]).toEqual(
      expect.objectContaining({
        started_at: startedAt,
        finished_at: expect.any(String)
      })
    )
  })

  it('新任务完成时只记录反馈协议且不提前写入PDF信息', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const onTaskSuccess = vi.fn()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)

    const { result } = renderHook(() => useTaskQueue({ executeTask, onTaskSuccess }))

    await act(async () => {
      await result.current.submitTask(basePayload(7))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))

    await act(async () => {
      deferred.resolve({
        taskId: 'task-7',
        status: 'success',
        reportMarkdown: '# report 7',
        reportPath: '/tmp/r7_r2审查报告_20260615_143000.md',
        feedbackProtocolVersion: 1
      })
    })

    await waitFor(() =>
      expect(result.current.historyTasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-7',
            pdfPath: undefined,
            pdf_report_name: undefined,
            feedback_protocol_version: 1
          })
        ])
      )
    )
    expect(onTaskSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-7',
        feedback_protocol_version: 1
      }),
      expect.objectContaining({
        feedbackProtocolVersion: 1
      })
    )
  })

  it('历史协议上传结果为 null 时不会误开逐问题反馈', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(8))
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))

    await act(async () => {
      deferred.resolve({
        taskId: 'task-8',
        status: 'success',
        reportMarkdown: '# invalid BMS report',
        reportPath: '/tmp/invalid-bms.md',
        feedbackProtocolVersion: null
      })
    })

    await waitFor(() =>
      expect(result.current.historyTasks[0]).toEqual(
        expect.objectContaining({
          id: 'task-8',
          feedback_protocol_version: null
        })
      )
    )
  })

  it('进度事件只更新匹配 clientTaskId 的本地任务', async () => {
    const deferreds = [createDeferred<ExecuteTaskResult>(), createDeferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const firstClientTaskId = executeTask.mock.calls[0][0].client_task_id
    const secondClientTaskId = executeTask.mock.calls[1][0].client_task_id

    await act(async () => {
      result.current.applyProgressEvent({
        taskId: 'task-server-2',
        clientTaskId: secondClientTaskId,
        type: 'stage',
        stage: 'running_codex',
        message: '第二个任务正在执行'
      })
    })

    const firstTask = result.current.tasks.find((task) => task.localTaskId === firstClientTaskId)
    const secondTask = result.current.tasks.find((task) => task.localTaskId === secondClientTaskId)

    expect(firstTask?.id).toBe(firstClientTaskId)
    expect(firstTask?.progress_message).toBeUndefined()
    expect(secondTask).toEqual(
      expect.objectContaining({
        id: 'task-server-2',
        localTaskId: secondClientTaskId,
        status: 'running_codex',
        progress_message: '第二个任务正在执行'
      })
    )
  })

  it('没有 clientTaskId 的进度事件不能用本地 ID 匹配未绑定服务端 ID 的任务', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const localTaskId = executeTask.mock.calls[0][0].client_task_id
    expect(localTaskId).toBeDefined()

    await act(async () => {
      result.current.applyProgressEvent({
        taskId: localTaskId!,
        type: 'stage',
        stage: 'running_codex',
        message: '不应更新本地未绑定任务'
      })
    })

    expect(result.current.tasks[0].progress_message).toBeUndefined()
    expect(result.current.tasks[0]).toEqual(
      expect.objectContaining({
        id: localTaskId,
        localTaskId,
        status: 'created'
      })
    )
  })

  it('没有 clientTaskId 的进度事件可以用 taskId 匹配服务端任务', async () => {
    const executeTask = vi.fn()
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask,
        initialTasks: [
          {
            id: 'task-1',
            svn_url: 'svn://repo/project-1',
            old_revision: '1',
            new_revision: '2',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'created'
          }
        ]
      })
    )

    await act(async () => {
      result.current.applyProgressEvent({
        taskId: 'task-1',
        type: 'stage',
        stage: 'running_codex',
        message: '服务端任务正在执行'
      })
    })

    expect(result.current.tasks[0]).toEqual(
      expect.objectContaining({
        id: 'task-1',
        localTaskId: 'task-1',
        status: 'running_codex',
        progress_message: '服务端任务正在执行'
      })
    )
  })

  it('服务端终态任务覆盖本地 running 状态后进入历史任务', async () => {
    const executeTask = vi.fn()
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask,
        initialTasks: [
          {
            id: 'task-1',
            svn_url: 'svn://repo/project-1',
            old_revision: '1',
            new_revision: '2',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'running_codex'
          }
        ]
      })
    )

    expect(result.current.runningTasks).toHaveLength(1)

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-1',
          svn_url: 'svn://repo/project-1',
          old_revision: '1',
          new_revision: '2',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一',
          status: 'success',
          progress_message: '审查完成'
        }
      ])
    })

    expect(result.current.runningTasks).toHaveLength(0)
    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-1',
          status: 'success',
          localQueueState: 'finished'
        })
      ])
    )
  })

  it('服务端刷新合并尚未绑定服务端 ID 的本地运行任务', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)
    const payload = basePayload(1)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const localTaskId = executeTask.mock.calls[0][0].client_task_id
    expect(localTaskId).toBeDefined()

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-server-1',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          status: 'running_codex',
          progress_message: '服务端任务运行中'
        }
      ])
    })

    expect(result.current.tasks).toHaveLength(1)
    expect(result.current.tasks[0]).toEqual(
      expect.objectContaining({
        id: 'task-server-1',
        localTaskId,
        svn_url: payload.svn_url,
        old_revision: payload.old_revision,
        new_revision: payload.new_revision,
        template_key: payload.template_key,
        skill_name: payload.skill_name,
        status: 'running_codex',
        progress_message: '服务端任务运行中',
        localQueueState: 'running'
      })
    )
  })

  it('服务端刷新同参数任务时只绑定已启动本地任务并保留排队任务', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })
    const payload = basePayload(1)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
      await result.current.submitTask(payload)
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const startedLocalTaskIds = executeTask.mock.calls.map((call) => call[0].client_task_id)
    expect(startedLocalTaskIds[0]).toBeDefined()
    expect(startedLocalTaskIds[1]).toBeDefined()

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-server-1',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          status: 'running_codex'
        },
        {
          id: 'task-server-2',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          status: 'checking_environment'
        }
      ])
    })

    expect(result.current.runningTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-server-1',
          localTaskId: startedLocalTaskIds[0]
        }),
        expect.objectContaining({
          id: 'task-server-2',
          localTaskId: startedLocalTaskIds[1]
        })
      ])
    )
    expect(result.current.queuedTasks).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^local-/),
        localQueueState: 'queued',
        queueIndex: 1,
        svn_url: payload.svn_url,
        old_revision: payload.old_revision,
        new_revision: payload.new_revision,
        template_key: payload.template_key,
        skill_name: payload.skill_name
      })
    ])
  })

  it('启动任务时传递需求表和重点审查方向字段', async () => {
    const executeTask = vi.fn(async () => ({
      taskId: 'task-1',
      status: 'success' as const
    }))
    const payload: ExecuteTaskRequest = {
      ...basePayload(1),
      requirement_file_path: '/tmp/产品开发需求表.xls',
      requirement_file_name: '产品开发需求表.xls',
      focus_direction_id: 'direction-1',
      focus_direction_snapshot: '重点检查 SOC 跳变'
    }
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    expect(executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        requirement_file_path: '/tmp/产品开发需求表.xls',
        requirement_file_name: '产品开发需求表.xls',
        focus_direction_id: 'direction-1',
        focus_direction_snapshot: '重点检查 SOC 跳变'
      })
    )
  })

  it('服务端刷新时不会把不同需求表的任务误绑定到本地任务', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)
    const payload: ExecuteTaskRequest = {
      ...basePayload(1),
      requirement_file_path: '/tmp/A.xls',
      requirement_file_name: 'A.xls',
      focus_direction_snapshot: '重点检查 A'
    }
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const localTaskId = executeTask.mock.calls[0]![0].client_task_id

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-server-different-requirement',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          requirement_file_name: 'B.xls',
          focus_direction_snapshot: payload.focus_direction_snapshot,
          status: 'running_codex'
        }
      ])
    })

    expect(result.current.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-server-different-requirement',
          localTaskId: 'task-server-different-requirement'
        }),
        expect.objectContaining({
          id: localTaskId,
          localTaskId
        })
      ])
    )
  })

  it('服务端刷新时可绑定尚未回填需求表名称的本地任务', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)
    const payload: ExecuteTaskRequest = {
      ...basePayload(1),
      requirement_file_path: '/tmp/产品开发需求表.xls',
      requirement_file_name: '产品开发需求表.xls',
      focus_direction_snapshot: '重点检查需求表'
    }
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const localTaskId = executeTask.mock.calls[0]![0].client_task_id

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-server-pending-requirement-upload',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          requirement_file_name: null,
          focus_direction_snapshot: payload.focus_direction_snapshot,
          status: 'running_codex'
        }
      ])
    })

    expect(result.current.tasks).toEqual([
      expect.objectContaining({
        id: 'task-server-pending-requirement-upload',
        localTaskId
      })
    ])
  })

  it('服务端刷新同参数终态历史任务时不绑定本地运行任务且不释放并发槽位', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })
    const payload = basePayload(1)

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(payload)
      await result.current.submitTask(payload)
      await result.current.submitTask(payload)
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const startedLocalTaskIds = executeTask.mock.calls.map((call) => call[0].client_task_id)

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-history-1',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          status: 'success'
        },
        {
          id: 'task-history-2',
          svn_url: payload.svn_url,
          old_revision: payload.old_revision,
          new_revision: payload.new_revision,
          template_key: payload.template_key,
          skill_name: payload.skill_name,
          status: 'failed'
        }
      ])
    })

    expect(executeTask).toHaveBeenCalledTimes(2)
    expect(result.current.runningTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: startedLocalTaskIds[0],
          localTaskId: startedLocalTaskIds[0],
          localQueueState: 'starting'
        }),
        expect.objectContaining({
          id: startedLocalTaskIds[1],
          localTaskId: startedLocalTaskIds[1],
          localQueueState: 'starting'
        })
      ])
    )
    expect(result.current.queuedTasks).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^local-/),
        localQueueState: 'queued',
        queueIndex: 1,
        svn_url: payload.svn_url,
        old_revision: payload.old_revision,
        new_revision: payload.new_revision,
        template_key: payload.template_key,
        skill_name: payload.skill_name
      })
    ])
  })

  it('任务失败后进入历史任务并继续调度下一条', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })

    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))

    await act(async () => {
      deferreds[0].reject(new Error('执行失败'))
    })

    expect(executeTask).toHaveBeenCalledTimes(3)
    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localQueueState: 'finished',
          status: 'failed',
          error_message: '执行失败'
        })
      ])
    )
    expect(result.current.runningTasks.map((task) => task.svn_url)).toContain('svn://repo/project-3')
    expect(result.current.queuedTasks).toHaveLength(0)
  })

  it('任务执行超过配置超时时间后标记失败并继续调度下一条', async () => {
    vi.useFakeTimers()
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })

    const { result } = renderHook(() => useTaskQueue({ executeTask, taskTimeoutMs: 100 }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    expect(executeTask).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          svn_url: 'svn://repo/project-1',
          status: 'failed',
          error_message: '任务执行超时，请联系管理员处理。',
          progress_message: '任务执行超时，请联系管理员处理。',
          localQueueState: 'finished',
          isLocallyExecuting: false
        }),
        expect.objectContaining({
          svn_url: 'svn://repo/project-2',
          status: 'failed',
          error_message: '任务执行超时，请联系管理员处理。',
          progress_message: '任务执行超时，请联系管理员处理。',
          localQueueState: 'finished',
          isLocallyExecuting: false
        })
      ])
    )
    expect(executeTask).toHaveBeenCalledTimes(3)
    expect(result.current.runningTasks.map((task) => task.svn_url)).toContain('svn://repo/project-3')
    expect(result.current.queuedTasks).toHaveLength(0)
  })

  it('超时后的迟到成功结果不会覆盖失败状态', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)

    const { result } = renderHook(() => useTaskQueue({ executeTask, taskTimeoutMs: 1 }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
    })

    expect(executeTask).toHaveBeenCalledTimes(1)

    await waitFor(() =>
      expect(result.current.historyTasks[0]).toEqual(
        expect.objectContaining({
          status: 'failed',
          error_message: '任务执行超时，请联系管理员处理。'
        })
      )
    )

    await act(async () => {
      deferred.resolve({
        taskId: 'task-late-success',
        status: 'success',
        reportMarkdown: '# late report',
        reportPath: '/tmp/late.md'
      })
      await Promise.resolve()
    })

    expect(result.current.historyTasks[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        error_message: '任务执行超时，请联系管理员处理。'
      })
    )
    expect(result.current.historyTasks[0].reportMarkdown).toBeUndefined()
  })

  it('取消等待中的任务后进入历史任务且不会调用后台取消接口', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })
    const cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))

    const { result } = renderHook(() => useTaskQueue({ executeTask, cancelTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const queuedTask = result.current.queuedTasks[0]

    await act(async () => {
      await result.current.cancelTask(queuedTask)
    })

    expect(cancelTask).not.toHaveBeenCalled()
    expect(executeTask).toHaveBeenCalledTimes(2)
    expect(result.current.queuedTasks).toHaveLength(0)
    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localTaskId: queuedTask.localTaskId,
          status: 'cancelled',
          progress_message: '任务已取消',
          localQueueState: 'finished',
          isLocallyExecuting: false
        })
      ])
    )
  })

  it('取消运行中的任务后调用后台取消接口并释放并发槽位', async () => {
    const deferreds = [
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>(),
      createDeferred<ExecuteTaskResult>()
    ]
    const executeTask = vi.fn((_: ExecuteTaskRequest) => {
      const deferred = deferreds[executeTask.mock.calls.length - 1]
      return deferred.promise
    })
    const cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))

    const { result } = renderHook(() => useTaskQueue({ executeTask, cancelTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
      await result.current.submitTask(basePayload(2))
      await result.current.submitTask(basePayload(3))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const runningTask = result.current.runningTasks[0]

    await act(async () => {
      await result.current.cancelTask(runningTask)
    })

    expect(cancelTask).toHaveBeenCalledWith({
      client_task_id: runningTask.localTaskId,
      task_id: runningTask.id
    })
    expect(result.current.historyTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localTaskId: runningTask.localTaskId,
          status: 'cancelled',
          progress_message: '任务已取消',
          localQueueState: 'finished',
          isLocallyExecuting: false
        })
      ])
    )
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
    expect(result.current.runningTasks.map((task) => task.svn_url)).toContain('svn://repo/project-3')
  })

  it('取消运行中的任务后迟到进度和成功结果不会覆盖已取消状态', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)
    const cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))

    const { result } = renderHook(() => useTaskQueue({ executeTask, cancelTask }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const runningTask = result.current.runningTasks[0]

    await act(async () => {
      await result.current.cancelTask(runningTask)
      result.current.applyProgressEvent({
        taskId: 'task-late',
        clientTaskId: runningTask.localTaskId,
        type: 'stage',
        stage: 'uploading_report',
        message: '不应覆盖取消状态'
      })
      deferred.resolve({
        taskId: 'task-late',
        status: 'success',
        reportMarkdown: '# late report',
        reportPath: '/tmp/late.md'
      })
      await flushMicrotasks()
    })

    expect(result.current.historyTasks[0]).toEqual(
      expect.objectContaining({
        localTaskId: runningTask.localTaskId,
        status: 'cancelled',
        progress_message: '任务已取消'
      })
    )
    expect(result.current.historyTasks[0].reportMarkdown).toBeUndefined()
  })

  it('任务成功回调使用包含最新日志的任务状态', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_: ExecuteTaskRequest) => deferred.promise)
    const onTaskSuccess = vi.fn()

    const { result } = renderHook(() => useTaskQueue({ executeTask, onTaskSuccess }))

    await act(async () => {
      await result.current.submitTask(basePayload(1))
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id
    expect(clientTaskId).toMatch(/^local-/)

    await act(async () => {
      result.current.applyProgressEvent({
        taskId: 'task-1',
        clientTaskId,
        type: 'codex_output',
        stream: 'stdout',
        message: '实时日志'
      })
      result.current.applyProgressEvent({
        taskId: 'task-1',
        clientTaskId,
        type: 'stage',
        stage: 'running_codex',
        message: '正在执行'
      })
    })

    await act(async () => {
      deferred.resolve({
        taskId: 'task-1',
        status: 'success',
        reportMarkdown: '# report',
        reportPath: '/tmp/report.md'
      })
    })

    await waitFor(() => expect(onTaskSuccess).toHaveBeenCalledTimes(1))
    expect(onTaskSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: 'success',
        codex_log: [
          expect.objectContaining({
            type: 'codex_output',
            message: '实时日志'
          })
        ]
      }),
      expect.objectContaining({ taskId: 'task-1', status: 'success' })
    )
  })

  it('重试历史失败任务时复用原任务卡片，不新增任务', async () => {
    const deferred = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn()
    const retryTask = vi.fn(() => deferred.promise)
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask,
        retryTask,
        initialTasks: [
          {
            id: 'task-failed',
            svn_url: 'svn://repo/retry',
            old_revision: '10',
            new_revision: '12',
            template_key: 'template_2',
            skill_name: '通用-代码审查-模版二',
            requirement_file_path: '/tmp/产品开发需求表.xls',
            status: 'failed',
            error_message: 'Codex 执行失败',
            finished_at: '2026-06-23T10:00:00.000Z'
          }
        ]
      })
    )

    await act(async () => {
      await result.current.retryTask(result.current.historyTasks[0])
    })

    await waitFor(() => expect(retryTask).toHaveBeenCalledTimes(1))
    expect(retryTask).toHaveBeenCalledWith({
      task_id: 'task-failed',
      client_task_id: 'task-failed',
      old_revision: '10',
      new_revision: '12',
      requirement_file_path: '/tmp/产品开发需求表.xls'
    })
    expect(executeTask).not.toHaveBeenCalled()
    expect(result.current.runningTasks).toEqual([
      expect.objectContaining({
        id: 'task-failed',
        localTaskId: 'task-failed',
        status: 'created',
        error_message: undefined
      })
    ])
    expect(result.current.tasks).toHaveLength(1)

    await act(async () => {
      deferred.resolve({
        taskId: 'task-failed',
        status: 'success',
        reportMarkdown: '# retry report',
        reportPath: '/tmp/retry.md'
      })
    })

    await waitFor(() =>
      expect(result.current.historyTasks).toEqual([
        expect.objectContaining({
          id: 'task-failed',
          status: 'success',
          reportMarkdown: '# retry report'
        })
      ])
    )
    expect(result.current.tasks).toHaveLength(1)
  })

  it('跨会话重试清除旧问题快照并在完成时合并服务端任务快照', async () => {
    const retry = createDeferred<ExecuteTaskResult>()
    const retryTask = vi.fn((_payload: RetryTaskRequest) => retry.promise)
    const { result } = renderHook(() => useTaskQueue({ executeTask: vi.fn(), retryTask }))

    act(() => {
      result.current.setServerTasks([{
        id: 'task-cross-session',
        svn_url: 'svn://repo/cross-session',
        old_revision: '10',
        new_revision: '12',
        review_item_ids: ['DS-03'],
        skill_name: 'bms-code-reviewer',
        status: 'failed',
        error_message: '历史执行失败',
        issue_count: 0,
        highest_issue_severity: null,
        feedback_protocol_version: 1,
        requirement_file_path: '/server/requirement.xlsx',
        codex_log_path: '/local/old-codex.log'
      }])
      result.current.updateTask('task-cross-session', (task) => ({
        ...task,
        requirement_file_path: '/local/requirement.xlsx'
      }))
    })
    const createdAtMs = result.current.historyTasks[0].createdAtMs

    await act(async () => {
      await result.current.retryTask(result.current.historyTasks[0])
    })

    await waitFor(() => expect(retryTask).toHaveBeenCalledTimes(1))
    expect(result.current.runningTasks[0]).toEqual(expect.objectContaining({
      issue_count: undefined,
      highest_issue_severity: undefined,
      feedback_protocol_version: undefined
    }))

    act(() => {
      result.current.applyProgressEvent({
        taskId: 'task-cross-session',
        clientTaskId: 'task-cross-session',
        type: 'codex_output',
        stream: 'stdout',
        message: '本地重试日志'
      })
      result.current.applyProgressEvent({
        taskId: 'task-cross-session',
        clientTaskId: 'task-cross-session',
        type: 'stage',
        stage: 'uploading_report',
        message: '本地正在上传报告'
      })
    })

    await act(async () => {
      retry.resolve({
        taskId: 'task-cross-session',
        status: 'success',
        reportMarkdown: '# 本地重试报告',
        reportPath: '/local/retry.md',
        pdfPath: '/local/retry.pdf',
        codexLogPath: '/local/retry-codex.log',
        serverTask: {
          id: 'task-cross-session',
          svn_url: 'svn://repo/cross-session',
          old_revision: '10',
          new_revision: '12',
          review_item_ids: ['DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'success',
          issue_count: 2,
          highest_issue_severity: 'high',
          feedback_protocol_version: 1,
          report_path: '/server/retry.md',
          pdf_report_name: '重试报告.pdf',
          progress_message: '服务端进度不应覆盖本地状态',
          codex_log_path: '/server/codex.log',
          codex_log: [{
            taskId: 'task-cross-session',
            type: 'codex_output',
            stream: 'stderr',
            message: '服务端日志不应覆盖本地日志'
          }],
          requirement_file_path: '/server/new-requirement.xlsx',
          reportMarkdown: '# 服务端报告不应覆盖本地报告',
          pdfPath: '/server/report.pdf',
          localQueueState: 'queued',
          localTaskId: 'server-local-task-id',
          createdAtMs: 0,
          isLocalOnly: true,
          isLocallyExecuting: true,
          queueIndex: 99
        } as unknown as NonNullable<ExecuteTaskResult['serverTask']>
      })
    })

    await waitFor(() => expect(result.current.historyTasks[0]?.status).toBe('success'))
    expect(result.current.historyTasks[0]).toEqual(expect.objectContaining({
      issue_count: 2,
      highest_issue_severity: 'high',
      feedback_protocol_version: 1,
      report_path: '/server/retry.md',
      pdf_report_name: '重试报告.pdf',
      progress_message: '审查完成',
      codex_log: [expect.objectContaining({ message: '本地重试日志' })],
      codex_log_path: '/local/retry-codex.log',
      reportMarkdown: '# 本地重试报告',
      pdfPath: '/local/retry.pdf',
      requirement_file_path: '/local/requirement.xlsx',
      localQueueState: 'finished',
      localTaskId: 'task-cross-session',
      createdAtMs,
      isLocalOnly: false,
      isLocallyExecuting: false,
      queueIndex: 0
    }))
  })

  it('服务端刷新后仍保留组合逐项输入并在失败重试时原样透传', async () => {
    const execution = createDeferred<ExecuteTaskResult>()
    const retry = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => execution.promise)
    const retryTask = vi.fn((_payload: RetryTaskRequest) => retry.promise)
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '仅核对本次协议导入',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/source/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/source/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask, retryTask }))

    await act(async () => {
      await result.current.submitTask({
        svn_url: 'svn://repo/multi-items',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id

    act(() => {
      result.current.setServerTasks([
        {
          id: 'task-multi-items',
          svn_url: 'svn://repo/multi-items',
          old_revision: '0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })

    await waitFor(() => expect(result.current.tasks).toHaveLength(2))
    expect(result.current.tasks.find((task) => task.id === 'task-multi-items')?.review_items)
      .toBeUndefined()
    expect(result.current.tasks.find((task) => task.localTaskId === clientTaskId)).toEqual(
      expect.objectContaining({ id: clientTaskId, review_items: reviewItems })
    )

    act(() => {
      result.current.applyProgressEvent({
        taskId: 'task-multi-items',
        clientTaskId,
        type: 'stage',
        stage: 'created',
        message: '任务已创建'
      })
    })

    await waitFor(() => expect(result.current.runningTasks[0]).toEqual(expect.objectContaining({
      old_revision: '0',
      new_revision: 'R130',
      review_items: reviewItems
    })))
    expect(result.current.tasks).toHaveLength(1)

    act(() => {
      result.current.setServerTasks([
        {
          id: 'task-multi-items',
          svn_url: 'svn://repo/multi-items',
          old_revision: '0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })
    expect(result.current.tasks).toEqual([
      expect.objectContaining({
        localTaskId: clientTaskId,
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems
      })
    ])

    await act(async () => {
      execution.reject(new Error('Codex 执行失败'))
      await execution.promise.catch(() => undefined)
    })
    await waitFor(() => expect(result.current.historyTasks[0]?.status).toBe('failed'))

    await act(async () => {
      await result.current.retryTask(result.current.historyTasks[0])
    })

    await waitFor(() => expect(retryTask).toHaveBeenCalledTimes(1))
    expect(retryTask).toHaveBeenCalledWith({
      task_id: 'task-multi-items',
      client_task_id: clientTaskId,
      old_revision: '0',
      new_revision: 'R130',
      requirement_file_path: undefined,
      review_items: reviewItems
    })

    await act(async () => {
      retry.resolve({
        taskId: 'task-multi-items',
        status: 'success',
        reportMarkdown: '# DS-01 + DS-03 report',
        reportPath: '/tmp/multi-items.md'
      })
    })
  })

  it('2.0 任务旧 revision 不同时不绑定服务端另一任务或泄露逐项输入', async () => {
    const execution = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => execution.promise)
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '本地 DS-01 规则不得泄露',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/private/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/private/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '本地 DS-03 规则不得泄露' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask({
        svn_url: 'svn://repo/same-project',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id

    act(() => {
      result.current.setServerTasks([
        {
          id: 'task-other-old-revision',
          svn_url: 'svn://repo/same-project',
          old_revision: 'r0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })

    await waitFor(() => expect(result.current.tasks).toHaveLength(2))
    const serverTask = result.current.tasks.find((task) => task.id === 'task-other-old-revision')
    const localTask = result.current.tasks.find((task) => task.localTaskId === clientTaskId)
    expect(serverTask).toEqual(expect.objectContaining({
      localTaskId: 'task-other-old-revision',
      old_revision: 'r0',
      new_revision: 'r130',
      review_items: undefined
    }))
    expect(JSON.stringify(serverTask)).not.toContain('/private/')
    expect(JSON.stringify(serverTask)).not.toContain('不得泄露')
    expect(localTask).toEqual(expect.objectContaining({
      id: clientTaskId,
      old_revision: '0',
      new_revision: 'R130',
      review_items: reviewItems
    }))
  })

  it('公共字段相同的两个 2.0 任务按 clientTaskId 绑定，服务端倒序不交换逐项输入', async () => {
    const executions = [createDeferred<ExecuteTaskResult>(), createDeferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) =>
      executions[executeTask.mock.calls.length - 1].promise
    )
    const reviewItemsA = [
      {
        id: 'DS-01',
        user_extra_rules: '任务 A 的 DS-01 规则',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/task-a/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/task-a/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '任务 A 的 DS-03 规则' }
    ]
    const reviewItemsB = [
      {
        id: 'DS-01',
        user_extra_rules: '任务 B 的 DS-01 规则',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/task-b/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/task-b/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '任务 B 的 DS-03 规则' }
    ]
    const commonPayload = {
      svn_url: 'svn://repo/identical-public-fields',
      old_revision: '0',
      new_revision: 'R130',
      skill_name: 'bms-code-reviewer'
    }
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask({ ...commonPayload, review_items: reviewItemsA })
      await result.current.submitTask({ ...commonPayload, review_items: reviewItemsB })
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    const clientTaskIdA = executeTask.mock.calls[0][0].client_task_id
    const clientTaskIdB = executeTask.mock.calls[1][0].client_task_id
    const serverTaskA = {
      id: 'task-a',
      ...commonPayload,
      new_revision: 'r130',
      review_item_ids: ['DS-01', 'DS-03'],
      status: 'running_codex' as const
    }
    const serverTaskB = { ...serverTaskA, id: 'task-b' }

    act(() => result.current.setServerTasks([serverTaskB, serverTaskA]))
    await waitFor(() => expect(result.current.tasks).toHaveLength(4))
    expect(result.current.tasks.find((task) => task.id === 'task-a')?.review_items).toBeUndefined()
    expect(result.current.tasks.find((task) => task.id === 'task-b')?.review_items).toBeUndefined()

    act(() => {
      result.current.applyProgressEvent({
        taskId: 'task-a', clientTaskId: clientTaskIdA, type: 'stage',
        stage: 'created', message: '任务 A 已创建'
      })
      result.current.applyProgressEvent({
        taskId: 'task-b', clientTaskId: clientTaskIdB, type: 'stage',
        stage: 'created', message: '任务 B 已创建'
      })
    })
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))

    act(() => result.current.setServerTasks([serverTaskB, serverTaskA]))
    const taskA = result.current.tasks.find((task) => task.id === 'task-a')
    const taskB = result.current.tasks.find((task) => task.id === 'task-b')
    expect(taskA).toEqual(expect.objectContaining({
      localTaskId: clientTaskIdA,
      review_items: reviewItemsA
    }))
    expect(taskB).toEqual(expect.objectContaining({
      localTaskId: clientTaskIdB,
      review_items: reviewItemsB
    }))
    expect(JSON.stringify(taskA)).not.toContain('/task-b/')
    expect(JSON.stringify(taskB)).not.toContain('/task-a/')
  })

  it('本地 create 失败时重试原 create 载荷，不使用本地 ID 调用服务端任务重试', async () => {
    const executions = [createDeferred<ExecuteTaskResult>(), createDeferred<ExecuteTaskResult>()]
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) =>
      executions[executeTask.mock.calls.length - 1].promise
    )
    const retryTask = vi.fn()
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '本地创建失败规则',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/local/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/local/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask, retryTask }))

    await act(async () => {
      await result.current.submitTask({
        svn_url: 'svn://repo/create-failure',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id

    act(() => {
      result.current.setServerTasks([
        {
          id: 'existing-same-parameters',
          svn_url: 'svn://repo/create-failure',
          old_revision: '0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))

    await act(async () => {
      executions[0].reject(new Error('创建任务失败'))
      await executions[0].promise.catch(() => undefined)
    })
    await waitFor(() => expect(
      result.current.tasks.find((task) => task.localTaskId === clientTaskId)?.status
    ).toBe('failed'))
    const failedLocalTask = result.current.tasks.find((task) => task.localTaskId === clientTaskId)
    if (!failedLocalTask) throw new Error('未找到本地创建失败任务')
    expect(failedLocalTask.id).toBe(clientTaskId)

    await act(async () => result.current.retryTask(failedLocalTask))
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(2))
    expect(retryTask).not.toHaveBeenCalled()
    expect(executeTask.mock.calls[1][0]).toEqual(expect.objectContaining({
      client_task_id: clientTaskId,
      old_revision: '0',
      new_revision: 'R130',
      review_items: reviewItems
    }))
    expect(executeTask.mock.calls[1][0]).not.toHaveProperty('task_id')
    expect(result.current.tasks.find((task) => task.localTaskId === clientTaskId)).toEqual(
      expect.objectContaining({ id: clientTaskId, isLocalOnly: true, executeWith: 'create' })
    )
  })

  it('progress 丢失时完成结果按 taskId 去重并保留本地逐项输入', async () => {
    const execution = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => execution.promise)
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '完成态保留规则',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/complete/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/complete/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask }))

    await act(async () => {
      await result.current.submitTask({
        svn_url: 'svn://repo/progress-lost',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id

    act(() => {
      result.current.setServerTasks([
        {
          id: 'task-progress-lost',
          svn_url: 'svn://repo/progress-lost',
          old_revision: '0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))

    await act(async () => {
      execution.resolve({
        taskId: 'task-progress-lost',
        status: 'success',
        reportMarkdown: '# complete',
        reportPath: '/tmp/complete.md'
      })
    })

    await waitFor(() => expect(result.current.tasks).toEqual([
      expect.objectContaining({
        id: 'task-progress-lost',
        localTaskId: clientTaskId,
        status: 'success',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems
      })
    ]))
  })

  it('取消后的迟到进度和完成结果不把本地逐项输入挂到远端占位卡', async () => {
    const execution = createDeferred<ExecuteTaskResult>()
    const executeTask = vi.fn((_payload: ExecuteTaskRequest) => execution.promise)
    const cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '已取消任务私有规则',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/cancelled/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/cancelled/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '' }
    ]
    const { result } = renderHook(() => useTaskQueue({ executeTask, cancelTask }))

    await act(async () => {
      await result.current.submitTask({
        svn_url: 'svn://repo/cancelled-late-event',
        old_revision: '0',
        new_revision: 'R130',
        review_items: reviewItems,
        skill_name: 'bms-code-reviewer'
      })
    })
    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(1))
    const clientTaskId = executeTask.mock.calls[0][0].client_task_id

    act(() => {
      result.current.setServerTasks([
        {
          id: 'task-cancelled-shadow',
          svn_url: 'svn://repo/cancelled-late-event',
          old_revision: '0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer',
          status: 'running_codex'
        }
      ])
    })
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))
    const localTask = result.current.tasks.find((task) => task.localTaskId === clientTaskId)
    if (!localTask) throw new Error('未找到待取消本地任务')

    await act(async () => result.current.cancelTask(localTask))
    act(() => {
      result.current.applyProgressEvent({
        taskId: 'task-cancelled-shadow',
        clientTaskId,
        type: 'stage',
        stage: 'running_codex',
        message: '迟到进度'
      })
    })
    await act(async () => {
      execution.resolve({ taskId: 'task-cancelled-shadow', status: 'success' })
    })

    const serverShadow = result.current.tasks.find((task) => task.id === 'task-cancelled-shadow')
    const cancelledLocal = result.current.tasks.find((task) => task.localTaskId === clientTaskId)
    expect(serverShadow?.review_items).toBeUndefined()
    expect(JSON.stringify(serverShadow)).not.toContain('/cancelled/')
    expect(cancelledLocal).toEqual(expect.objectContaining({
      id: clientTaskId,
      status: 'cancelled',
      review_items: reviewItems
    }))
  })

  it('历史任务按完成时间倒序展示', () => {
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask: vi.fn(),
        initialTasks: [
          {
            id: 'task-old',
            svn_url: 'svn://repo/old',
            old_revision: '1',
            new_revision: '2',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'success',
            finished_at: '2026-06-23T09:00:00.000Z'
          },
          {
            id: 'task-new',
            svn_url: 'svn://repo/new',
            old_revision: '3',
            new_revision: '4',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'success',
            finished_at: '2026-06-23T10:00:00.000Z'
          }
        ]
      })
    )

    expect(result.current.historyTasks.map((task) => task.id)).toEqual([
      'task-new',
      'task-old'
    ])
  })

  it('历史任务缺少完成时间时用开始时间和本地创建时间兜底排序', () => {
    const { result } = renderHook(() =>
      useTaskQueue({
        executeTask: vi.fn(),
        initialTasks: [
          {
            id: 'task-start-old',
            svn_url: 'svn://repo/old',
            old_revision: '1',
            new_revision: '2',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'success',
            started_at: '2026-06-23T09:00:00.000Z'
          },
          {
            id: 'task-start-new',
            svn_url: 'svn://repo/new',
            old_revision: '3',
            new_revision: '4',
            template_key: 'template_1',
            skill_name: '通用-代码审查-模版一',
            status: 'success',
            started_at: '2026-06-23T10:00:00.000Z'
          }
        ]
      })
    )

    expect(result.current.historyTasks.map((task) => task.id)).toEqual([
      'task-start-new',
      'task-start-old'
    ])
  })

  it('移除任务后该任务不再出现在队列里', async () => {
    const { result } = renderHook(() => useTaskQueue({ executeTask: vi.fn() }))

    await act(async () => {
      result.current.setServerTasks([
        {
          id: 'task-keep',
          svn_url: 'svn://repo/keep',
          old_revision: '1',
          new_revision: '2',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一',
          status: 'failed'
        },
        {
          id: 'task-drop',
          svn_url: 'svn://repo/drop',
          old_revision: '3',
          new_revision: '4',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一',
          status: 'failed'
        }
      ])
    })

    expect(result.current.tasks.map((task) => task.id)).toEqual(['task-keep', 'task-drop'])

    await act(async () => {
      result.current.removeTask('task-drop')
    })

    expect(result.current.tasks.map((task) => task.id)).toEqual(['task-keep'])
  })

  it('移除后的任务不会因服务端列表刷新而以本地任务身份复活', async () => {
    const { result } = renderHook(() => useTaskQueue({ executeTask: vi.fn() }))
    const serverTask = {
      id: 'task-drop',
      svn_url: 'svn://repo/drop',
      old_revision: '3',
      new_revision: '4',
      template_key: 'template_1' as const,
      skill_name: '通用-代码审查-模版一',
      status: 'failed' as const
    }

    await act(async () => {
      result.current.setServerTasks([serverTask])
    })
    await act(async () => {
      result.current.removeTask('task-drop')
    })

    // 主进程已过滤掉该任务，刷新时它不再出现在服务端返回里。
    await act(async () => {
      result.current.setServerTasks([])
    })

    expect(result.current.tasks).toEqual([])
  })
})
