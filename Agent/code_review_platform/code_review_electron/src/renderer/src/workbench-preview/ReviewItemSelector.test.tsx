// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixtureWorkbenchAdapter } from './fixture-adapter'
import { ReviewItemSelector } from './ReviewItemSelector'
import type {
  MaterialFileView,
  ReviewItemDefinition,
  ReviewSelection,
  WorkbenchCommands
} from './types'

afterEach(cleanup)

describe('ReviewItemSelector', () => {
  it('在详情切换时保留逐项规则和材料，并只在确认时回填', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    const viewModel = adapter.getViewModel()
    const onConfirm = vi.fn<(selection: ReviewSelection) => void>()
    const onCancel = vi.fn()

    render(
      <StrictMode>
        <ReviewItemSelector
          catalog={viewModel.catalog}
          initialSelection={{}}
          commands={adapter.commands}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </StrictMode>
    )

    expect(screen.getByPlaceholderText('搜索 ID、名称或分类')).toHaveFocus()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(
      screen.getByLabelText('DS-01 额外规则'),
      '这是一段只属于 DS-01 的很长额外规则，用于验证详情切换后输入不会串到其他审查项。'
    )
    const fileButtons = screen.getAllByRole('button', { name: '选择文件' })
    await user.click(fileButtons[0])
    await user.click(fileButtons[1])

    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    expect(screen.getByLabelText('DS-02 额外规则')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /DS-01.*变更点审查/ }))

    expect(screen.getByLabelText('DS-01 额外规则')).toHaveValue(
      '这是一段只属于 DS-01 的很长额外规则，用于验证详情切换后输入不会串到其他审查项。'
    )
    expect(screen.getAllByText(/BMS_平台_V2.7_低压上下电与故障恢复产品开发需求表/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/PCH-BMS-SPEC-2026-08_整车控制器产品规格书/).length).toBeGreaterThan(0)
    const originalRequirementName = viewModel.sampleTask.selection['DS-01']?.materials[
      'requirement-sheet'
    ][0].name
    await user.click(screen.getAllByRole('button', { name: '更换文件' })[0])
    expect(screen.queryByText(originalRequirementName ?? '')).not.toBeInTheDocument()
    expect(screen.getAllByText(/二次评审修订版/).length).toBeGreaterThan(0)
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        'DS-01': expect.objectContaining({
          extraRules: expect.stringContaining('只属于 DS-01'),
          materials: {
            'requirement-sheet': [expect.objectContaining({ name: expect.stringMatching(/\.xlsx$/) })],
            'product-spec': [expect.objectContaining({ name: expect.stringMatching(/\.pdf$/) })]
          }
        })
      })
    )
  })

  it('支持搜索、分类全选、仅看已选和清空选择', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    const viewModel = adapter.getViewModel()

    render(
      <ReviewItemSelector
        catalog={viewModel.catalog}
        initialSelection={{}}
        commands={adapter.commands}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '可靠性')
    expect(screen.getByText('状态机审核')).toBeInTheDocument()
    expect(screen.queryByText('编码规范审核')).not.toBeInTheDocument()
    await user.clear(screen.getByPlaceholderText('搜索 ID、名称或分类'))

    await user.click(screen.getByRole('checkbox', { name: '选择需求与变更全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 1 项')
    await user.click(screen.getByRole('checkbox', { name: '仅看已选' }))
    const catalogList = screen.getByLabelText('审查项列表')
    expect(within(catalogList).getByText('变更点审查')).toBeInTheDocument()
    expect(within(catalogList).queryByText('状态机审核')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空选择' }))
    expect(within(screen.getByLabelText('审查项列表')).getByText('没有匹配的审查项')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '显示全部' }))
    expect(screen.getByText('状态机审核')).toBeInTheDocument()
  })

  it('synthetic 多文件字段支持按顺序多选、移除并补选材料', async () => {
    const user = userEvent.setup()
    const firstFile: MaterialFileView = {
      id: '/source/第一份证据.pdf',
      name: '第一份证据.pdf',
      sizeLabel: '1 KB'
    }
    const secondFile: MaterialFileView = {
      id: '/source/第二份证据.pdf',
      name: '第二份证据.pdf',
      sizeLabel: '2 KB'
    }
    const replacementFile: MaterialFileView = {
      id: '/source/补选证据.pdf',
      name: '补选证据.pdf',
      sizeLabel: '3 KB'
    }
    const catalog: ReviewItemDefinition[] = [{
      id: 'DS-01',
      category: '测试目录',
      name: '多材料审查',
      summary: '仅用于验证 renderer 多文件交互，不改变生产目录。',
      goal: '验证多文件材料选择。',
      process: ['选择并管理多份材料'],
      specification: 'synthetic 测试定义。',
      materialFields: [{
        id: 'evidence',
        label: '审查证据',
        description: '可选择多份 PDF 证据。',
        required: true,
        extensions: ['.pdf'],
        multiplicity: 'multiple'
      }]
    }]
    const chooseMaterial = vi.fn<WorkbenchCommands['chooseMaterial']>()
      .mockResolvedValueOnce(firstFile)
      .mockResolvedValueOnce(secondFile)
      .mockResolvedValueOnce(replacementFile)
    const onConfirm = vi.fn<(selection: ReviewSelection) => void>()

    render(
      <ReviewItemSelector
        catalog={catalog}
        initialSelection={{}}
        commands={{ chooseMaterial }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 多材料审查' }))
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '选择文件' }))

    expect(chooseMaterial).toHaveBeenNthCalledWith(1, 'DS-01', 'evidence', [])
    expect(chooseMaterial).toHaveBeenNthCalledWith(2, 'DS-01', 'evidence', [firstFile.id])
    expect(screen.getByText(firstFile.name)).toBeInTheDocument()
    expect(screen.getByText(secondFile.name)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `移除 ${firstFile.name}` }))
    expect(screen.queryByText(firstFile.name)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择文件' }))

    expect(chooseMaterial).toHaveBeenNthCalledWith(3, 'DS-01', 'evidence', [secondFile.id])
    expect(screen.getByText(replacementFile.name)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(onConfirm).toHaveBeenCalledWith({
      'DS-01': {
        itemId: 'DS-01',
        extraRules: '',
        materials: { evidence: [secondFile, replacementFile] }
      }
    })
  })

  it('将 Tab 限制在弹窗内，并支持 Escape 取消', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    const viewModel = adapter.getViewModel()
    const onCancel = vi.fn()

    render(
      <ReviewItemSelector
        catalog={viewModel.catalog}
        initialSelection={{}}
        commands={adapter.commands}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )

    const firstButton = screen.getByRole('button', { name: '取消并关闭' })
    const lastButton = screen.getByRole('button', { name: '完成选择（0）' })
    lastButton.focus()
    await user.tab()
    expect(firstButton).toHaveFocus()
    await user.tab({ shift: true })
    expect(lastButton).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
