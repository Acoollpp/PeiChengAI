import { describe, expect, it } from 'vitest'

import { createFixtureWorkbenchAdapter } from './fixture-adapter'

describe('fixture workbench adapter', () => {
  it('预览今日统计随 fixture 失败任务和报告数量更新', async () => {
    const adapter = createFixtureWorkbenchAdapter()
    const viewModel = adapter.getViewModel()

    expect(viewModel.taskStats).toEqual({
      status: 'ready',
      range: 'today',
      failedOrError: viewModel.tasks.filter((task) => task.stage === 'failed').length,
      success: viewModel.reports.length
    })

    await adapter.commands.setScenario('empty')
    await adapter.commands.createTask({
      svnUrl: 'svn://fixture/stats',
      oldRevision: '1',
      newRevision: '2',
      selection: { 'DS-03': { itemId: 'DS-03', extraRules: '', materials: {} } }
    })
    expect(adapter.getViewModel().taskStats).toMatchObject({ success: 0 })

    for (let index = 0; index < 4; index += 1) await adapter.commands.advanceTasks()
    expect(adapter.getViewModel().taskStats).toMatchObject({ success: 1 })
  })

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

  it('带 r 前缀的 revision 始终只显示一个 r', async () => {
    const adapter = createFixtureWorkbenchAdapter()
    await adapter.commands.setScenario('empty')
    await adapter.commands.createTask({
      svnUrl: 'svn://fixture/prefixed',
      oldRevision: 'r0',
      newRevision: 'R12',
      selection: { 'DS-03': { itemId: 'DS-03', extraRules: '', materials: {} } }
    })
    for (let index = 0; index < 4; index += 1) await adapter.commands.advanceTasks()
    expect(adapter.getViewModel().reports[0]?.revisionRange).toBe('r0 → r12')
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

    if (!replacement) throw new Error('fixture 应返回替换材料')
    expect(replacement.id).not.toBe(currentFile?.id)
    expect(replacement.name).not.toBe(currentFile?.name)
  })

  it('为 DS-04 多芯片规格书和 DS-06 产品规格书提供预览材料 fixture', async () => {
    const adapter = createFixtureWorkbenchAdapter()

    const firstChipSpec = await adapter.commands.chooseMaterial('DS-04', 'chip-specs', [])
    const secondChipSpec = await adapter.commands.chooseMaterial(
      'DS-04',
      'chip-specs',
      firstChipSpec ? [firstChipSpec.id] : []
    )
    const productSpec = await adapter.commands.chooseMaterial('DS-06', 'product-spec', [])

    expect(firstChipSpec?.name).toMatch(/芯片规格书.*\.pdf$/)
    expect(secondChipSpec?.id).not.toBe(firstChipSpec?.id)
    expect(productSpec?.name).toMatch(/产品规格书.*\.pdf$/)
  })

  it('连续选择五张反馈截图时保持唯一，耗尽后明确拒绝', async () => {
    const adapter = createFixtureWorkbenchAdapter()
    const selectedIds: string[] = []

    for (let index = 0; index < 5; index += 1) {
      const screenshot = await adapter.commands.chooseFeedbackScreenshot(selectedIds)
      selectedIds.push(screenshot.id)
    }

    expect(new Set(selectedIds).size).toBe(5)
    await expect(adapter.commands.chooseFeedbackScreenshot(selectedIds)).rejects.toThrow(
      '没有更多可用截图。'
    )
  })
})
