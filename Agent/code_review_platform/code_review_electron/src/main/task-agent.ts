import { cp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ApiClient, CreateTaskRequest, UpdateTaskStatusRequest } from './api-client'
import { checkEnvironment, type EnvironmentCheckResult } from './environment-checker'
import { buildReviewPrompt, CodexReviewError, runCodexReview, type CodexErrorCode } from './codex-runner'
import { ensureReportReady, uploadReportFile } from './report-uploader'
import type {
  EnvironmentStatus,
  ReviewTask,
  ReviewTaskStatus,
  TaskProgressEvent,
  TaskProgressStage
} from '../shared/types'

export interface ExecuteReviewTaskInput {
  token: string
  request: CreateTaskRequest
}

export interface PreparedWorkspace {
  cwd: string
  reportPath: string
}

export interface RunCodexInput {
  cwd: string
  reportPath: string
  task: ReviewTask
  onProgress?: TaskProgressReporter
}

export interface ExecuteReviewTaskResult {
  taskId: string
  status: ReviewTaskStatus
  reportMarkdown?: string
  reportPath?: string
}

export interface TaskAgentApi {
  createTask(token: string, payload: CreateTaskRequest): Promise<unknown>
  updateTaskStatus(
    token: string,
    taskId: string,
    payload: UpdateTaskStatusRequest
  ): Promise<unknown>
  uploadReport?: ApiClient['uploadReport']
}

export interface TaskAgentDependencies {
  api: TaskAgentApi
  checkEnvironment: () => Promise<EnvironmentCheckResult>
  prepareWorkspace: (taskId: string) => Promise<PreparedWorkspace>
  runCodex: (input: RunCodexInput) => Promise<unknown>
  uploadReport: (token: string, taskId: string, reportPath: string) => Promise<unknown>
}

export type TaskProgressReporter = (event: TaskProgressEvent) => void

const environmentErrorMessages: Record<Exclude<EnvironmentStatus, 'ready'>, string> = {
  missing_codex: '本机 Codex CLI 不可用，请联系管理员处理。',
  missing_svn: '本机 SVN CLI 不可用，请联系管理员处理。',
  missing_skill: '本机代码审查 Skill 不可用，请联系管理员处理。',
  failed: '本机审查环境检查失败，请联系管理员处理。'
}

const codexErrorMessages: Record<CodexErrorCode, string> = {
  SVN_ERROR: 'SVN 操作失败，请检查项目路径和版本号是否正确。',
  SKILL_ERROR: '代码审查 Skill 执行异常，请联系管理员处理。',
  PARAM_ERROR: '输入参数无效，请检查项目路径、版本号等信息。',
  REPORT_ERROR: '审查报告生成失败，请重试或联系管理员。',
  INTERNAL_ERROR: 'Codex 执行过程中发生内部错误。',
}

const toReviewTask = (value: unknown): ReviewTask => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  ) {
    return value as ReviewTask
  }

  throw new Error('创建审查任务失败：服务端未返回任务 ID')
}

export const defaultPrepareWorkspace = async (taskId: string): Promise<PreparedWorkspace> => {
  const { app } = await import('electron')
  const userData = app.getPath('userData')
  const cwd = join(userData, 'workspaces', taskId)
  const sourceSkillPath = join(userData, 'skills', '通用-代码变更审查')
  const workspaceSkillPath = join(cwd, 'skills', '通用-代码变更审查')

  await mkdir(cwd, { recursive: true })
  await cp(sourceSkillPath, workspaceSkillPath, {
    recursive: true,
    force: true,
    errorOnExist: false
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`本机代码审查 Skill 源目录缺失，无法复制到任务工作区：${sourceSkillPath} (${message})`)
  })

  return {
    cwd,
    reportPath: join(cwd, 'report.md')
  }
}

export const defaultRunCodex = async ({
  cwd,
  reportPath,
  task,
  onProgress
}: RunCodexInput): Promise<void> => {
  await runCodexReview({
    cwd,
    prompt: buildReviewPrompt({
      svnUrl: task.svn_url,
      oldRevision: task.old_revision,
      newRevision: task.new_revision,
      reportPath
    }),
    timeoutMs: 30 * 60 * 1000,
    onOutput: (event) =>
      onProgress?.({
        taskId: task.id,
        type: 'codex_output',
        stream: event.stream,
        message: event.text
      })
  })
}

export const createTaskAgentDependencies = (api: ApiClient): TaskAgentDependencies => ({
  api,
  checkEnvironment,
  prepareWorkspace: defaultPrepareWorkspace,
  runCodex: defaultRunCodex,
  uploadReport: (token, taskId, reportPath) => uploadReportFile(api, token, taskId, reportPath)
})

export const executeReviewTask = async (
  input: ExecuteReviewTaskInput,
  dependencies: TaskAgentDependencies,
  onProgress?: TaskProgressReporter
): Promise<ExecuteReviewTaskResult> => {
  const task = toReviewTask(await dependencies.api.createTask(input.token, input.request))

  try {
    emitStage(onProgress, task.id, 'checking_environment', '检查本机环境')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'checking_environment'
    })

    const environment = await dependencies.checkEnvironment()

    if (environment.status !== 'ready') {
      emitStage(onProgress, task.id, 'environment_error', environmentErrorMessages[environment.status])
      await updateStatus(dependencies, input.token, task.id, {
        status: 'environment_error',
        error_message: environmentErrorMessages[environment.status]
      })

      return { taskId: task.id, status: 'environment_error' }
    }

    emitStage(onProgress, task.id, 'preparing_workspace', '准备任务工作区')
    const workspace = await dependencies.prepareWorkspace(task.id)

    emitStage(onProgress, task.id, 'running_codex', '启动 Codex 执行审查 Skill')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'running_codex'
    })

    await dependencies.runCodex({
      ...workspace,
      task,
      onProgress
    })

    emitStage(onProgress, task.id, 'uploading_report', '上传审查报告')
    await updateStatus(dependencies, input.token, task.id, {
      status: 'uploading_report'
    })

    await ensureReportReady(workspace.reportPath)
    await dependencies.uploadReport(input.token, task.id, workspace.reportPath)
    const reportMarkdown = await readFile(workspace.reportPath, 'utf8')

    emitStage(onProgress, task.id, 'success', '审查完成')
    return {
      taskId: task.id,
      status: 'success',
      reportMarkdown,
      reportPath: workspace.reportPath
    }
  } catch (error) {
    const errorMessage = error instanceof CodexReviewError
      ? `${codexErrorMessages[error.errorCode]}（Codex 分析：${error.message}）`
      : sanitizeErrorSummary(error, input.token)

    await updateStatus(dependencies, input.token, task.id, {
      status: 'failed',
      error_message: errorMessage
    })
    emitStage(onProgress, task.id, 'failed', errorMessage)

    throw error
  }
}

const emitStage = (
  onProgress: TaskProgressReporter | undefined,
  taskId: string,
  stage: TaskProgressStage,
  message: string
): void => {
  onProgress?.({
    taskId,
    type: 'stage',
    stage,
    message
  })
}

const updateStatus = (
  dependencies: TaskAgentDependencies,
  token: string,
  taskId: string,
  payload: UpdateTaskStatusRequest
): Promise<unknown> => dependencies.api.updateTaskStatus(token, taskId, payload)

const sanitizeErrorSummary = (error: unknown, token: string): string => {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const withoutToken = token ? rawMessage.split(token).join('[redacted]') : rawMessage

  return withoutToken
    .replace(
      /\b(password|svn_password|secret|token|access_token|refresh_token)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match, key: string, separator: string) => `${key}${separator} [redacted]`
    )
    .replace(/\bBearer\s+("[^"]*"|'[^']*'|[^\s,;]+)/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z]:\\[^\s:]+/g, '[路径已隐藏]')
    .replace(/\/[^\s:]+/g, '[路径已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}
