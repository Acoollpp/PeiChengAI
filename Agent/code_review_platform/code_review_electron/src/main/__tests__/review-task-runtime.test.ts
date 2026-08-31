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
import { ReportUploadRecoveryError } from '../report-uploader'

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

const createDeferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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

  it('等待解密后只重新读取并上传现有报告且成功后清除恢复记录', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'review-runtime-report-retry-'))
    tempDirs.push(workspaceDir)
    const reportPath = join(workspaceDir, '代码审查报告.md')
    const imagesDir = join(workspaceDir, 'images')
    await mkdir(imagesDir)
    const recoveryRecord = {
      taskId: 'task-created',
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue-01.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => ({ status: 'ready' as const, record: recoveryRecord })),
      remove: vi.fn(async () => undefined)
    }
    const api = createApi({
      readTask: vi.fn(async (_token, taskId) => makeTask(taskId, { status: 'success' }))
    })
    const uploadReport = vi.fn()
      .mockRejectedValueOnce(new ReportUploadRecoveryError(['images/issue-01.svg']))
      .mockResolvedValueOnce({ ok: true })
    const prepareReport = vi.fn(async () => readFile(reportPath, 'utf8'))
    const runCodex = vi.fn(async () => {
      await writeFile(reportPath, '# 初次生成\n')
    })
    const options = createOptions(api, {
      reportUploadRecoveryStore,
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd: workspaceDir, reportPath, imagesDir })),
      runCodex,
      prepareReport,
      uploadReport
    })
    const runtime = new DefaultReviewTaskRuntime(options)

    await expect(runtime.run({
      kind: 'create',
      request: {
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      }
    })).resolves.toMatchObject({
      status: 'uploading_report',
      reportUploadRecovery: {
        failureCode: 'REPORT_IMAGE_INVALID_UTF8',
        assetPaths: ['images/issue-01.svg']
      }
    })
    expect(reportUploadRecoveryStore.save).toHaveBeenCalledWith(recoveryRecord)

    await writeFile(reportPath, '# 解密后重新读取\n')
    await expect(runtime.retryReportUpload('task-created')).resolves.toMatchObject({
      taskId: 'task-created',
      status: 'success',
      reportMarkdown: '# 解密后重新读取\n',
      reportPath
    })

    expect(uploadReport).toHaveBeenLastCalledWith(
      'token-123',
      'task-created',
      reportPath,
      '# 解密后重新读取\n'
    )
    expect(options.syncSkill).toHaveBeenCalledTimes(1)
    expect(options.checkEnvironment).toHaveBeenCalledTimes(1)
    expect(options.prepareWorkspace).toHaveBeenCalledTimes(1)
    expect(runCodex).toHaveBeenCalledTimes(1)
    expect(reportUploadRecoveryStore.remove).toHaveBeenCalledWith('task-created')
  })

  it('原地解密 IPGSD 候选后重新读取并上传真实 SVG 与问题快照', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'review-runtime-real-svg-retry-'))
    tempDirs.push(workspaceDir)
    const reportPath = join(workspaceDir, '代码审查报告.md')
    const imagesDir = join(workspaceDir, 'images')
    const imagePath = join(imagesDir, 'issue.svg.IPGSD')
    const safeSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    )
    await mkdir(imagesDir)
    await writeFile(
      reportPath,
      '### 1. 解密后图片\n\n- **问题描述：** 验证重新读取。\n\n![证据](images/issue.svg)\n'
    )
    await writeFile(imagePath, safeSvg)
    const record = {
      taskId: 'task-real-svg-retry',
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => ({ status: 'ready' as const, record })),
      remove: vi.fn(async () => undefined)
    }
    const api = createApi({
      uploadReport: vi.fn(async () => ({ ok: true }))
    })
    const runtime = new DefaultReviewTaskRuntime(createOptions(api, {
      reportUploadRecoveryStore,
      prepareReport: undefined,
      uploadReport: undefined
    }))

    await expect(runtime.retryReportUpload(record.taskId)).resolves.toMatchObject({
      status: 'success',
      reportPath
    })
    expect(api.uploadReport).toHaveBeenCalledWith(
      'token-123',
      record.taskId,
      expect.objectContaining({
        report_content: expect.stringContaining('images/issue.svg'),
        issues: [expect.objectContaining({ issue_text: '解密后图片' })],
        assets: [{
          relative_path: 'images/issue.svg',
          content: safeSvg,
          content_type: 'image/svg+xml'
        }]
      })
    )
  })

  it('重复点击共享同一次重检且再次命中非 UTF-8 时保持可恢复', async () => {
    const record = {
      taskId: 'task-still-encrypted',
      reportPath: '/trusted/report.md',
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => ({ status: 'ready' as const, record })),
      remove: vi.fn(async () => undefined)
    }
    const deferred = createDeferred<never>()
    const uploadReport = vi.fn(async () => deferred.promise)
    const api = createApi()
    const runtime = new DefaultReviewTaskRuntime(createOptions(api, {
      reportUploadRecoveryStore,
      prepareReport: vi.fn(async () => '# 报告\n'),
      uploadReport
    }))

    const first = runtime.retryReportUpload(record.taskId)
    const second = runtime.retryReportUpload(record.taskId)
    expect(first).toBe(second)
    await vi.waitFor(() => expect(uploadReport).toHaveBeenCalledTimes(1))
    deferred.reject(new ReportUploadRecoveryError(['images/issue.svg']))

    await expect(first).resolves.toMatchObject({
      status: 'uploading_report',
      reportUploadRecovery: {
        failureCode: 'REPORT_IMAGE_INVALID_UTF8',
        availability: 'ready'
      }
    })
    await expect(second).resolves.toMatchObject({ status: 'uploading_report' })
    expect(reportUploadRecoveryStore.save).toHaveBeenCalledWith(record)
    expect(api.updateTaskStatus).toHaveBeenCalledWith('token-123', record.taskId, {
      status: 'uploading_report',
      error_message: '图片可能被 IPGSD 加密，请解密后重试',
      report_upload_failure_code: 'REPORT_IMAGE_INVALID_UTF8'
    })
  })

  it('上传响应丢失时回查成功状态并清除恢复记录', async () => {
    const record = {
      taskId: 'task-response-lost',
      reportPath: '/trusted/report.md',
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => ({ status: 'ready' as const, record })),
      remove: vi.fn(async () => undefined)
    }
    const api = createApi({
      readTask: vi.fn(async (_token, taskId) => makeTask(taskId, { status: 'success' }))
    })
    const runtime = new DefaultReviewTaskRuntime(createOptions(api, {
      reportUploadRecoveryStore,
      prepareReport: vi.fn(async () => '# 报告\n'),
      uploadReport: vi.fn(async () => {
        throw new Error('上传响应丢失')
      })
    }))

    await expect(runtime.retryReportUpload(record.taskId)).resolves.toMatchObject({
      taskId: record.taskId,
      status: 'success',
      reportPath: record.reportPath
    })
    expect(reportUploadRecoveryStore.remove).toHaveBeenCalledWith(record.taskId)
    expect(api.updateTaskStatus).not.toHaveBeenCalled()
  })

  it('服务端有原因码但本机无恢复记录时明确标记为其他客户端', async () => {
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => null),
      remove: vi.fn(async () => undefined)
    }
    const runtime = new DefaultReviewTaskRuntime(createOptions(createApi(), {
      reportUploadRecoveryStore
    }))

    await expect(runtime.getReportUploadRecovery(
      'task-other-client',
      'REPORT_IMAGE_INVALID_UTF8'
    )).resolves.toEqual({
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      stage: 'uploading_report',
      assetPaths: [],
      availability: 'other_client'
    })
    await expect(runtime.retryReportUpload('task-other-client')).resolves.toMatchObject({
      status: 'uploading_report',
      reportUploadRecovery: { availability: 'other_client' }
    })
  })

  it('同一进程每次查询恢复状态都重新校验 Store', async () => {
    const record = {
      taskId: 'task-revalidate',
      reportPath: '/trusted/report.md',
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn()
        .mockResolvedValueOnce({ status: 'ready' as const, record })
        .mockResolvedValueOnce({
          status: 'source_missing' as const,
          assetPaths: record.assetPaths
        }),
      remove: vi.fn(async () => undefined)
    }
    const runtime = new DefaultReviewTaskRuntime(createOptions(createApi(), {
      reportUploadRecoveryStore
    }))

    await expect(runtime.getReportUploadRecovery(
      record.taskId,
      'REPORT_IMAGE_INVALID_UTF8'
    )).resolves.toMatchObject({ availability: 'ready' })
    await expect(runtime.getReportUploadRecovery(
      record.taskId,
      'REPORT_IMAGE_INVALID_UTF8'
    )).resolves.toMatchObject({ availability: 'source_missing' })
    expect(reportUploadRecoveryStore.load).toHaveBeenCalledTimes(2)
  })

  it('普通重检错误写服务端前隐藏 token 和绝对路径', async () => {
    const record = {
      taskId: 'task-sanitized-error',
      reportPath: '/trusted/report.md',
      failureCode: 'REPORT_IMAGE_INVALID_UTF8' as const,
      assetPaths: ['images/issue.svg']
    }
    const reportUploadRecoveryStore = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => ({ status: 'ready' as const, record })),
      remove: vi.fn(async () => undefined)
    }
    const api = createApi({
      readTask: vi.fn(async (_token, taskId) => makeTask(taskId, { status: 'uploading_report' }))
    })
    const runtime = new DefaultReviewTaskRuntime(createOptions(api, {
      reportUploadRecoveryStore,
      prepareReport: vi.fn(async () => {
        throw new Error('token token-123 report /private/workspace/report.md')
      })
    }))

    await expect(runtime.retryReportUpload(record.taskId)).rejects.toThrow('[路径已隐藏]')
    expect(api.updateTaskStatus).toHaveBeenCalledWith('token-123', record.taskId, {
      status: 'failed',
      error_message: expect.stringContaining('[路径已隐藏]')
    })
    const payload = vi.mocked(api.updateTaskStatus).mock.calls.at(-1)?.[2]
    expect(JSON.stringify(payload)).not.toContain('token-123')
    expect(JSON.stringify(payload)).not.toContain('/private/workspace/report.md')
  })
})
