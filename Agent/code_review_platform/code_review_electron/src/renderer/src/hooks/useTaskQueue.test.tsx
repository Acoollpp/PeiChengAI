// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExecuteTaskRequest, ExecuteTaskResult } from '../code-review-api'
import { useTaskQueue } from './useTaskQueue'

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

  it('新任务完成时把执行结果的 PDF 原文件名写入历史任务', async () => {
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
        pdfPath: '/tmp/r7_r2审查报告_20260615_143000.pdf',
        pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
      })
    })

    await waitFor(() =>
      expect(result.current.historyTasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-7',
            pdfPath: '/tmp/r7_r2审查报告_20260615_143000.pdf',
            pdf_report_name: 'r7_r2审查报告_20260615_143000.pdf'
          })
        ])
      )
    )
    expect(onTaskSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-7',
        pdf_report_name: 'r7_r2审查报告_20260615_143000.pdf'
      }),
      expect.objectContaining({
        pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
      })
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

    await waitFor(() =>
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
})
