// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

describe('useTaskQueue', () => {
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

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
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

    await waitFor(() => expect(executeTask).toHaveBeenCalledTimes(3))
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
})
