import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultPrepareWorkspace,
  executeReviewTask,
  type TaskAgentDependencies
} from '../task-agent'
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

describe('executeReviewTask', () => {
  let tempDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
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
    const dependencies: TaskAgentDependencies = {
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
    }

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
    const imagesDir = join(cwd, 'images')
    const calls: string[] = []
    const dependencies: TaskAgentDependencies = {
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
        return { status: 'ready' as const }
      }),
      prepareWorkspace: vi.fn(async () => {
        calls.push('prepareWorkspace')
        return { cwd, reportPath, imagesDir }
      }),
      runCodex: vi.fn(async () => {
        calls.push('runCodex')
        await writeFile(reportPath, '# report\n')
      }),
      uploadReport: vi.fn(async () => {
        calls.push('uploadReport')
      })
    }

    const result = await executeReviewTask({ token: 'token-123', request }, dependencies)

    expect(result).toEqual({
      taskId: 'task-1',
      status: 'success',
      reportMarkdown: '# report\n',
      reportPath
    })
    expect(dependencies.runCodex).toHaveBeenCalledWith({
      cwd,
      reportPath,
      imagesDir,
      skillName: '通用-代码审查-模版二',
      task: makeTask()
    })
    expect(dependencies.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', reportPath)
    expect(dependencies.prepareWorkspace).toHaveBeenCalledWith({
      taskId: 'task-1',
      svnUrl: 'svn://repo/project',
      oldRevision: '12',
      newRevision: '14'
    })
    expect(calls).toEqual([
      'createTask',
      'status:checking_environment',
      'checkEnvironment',
      'prepareWorkspace',
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
  })

  it('取消信号触发后标记任务为已取消且不上传报告', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-cancel-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const controller = new AbortController()
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# 不应上传\n')
        controller.abort()
      }),
      uploadReport: vi.fn()
    }

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
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
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
    }

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
      'local-task-1:task-1:stage:preparing_workspace:准备任务工作区',
      'local-task-1:task-1:stage:running_codex:启动 Codex 执行审查 Skill',
      'local-task-1:task-1:codex_output:stdout:读取 Skill\n',
      'local-task-1:task-1:stage:uploading_report:上传审查报告',
      'local-task-1:task-1:stage:success:审查完成'
    ])
  })

  it('marks task as failed with a sanitized summary when codex throws', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        throw new Error(`failure using token secret-token at ${cwd}`)
      }),
      uploadReport: vi.fn()
    }

    await expect(executeReviewTask({ token: 'secret-token', request }, dependencies)).rejects.toThrow(
      'failure using token secret-token'
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

  it('redacts secret-like values from codex failure summaries', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        throw new Error('failed with password=hunter2 access_token: abc Bearer xyz')
      }),
      uploadReport: vi.fn()
    }

    await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
      'failed with password=hunter2'
    )

    const lastStatus = vi.mocked(dependencies.api.updateTaskStatus).mock.calls.at(-1)?.[2]

    expect(lastStatus?.error_message).toContain('[redacted]')
    expect(lastStatus?.error_message).not.toContain('hunter2')
    expect(lastStatus?.error_message).not.toContain('abc')
    expect(lastStatus?.error_message).not.toContain('xyz')
    expect(dependencies.uploadReport).not.toHaveBeenCalled()
  })

  it('fails and reports failed status when no review template Skill is selected', async () => {
    const dependencies: TaskAgentDependencies = {
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
    }

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
      imagesDir: join(appRoot, '.runtime-data', 'workspaces', 'task-runtime-workspace', 'images')
    })
    await expect(
      readFile(join(workspace.cwd, 'skills', '??-??????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(join(workspace.cwd, 'skills', '???-?????????', 'SKILL.md'), 'utf8')
    ).rejects.toThrow()
  })
})
