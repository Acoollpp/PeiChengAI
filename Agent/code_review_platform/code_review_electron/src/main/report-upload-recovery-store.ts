import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

import { REPORT_IMAGE_INVALID_UTF8 } from '../shared/report-upload-recovery'
import { getRuntimePaths, type RuntimePaths } from './runtime-paths'

const RECOVERY_DIR_NAME = 'report-upload-recoveries'
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface StoredReportUploadRecovery {
  taskId: string
  reportPath: string
  failureCode: typeof REPORT_IMAGE_INVALID_UTF8
  assetPaths: string[]
}

export type ReportUploadRecoverySource =
  | { status: 'ready'; record: StoredReportUploadRecovery }
  | { status: 'source_missing'; assetPaths: string[] }

export interface ReportUploadRecoveryRepository {
  save(record: StoredReportUploadRecovery): Promise<void>
  load(taskId: string): Promise<ReportUploadRecoverySource | null>
  remove(taskId: string): Promise<void>
}

type StoredRecoveryFile = {
  version: 1
  task_id: string
  report_file_name: string
  failure_code: typeof REPORT_IMAGE_INVALID_UTF8
  asset_paths: string[]
}

type ControlledPaths = {
  runtimePaths: RuntimePaths
  realWorkspacesDir: string
  statePath: string
}

const isInsideDirectory = (candidatePath: string, directoryPath: string): boolean => {
  const relativePath = relative(directoryPath, candidatePath)
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

const isSafeRelativePath = (value: string): boolean => {
  if (!value || isAbsolute(value) || value.startsWith('/') || value.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false
  return value.split(/[\\/]+/).every(
    (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
  )
}

const isDirectMarkdownFileName = (value: string): boolean =>
  value === basename(value) && extname(value).toLowerCase() === '.md' && isSafeRelativePath(value)

const validateTaskId = (taskId: string): void => {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error('报告上传恢复任务 ID 无效')
}

const parseRecoveryFile = (value: unknown, taskId: string): StoredRecoveryFile | null => {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<StoredRecoveryFile>
  if (
    candidate.version !== 1 ||
    candidate.task_id !== taskId ||
    candidate.failure_code !== REPORT_IMAGE_INVALID_UTF8 ||
    typeof candidate.report_file_name !== 'string' ||
    !isDirectMarkdownFileName(candidate.report_file_name) ||
    !Array.isArray(candidate.asset_paths) ||
    !candidate.asset_paths.every((path) => typeof path === 'string' && isSafeRelativePath(path))
  ) return null
  return candidate as StoredRecoveryFile
}

const requireRealDirectory = async (path: string, message: string): Promise<string> => {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink() || !pathStat.isDirectory()) throw new Error(message)
  return realpath(path)
}

export class ReportUploadRecoveryStore implements ReportUploadRecoveryRepository {
  constructor(private readonly loadRuntimePaths: () => Promise<RuntimePaths> = getRuntimePaths) {}

  async save(record: StoredReportUploadRecovery): Promise<void> {
    if (!record.assetPaths.every(isSafeRelativePath)) {
      throw new Error('报告上传恢复图片路径无效')
    }
    const paths = await this.resolveControlledPaths(record.taskId)
    const reportPath = await this.validateReportPath(paths, record.taskId, record.reportPath)
    const payload: StoredRecoveryFile = {
      version: 1,
      task_id: record.taskId,
      report_file_name: basename(reportPath),
      failure_code: record.failureCode,
      asset_paths: record.assetPaths
    }
    await this.atomicWrite(paths.statePath, `${JSON.stringify(payload, null, 2)}\n`)
  }

  async load(taskId: string): Promise<ReportUploadRecoverySource | null> {
    let paths: ControlledPaths
    try {
      paths = await this.resolveControlledPaths(taskId)
    } catch {
      return null
    }
    let parsed: StoredRecoveryFile | null
    try {
      const stateStat = await lstat(paths.statePath)
      if (stateStat.isSymbolicLink() || !stateStat.isFile()) return null
      parsed = parseRecoveryFile(JSON.parse(await readFile(paths.statePath, 'utf8')), taskId)
    } catch {
      return null
    }
    if (!parsed) return null

    const reportPath = resolve(paths.runtimePaths.workspaceForTask(taskId), parsed.report_file_name)
    try {
      const validatedReportPath = await this.validateReportPath(paths, taskId, reportPath)
      return {
        status: 'ready',
        record: {
          taskId,
          reportPath: validatedReportPath,
          failureCode: parsed.failure_code,
          assetPaths: parsed.asset_paths
        }
      }
    } catch {
      return { status: 'source_missing', assetPaths: parsed.asset_paths }
    }
  }

  async remove(taskId: string): Promise<void> {
    const paths = await this.resolveControlledPaths(taskId)
    try {
      const stateStat = await lstat(paths.statePath)
      if (stateStat.isSymbolicLink()) throw new Error('报告上传恢复状态文件不能是符号链接')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await rm(paths.statePath, { force: true })
  }

  private async resolveControlledPaths(taskId: string): Promise<ControlledPaths> {
    validateTaskId(taskId)
    const runtimePaths = await this.loadRuntimePaths()
    const runtimeRoot = resolve(runtimePaths.runtimeRoot)
    const realRuntimeRoot = await realpath(runtimeRoot)

    const workspacesDir = resolve(runtimePaths.workspacesDir)
    const realWorkspacesDir = await requireRealDirectory(
      workspacesDir,
      '报告上传恢复工作区根目录无效'
    )
    if (!isInsideDirectory(realWorkspacesDir, realRuntimeRoot)) {
      throw new Error('报告上传恢复工作区根目录不属于运行目录')
    }

    const recoveryDir = resolve(runtimeRoot, RECOVERY_DIR_NAME)
    if (!isInsideDirectory(recoveryDir, runtimeRoot)) throw new Error('报告上传恢复状态目录无效')
    await mkdir(recoveryDir, { recursive: true, mode: 0o700 })
    const realRecoveryDir = await requireRealDirectory(
      recoveryDir,
      '报告上传恢复状态目录不能是符号链接'
    )
    if (!isInsideDirectory(realRecoveryDir, realRuntimeRoot)) {
      throw new Error('报告上传恢复状态目录不属于运行目录')
    }
    await chmod(realRecoveryDir, 0o700)
    return {
      runtimePaths,
      realWorkspacesDir,
      statePath: resolve(realRecoveryDir, `${taskId}.json`)
    }
  }

  private async validateReportPath(
    paths: ControlledPaths,
    taskId: string,
    candidatePath: string
  ): Promise<string> {
    const workspacePath = resolve(paths.runtimePaths.workspaceForTask(taskId))
    if (!isInsideDirectory(workspacePath, resolve(paths.runtimePaths.workspacesDir))) {
      throw new Error('报告上传恢复任务工作区路径无效')
    }
    const realWorkspacePath = await requireRealDirectory(
      workspacePath,
      '报告上传恢复任务工作区不能是符号链接'
    )
    if (!isInsideDirectory(realWorkspacePath, paths.realWorkspacesDir)) {
      throw new Error('报告上传恢复任务工作区不属于工作区根目录')
    }

    const reportPath = resolve(candidatePath)
    if (dirname(reportPath) !== workspacePath || extname(reportPath).toLowerCase() !== '.md') {
      throw new Error('报告上传恢复只允许任务工作区根目录下的 Markdown 报告')
    }
    const reportStat = await lstat(reportPath)
    if (reportStat.isSymbolicLink() || !reportStat.isFile()) {
      throw new Error('报告上传恢复报告文件无效')
    }
    const realReportPath = await realpath(reportPath)
    if (dirname(realReportPath) !== realWorkspacePath) {
      throw new Error('报告上传恢复报告不能指向任务工作区外')
    }
    return reportPath
  }

  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    try {
      const targetStat = await lstat(targetPath)
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new Error('报告上传恢复状态文件无效')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const temporaryPath = resolve(dirname(targetPath), `.${basename(targetPath)}.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      const targetStat = await lstat(targetPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isFile())) {
        throw new Error('报告上传恢复状态文件无效')
      }
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}
