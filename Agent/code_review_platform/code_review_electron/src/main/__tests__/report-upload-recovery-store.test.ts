import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { ReportUploadRecoveryStore } from '../report-upload-recovery-store'
import type { RuntimePaths } from '../runtime-paths'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_TASK_ID = '22222222-2222-4222-8222-222222222222'

const buildRuntimePaths = (runtimeRoot: string): RuntimePaths => ({
  runtimeRoot,
  skillPackagesDir: join(runtimeRoot, 'skill-packages'),
  skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
  workspacesDir: join(runtimeRoot, 'workspaces'),
  workspaceForTask: (taskId) => join(runtimeRoot, 'workspaces', taskId),
  reportPathForTask: (taskId, fileName = '代码审查报告.md') =>
    join(runtimeRoot, 'workspaces', taskId, fileName),
  imagesDirForTask: (taskId) => join(runtimeRoot, 'workspaces', taskId, 'images')
})

const recoveryPath = (runtimeRoot: string, taskId = TASK_ID): string =>
  join(runtimeRoot, 'report-upload-recoveries', `${taskId}.json`)

const recoveryPayload = (taskId = TASK_ID, reportFileName = 'BMS_审查报告.md') => ({
  version: 1,
  task_id: taskId,
  report_file_name: reportFileName,
  failure_code: 'REPORT_IMAGE_INVALID_UTF8',
  asset_paths: ['images/issue-01.svg']
})

describe('ReportUploadRecoveryStore', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('在 runtimeRoot 受控目录持久化并在每次读取时复验报告', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-store-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = buildRuntimePaths(runtimeRoot)
    const workspace = runtimePaths.workspaceForTask(TASK_ID)
    const reportPath = join(workspace, 'BMS_审查报告.md')
    await mkdir(join(workspace, 'images'), { recursive: true })
    await writeFile(reportPath, '# 报告\n')
    const firstStore = new ReportUploadRecoveryStore(async () => runtimePaths)

    await firstStore.save({
      taskId: TASK_ID,
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      assetPaths: ['images/issue-01.svg']
    })

    const stateContent = await readFile(recoveryPath(runtimeRoot), 'utf8')
    expect(stateContent).not.toContain(reportPath)
    expect(stateContent).toContain('BMS_审查报告.md')
    await expect(new ReportUploadRecoveryStore(async () => runtimePaths).load(TASK_ID))
      .resolves.toEqual({
        status: 'ready',
        record: {
          taskId: TASK_ID,
          reportPath,
          failureCode: 'REPORT_IMAGE_INVALID_UTF8',
          assetPaths: ['images/issue-01.svg']
        }
      })

    await rm(reportPath)
    await expect(firstStore.load(TASK_ID)).resolves.toEqual({
      status: 'source_missing',
      assetPaths: ['images/issue-01.svg']
    })
  })

  it('拒绝预置状态目录和状态文件符号链接且不修改外部目标', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-state-link-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-state-outside-'))
    tempDirs.push(runtimeRoot, outsideRoot)
    const runtimePaths = buildRuntimePaths(runtimeRoot)
    const workspace = runtimePaths.workspaceForTask(TASK_ID)
    const reportPath = join(workspace, '报告.md')
    await mkdir(workspace, { recursive: true })
    await writeFile(reportPath, '# 报告\n')
    const store = new ReportUploadRecoveryStore(async () => runtimePaths)
    const outsideState = join(outsideRoot, 'outside.json')
    await writeFile(outsideState, 'outside-original')

    await symlink(outsideRoot, join(runtimeRoot, 'report-upload-recoveries'))
    await expect(store.save({
      taskId: TASK_ID,
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      assetPaths: ['images/issue.svg']
    })).rejects.toThrow('状态目录不能是符号链接')
    await expect(readFile(outsideState, 'utf8')).resolves.toBe('outside-original')

    await rm(join(runtimeRoot, 'report-upload-recoveries'))
    await mkdir(join(runtimeRoot, 'report-upload-recoveries'))
    await symlink(outsideState, recoveryPath(runtimeRoot))
    await expect(store.save({
      taskId: TASK_ID,
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      assetPaths: ['images/issue.svg']
    })).rejects.toThrow('状态文件无效')
    await expect(readFile(outsideState, 'utf8')).resolves.toBe('outside-original')
  })

  it('工作区或报告替换为外部符号链接后返回 source_missing', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-workspace-link-'))
    const outsideRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-workspace-outside-'))
    tempDirs.push(runtimeRoot, outsideRoot)
    const runtimePaths = buildRuntimePaths(runtimeRoot)
    const workspace = runtimePaths.workspaceForTask(TASK_ID)
    const reportPath = join(workspace, '报告.md')
    const outsideReport = join(outsideRoot, 'outside.md')
    await mkdir(workspace, { recursive: true })
    await writeFile(reportPath, '# 报告\n')
    await writeFile(outsideReport, '# 外部文件\n')
    const store = new ReportUploadRecoveryStore(async () => runtimePaths)
    await store.save({
      taskId: TASK_ID,
      reportPath,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      assetPaths: ['images/issue.svg']
    })

    await rm(reportPath)
    await symlink(outsideReport, reportPath)
    await expect(store.load(TASK_ID)).resolves.toEqual({
      status: 'source_missing',
      assetPaths: ['images/issue.svg']
    })

    const secondWorkspace = runtimePaths.workspaceForTask(SECOND_TASK_ID)
    const secondReport = join(secondWorkspace, '报告.md')
    await rm(reportPath)
    await mkdir(secondWorkspace)
    await writeFile(secondReport, '# 报告\n')
    await store.save({
      taskId: SECOND_TASK_ID,
      reportPath: secondReport,
      failureCode: 'REPORT_IMAGE_INVALID_UTF8',
      assetPaths: ['images/issue.svg']
    })
    await rm(secondWorkspace, { recursive: true })
    await symlink(outsideRoot, secondWorkspace)
    await expect(store.load(SECOND_TASK_ID)).resolves.toEqual({
      status: 'source_missing',
      assetPaths: ['images/issue.svg']
    })
  })

  it('拒绝伪造 JSON 指向日志、嵌套文件和路径穿越任务 ID', async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'report-upload-recovery-forged-'))
    tempDirs.push(runtimeRoot)
    const runtimePaths = buildRuntimePaths(runtimeRoot)
    const workspace = runtimePaths.workspaceForTask(TASK_ID)
    await mkdir(join(runtimeRoot, 'report-upload-recoveries'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'codex-review.log'), 'secret log')
    const store = new ReportUploadRecoveryStore(async () => runtimePaths)

    await writeFile(recoveryPath(runtimeRoot), JSON.stringify(recoveryPayload(TASK_ID, 'codex-review.log')))
    await expect(store.load(TASK_ID)).resolves.toBeNull()
    await writeFile(recoveryPath(runtimeRoot), JSON.stringify(recoveryPayload(TASK_ID, 'nested/report.md')))
    await expect(store.load(TASK_ID)).resolves.toBeNull()
    await expect(store.load('../outside-task')).resolves.toBeNull()
    await expect(store.remove('../outside-task')).rejects.toThrow('任务 ID 无效')
  })
})
