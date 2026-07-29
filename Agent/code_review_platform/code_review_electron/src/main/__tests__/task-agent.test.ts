import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CODEX_REVIEW_TIMEOUT_MS,
  defaultPrepareWorkspace,
  executeReviewTask,
  prepareRequirementFile,
  retryReviewTask,
  type TaskAgentDependencies
} from '../task-agent'
import { SvnPreflightError } from '../svn-preflight'
import type { ReviewTask } from '../../shared/types'

const request = {
  svn_url: 'svn://repo/project',
  old_revision: '12',
  new_revision: '14',
  template_key: 'template_2' as const,
  skill_name: '通用-代码审查-模版二'
}

const makeTask = (overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id: 'task-1',
  svn_url: request.svn_url,
  old_revision: request.old_revision,
  new_revision: request.new_revision,
  status: 'created',
  ...overrides
})

const withPdfDependencies = (
  dependencies: Omit<
    TaskAgentDependencies,
    | 'preflightSvn'
    | 'prepareReport'
    | 'generatePdfReport'
    | 'uploadPdfReport'
    | 'uploadRequirementFile'
  > &
    Partial<
      Pick<
        TaskAgentDependencies,
        | 'preflightSvn'
        | 'prepareReport'
        | 'generatePdfReport'
        | 'uploadPdfReport'
        | 'uploadRequirementFile'
      >
    >
): TaskAgentDependencies => ({
  preflightSvn: vi.fn(),
  prepareReport: vi.fn(async (reportPath: string) => readFile(reportPath, 'utf8')),
  generatePdfReport: vi.fn(async (reportPath: string) => ({
    status: 'ready' as const,
    reportPath,
    pdfPath: reportPath.replace(/\.md$/i, '.pdf')
  })),
  uploadRequirementFile: vi.fn(),
  uploadPdfReport: vi.fn(),
  ...dependencies
})

describe('executeReviewTask', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('Codex 审查默认超时时间为 60 分钟', () => {
    expect(CODEX_REVIEW_TIMEOUT_MS).toBe(60 * 60 * 1000)
  })

  it('prepares the default workspace with a dynamic report file name from task revisions', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => '/tmp/code_review_electron')
      }
    }))
    const { defaultPrepareWorkspace } = await import('../task-agent')

    const workspace = await defaultPrepareWorkspace({
      taskId: 'task-dynamic-report',
      svnCommand: '/fake/bin/svn',
      svnUrl: 'svn://repo/project',
      oldRevision: 'r12',
      newRevision: '14',
      generatedAt: new Date(2026, 5, 10, 14, 25, 30),
      runSvnLog: vi.fn(async () => '<log><logentry revision="14"><msg>代码：P16S100A-41662-1.30-000</msg></logentry></log>')
    })

    expect(workspace.reportPath).toBe(
      join(
        '/tmp/code_review_electron',
        '.runtime-data',
        'workspaces',
        'task-dynamic-report',
        'P16S100A-41662-1.30-000_审查报告.md'
      )
    )
  })

  it('marks task as environment_error and skips codex/upload when SVN CLI is missing', async () => {
    const calls: string[] = []
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => {
          calls.push('createTask')
          return makeTask()
        }),
        updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
          calls.push(`status:${payload.status}`)
        })
      },
      checkEnvironment: vi.fn(async () => {
        calls.push('checkEnvironment')
        return { status: 'missing_svn' as const }
      }),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })

    const result = await executeReviewTask({ token: 'token-123', request }, dependencies)

    expect(result).toEqual({ taskId: 'task-1', status: 'environment_error' })
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'environment_error',
      error_message: '本机 SVN CLI 不可用，请联系管理员处理。'
    })
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(calls).toEqual([
      'createTask',
      'status:checking_environment',
      'checkEnvironment',
      'status:environment_error'
    ])
  })

  it('runs codex, uploads the report, and returns markdown after the environment is ready', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const pdfPath = join(cwd, '代码审查报告.pdf')
    const imagesDir = join(cwd, 'images')
    const calls: string[] = []
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => {
          calls.push('createTask')
          return makeTask({ department_name: '软件开发部' })
        }),
        updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
          calls.push(`status:${payload.status}`)
        })
      },
      checkEnvironment: vi.fn(async () => {
        calls.push('checkEnvironment')
        return { status: 'ready' as const, svnPath: '/fake/bin/svn' }
      }),
      preflightSvn: vi.fn(async () => {
        calls.push('preflight')
      }),
      prepareWorkspace: vi.fn(async () => {
        calls.push('prepareWorkspace')
        return {
          cwd,
          reportPath,
          imagesDir,
          requirementFilePath: join(cwd, 'requirements', '产品开发需求表.xls')
        }
      }),
      runCodex: vi.fn(async () => {
        calls.push('runCodex')
        await writeFile(reportPath, '# report\n')
      }),
      generatePdfReport: vi.fn(async () => {
        calls.push('generatePdfReport')
        await writeFile(pdfPath, '%PDF-1.4\n')
        return { status: 'ready' as const, reportPath, pdfPath }
      }),
      uploadRequirementFile: vi.fn(async () => {
        calls.push('uploadRequirementFile')
      }),
      uploadReport: vi.fn(async () => {
        calls.push('uploadReport')
      }),
      uploadPdfReport: vi.fn(async () => {
        calls.push('uploadPdfReport')
      })
    })

    const result = await executeReviewTask({ token: 'token-123', request }, dependencies)

    expect(result).toEqual({
      taskId: 'task-1',
      status: 'success',
      reportMarkdown: '# report\n',
      reportPath,
      pdfPath,
      pdfReportName: basename(pdfPath)
    })
    expect(dependencies.runCodex).toHaveBeenCalledWith({
      cwd,
      reportPath,
      imagesDir,
      requirementFilePath: join(cwd, 'requirements', '产品开发需求表.xls'),
      skillName: '通用-代码审查-模版二',
      task: makeTask({ department_name: '软件开发部' }),
      clientTaskId: undefined,
      signal: undefined,
      onProgress: undefined
    })
    expect(dependencies.generatePdfReport).toHaveBeenCalledWith(reportPath)
    expect(dependencies.uploadRequirementFile).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      join(cwd, 'requirements', '产品开发需求表.xls')
    )
    expect(dependencies.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      reportPath,
      '# report\n'
    )
    expect(dependencies.uploadPdfReport).toHaveBeenCalledWith('token-123', 'task-1', pdfPath)
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith({
      taskId: 'task-1',
      svnUrl: 'svn://repo/project',
      oldRevision: '12',
      newRevision: '14',
      svnCommand: '/fake/bin/svn'
    })
    expect(calls).toEqual([
      'createTask',
      'status:checking_environment',
      'checkEnvironment',
      'preflight',
      'prepareWorkspace',
      'uploadRequirementFile',
      'status:running_codex',
      'runCodex',
      'status:uploading_report',
      'generatePdfReport',
      'uploadReport',
      'uploadPdfReport'
    ])
    expect(dependencies.api.updateTaskStatus).not.toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        status: 'success',
        report_path: reportPath
      })
    )
  })

  it('在生成 PDF 前清理报告输出元数据并返回稳定的原始 Markdown', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-report-metadata-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const pdfPath = join(cwd, '代码审查报告.pdf')
    const imagesDir = join(cwd, 'images')
    const originalReport = [
      '# 代码审查报告',
      '**报告输出路径：** C:\\review\\代码审查报告.md',
      '问题涉及普通路径：`src/main.c:42`',
      ''
    ].join('\n')
    const cleanedReport = ['# 代码审查报告', '问题涉及普通路径：`src/main.c:42`', ''].join('\n')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, originalReport)
      }),
      prepareReport: vi.fn(async () => {
        await writeFile(reportPath, cleanedReport)
        return cleanedReport
      }),
      generatePdfReport: vi.fn(async () => {
        await expect(readFile(reportPath, 'utf8')).resolves.toBe(cleanedReport)
        await writeFile(pdfPath, '%PDF-1.4\n')
        return { status: 'ready' as const, reportPath, pdfPath }
      }),
      uploadReport: vi.fn(async () => {
        await expect(readFile(reportPath, 'utf8')).resolves.toBe(cleanedReport)
      }),
      uploadPdfReport: vi.fn()
    })

    const result = await executeReviewTask({ token: 'token-123', request }, dependencies)

    expect(result.reportMarkdown).toBe(cleanedReport)
    expect(dependencies.prepareReport).toHaveBeenCalledWith(reportPath)
    expect(dependencies.prepareReport).toHaveBeenCalledTimes(1)
    await expect(readFile(reportPath, 'utf8')).resolves.toBe(cleanedReport)
  })

  it('在工作区准备前使用环境探测到的命令执行 SVN 预检', async () => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({
        status: 'ready' as const,
        svnPath: '/opt/company/bin/svn'
      })),
      prepareWorkspace: vi.fn(async () => {
        throw new Error('顺序断言完成后停止')
      }),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })
    const events: string[] = []

    await expect(
      executeReviewTask({ token: 'token-123', request }, dependencies, (event) => {
        if (event.type === 'stage') events.push(`${event.stage}:${event.message}`)
      })
    ).rejects.toThrow('顺序断言完成后停止')

    expect(dependencies.preflightSvn).toHaveBeenCalledWith({
      svnUrl: request.svn_url,
      oldRevision: request.old_revision,
      newRevision: request.new_revision,
      svnCommand: '/opt/company/bin/svn',
      commandOptions: expect.objectContaining({
        env: expect.objectContaining({ PATH: expect.any(String) }),
        shell: false,
        windowsHide: true
      }),
      signal: undefined
    })
    expect(vi.mocked(dependencies.preflightSvn).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dependencies.prepareWorkspace).mock.invocationCallOrder[0]
    )
    expect(events).toContain('checking_environment:校验 SVN 地址和版本')
  })

  it.each([
    ['NEW_REVISION_UNAVAILABLE', '新版本 14 在该 SVN 地址下不存在或不可访问。'],
    ['OLD_REVISION_UNAVAILABLE', '旧版本 12 在该 SVN 地址下不存在或不可访问。'],
    ['AUTHENTICATION_FAILED', 'SVN 认证失败，请先在本机 SVN 客户端更新登录凭据。'],
    ['PERMISSION_DENIED', '当前 SVN 账号无权访问该地址或版本，请联系管理员开通权限。'],
    ['NETWORK_FAILED', '无法连接 SVN 服务，请检查网络后重试。'],
    ['TIMEOUT', 'SVN 地址或版本校验超时，请检查网络后重试。'],
    ['CLI_START_FAILED', 'SVN CLI 启动失败，请联系管理员处理。'],
    ['INVALID_ARGUMENT', 'SVN 地址或版本参数无效，请检查后重试。'],
    ['INVALID_REVISION_ORDER', 'SVN 新旧版本范围无效，请确保旧版本小于新版本。']
  ] as const)('预检错误 %s 使用固定用户消息并短路后续步骤', async (code, expectedMessage) => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(async () => {
        throw new SvnPreflightError(code)
      }),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      generatePdfReport: vi.fn(),
      uploadRequirementFile: vi.fn(),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
      expectedMessage
    )

    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'failed',
      error_message: expectedMessage
    })
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
  })

  it('环境 ready 但缺少 svnPath 时失败且不执行预检和后续步骤', async () => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      generatePdfReport: vi.fn(),
      uploadRequirementFile: vi.fn(),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
      '环境检查已通过但未返回 SVN CLI 路径'
    )
    expect(dependencies.preflightSvn).not.toHaveBeenCalled()
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
  })

  it('重试反向历史版本任务时由预检拒绝且不准备工作区', async () => {
    const reverseTask = makeTask({
      id: 'task-reverse',
      old_revision: '20',
      new_revision: '10',
      skill_name: request.skill_name,
      status: 'failed'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(),
        readTask: vi.fn(async () => reverseTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(async () => {
        throw new SvnPreflightError('INVALID_REVISION_ORDER')
      }),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })

    await expect(
      retryReviewTask({ token: 'token-123', taskId: reverseTask.id }, dependencies)
    ).rejects.toThrow('SVN 新旧版本范围无效，请确保旧版本小于新版本。')

    expect(dependencies.preflightSvn).toHaveBeenCalledWith(
      expect.objectContaining({ oldRevision: '20', newRevision: '10' })
    )
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
  })

  it('预检期间取消时返回 cancelled 且不执行任何后续步骤', async () => {
    const controller = new AbortController()
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(async () => {
        controller.abort()
        throw new SvnPreflightError('CANCELLED')
      }),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      generatePdfReport: vi.fn(),
      uploadRequirementFile: vi.fn(),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request, signal: controller.signal }, dependencies)
    ).resolves.toEqual({ taskId: 'task-1', status: 'cancelled' })
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
  })

  it('retries an existing failed task without creating a new review task', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-retry-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const pdfPath = join(cwd, '代码审查报告.pdf')
    const imagesDir = join(cwd, 'images')
    const calls: string[] = []
    const failedTask = makeTask({
      id: 'task-retry',
      status: 'failed',
      error_message: 'Codex 执行失败',
      skill_name: '通用-代码审查-模版二'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => {
          throw new Error('不应该新建任务')
        }),
        readTask: vi.fn(async () => failedTask),
        updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
          calls.push(`status:${payload.status}`)
        })
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(async () => {
        calls.push('preflight')
      }),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# retry report\n')
      }),
      generatePdfReport: vi.fn(async () => {
        await writeFile(pdfPath, '%PDF-1.4\n')
        return { status: 'ready' as const, reportPath, pdfPath }
      }),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    const result = await retryReviewTask(
      {
        token: 'token-123',
        taskId: 'task-retry',
        clientTaskId: 'task-retry',
        requirementFilePath: '/tmp/产品开发需求表.xls'
      },
      dependencies
    )

    expect(result).toMatchObject({
      taskId: 'task-retry',
      status: 'success',
      reportMarkdown: '# retry report\n'
    })
    expect(dependencies.api.createTask).not.toHaveBeenCalled()
    expect(dependencies.api.readTask).toHaveBeenCalledWith('token-123', 'task-retry')
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith({
      taskId: 'task-retry',
      svnUrl: 'svn://repo/project',
      oldRevision: '12',
      newRevision: '14',
      svnCommand: '/fake/bin/svn',
      requirementFilePath: '/tmp/产品开发需求表.xls'
    })
    expect(calls).toEqual([
      'status:checking_environment',
      'preflight',
      'status:running_codex',
      'status:uploading_report'
    ])
  })

  it('marks task failed when PDF generation fails after markdown is ready', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-pdf-fail-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# report\n')
      }),
      generatePdfReport: vi.fn(async () => {
        throw new Error('PDF报告生成失败：报告图片不存在')
      }),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
      'PDF报告生成失败'
    )

    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('PDF报告生成失败')
      })
    )
  })

  it('取消信号触发后标记任务为已取消且不上传报告', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-cancel-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const controller = new AbortController()
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# 不应上传\n')
        controller.abort()
      }),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask(
        { token: 'token-123', request, signal: controller.signal },
        dependencies
      )
    ).resolves.toEqual({
      taskId: 'task-1',
      status: 'cancelled'
    })

    expect(dependencies.uploadReport).not.toHaveBeenCalled()
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'cancelled',
      error_message: '任务已取消'
    })
  })

  it('emits task progress events around environment, workspace, Codex, and upload stages', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const events: string[] = []
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async ({ onProgress }) => {
        onProgress?.({
          taskId: 'task-1',
          type: 'codex_output',
          stream: 'stdout',
          message: '读取 Skill\n'
        })
        await writeFile(reportPath, '# report\n')
      }),
      uploadReport: vi.fn()
    })

    await executeReviewTask(
      { token: 'token-123', request, clientTaskId: 'local-task-1' },
      dependencies,
      (event) => {
        const detail = event.type === 'stage' ? event.stage : event.stream
        events.push(`${event.clientTaskId}:${event.taskId}:${event.type}:${detail}:${event.message}`)
      }
    )

    expect(events).toEqual([
      'local-task-1:task-1:stage:created:任务已创建',
      'local-task-1:task-1:stage:checking_environment:检查本机环境',
      'local-task-1:task-1:stage:checking_environment:校验 SVN 地址和版本',
      'local-task-1:task-1:stage:preparing_workspace:准备任务工作区',
      'local-task-1:task-1:stage:running_codex:启动 Codex 执行审查 Skill',
      'local-task-1:task-1:codex_output:stdout:读取 Skill\n',
      'local-task-1:task-1:stage:uploading_report:上传审查报告',
      'local-task-1:task-1:stage:success:审查完成'
    ])
  })

  it('continues review when requirement file archive fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-requirement-upload-fail-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const pdfPath = join(cwd, '代码审查报告.pdf')
    const imagesDir = join(cwd, 'images')
    const events: string[] = []
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({
        cwd,
        reportPath,
        imagesDir,
        requirementFilePath: join(cwd, 'requirements', '产品开发需求表.xls')
      })),
      uploadRequirementFile: vi.fn(async () => {
        throw new Error('服务端不可用')
      }),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# report\n')
      }),
      generatePdfReport: vi.fn(async () => {
        await writeFile(pdfPath, '%PDF-1.4\n')
        return { status: 'ready' as const, reportPath, pdfPath }
      }),
      uploadReport: vi.fn(),
      uploadPdfReport: vi.fn()
    })

    const result = await executeReviewTask(
      { token: 'token-123', request, clientTaskId: 'local-task-1' },
      dependencies,
      (event) => {
        if (event.type === 'stage') {
          events.push(`${event.stage}:${event.message}`)
        }
      }
    )

    expect(result.status).toBe('success')
    expect(dependencies.runCodex).toHaveBeenCalled()
    expect(events).toContain('preparing_workspace:产品开发需求表归档失败，审查将继续执行。')
  })

  it('marks task as failed with a sanitized summary when codex throws', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        throw new Error(`failure using token secret-token at ${cwd}`)
      }),
      uploadReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'secret-token', request }, dependencies)).rejects.toThrow(
      'failure using token [redacted]'
    )

    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('secret-token', 'task-1', {
      status: 'failed',
      error_message: expect.not.stringContaining('secret-token')
    })
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('secret-token', 'task-1', {
      status: 'failed',
      error_message: expect.not.stringContaining(cwd)
    })
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
  })

  it('maps common Codex infrastructure failures to business friendly messages', async () => {
    const cases = [
      {
        raw: 'Codex review timed out after 3600000ms',
        expected: 'Codex 审查超过 60 分钟仍未完成，请稍后重试或联系管理员。'
      },
      {
        raw: '审查报告不存在：[路径已隐藏]',
        expected: 'SVN权限不足（或者SVN账号未登录）'
      },
      {
        raw: 'Codex review failed with exit code 1: Reading failed\nstderr: 任意 Codex 输出内容都会变化',
        expected: 'Codex报错请检查Codex对话后重试。'
      }
    ]

    for (const item of cases) {
      const cwd = await mkdtemp(join(tmpdir(), 'task-agent-friendly-error-'))
      tempDirs.push(cwd)
      const reportPath = join(cwd, '代码审查报告.md')
      const imagesDir = join(cwd, 'images')
      const dependencies: TaskAgentDependencies = withPdfDependencies({
        api: {
          createTask: vi.fn(async () => makeTask()),
          updateTaskStatus: vi.fn(async () => undefined)
        },
        checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
        prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
        runCodex: vi.fn(async () => {
          throw new Error(item.raw)
        }),
        uploadReport: vi.fn()
      })

      await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
        item.expected
      )

      expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
        status: 'failed',
        error_message: item.expected
      })
    }
  })

  it('redacts secret-like values from codex failure summaries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        throw new Error('failed with password=hunter2 access_token: abc Bearer xyz')
      }),
      uploadReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
      'failed with password= [redacted]'
    )

    const lastStatus = vi.mocked(dependencies.api.updateTaskStatus).mock.calls.at(-1)?.[2]

    expect(lastStatus?.error_message).toContain('[redacted]')
    expect(lastStatus?.error_message).not.toContain('hunter2')
    expect(lastStatus?.error_message).not.toContain('abc')
    expect(lastStatus?.error_message).not.toContain('xyz')
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
  })

  it('fails and reports failed status when no review template Skill is selected', async () => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () =>
          makeTask({
            skill_name: undefined,
            template_key: undefined
          })
        ),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })

    const requestWithoutSkill = {
      svn_url: request.svn_url,
      old_revision: request.old_revision,
      new_revision: request.new_revision
    }

    await expect(
      executeReviewTask({ token: 'token-123', request: requestWithoutSkill }, dependencies)
    ).rejects.toThrow('未选择审查模板 Skill')

    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'failed',
      error_message: '未选择审查模板 Skill'
    })
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
  })
})

describe('defaultPrepareWorkspace', () => {
  const appRoot = join(tmpdir(), `code-review-app-${Date.now()}`)

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    await rm(appRoot, { recursive: true, force: true })
  })

  it('creates the task workspace under development runtime-data without copying Skill files', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => appRoot)
      }
    }))

    const { defaultPrepareWorkspace } = await import('../task-agent')
    const workspace = await defaultPrepareWorkspace({
      taskId: 'task-runtime-workspace',
      svnCommand: '/fake/bin/svn',
      svnUrl: 'svn://repo/project',
      oldRevision: 'r12',
      newRevision: 'r14',
      generatedAt: new Date(2026, 5, 10, 14, 25, 30),
      runSvnLog: vi.fn(async () => '<log><logentry revision="14"><msg>代码：P16S100A-41662-1.30-000</msg></logentry></log>')
    })

    expect(workspace).toEqual({
      cwd: join(appRoot, '.runtime-data', 'workspaces', 'task-runtime-workspace'),
      reportPath: join(
        appRoot,
        '.runtime-data',
        'workspaces',
        'task-runtime-workspace',
        'P16S100A-41662-1.30-000_审查报告.md'
      ),
      codexLogPath: join(
        appRoot,
        '.runtime-data',
        'workspaces',
        'task-runtime-workspace',
        'codex-review.log'
      ),
      imagesDir: join(appRoot, '.runtime-data', 'workspaces', 'task-runtime-workspace', 'images')
    })
    await expect(
      readFile(join(workspace.cwd, 'skills', '??-??????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(join(workspace.cwd, 'skills', '???-?????????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
  })

  it('copies requirement Excel into the task workspace', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => appRoot)
      }
    }))
    const sourceDir = await mkdtemp(join(tmpdir(), 'requirement-source-'))
    const sourcePath = join(sourceDir, '产品开发需求表.xlsx')
    await writeFile(sourcePath, 'excel-content')

    const { defaultPrepareWorkspace } = await import('../task-agent')
    const workspace = await defaultPrepareWorkspace({
      taskId: 'task-with-requirement',
      svnCommand: '/fake/bin/svn',
      svnUrl: 'svn://repo/project',
      oldRevision: '12',
      newRevision: '14',
      requirementFilePath: sourcePath
    })

    expect(workspace.requirementFilePath).toBe(
      join(workspace.cwd, 'requirements', '产品开发需求表.xlsx')
    )
    expect(workspace.requirementFilePath).toBeDefined()
    await expect(readFile(workspace.requirementFilePath!, 'utf8')).resolves.toBe('excel-content')
    await rm(sourceDir, { recursive: true, force: true })
  })
})

describe('prepareRequirementFile', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('returns undefined when no requirement file path is provided', async () => {
    const destinationDir = await mkdtemp(join(tmpdir(), 'requirement-target-'))
    tempDirs.push(destinationDir)

    await expect(prepareRequirementFile(undefined, destinationDir)).resolves.toBeUndefined()
    await expect(prepareRequirementFile('   ', destinationDir)).resolves.toBeUndefined()
  })

  it('rejects non-Excel requirement files with a Chinese message', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'requirement-source-'))
    const destinationDir = await mkdtemp(join(tmpdir(), 'requirement-target-'))
    tempDirs.push(sourceDir, destinationDir)
    const sourcePath = join(sourceDir, '需求.txt')
    await writeFile(sourcePath, 'text')

    await expect(prepareRequirementFile(sourcePath, destinationDir)).rejects.toThrow(
      '产品开发需求表仅支持 .xls 或 .xlsx 文件。'
    )
  })
})
