import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DefaultReviewTaskRuntime,
  type ReviewTaskRuntimeApi,
  type ReviewTaskRuntimeOptions
} from '../review-task-runtime/review-task-runtime'
import type { ReviewTask } from '../../shared/types'

const makeTask = (id: string, overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id,
  svn_url: 'svn://repo/project',
  old_revision: '1',
  new_revision: '2',
  template_key: 'template_1',
  skill_name: '通用-代码审查-模版一',
  status: 'created',
  ...overrides
})

const createApi = (overrides: Partial<ReviewTaskRuntimeApi> = {}): ReviewTaskRuntimeApi => ({
  createTask: vi.fn(async (_token, request) =>
    makeTask('task-created', {
      svn_url: request.svn_url,
      old_revision: request.old_revision,
      new_revision: request.new_revision
    })
  ),
  readTask: vi.fn(async (_token, taskId) =>
    makeTask(taskId, { svn_url: 'svn://repo/retry', status: 'failed' })
  ),
  updateTaskStatus: vi.fn(async () => undefined),
  uploadRequirementFile: vi.fn(async () => undefined),
  uploadReport: vi.fn(async () => undefined),
  uploadPdfReport: vi.fn(async (_token, taskId) => makeTask(taskId)),
  ...overrides
})

const createOptions = (
  api: ReviewTaskRuntimeApi,
  overrides: Partial<ReviewTaskRuntimeOptions> = {}
): ReviewTaskRuntimeOptions => ({
  authStore: {
    load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' }))
  },
  createApiClient: vi.fn(async () => api),
  syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
  checkEnvironment: vi.fn(async () => ({ status: 'missing_svn' as const })),
  preflightSvn: vi.fn(),
  prepareWorkspace: vi.fn(),
  runCodex: vi.fn(),
  prepareReport: vi.fn(),
  generatePdfReport: vi.fn(),
  uploadRequirementFile: vi.fn(),
  uploadReport: vi.fn(),
  uploadPdfReport: vi.fn(),
  ...overrides
})

describe('ReviewTaskRuntime', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('通过同一个 run interface 分派新建和重试，且不改变各自的服务端任务语义', async () => {
    const api = createApi()
    const runtime = new DefaultReviewTaskRuntime(createOptions(api))

    await expect(
      runtime.run({
        kind: 'create',
        clientTaskId: 'local-create',
        request: {
          svn_url: 'svn://repo/create',
          old_revision: '1',
          new_revision: '2',
          template_key: 'template_1',
          skill_name: '通用-代码审查-模版一'
        }
      })
    ).resolves.toMatchObject({ taskId: 'task-created', status: 'environment_error' })
    await expect(
      runtime.run({
        kind: 'retry',
        clientTaskId: 'local-retry',
        taskId: 'task-retry'
      })
    ).resolves.toMatchObject({ taskId: 'task-retry', status: 'environment_error' })

    expect(api.createTask).toHaveBeenCalledTimes(1)
    expect(api.readTask).toHaveBeenCalledWith('token-123', 'task-retry')
  })

  it('run 返回前完成异步任务日志写入', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'review-runtime-log-'))
    tempDirs.push(workspaceDir)
    const reportPath = join(workspaceDir, '代码审查报告.md')
    const imagesDir = join(workspaceDir, 'images')
    const codexLogPath = join(workspaceDir, 'codex-review.log')
    const runtime = new DefaultReviewTaskRuntime(
      createOptions(createApi(), {
        checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/svn' })),
        prepareWorkspace: vi.fn(async () => ({
          cwd: workspaceDir,
          reportPath,
          imagesDir,
          codexLogPath
        })),
        runCodex: vi.fn(async ({ onProgress }) => {
          onProgress?.({
            type: 'stage',
            stage: 'codex_running',
            message: '日志写入完成后才能返回'
          })
          await writeFile(reportPath, '# report\n')
        }) as never,
        prepareReport: vi.fn(async () => '# report\n')
      })
    )

    await runtime.run({
      kind: 'retry',
      clientTaskId: 'local-log',
      taskId: 'task-log'
    })

    await expect(readFile(codexLogPath, 'utf8')).resolves.toContain('日志写入完成后才能返回')
  })

  it('cancelAll 等待已停止执行但仍在 flush 日志的运行完成', async () => {
    let releaseFlush!: () => void
    const flushFinished = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    const flushTaskLog = vi.fn(async () => flushFinished)
    const runtime = new DefaultReviewTaskRuntime(
      createOptions(createApi(), {
        flushTaskLog
      })
    )
    const runPromise = runtime.run({
      kind: 'retry',
      clientTaskId: 'local-flush',
      taskId: 'task-flush'
    })
    await vi.waitFor(() => expect(flushTaskLog).toHaveBeenCalledTimes(1))

    let cancelAllSettled = false
    const cancelAllPromise = runtime.cancelAll().then(() => {
      cancelAllSettled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cancelAllSettled).toBe(false)

    releaseFlush()
    await expect(cancelAllPromise).resolves.toBeUndefined()
    await expect(runPromise).resolves.toMatchObject({ taskId: 'task-flush' })
  })

  it('两个 ID 定位同一次运行，重复取消只清理一次工作区和独立证据目录', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'review-runtime-workspace-'))
    const evidenceDir = await mkdtemp(join(tmpdir(), 'review-runtime-evidence-'))
    tempDirs.push(workspaceDir, evidenceDir)
    const reportPath = join(workspaceDir, '代码审查报告.md')
    const imagesDir = join(workspaceDir, 'images')
    await mkdir(imagesDir)

    let releaseCodex!: () => void
    const codexFinished = new Promise<void>((resolve) => {
      releaseCodex = resolve
    })
    const runCodex = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await writeFile(reportPath, '# partial report\n')
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      releaseCodex()
    })
    const api = createApi()
    const runtime = new DefaultReviewTaskRuntime(
      createOptions(api, {
        checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/svn' })),
        prepareWorkspace: vi.fn(async () => ({
          cwd: workspaceDir,
          reportPath,
          imagesDir,
          evidenceDir
        })),
        runCodex: runCodex as never,
        prepareReport: vi.fn(async () => '# report\n')
      })
    )

    const runPromise = runtime.run({
      kind: 'create',
      clientTaskId: 'local-cancel',
      request: {
        svn_url: 'svn://repo/cancel',
        old_revision: '1',
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      }
    })
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1))

    const cancelByClientId = runtime.cancel({ clientTaskId: 'local-cancel' })
    const cancelByTaskId = runtime.cancel({ taskId: 'task-created' })
    await expect(Promise.all([cancelByClientId, cancelByTaskId])).resolves.toEqual([
      { status: 'cancelled' },
      { status: 'cancelled' }
    ])
    await codexFinished
    await expect(runPromise).resolves.toMatchObject({ status: 'cancelled' })

    await expect(readFile(reportPath, 'utf8')).rejects.toThrow()
    await expect(stat(evidenceDir)).rejects.toThrow()
  })

  it('cancelAll 按运行实例去重，并吸收单个取消失败', async () => {
    const api = createApi({
      updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
        if (payload.status === 'cancelled') {
          throw new Error('status unavailable')
        }
      })
    })
    let releaseCodex!: () => void
    const codexFinished = new Promise<void>((resolve) => {
      releaseCodex = resolve
    })
    const runCodex = vi.fn(async ({ signal, onProgress }) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      onProgress?.({
        type: 'stage',
        stage: 'codex_running',
        message: '取消后的最后一条日志'
      })
      await codexFinished
    }) as ReviewTaskRuntimeOptions['runCodex']
    const workspaceDir = await mkdtemp(join(tmpdir(), 'review-runtime-cancel-all-'))
    const evidenceDir = await mkdtemp(join(tmpdir(), 'review-runtime-cancel-all-evidence-'))
    tempDirs.push(workspaceDir, evidenceDir)
    const runtime = new DefaultReviewTaskRuntime(
      createOptions(api, {
        checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/svn' })),
        prepareWorkspace: vi.fn(async () => ({
          cwd: workspaceDir,
          reportPath: join(workspaceDir, 'unused-report.md'),
          imagesDir: join(workspaceDir, 'unused-images'),
          evidenceDir
        })),
        runCodex
      })
    )
    const runPromise = runtime.run({
      kind: 'retry',
      clientTaskId: 'local-retry',
      taskId: 'task-retry'
    })
    const runRejection = expect(runPromise).rejects.toThrow('status unavailable')
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1))

    let cancelAllSettled = false
    const cancelAllPromise = runtime.cancelAll().then(() => {
      cancelAllSettled = true
    })
    await vi.waitFor(() => expect(api.updateTaskStatus).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cancelAllSettled).toBe(false)

    releaseCodex()
    await expect(cancelAllPromise).resolves.toBeUndefined()
    await runRejection
    await expect(stat(workspaceDir)).rejects.toThrow()
    await expect(stat(evidenceDir)).rejects.toThrow()
    expect(api.updateTaskStatus).toHaveBeenCalledWith('token-123', 'task-retry', {
      status: 'cancelled',
      error_message: '任务已取消'
    })
  })
})
