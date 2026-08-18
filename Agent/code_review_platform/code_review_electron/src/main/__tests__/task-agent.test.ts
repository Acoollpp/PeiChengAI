import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
import { CodexReviewError } from '../codex-runner'
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

const createDeferred = <T,>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

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

  it('内置 CodeGraph 异常只阻止新任务进入 Codex 并保留明确重装提示', async () => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({
        status: 'failed' as const,
        codegraphStatus: 'corrupt' as const,
        codegraphRequiredVersion: '1.4.1',
        codegraphVersion: '1.4.1',
        codegraphPath:
          'C:\\Program Files\\AI代码审查客户端\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd',
        codegraphError: '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
      })),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request }, dependencies)
    ).resolves.toEqual({ taskId: 'task-1', status: 'environment_error' })
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'environment_error',
      error_message: '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
    })
    expect(dependencies.prepareWorkspace).not.toHaveBeenCalled()
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
  })

  it('把工作区的证据目录透传给 Codex', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-evidence-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const evidenceDir = join(cwd, 'e', '6fcddf8b')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn()
      } as unknown as TaskAgentDependencies['api'],
      checkEnvironment: vi.fn(async () => ({
        status: 'ready' as const,
        svnPath: '/fake/bin/svn'
      })),
      prepareWorkspace: vi.fn(async () => ({
        cwd,
        reportPath,
        imagesDir: join(cwd, 'images'),
        evidenceDir
      })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# report\n')
      }),
      uploadReport: vi.fn(async () => ({}))
    })

    await executeReviewTask({ token: 'token-123', request }, dependencies)

    expect(dependencies.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceDir })
    )
  })

  it('环境就绪后只上传原始Markdown并透传服务端反馈协议', async () => {
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
        return makeTask({
          status: 'success',
          feedback_protocol_version: 1,
          issue_count: 2,
          highest_issue_severity: 'high'
        })
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
      feedbackProtocolVersion: 1,
      serverTask: makeTask({
        status: 'success',
        feedback_protocol_version: 1,
        issue_count: 2,
        highest_issue_severity: 'high'
      })
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
    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
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
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
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
      'uploadReport'
    ])
    expect(dependencies.api.updateTaskStatus).not.toHaveBeenCalledWith(
      'token-123',
      'task-1',
      expect.objectContaining({
        status: 'success',
        report_path: reportPath
      })
    )

    vi.mocked(dependencies.uploadReport).mockResolvedValueOnce({
      feedback_protocol_version: null
    })
    const resultWithoutTaskSnapshot = await executeReviewTask(
      { token: 'token-123', request },
      dependencies
    )
    expect(resultWithoutTaskSnapshot).toMatchObject({
      taskId: 'task-1',
      status: 'success',
      feedbackProtocolVersion: null
    })
    expect(resultWithoutTaskSnapshot).not.toHaveProperty('serverTask')
  })

  it('DS-03 结构化任务贯通创建、预检、Codex 和报告上传且原样透传 0', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-ds03-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'DS-03_审查报告.md')
    const imagesDir = join(cwd, 'images')
    const ds03Request = {
      svn_url: 'svn://repo/ds03',
      old_revision: '0',
      new_revision: 'r30',
      review_items: [
        {
          id: 'DS-03',
          user_extra_rules: '重点检查休眠唤醒状态'
        }
      ]
    }
    const serverTask = makeTask({
      svn_url: ds03Request.svn_url,
      old_revision: '0',
      new_revision: ds03Request.new_revision,
      department_name: '软件开发部',
      review_item_ids: ['DS-03'],
      skill_name: 'bms-code-reviewer'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => serverTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# DS-03 report\n')
      }),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request: ds03Request }, dependencies)
    ).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'success',
      reportMarkdown: '# DS-03 report\n'
    })

    expect(dependencies.api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: ds03Request.svn_url,
      old_revision: ds03Request.old_revision,
      new_revision: ds03Request.new_revision,
      skill_name: 'bms-code-reviewer',
      review_item_ids: ['DS-03']
    })
    expect(dependencies.preflightSvn).toHaveBeenCalled()
    expect(dependencies.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        task: serverTask,
        skillName: 'bms-code-reviewer',
        reviewItems: [
          {
            id: 'DS-03',
            name: 'MOS 充放电状态机审查',
            user_extra_rules: '重点检查休眠唤醒状态',
            materials: []
          }
        ],
        oldRevision: '0',
        newRevision: 'r30',
        reportPath
      })
    )
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).toHaveBeenCalledWith(
      'token-123',
      'task-1',
      reportPath,
      '# DS-03 report\n'
    )
  })

  it('DS-02 单选只向服务端发送 ID，并把原始 revision 和空材料输入交给 Codex', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-ds02-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'DS-02_审查报告.md')
    const imagesDir = join(cwd, 'images')
    const ds02Request = {
      svn_url: 'svn://repo/ds02',
      old_revision: 'r0',
      new_revision: 'R42',
      review_items: [{
        id: 'DS-02',
        user_extra_rules: '只检查本次新增诊断代码'
      }]
    }
    const serverTask = makeTask({
      svn_url: ds02Request.svn_url,
      old_revision: ds02Request.old_revision,
      new_revision: ds02Request.new_revision,
      review_item_ids: ['DS-02'],
      skill_name: 'bms-code-reviewer'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => serverTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# DS-02 report\n')
      }),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request: ds02Request }, dependencies)
    ).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'success',
      reportMarkdown: '# DS-02 report\n'
    })

    expect(dependencies.api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: ds02Request.svn_url,
      old_revision: 'r0',
      new_revision: 'R42',
      skill_name: 'bms-code-reviewer',
      review_item_ids: ['DS-02']
    })
    expect(dependencies.preflightSvn).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: 'r0',
      newRevision: 'R42'
    }))
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: 'r0',
      newRevision: 'R42',
      reviewItems: [{
        id: 'DS-02',
        name: '编码规范审查',
        user_extra_rules: '只检查本次新增诊断代码',
        materials: []
      }]
    }))
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: 'r0',
      newRevision: 'R42',
      reviewItems: [{
        id: 'DS-02',
        name: '编码规范审查',
        user_extra_rules: '只检查本次新增诊断代码',
        materials: []
      }]
    }))
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
  })

  it('DS-01 只把工作区材料交给 Codex，服务端创建与旧需求表上传均不接收材料', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-ds01-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'DS-01_审查报告.md')
    const imagesDir = join(cwd, 'images')
    const requirementSource = '/local/source/产品开发需求表.xlsx'
    const legacyRequirementSource = '/legacy/source/不得上传的需求表.xlsx'
    const request = {
      svn_url: 'svn://repo/ds01',
      old_revision: '120',
      new_revision: '130',
      requirement_file_path: legacyRequirementSource,
      requirement_file_name: '不得发送到服务端.xlsx',
      review_items: [{
        id: 'DS-01',
        user_extra_rules: '仅核对协议导入',
        materials: [
          { field_id: 'requirement-sheet', file_paths: [requirementSource] }
        ]
      }]
    }
    const serverTask = makeTask({
      svn_url: request.svn_url,
      old_revision: request.old_revision,
      new_revision: request.new_revision,
      review_item_ids: ['DS-01'],
      skill_name: 'bms-code-reviewer'
    })
    const requirementCopy = join(cwd, 'materials', 'DS-01', 'requirement-sheet', '产品开发需求表.xlsx')
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => serverTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async (
        input: Parameters<TaskAgentDependencies['prepareWorkspace']>[0]
      ) => ({
        cwd,
        reportPath,
        imagesDir,
        reviewItems: input.reviewItems?.map((item) => ({
          ...item,
          materials: item.materials.map((material) => ({
            ...material,
            filePaths: [requirementCopy]
          }))
        }))
      })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# DS-01 report\n')
      }),
      uploadReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).resolves.toMatchObject({
      taskId: 'task-1', status: 'success'
    })

    expect(dependencies.api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: request.svn_url,
      old_revision: request.old_revision,
      new_revision: request.new_revision,
      skill_name: 'bms-code-reviewer',
      review_item_ids: ['DS-01']
    })
    expect(JSON.stringify(vi.mocked(dependencies.api.createTask).mock.calls)).not.toContain('/local/source')
    expect(JSON.stringify(vi.mocked(dependencies.api.createTask).mock.calls)).not.toContain('/legacy/source')
    expect(JSON.stringify(vi.mocked(dependencies.api.createTask).mock.calls)).not.toContain('不得发送到服务端.xlsx')
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      reviewItems: [expect.objectContaining({
        id: 'DS-01',
        materials: [
          expect.objectContaining({ fieldId: 'requirement-sheet', filePaths: [requirementSource] })
        ]
      })]
    }))
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      reviewItems: [expect.objectContaining({
        id: 'DS-01',
        user_extra_rules: '仅核对协议导入',
        materials: [
          expect.objectContaining({ filePaths: [requirementCopy] })
        ]
      })]
    }))
    expect(JSON.stringify(vi.mocked(dependencies.prepareWorkspace).mock.calls)).not.toContain(legacyRequirementSource)
    expect(JSON.stringify(vi.mocked(dependencies.runCodex).mock.calls)).not.toContain(legacyRequirementSource)
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
  })

  it('DS-01 与 DS-03 组合执行时服务端只接收两个 ID，Codex 接收逐项工作区输入', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-multi-items-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '组合审查报告.md')
    const imagesDir = join(cwd, 'images')
    const requirementSource = '/local/source/组合审查需求表.xlsx'
    const requirementCopy = join(cwd, 'materials', 'DS-01', 'requirement-sheet', '组合审查需求表.xlsx')
    const multiRequest = {
      svn_url: 'svn://repo/multi-items',
      old_revision: '120',
      new_revision: 'R130',
      review_items: [
        {
          id: 'DS-01',
          user_extra_rules: '只核对协议导入',
          materials: [
            { field_id: 'requirement-sheet', file_paths: [requirementSource] }
          ]
        },
        { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
      ]
    }
    const serverTask = makeTask({
      svn_url: multiRequest.svn_url,
      old_revision: multiRequest.old_revision,
      new_revision: multiRequest.new_revision,
      review_item_ids: ['DS-01', 'DS-03'],
      skill_name: 'bms-code-reviewer'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => serverTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async (
        input: Parameters<TaskAgentDependencies['prepareWorkspace']>[0]
      ) => ({
        cwd,
        reportPath,
        imagesDir,
        reviewItems: input.reviewItems?.map((item) => ({
          ...item,
          materials: item.materials.map((material) => ({
            ...material,
            filePaths: [requirementCopy]
          }))
        }))
      })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# DS-01 + DS-03 report\n')
      }),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request: multiRequest }, dependencies)
    ).resolves.toMatchObject({ taskId: 'task-1', status: 'success' })

    expect(dependencies.api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: multiRequest.svn_url,
      old_revision: '120',
      new_revision: 'R130',
      skill_name: 'bms-code-reviewer',
      review_item_ids: ['DS-01', 'DS-03']
    })
    const serverCalls = JSON.stringify(vi.mocked(dependencies.api.createTask).mock.calls)
    expect(serverCalls).not.toContain('只核对协议导入')
    expect(serverCalls).not.toContain('只检查故障恢复状态')
    expect(serverCalls).not.toContain('/local/source')
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: '120',
      newRevision: 'R130',
      reviewItems: [
        expect.objectContaining({
          id: 'DS-01',
          user_extra_rules: '只核对协议导入',
          materials: [
            expect.objectContaining({ filePaths: [requirementCopy] })
          ]
        }),
        {
          id: 'DS-03',
          name: 'MOS 充放电状态机审查',
          user_extra_rules: '只检查故障恢复状态',
          materials: []
        }
      ]
    }))
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
  })

  it('r0 组合任务原样交给 Codex，并展示 Skill 返回的参数错误而不自行降级', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-multi-r0-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '组合参数错误.md')
    const imagesDir = join(cwd, 'images')
    const multiRequest = {
      svn_url: 'svn://repo/multi-r0',
      old_revision: 'r0',
      new_revision: 'R130',
      review_items: [
        {
          id: 'DS-01',
          materials: [
            { field_id: 'requirement-sheet', file_paths: ['/source/requirements.xlsx'] }
          ]
        },
        { id: 'DS-03' }
      ]
    }
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask({
          svn_url: multiRequest.svn_url,
          old_revision: 'r0',
          new_revision: 'r130',
          review_item_ids: ['DS-01', 'DS-03'],
          skill_name: 'bms-code-reviewer'
        })),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async (
        input: Parameters<TaskAgentDependencies['prepareWorkspace']>[0]
      ) => ({
        cwd,
        reportPath,
        imagesDir,
        reviewItems: input.reviewItems?.map((item) => ({
          ...item,
          materials: item.materials.map((material) => ({
            ...material,
            filePaths: [join(cwd, 'materials', item.id, material.fieldId, material.fieldId)]
          }))
        }))
      })),
      runCodex: vi.fn(async () => {
        throw new CodexReviewError('PARAM_ERROR', 'DS-01 要求真实双 revision，旧 revision 不能为 r0。')
      }),
      uploadReport: vi.fn()
    })

    await expect(
      executeReviewTask({ token: 'token-123', request: multiRequest }, dependencies)
    ).rejects.toThrow(
      '输入参数无效，请检查项目路径、版本号等信息。（Codex 分析：DS-01 要求真实双 revision，旧 revision 不能为 r0。）'
    )
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: 'r0',
      newRevision: 'R130',
      reviewItems: [
        expect.objectContaining({ id: 'DS-01' }),
        expect.objectContaining({ id: 'DS-03', materials: [] })
      ]
    }))
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'failed',
      error_message: '输入参数无效，请检查项目路径、版本号等信息。（Codex 分析：DS-01 要求真实双 revision，旧 revision 不能为 r0。）'
    })
  })

  it('组合任务从头重试保留原始 revision 和逐项输入，且 Codex 只接收工作区副本', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-ds01-retry-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'DS-01_重试审查报告.md')
    const imagesDir = join(cwd, 'images')
    const requirementSource = '/local/source/重试需求表.xlsx'
    const legacyRequirementSource = '/legacy/source/不得复制的旧需求表.xls'
    const requirementCopy = join(cwd, 'materials', 'DS-01', 'requirement-sheet', '重试需求表.xlsx')
    const reviewItems = [
      {
        id: 'DS-01',
        user_extra_rules: '从头重新核对协议导入',
        materials: [
          { field_id: 'requirement-sheet', file_paths: [requirementSource] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '从头重新核对故障恢复' }
    ]
    const serverTask = makeTask({
      id: 'task-ds01-retry',
      old_revision: '0',
      new_revision: 'r130',
      status: 'failed',
      review_item_ids: ['DS-01', 'DS-03'],
      skill_name: 'bms-code-reviewer'
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(),
        readTask: vi.fn(async () => serverTask),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async (
        input: Parameters<TaskAgentDependencies['prepareWorkspace']>[0]
      ) => ({
        cwd,
        reportPath,
        imagesDir,
        requirementFilePath: legacyRequirementSource,
        reviewItems: input.reviewItems?.map((item) => ({
          ...item,
          materials: item.materials.map((material) => ({
            ...material,
            filePaths: [requirementCopy]
          }))
        }))
      })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# DS-01 retry report\n')
      }),
      uploadReport: vi.fn()
    })

    await expect(retryReviewTask({
      token: 'token-123',
      taskId: serverTask.id,
      clientTaskId: serverTask.id,
      oldRevision: '0',
      newRevision: 'R130',
      requirementFilePath: legacyRequirementSource,
      reviewItems
    }, dependencies)).resolves.toMatchObject({
      taskId: serverTask.id,
      status: 'success'
    })

    const workspaceCalls = JSON.stringify(vi.mocked(dependencies.prepareWorkspace).mock.calls)
    const codexCalls = JSON.stringify(vi.mocked(dependencies.runCodex).mock.calls)
    expect(dependencies.preflightSvn).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: '0',
      newRevision: 'R130'
    }))
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: '0',
      newRevision: 'R130',
      reviewItems: expect.arrayContaining([
        expect.objectContaining({ id: 'DS-01', user_extra_rules: '从头重新核对协议导入' }),
        expect.objectContaining({ id: 'DS-03', user_extra_rules: '从头重新核对故障恢复' })
      ])
    }))
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      oldRevision: '0',
      newRevision: 'R130',
      reviewItems: [
        expect.objectContaining({ id: 'DS-01', user_extra_rules: '从头重新核对协议导入' }),
        expect.objectContaining({
          id: 'DS-03',
          user_extra_rules: '从头重新核对故障恢复',
          materials: []
        })
      ]
    }))
    expect(workspaceCalls).not.toContain(legacyRequirementSource)
    expect(codexCalls).not.toContain(legacyRequirementSource)
    expect(codexCalls).not.toContain(requirementSource)
    expect(codexCalls).toContain(requirementCopy)
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
  })

  it('DS-01 材料准备失败时先标记任务失败且绝不启动 Codex', async () => {
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask({ review_item_ids: ['DS-01'] })),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      preflightSvn: vi.fn(),
      prepareWorkspace: vi.fn(async () => {
        throw new Error('审查材料无效：DS-01 产品开发需求表不存在，请重新选择。')
      }),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })
    const invalidRequest = {
      svn_url: 'svn://repo/ds01', old_revision: '120', new_revision: '130',
      review_items: [{
        id: 'DS-01',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/source/missing.xlsx'] }
        ]
      }]
    }

    await expect(
      executeReviewTask({ token: 'token-123', request: invalidRequest }, dependencies)
    ).rejects.toThrow('DS-01 产品开发需求表不存在')
    expect(dependencies.runCodex).not.toHaveBeenCalled()
    expect(dependencies.uploadRequirementFile).not.toHaveBeenCalled()
    expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-1', {
      status: 'failed',
      error_message: '审查材料无效：DS-01 产品开发需求表不存在，请重新选择。'
    })
  })

  it('发布前清理报告输出元数据并返回稳定的原始Markdown', async () => {
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

  it('重试阶段事件只在对应服务端状态落库后发出', async () => {
    const checkingStarted = createDeferred<void>()
    const checkingPersisted = createDeferred<void>()
    const environmentErrorStarted = createDeferred<void>()
    const environmentErrorPersisted = createDeferred<void>()
    const events: string[] = []
    const failedTask = makeTask({
      id: 'task-retry-order',
      status: 'failed',
      skill_name: request.skill_name
    })
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(),
        readTask: vi.fn(async () => failedTask),
        updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
          if (payload.status === 'checking_environment') {
            checkingStarted.resolve(undefined)
            await checkingPersisted.promise
          }
          if (payload.status === 'environment_error') {
            environmentErrorStarted.resolve(undefined)
            await environmentErrorPersisted.promise
          }
        })
      },
      checkEnvironment: vi.fn(async () => ({ status: 'missing_svn' as const })),
      prepareWorkspace: vi.fn(),
      runCodex: vi.fn(),
      uploadReport: vi.fn()
    })

    const execution = retryReviewTask(
      { token: 'token-123', taskId: failedTask.id, clientTaskId: failedTask.id },
      dependencies,
      (event) => {
        if (event.type === 'stage') events.push(`${event.stage}:${event.message}`)
      }
    )

    await checkingStarted.promise
    expect(events).toEqual([])
    checkingPersisted.resolve(undefined)
    await environmentErrorStarted.promise
    expect(events).toEqual([
      'checking_environment:任务重新启动',
      'checking_environment:检查本机环境'
    ])
    environmentErrorPersisted.resolve(undefined)

    await expect(execution).resolves.toEqual({
      taskId: failedTask.id,
      status: 'environment_error'
    })
    expect(events).toEqual([
      'checking_environment:任务重新启动',
      'checking_environment:检查本机环境',
      'environment_error:本机 SVN CLI 不可用，请联系管理员处理。'
    ])
  })

  it('任务完成阶段不调用PDF生成或上传依赖', async () => {
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

    await expect(
      executeReviewTask({ token: 'token-123', request }, dependencies)
    ).resolves.toEqual(
      expect.objectContaining({ status: 'success', reportMarkdown: '# report\n' })
    )

    expect(dependencies.generatePdfReport).not.toHaveBeenCalled()
    expect(dependencies.uploadReport).toHaveBeenCalledTimes(1)
    expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
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
        createTask: vi.fn(async () => {
          events.push('persisted:created')
          return makeTask()
        }),
        updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
          events.push(`persisted:${payload.status}`)
        })
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
      uploadReport: vi.fn(async () => {
        events.push('persisted:success')
      })
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
      'persisted:created',
      'local-task-1:task-1:stage:created:任务已创建',
      'persisted:checking_environment',
      'local-task-1:task-1:stage:checking_environment:检查本机环境',
      'local-task-1:task-1:stage:checking_environment:校验 SVN 地址和版本',
      'local-task-1:task-1:stage:preparing_workspace:准备任务工作区',
      'persisted:running_codex',
      'local-task-1:task-1:stage:running_codex:启动 Codex 执行审查 Skill',
      'local-task-1:task-1:codex_output:stdout:读取 Skill\n',
      'persisted:uploading_report',
      'local-task-1:task-1:stage:uploading_report:上传审查报告',
      'persisted:success',
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

describe('defaultRunCodex', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  const runWithEvidenceDir = async (
    reviewItems?: { id: string; name: string; materials: [] }[]
  ): Promise<string> => {
    vi.doMock('electron', () => ({
      app: { isPackaged: false, getAppPath: vi.fn(() => '/tmp/code_review_electron') }
    }))
    let capturedPrompt = ''
    const runCodexReview = vi.fn(async (input: { prompt: string }) => {
      capturedPrompt = input.prompt
      return { stdout: '', stderr: '' }
    })
    vi.doMock('../codex-runner', async () => ({
      ...(await vi.importActual<typeof import('../codex-runner')>('../codex-runner')),
      runCodexReview
    }))

    const { defaultRunCodex } = await import('../task-agent')
    await defaultRunCodex({
      cwd: 'C:\\crv\\w\\task-1',
      reportPath: 'C:\\crv\\w\\task-1\\报告.md',
      imagesDir: 'C:\\crv\\w\\task-1\\images',
      evidenceDir: 'C:\\crv\\e\\6fcddf8b',
      skillName: '通用-代码审查-模版二',
      task: makeTask(),
      ...(reviewItems ? { reviewItems } : {})
    })

    expect(runCodexReview).toHaveBeenCalledTimes(1)
    return capturedPrompt
  }

  it('逐项审查提示词包含证据工作目录', async () => {
    const prompt = await runWithEvidenceDir([
      { id: 'DS-03', name: 'MOS 充放电状态机审查', materials: [] }
    ])

    expect(prompt).toContain('证据工作目录：C:\\crv\\e\\6fcddf8b')
  })

  it('模板审查提示词包含证据工作目录', async () => {
    const prompt = await runWithEvidenceDir()

    expect(prompt).toContain('证据工作目录：C:\\crv\\e\\6fcddf8b')
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
      imagesDir: join(appRoot, '.runtime-data', 'workspaces', 'task-runtime-workspace', 'images'),
      evidenceDir: join(appRoot, '.runtime-data', 'e', 'taskrunt')
    })
    await expect(
      readFile(join(workspace.cwd, 'skills', '??-??????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(join(workspace.cwd, 'skills', '???-?????????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
  })

  it('在短路径下准备证据目录，且重试时清空上一次的证据', async () => {
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: vi.fn(() => appRoot)
      }
    }))

    const evidenceDir = join(appRoot, '.runtime-data', 'e', 'taskevid')
    // 模拟同一任务的上一次运行残留：acquire-svn-evidence.ps1 拒绝非空输出目录，
    // 不清空就会让重试必然失败。
    await mkdir(join(evidenceDir, 'new-source'), { recursive: true })
    await writeFile(join(evidenceDir, 'new-source', 'stale.c'), 'stale')

    const { defaultPrepareWorkspace } = await import('../task-agent')
    const workspace = await defaultPrepareWorkspace({
      taskId: 'task-evidence-dir',
      svnCommand: '/fake/bin/svn',
      svnUrl: 'svn://repo/project',
      oldRevision: '12',
      newRevision: '14'
    })

    expect(workspace.evidenceDir).toBe(evidenceDir)
    await expect(readdir(evidenceDir)).resolves.toEqual([])
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
  it('DS-99 只向服务端写入输入快照，并将本地材料留在工作区执行链路', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-ds99-'))
    const reportPath = join(cwd, 'DS-99_审查报告.md')
    const localMaterialPath = '/local/private/custom-rule.pdf'
    const workspaceMaterialPath = join(cwd, 'materials', 'DS-99', 'pdf-materials', 'custom-rule.pdf')
    const request = {
      svn_url: 'svn://repo/ds99', old_revision: '120', new_revision: '130',
      review_items: [{
        id: 'DS-99', user_extra_rules: '保护条件必须具有明确恢复路径。',
        custom_mode: 'dual_revision' as const,
        materials: [{ field_id: 'pdf-materials', file_paths: [localMaterialPath] }]
      }]
    }
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: {
        createTask: vi.fn(async () => makeTask({
          svn_url: request.svn_url, old_revision: request.old_revision,
          new_revision: request.new_revision, review_item_ids: ['DS-99']
        })),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async (input: Parameters<TaskAgentDependencies['prepareWorkspace']>[0]) => ({
        cwd, reportPath, imagesDir: join(cwd, 'images'),
        reviewItems: input.reviewItems?.map((item) => ({
          ...item,
          materials: item.materials.map((material) => ({
            ...material, filePaths: [workspaceMaterialPath]
          }))
        }))
      })),
      runCodex: vi.fn(async () => writeFile(reportPath, '# DS-99 report\n')),
      uploadReport: vi.fn()
    })

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).resolves.toMatchObject({
      taskId: 'task-1', status: 'success'
    })

    expect(dependencies.api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: request.svn_url,
      old_revision: request.old_revision,
      new_revision: request.new_revision,
      skill_name: 'bms-code-reviewer',
      review_item_ids: ['DS-99'],
      custom_review_rule: '保护条件必须具有明确恢复路径。',
      custom_review_mode: 'dual_revision',
      has_custom_review_word_material: false,
      has_custom_review_excel_material: false,
      has_custom_review_pdf_material: true
    })
    expect(JSON.stringify(vi.mocked(dependencies.api.createTask).mock.calls)).not.toContain(localMaterialPath)
    expect(dependencies.runCodex).toHaveBeenCalledWith(expect.objectContaining({
      reviewItems: [expect.objectContaining({
        id: 'DS-99', custom_mode: 'dual_revision',
        materials: expect.arrayContaining([
          expect.objectContaining({ filePaths: [workspaceMaterialPath] })
        ])
      })]
    }))
    await rm(cwd, { recursive: true, force: true })
  })

  it('DS-99 变更代码审查模式在旧 revision 为零时不创建服务端任务', async () => {
    const createTask = vi.fn()
    const dependencies: TaskAgentDependencies = withPdfDependencies({
      api: { createTask, updateTaskStatus: vi.fn() },
      checkEnvironment: vi.fn(), prepareWorkspace: vi.fn(), runCodex: vi.fn(), uploadReport: vi.fn()
    })

    await expect(executeReviewTask({
      token: 'token-123',
      request: {
        svn_url: 'svn://repo/ds99', old_revision: ' R0 ', new_revision: '130',
        review_items: [{
          id: 'DS-99', user_extra_rules: '检查保护条件', custom_mode: 'dual_revision'
        }]
      }
    }, dependencies)).rejects.toThrow('DS-99 变更代码审查模式不能使用旧 revision 0 或 r0。')
    expect(createTask).not.toHaveBeenCalled()
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
