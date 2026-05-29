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
  new_revision: '14'
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

    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs = []
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
    const reportPath = join(cwd, 'report.md')
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
        return { cwd, reportPath }
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
      task: makeTask()
    })
    expect(dependencies.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', reportPath)
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

  it('emits task progress events around environment, workspace, Codex, and upload stages', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'report.md')
    const events: string[] = []
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath })),
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
      { token: 'token-123', request },
      dependencies,
      (event) => {
        const detail = event.type === 'stage' ? event.stage : event.stream
        events.push(`${event.type}:${detail}:${event.message}`)
      }
    )

    expect(events).toEqual([
      'stage:checking_environment:检查本机环境',
      'stage:preparing_workspace:准备任务工作区',
      'stage:running_codex:启动 Codex 执行审查 Skill',
      'codex_output:stdout:读取 Skill\n',
      'stage:uploading_report:上传审查报告',
      'stage:success:审查完成'
    ])
  })

  it('marks task as failed with a sanitized summary when codex throws', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'task-agent-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'report.md')
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath })),
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
    const reportPath = join(cwd, 'report.md')
    const dependencies: TaskAgentDependencies = {
      api: {
        createTask: vi.fn(async () => makeTask()),
        updateTaskStatus: vi.fn(async () => undefined)
      },
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath })),
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
})

describe('defaultPrepareWorkspace', () => {
  const userData = join(tmpdir(), `code-review-user-data-${Date.now()}`)

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.resetModules()
    await rm(userData, { recursive: true, force: true })
  })

  it('copies the source review skill into the task workspace', async () => {
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => userData)
      }
    }))

    const sourceSkill = join(userData, 'skills', '通用-代码变更审查')
    await mkdir(sourceSkill, { recursive: true })
    await writeFile(join(sourceSkill, 'SKILL.md'), 'review skill')

    const workspace = await defaultPrepareWorkspace('task-copy-skill')
    const workspaceSkill = join(workspace.cwd, 'skills', '通用-代码变更审查', 'SKILL.md')

    await expect(readFile(workspaceSkill, 'utf8')).resolves.toBe('review skill')
  })

  it('throws a clear error when the source review skill is missing', async () => {
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => userData)
      }
    }))

    await expect(defaultPrepareWorkspace('task-missing-skill')).rejects.toThrow(
      '本机代码审查 Skill 源目录缺失'
    )
  })
})
