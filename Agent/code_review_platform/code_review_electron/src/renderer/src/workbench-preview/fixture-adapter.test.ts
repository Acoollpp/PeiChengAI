import { describe, expect, it } from 'vitest'

import { createFixtureWorkbenchAdapter } from './fixture-adapter'

describe('fixture workbench adapter', () => {
  it('原样展示 r0，不在平台层推断新版本全量模式', async () => {
    const adapter = createFixtureWorkbenchAdapter()
    const staticReport = adapter.getViewModel().reports.find((report) => report.taskId === 'CR-240806-009')
    expect(staticReport?.revisionRange).toBe('r0 → r10772')

    await adapter.commands.setScenario('empty')
    await adapter.commands.createTask({
      svnUrl: 'svn://fixture/ds-01-r0',
      oldRevision: '0',
      newRevision: '9012',
      selection: {
        'DS-01': {
          itemId: 'DS-01',
          extraRules: '',
          materials: {}
        }
      }
    })
    await adapter.commands.advanceTasks()
    await adapter.commands.advanceTasks()
    await adapter.commands.advanceTasks()
    await adapter.commands.advanceTasks()

    const dynamicReport = adapter
      .getViewModel()
      .reports.find((report) => report.svnUrl === 'svn://fixture/ds-01-r0')
    expect(dynamicReport?.revisionRange).toBe('r0 → r9012')
    expect(dynamicReport?.revisionRange).not.toContain('全量')
  })

  it('取消首个等待任务后，即使执行槽已满也会重排剩余序号', async () => {
    const adapter = createFixtureWorkbenchAdapter()

    await adapter.commands.cancelTask('CR-240806-018')

    const waitingTasks = adapter
      .getViewModel()
      .tasks.filter((task) => task.stage === 'waiting')
    expect(waitingTasks.map((task) => task.id)).toEqual(['CR-240806-019', 'CR-240806-020'])
    expect(waitingTasks.map((task) => task.queueIndex)).toEqual([1, 2])
  })

  it('更换单文件材料时返回与当前文件不同的 fixture', async () => {
    const adapter = createFixtureWorkbenchAdapter()
    const currentFile = adapter.getViewModel().sampleTask.selection['DS-01']?.materials[
      'requirement-sheet'
    ][0]
    expect(currentFile).toBeDefined()

    const replacement = await adapter.commands.chooseMaterial(
      'DS-01',
      'requirement-sheet',
      currentFile ? [currentFile.id] : []
    )

    expect(replacement.id).not.toBe(currentFile?.id)
    expect(replacement.name).not.toBe(currentFile?.name)
  })
})
