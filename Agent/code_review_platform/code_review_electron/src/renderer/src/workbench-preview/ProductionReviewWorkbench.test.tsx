// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodeReviewApi } from '../code-review-api'
import type { TaskProgressEvent } from '../../../shared/types'
import { ProductionReviewWorkbench } from './ProductionReviewWorkbench'
import type { ReviewItemDefinition } from './types'

const reportMarkdown = `# DS-03 状态机审核报告

## 一、审查问题

### P01 [高风险] 状态恢复事件缺失

**问题描述：** 恢复分支没有发送完成事件。
`

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    readTaskReport: vi.fn(async () => reportMarkdown),
    preflightTask: vi.fn(async () => ({ status: 'valid' as const })),
    executeTask: vi.fn(async () => ({
      taskId: 'task-production-1',
      status: 'success' as const,
      reportMarkdown,
      reportPath: '/reports/task-production-1.md',
      pdfPath: '/reports/task-production-1.pdf',
      pdfReportName: 'task-production-1.pdf',
      feedbackProtocolVersion: 1
    })),
    retryTask: vi.fn(),
    cancelTask: vi.fn(async () => ({ status: 'cancelled' as const })),
    onTaskProgress: vi.fn(() => vi.fn()),
    selectReviewMaterialFile: vi.fn(async () => ({ status: 'cancelled' as const })),
    openPdfReport: vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/reports/task-production-1.pdf'
    })),
    openReportFeedbackWindow: vi.fn(async () => true),
    submitNegativeReportFeedback: vi.fn(async (taskId: string) => ({
      taskId, helpful: false, usefulIssuesText: null
    })),
    openTaskLog: vi.fn(async () => ({ status: 'ready' as const, logPath: '/logs/task.log' })),
    readReportAsset: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,aW1hZ2U=' })),
    showTaskCompletionNotification: vi.fn(async () => ({ status: 'shown' as const })),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' as const })),
    onReportFeedbackSubmitted: vi.fn(() => vi.fn()),
    onIssueFeedbackSubmitted: vi.fn(() => vi.fn()),
    onReportFeedbackFocusAnchor: vi.fn(() => vi.fn())
  } as unknown as CodeReviewApi
}

const productionProps = {
  currentUser: {
    id: 'user-1',
    full_name: '王工程师',
    department_id: 'dept-1',
    department_name: 'BMS 软件部'
  },
  environment: { status: 'ready' as const },
  isCheckingEnvironment: false,
  isInstallingSkillDuringCheck: false,
  isInstallingCodex: false,
  isInstallingSvn: false,
  onRefreshEnvironment: vi.fn(),
  onInstallCodex: vi.fn(),
  onInstallSvn: vi.fn(),
  onInstallSkill: vi.fn()
}

const longNameStressCatalog: ReviewItemDefinition[] = [
  {
    id: 'DS-03',
    category: '设计与安全',
    name: '状态机审核与故障恢复及跨模式安全降级边界条件完整性联合审查（超长名称视觉压力样例）',
    summary: '仅用于开发验收长名称布局，不改变正式目录。',
    goal: '验证长审查项名称的布局。',
    process: ['使用真实生产组件渲染'],
    specification: '仅用于视觉验收。',
    materialFields: []
  }
]

const submitMinimalDs03Task = async (svnUrl: string): Promise<void> => {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('SVN 地址'), svnUrl)
  await user.type(screen.getByLabelText('旧 revision'), '0')
  await user.type(screen.getByLabelText('新 revision'), '12')
  await user.click(screen.getByRole('button', { name: '选择' }))
  await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
  await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
  await user.click(screen.getByRole('button', { name: '创建审查任务' }))
}

const mockRendererForeground = (foreground: boolean): void => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(foreground ? 'visible' : 'hidden')
  vi.spyOn(document, 'hasFocus').mockReturnValue(foreground)
}

beforeEach(() => {
  setupCodeReviewApi()
  mockRendererForeground(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProductionReviewWorkbench', () => {
  it('默认使用正式目录，只在显式注入时渲染长名称压力目录', async () => {
    const user = userEvent.setup()
    const firstRender = render(<ProductionReviewWorkbench {...productionProps} />)

    await user.click(await screen.findByRole('button', { name: '选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    expect(screen.queryByText(longNameStressCatalog[0].name)).not.toBeInTheDocument()

    firstRender.unmount()
    render(
      <ProductionReviewWorkbench
        {...productionProps}
        catalogOverride={longNameStressCatalog}
      />
    )
    await user.click(await screen.findByRole('button', { name: '选择' }))
    expect(
      screen.getByRole('checkbox', {
        name: `选择 DS-03 ${longNameStressCatalog[0].name}`
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('编码规范审核')).not.toBeInTheDocument()
  })

  it('从生产工作台原样提交 r0 和 DS-03 规则，并打开真实 Markdown、PDF 与逐问题反馈', async () => {
    const user = userEvent.setup()
    render(
      <ProductionReviewWorkbench {...productionProps} />
    )

    expect(await screen.findByRole('heading', { name: '创建审查任务' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '填入验收样例' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '推进任务阶段' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://server/project')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), '10772')
    await user.click(screen.getByRole('button', { name: '选择' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    await user.type(screen.getByLabelText('DS-03 额外规则'), '重点检查故障恢复路径')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => {
      expect(window.codeReview.preflightTask).toHaveBeenCalledWith({
        svn_url: 'svn://server/project',
        old_revision: '0',
        new_revision: '10772'
      })
      expect(window.codeReview.executeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          svn_url: 'svn://server/project',
          old_revision: '0',
          new_revision: '10772',
          review_items: [{ id: 'DS-03', user_extra_rules: '重点检查故障恢复路径' }],
          skill_name: 'bms-code-reviewer'
        })
      )
    })

    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
    const completionMessage = await screen.findByText('任务 task-production-1 已完成，可查看报告。')
    const completionNotice = completionMessage.closest('[role="status"]')
    expect(completionNotice).not.toBeNull()
    expect(completionNotice).toHaveTextContent('任务 task-production-1 已完成，可查看报告。')
    await user.click(within(completionNotice as HTMLElement).getByRole('button', { name: '查看报告' }))
    expect(await screen.findByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    const preview = screen.getByRole('article', { name: 'Markdown 报告预览' })
    expect(within(preview).getByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
    expect(screen.getAllByText(/1 个问题.*严重度未知/).length).toBeGreaterThan(0)

    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '反馈报告问题' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'issues',
      taskId: 'task-production-1',
      anchors: expect.any(Array)
    })
  })

  it('从正式目录单独提交 DS-02，原样保留 revision 且不产生材料字段', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds02-only')
    await user.type(screen.getByLabelText('旧 revision'), 'r0')
    await user.type(screen.getByLabelText('新 revision'), 'R42')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '代码质量')
    expect(screen.getByText('代码质量')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择 DS-01 变更点审查' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    expect(screen.getByRole('article', { name: 'DS-02 编码规范审核 详情' })).toHaveTextContent(
      '具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护'
    )
    expect(screen.getByText('此审查项不需要专项材料。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择文件' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('DS-02 额外规则'), '仅检查本次新增的诊断模块')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(screen.getByText('DS-02').closest('.wb-selected-item')).toHaveTextContent('无需专项材料')
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds02-only',
        old_revision: 'r0',
        new_revision: 'R42',
        skill_name: 'bms-code-reviewer',
        review_items: [{ id: 'DS-02', user_extra_rules: '仅检查本次新增的诊断模块' }]
      })
    ))
    expect(window.codeReview.selectReviewMaterialFile).not.toHaveBeenCalled()
  })

  it('通过系统文件选择器提交 DS-01 的 Excel、PDF 和独立额外规则', async () => {
    const user = userEvent.setup()
    const longRequirementName = 'BMS_平台_V2.7_低压上下电与故障恢复产品开发需求表_最终评审修订版_20260806.xlsx'
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: `/local/materials/${longRequirementName}`,
        fileName: longRequirementName,
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/产品规格书.pdf',
        fileName: '产品规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), '130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对本次协议导入')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    const longName = await screen.findByText(longRequirementName)
    expect(longName).toHaveAttribute('title', longRequirementName)
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('已选 1 项 · 2 个材料文件')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds01',
        old_revision: '120',
        new_revision: '130',
        skill_name: 'bms-code-reviewer',
        review_items: [{
          id: 'DS-01',
          user_extra_rules: '仅核对本次协议导入',
          materials: [
            {
              field_id: 'requirement-sheet',
              file_paths: [`/local/materials/${longRequirementName}`]
            },
            { field_id: 'product-spec', file_paths: ['/local/materials/产品规格书.pdf'] }
          ]
        }]
      })
    ))
  })

  it('同时提交 DS-01 和 DS-03，并保留各自额外规则与材料边界', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/组合审查需求表.xlsx',
        fileName: '组合审查需求表.xlsx',
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/组合审查规格书.pdf',
        fileName: '组合审查规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/multi-items')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), 'R130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '只核对协议导入与第五章')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    expect(screen.getByText('此审查项不需要专项材料。')).toBeInTheDocument()
    await user.type(screen.getByLabelText('DS-03 额外规则'), '只检查故障恢复状态')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))

    expect(screen.getByText('已选 2 项 · 2 个材料文件')).toBeInTheDocument()
    expect(screen.getByText('DS-01').closest('.wb-selected-item')).toHaveTextContent('2 个材料文件已就绪')
    expect(screen.getByText('DS-03').closest('.wb-selected-item')).toHaveTextContent('无需专项材料')
    expect(screen.queryByText('当前版本每个任务只能选择一个审查项。')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/multi-items',
        old_revision: '120',
        new_revision: 'R130',
        skill_name: 'bms-code-reviewer',
        review_items: [
          {
            id: 'DS-01',
            user_extra_rules: '只核对协议导入与第五章',
            materials: [
              {
                field_id: 'requirement-sheet',
                file_paths: ['/local/materials/组合审查需求表.xlsx']
              },
              {
                field_id: 'product-spec',
                file_paths: ['/local/materials/组合审查规格书.pdf']
              }
            ]
          },
          { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
        ]
      })
    ))
  })

  it('提交 DS-01 + DS-02 时 Excel/PDF 只归属 DS-01', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile)
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/DS01-DS02-需求表.xlsx',
        fileName: 'DS01-DS02-需求表.xlsx',
        fileSize: 2048
      })
      .mockResolvedValueOnce({
        status: 'selected',
        filePath: '/local/materials/DS01-DS02-规格书.pdf',
        fileName: 'DS01-DS02-规格书.pdf',
        fileSize: 4096
      })
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01-ds02')
    await user.type(screen.getByLabelText('旧 revision'), '220')
    await user.type(screen.getByLabelText('新 revision'), 'R230')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.type(screen.getByLabelText('DS-01 额外规则'), '仅核对产品需求')
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '选择文件' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '仅检查新增诊断代码')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds01-ds02',
        old_revision: '220',
        new_revision: 'R230',
        review_items: [
          {
            id: 'DS-01',
            user_extra_rules: '仅核对产品需求',
            materials: [
              {
                field_id: 'requirement-sheet',
                file_paths: ['/local/materials/DS01-DS02-需求表.xlsx']
              },
              {
                field_id: 'product-spec',
                file_paths: ['/local/materials/DS01-DS02-规格书.pdf']
              }
            ]
          },
          { id: 'DS-02', user_extra_rules: '仅检查新增诊断代码' }
        ]
      })
    ))
  })

  it('提交 DS-02 + DS-03 时逐项额外规则隔离且均无材料', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds02-ds03')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), 'R330')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '只检查命名一致性')
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: /DS-03.*状态机审核/ }))
    await user.type(screen.getByLabelText('DS-03 额外规则'), '只检查故障恢复状态')
    await user.click(screen.getByRole('button', { name: '完成选择（2）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://server/ds02-ds03',
        old_revision: '0',
        new_revision: 'R330',
        review_items: [
          { id: 'DS-02', user_extra_rules: '只检查命名一致性' },
          { id: 'DS-03', user_extra_rules: '只检查故障恢复状态' }
        ]
      })
    ))
    expect(window.codeReview.selectReviewMaterialFile).not.toHaveBeenCalled()
  })

  it('生产分类工具操作真实草稿，取消后不回填', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await screen.findByRole('heading', { name: '创建审查任务' })
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.type(screen.getByPlaceholderText('搜索 ID、名称或分类'), '代码质量')
    await user.click(screen.getByRole('checkbox', { name: '选择代码质量全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 1 项')
    await user.clear(screen.getByPlaceholderText('搜索 ID、名称或分类'))
    await user.click(screen.getByRole('checkbox', { name: '选择设计与安全全部审查项' }))
    expect(screen.getByRole('dialog').querySelector('.wb-selector-count')).toHaveTextContent('已选 2 项')
    await user.click(screen.getByRole('checkbox', { name: '仅看已选' }))
    const catalogList = screen.getByLabelText('审查项列表')
    expect(within(catalogList).getByText('编码规范审核')).toBeInTheDocument()
    expect(within(catalogList).getByText('状态机审核')).toBeInTheDocument()
    expect(within(catalogList).queryByText('变更点审查')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空选择' }))
    expect(within(catalogList).getByText('没有匹配的审查项')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByText('尚未确定本次审查范围')).toBeInTheDocument()
  })

  it('只有完成选择回填；取消、关闭、Escape 和遮罩退出均恢复已确认草稿', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)

    await screen.findByRole('heading', { name: '创建审查任务' })
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: /DS-02.*编码规范审核/ }))
    await user.type(screen.getByLabelText('DS-02 额外规则'), '上一次已确认规则')
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    expect(screen.getByText('DS-02').closest('.wb-selected-item')).toHaveTextContent('已填写额外规则')

    const assertConfirmedDraftRestored = async (): Promise<void> => {
      expect(screen.getByLabelText('DS-02 额外规则')).toHaveValue('上一次已确认规则')
      expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' })).not.toBeChecked()
    }
    const changeDraft = async (): Promise<void> => {
      await user.clear(screen.getByLabelText('DS-02 额外规则'))
      await user.type(screen.getByLabelText('DS-02 额外规则'), '本轮未确认规则')
      await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    }

    let adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.click(screen.getByRole('button', { name: '取消' }))

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.click(screen.getByRole('button', { name: '取消并关闭' }))

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(adjustButton).toHaveFocus())

    adjustButton = screen.getByRole('button', { name: '调整' })
    await user.click(adjustButton)
    await assertConfirmedDraftRestored()
    await changeDraft()
    const backdrop = screen.getByRole('dialog').parentElement
    if (!backdrop) throw new Error('选择器应存在遮罩层')
    fireEvent.mouseDown(backdrop)

    await user.click(screen.getByRole('button', { name: '调整' }))
    await assertConfirmedDraftRestored()
  })

  it('DS-01 一次显示缺失材料和错误扩展名', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.selectReviewMaterialFile).mockResolvedValueOnce({
      status: 'selected',
      filePath: '/local/materials/错误格式.txt',
      fileName: '错误格式.txt',
      fileSize: 128
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/ds01-invalid')
    await user.type(screen.getByLabelText('旧 revision'), '120')
    await user.type(screen.getByLabelText('新 revision'), '130')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-01 变更点审查' }))
    await user.click(screen.getAllByRole('button', { name: '选择文件' })[0])
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))

    expect(screen.getByRole('alert')).toHaveTextContent('DS-01 产品开发需求表仅支持 .xlsx、.xls 文件')
    expect(screen.getByRole('alert')).toHaveTextContent('DS-01 产品规格书未选择')
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    expect(window.codeReview.executeTask).not.toHaveBeenCalled()
  })

  it('后台系统通知成功时不显示应用内完成提醒，点击通知可打开对应 Markdown', async () => {
    let notificationClick: Parameters<CodeReviewApi['onTaskCompletionNotificationClicked']>[0] | undefined
    mockRendererForeground(false)
    vi.mocked(window.codeReview.onTaskCompletionNotificationClicked).mockImplementation((listener) => {
      notificationClick = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await submitMinimalDs03Task('svn://server/background-shown')

    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('任务 task-production-1 已完成，可查看报告。')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    const payload = vi.mocked(window.codeReview.showTaskCompletionNotification).mock.calls[0][0]
    act(() => notificationClick?.(payload))
    expect(await screen.findByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Markdown 报告预览' }))
      .getByRole('heading', { name: 'DS-03 状态机审核报告' })).toBeInTheDocument()
  })

  it.each([
    ['系统不支持', async () => ({ status: 'unsupported' as const })],
    ['系统调用失败', async () => { throw new Error('系统通知失败') }]
  ])('后台%s时降级为可操作的应用内完成提醒', async (_label, notificationResult) => {
    mockRendererForeground(false)
    vi.mocked(window.codeReview.showTaskCompletionNotification).mockImplementationOnce(notificationResult)
    render(<ProductionReviewWorkbench {...productionProps} />)
    await submitMinimalDs03Task('svn://server/background-fallback')

    const completionMessage = await screen.findByText('任务 task-production-1 已完成，可查看报告。')
    const completionNotice = completionMessage.closest('[role="status"]')
    expect(completionNotice).not.toBeNull()
    expect(completionNotice).toHaveTextContent('任务 task-production-1 已完成，可查看报告。')
    expect(within(completionNotice as HTMLElement).getByRole('button', { name: '查看报告' })).toBeInTheDocument()
    expect(screen.queryByText(/系统通知发送失败/)).not.toBeInTheDocument()
    await userEvent.setup().click(within(completionNotice as HTMLElement).getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('兼容缺少新字段的历史任务，并从真实阶段事件显示准备工作区', async () => {
    let progressListener: ((event: TaskProgressEvent) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'legacy-success',
          svn_url: 'svn://server/legacy',
          old_revision: '0',
          new_revision: '12',
          status: 'success',
          finished_at: '2026-08-06T08:00:00Z'
        },
        {
          id: 'running-1',
          svn_url: 'svn://server/running',
          old_revision: '20',
          new_revision: '21',
          review_item_ids: ['DS-03'],
          status: 'checking_environment'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.onTaskProgress).mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })

    render(<ProductionReviewWorkbench {...productionProps} />)

    expect(await screen.findByText('审查任务 legacy-success')).toBeInTheDocument()
    expect(screen.getByText('r0 → r12')).toBeInTheDocument()
    expect(screen.getByText(/1 个.*严重度未知/)).toBeInTheDocument()
    expect(screen.getByText(/严重度未知/)).toBeInTheDocument()
    progressListener?.({
      taskId: 'running-1',
      type: 'stage',
      stage: 'preparing_workspace',
      message: '正在准备真实工作区'
    })
    expect(await screen.findByText('准备工作区')).toBeInTheDocument()
    expect(screen.getByText('正在准备真实工作区')).toBeInTheDocument()
  })

  it('revision 接受可选 r 前缀，展示保持单个 r 且提交保留用户输入', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/prefixed')
    await user.type(screen.getByLabelText('旧 revision'), 'r0')
    await user.type(screen.getByLabelText('新 revision'), 'R12')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    await waitFor(() => expect(window.codeReview.preflightTask).toHaveBeenCalledWith({
      svn_url: 'svn://server/prefixed', old_revision: 'r0', new_revision: 'R12'
    }))
    expect(window.codeReview.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      old_revision: 'r0', new_revision: 'R12'
    }))
    expect(await screen.findByText('r0 → r12')).toBeInTheDocument()
    expect(screen.queryByText(/rr0|rR12/)).not.toBeInTheDocument()
  })

  it('生产报告通过 MarkdownPreview 读取相对图片资源', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'asset-task', svn_url: 'svn://server/assets', old_revision: '0', new_revision: 'r12',
        review_item_ids: ['DS-03'], status: 'success', report_path: '/reports/asset/report.md'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.readTaskReport).mockResolvedValueOnce(
      '# 状态机报告\n\n![状态图](images/state.png)'
    )
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[0])
    await waitFor(() => expect(window.codeReview.readReportAsset).toHaveBeenCalledWith({
      reportPath: '/reports/asset/report.md', assetPath: 'images/state.png'
    }))
    expect(await screen.findByRole('img', { name: '状态图' })).toHaveAttribute(
      'src', 'data:image/png;base64,aW1hZ2U='
    )
  })

  it('快速切换报告时迟到加载结果不会串到当前报告', async () => {
    const user = userEvent.setup()
    let resolveReportB: ((value: string) => void) | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        { id: 'task-a', svn_url: 'svn://server/a', old_revision: '1', new_revision: '2', status: 'success' },
        { id: 'task-b', svn_url: 'svn://server/b', old_revision: '2', new_revision: '3', status: 'success' }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.readTaskReport)
      .mockResolvedValueOnce('# 报告 A')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReportB = resolve }))
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[1])
    await user.click(screen.getByRole('button', { name: /task-a/ }))
    expect(await screen.findByRole('heading', { name: '报告 A' })).toBeInTheDocument()
    act(() => resolveReportB?.('# 报告 B'))
    await waitFor(() => expect(screen.getByRole('heading', { name: '报告 A' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '报告 B' })).not.toBeInTheDocument()
  })

  it('把生产任务取消和失败任务重试交给本地队列', async () => {
    const user = userEvent.setup()
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        {
          id: 'running-1', svn_url: 'svn://server/running', old_revision: '1', new_revision: '2',
          review_item_ids: ['DS-03'], status: 'running_codex'
        },
        {
          id: 'failed-1', svn_url: 'svn://server/failed', old_revision: '2', new_revision: '3',
          review_item_ids: ['DS-03'], status: 'failed', error_message: '执行失败'
        }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.retryTask).mockResolvedValueOnce({
      taskId: 'failed-1', status: 'success', reportMarkdown
    })
    render(<ProductionReviewWorkbench {...productionProps} />)

    vi.mocked(window.codeReview.openTaskLog).mockResolvedValueOnce({ status: 'missing' })
    await user.click(await screen.findByRole('button', { name: '打开任务日志 failed-1' }))
    expect(window.codeReview.openTaskLog).toHaveBeenCalledWith('failed-1')
    expect(await screen.findByRole('status')).toHaveTextContent('未找到该任务的本地 Codex 执行日志。')
    await user.click(await screen.findByRole('button', { name: '取消任务 running-1' }))
    expect(window.codeReview.cancelTask).toHaveBeenCalledWith({
      client_task_id: 'running-1', task_id: 'running-1'
    })
    await user.click(screen.getByRole('button', { name: '从头重试 failed-1' }))
    await waitFor(() => expect(window.codeReview.retryTask).toHaveBeenCalledWith({
      task_id: 'failed-1', client_task_id: 'failed-1',
      old_revision: '2', new_revision: '3',
      requirement_file_path: undefined, review_items: undefined
    }))
  })

  it('意见反馈只提交用户实际选择的文件，不生成 fixture 截图', async () => {
    const user = userEvent.setup()
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: '意见反馈' }))
    await user.type(screen.getByLabelText('问题描述'), '生产任务阶段显示异常')
    const screenshot = new File(['image'], '真实截图.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择反馈截图'), [screenshot, screenshot])
    expect(screen.getByText('真实截图.png')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '移除 真实截图.png' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '提交意见' }))
    await waitFor(() => expect(window.codeReview.submitFeedback).toHaveBeenCalledWith({
      description: '生产任务阶段显示异常', screenshots: [screenshot]
    }))
  })

  it('环境未就绪时保留安装入口并禁止提交生产任务', async () => {
    render(<ProductionReviewWorkbench {...productionProps} environment={{ status: 'missing_skill' }} />)
    expect(await screen.findByLabelText('本地环境状态')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    expect(screen.getByText('本地环境就绪后才可发起审查。')).toBeInTheDocument()
  })

  it('问题反馈提交事件更新反馈版 PDF 路径', async () => {
    const user = userEvent.setup()
    let issueFeedbackListener: Parameters<CodeReviewApi['onIssueFeedbackSubmitted']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'feedback-task', svn_url: 'svn://server/feedback', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', feedback_protocol_version: 1,
        pdf_report_name: '原始报告.pdf'
      }],
      count: 1
    })
    vi.mocked(window.codeReview.onIssueFeedbackSubmitted).mockImplementation((listener) => {
      issueFeedbackListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await screen.findByRole('button', { name: /查看报告/ })
    await user.click(screen.getByRole('button', { name: /查看报告/ }))
    expect(screen.getByRole('button', { name: '反馈报告问题' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    act(() => issueFeedbackListener?.({
      taskId: 'feedback-task',
      feedbackSubmittedAt: '2026-08-06T09:00:00Z',
      pdfPath: '/reports/feedback-task-reviewed.pdf',
      pdfReportName: '反馈版报告.pdf'
    }))
    expect(await screen.findByRole('button', { name: '查看已提交反馈' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '反馈报告问题' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看已提交反馈' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'issues', taskId: 'feedback-task', anchors: expect.any(Array)
    })
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'feedback-task',
      localPdfPath: '/reports/feedback-task-reviewed.pdf',
      pdfReportName: '反馈版报告.pdf',
      action: 'reveal'
    })
  })

  it('只响应当前报告的反馈锚点并在切换报告时清理高亮', async () => {
    const user = userEvent.setup()
    let focusAnchorListener: Parameters<CodeReviewApi['onReportFeedbackFocusAnchor']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [
        { id: 'anchor-a', svn_url: 'svn://server/a', old_revision: '1', new_revision: '2', status: 'success', feedback_protocol_version: 1 },
        { id: 'anchor-b', svn_url: 'svn://server/b', old_revision: '2', new_revision: '3', status: 'success', feedback_protocol_version: 1 }
      ],
      count: 2
    })
    vi.mocked(window.codeReview.onReportFeedbackFocusAnchor).mockImplementation((listener) => {
      focusAnchorListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click((await screen.findAllByRole('button', { name: /查看报告/ }))[0])
    const previewScroll = document.querySelector('.preview-scroll') as HTMLDivElement
    previewScroll.scrollTo = vi.fn()
    const issueBlock = document.querySelector('[data-report-issue-anchor-id="report-option-4"]')
    expect(issueBlock).not.toHaveClass('report-issue-block-active')

    act(() => focusAnchorListener?.({ taskId: 'anchor-b', anchorId: 'report-option-4' }))
    expect(issueBlock).not.toHaveClass('report-issue-block-active')
    act(() => focusAnchorListener?.({ taskId: 'anchor-a', anchorId: 'report-option-4' }))
    expect(issueBlock).toHaveClass('report-issue-block-active')

    await user.click(screen.getByRole('button', { name: /anchor-b/ }))
    await waitFor(() => expect(document.querySelector('.report-issue-block-active')).not.toBeInTheDocument())
  })

  it('旧协议只由当前报告的反馈提交事件自动打开 PDF', async () => {
    const user = userEvent.setup()
    let feedbackSubmittedListener: Parameters<CodeReviewApi['onReportFeedbackSubmitted']>[0] | undefined
    vi.mocked(window.codeReview.listTasks).mockResolvedValueOnce({
      data: [{
        id: 'legacy-feedback', svn_url: 'svn://server/legacy-feedback', old_revision: '1', new_revision: '2',
        review_item_ids: ['DS-03'], status: 'success', report_feedback_helpful: null
      }],
      count: 1
    })
    vi.mocked(window.codeReview.onReportFeedbackSubmitted).mockImplementation((listener) => {
      feedbackSubmittedListener = listener
      return vi.fn()
    })
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.click(await screen.findByRole('button', { name: /查看报告/ }))
    await user.click(screen.getByRole('button', { name: '报告有帮助' }))
    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      mode: 'legacy', taskId: 'legacy-feedback', options: expect.any(Array)
    })
    await user.click(screen.getByRole('button', { name: '报告没帮助' }))
    expect(window.codeReview.submitNegativeReportFeedback).toHaveBeenCalledTimes(1)
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    expect(await screen.findByText('反馈已提交')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '报告有帮助' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '报告没帮助' })).not.toBeInTheDocument()

    act(() => feedbackSubmittedListener?.({
      taskId: 'other-task', helpful: false, usefulIssuesText: null
    }))
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    act(() => feedbackSubmittedListener?.({
      taskId: 'legacy-feedback', helpful: false, usefulIssuesText: null
    }))
    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'legacy-feedback', localPdfPath: undefined, pdfReportName: undefined
    }))
  })

  it('任务创建和通用意见反馈提交中均防止重复调用', async () => {
    const user = userEvent.setup()
    let resolvePreflight: ((value: { status: 'valid' }) => void) | undefined
    vi.mocked(window.codeReview.preflightTask).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreflight = resolve
    }))
    render(<ProductionReviewWorkbench {...productionProps} />)
    await user.type(await screen.findByLabelText('SVN 地址'), 'svn://server/no-duplicate')
    await user.type(screen.getByLabelText('旧 revision'), '0')
    await user.type(screen.getByLabelText('新 revision'), '12')
    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    const createButton = screen.getByRole('button', { name: '创建审查任务' })
    fireEvent.click(createButton)
    fireEvent.click(createButton)
    expect(window.codeReview.preflightTask).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '创建中...' })).toBeDisabled()
    act(() => resolvePreflight?.({ status: 'valid' }))
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    let resolveFeedback: ((value: { id: string; status: 'pending' }) => void) | undefined
    vi.mocked(window.codeReview.submitFeedback).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFeedback = resolve
    }))
    await user.click(screen.getByRole('button', { name: '意见反馈' }))
    await user.type(screen.getByLabelText('问题描述'), '防重复提交')
    const feedbackButton = screen.getByRole('button', { name: '提交意见' })
    fireEvent.click(feedbackButton)
    fireEvent.click(feedbackButton)
    expect(window.codeReview.submitFeedback).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled()
    act(() => resolveFeedback?.({ id: 'feedback-once', status: 'pending' }))
    await waitFor(() => expect(screen.getByLabelText('问题描述')).toHaveValue(''))
  })
})
