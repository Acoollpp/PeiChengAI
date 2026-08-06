// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixtureWorkbenchAdapter } from './fixture-adapter'
import { ReviewWorkbenchPreview } from './ReviewWorkbenchPreview'

afterEach(cleanup)

describe('ReviewWorkbenchPreview', () => {
  it('从 view model 派生头像和空选择入口文案', () => {
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => {
        const viewModel = fixtureAdapter.getViewModel()
        return {
          ...viewModel,
          userName: '王工程师',
          catalog: [...viewModel.catalog].reverse()
        }
      }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getByText('王', { selector: '.wb-avatar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择 DS-03、DS-02、DS-01/ })).toBeInTheDocument()
  })

  it('从默认不可提交、校验失败切换到可提交，并创建可观察的预览任务', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空任务输入' })).toBeDisabled()
    expect(screen.getByText('信息未完整')).toBeInTheDocument()

    await user.type(screen.getByLabelText('SVN 地址'), 'not-a-svn-path')
    await user.tab()
    expect(
      screen.getByText('SVN 地址必须以 svn://、http:// 或 https:// 开头，请检查完整路径后重试。')
    ).toBeInTheDocument()
    expect(screen.getByText('需要修正')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('旧 revision'))
    await user.type(screen.getByLabelText('旧 revision'), '20')
    await user.clear(screen.getByLabelText('新 revision'))
    await user.type(screen.getByLabelText('新 revision'), '10')
    await user.tab()
    expect(
      screen.getByText('新 revision 必须大于旧 revision；旧 revision 为 0 时将保持原值交由 Skill 判断。')
    ).toBeInTheDocument()
    expect(screen.queryByText(/全量审查/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '填入验收样例' }))
    expect(screen.getByRole('button', { name: '清空任务输入' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '创建审查任务' })).toBeEnabled()
    expect(screen.getByText('可以创建')).toBeInTheDocument()
    const selectionSection = screen.getByRole('heading', { name: '审查项' }).closest('section')
    expect(selectionSection).not.toBeNull()
    expect(within(selectionSection as HTMLElement).getByText('DS-01').closest('.wb-selected-item')).toHaveTextContent('2 个材料文件已就绪')

    await user.click(screen.getByRole('button', { name: '创建审查任务' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/已创建预览任务 CR-240806-/)
    expect(within(screen.getByLabelText('任务总览')).getByText('本机等待').closest('div')).toHaveTextContent('4')
  })

  it('取消选择器草稿时保留上一次已确认选择', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: '选择' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('button', { name: '确认选择（1）' }))
    const selectionSection = screen.getByRole('heading', { name: '审查项' }).closest('section')
    expect(selectionSection).not.toBeNull()
    expect(within(selectionSection as HTMLElement).getByText('DS-03').closest('.wb-selected-item')).toHaveTextContent('状态机审核')

    await user.click(screen.getByRole('button', { name: '调整' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    await user.click(screen.getByRole('button', { name: '调整' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审核' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审核' })).not.toBeChecked()
  })

  it('选择器初始聚焦并在 Escape 关闭后恢复触发按钮焦点', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    const trigger = screen.getByRole('button', { name: '选择' })
    await user.click(trigger)
    expect(screen.getByPlaceholderText('搜索 ID、名称或分类')).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '选择审查项' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('展示三视图导航，并覆盖取消、重试和阶段推进交互', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    const navigation = screen.getByRole('navigation', { name: '工作台视图' })
    expect(within(navigation).getByRole('button', { name: '任务管理' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('button', { name: '报告中心' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: '意见反馈' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完整状态' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '空数据' })).not.toBeInTheDocument()
    expect(screen.getAllByText('正在执行').length).toBeGreaterThan(0)
    expect(screen.getByText('本机等待第 3 位')).toBeInTheDocument()
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
    expect(screen.getByText('任务已由当前用户取消。')).toBeInTheDocument()
    const runningTask = screen.getByLabelText('CR-240806-017 电池包主控状态机变更')
    expect(within(runningTask).getByTitle('svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller')).toHaveTextContent(
      'svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller'
    )

    const reportRow = screen.getByText('低压上下电状态机复核').closest('.wb-management-report-row')
    expect(reportRow).not.toBeNull()
    expect(within(reportRow as HTMLElement).getByTitle('svn://192.168.8.20/bms/platform/trunk/power-mode')).toHaveTextContent(
      'svn://192.168.8.20/bms/platform/trunk/power-mode'
    )
    expect(reportRow).toHaveTextContent('CR-240806-009 · DS-03')

    await user.click(screen.getByRole('button', { name: '从头重试 CR-240806-012' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已从头重试')
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: '关闭提示' }))

    await user.click(screen.getByRole('button', { name: '取消任务 CR-240806-018' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已取消任务 CR-240806-018')

    await user.click(screen.getByRole('button', { name: '推进任务阶段' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已推进一轮本地任务阶段')
  })

  it('在报告中心选择真实 Markdown 报告并触发 PDF 预览命令', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: '报告中心' }))
    expect(screen.queryByRole('heading', { name: '创建审查任务' })).not.toBeInTheDocument()
    const preview = screen.getByRole('article', { name: 'Markdown 报告预览' })
    expect(within(preview).getByRole('heading', { name: '低压上下电状态机复核' })).toBeInTheDocument()
    expect(within(preview).getByRole('table')).toHaveTextContent('处置建议')

    const socReportButton = screen.getByRole('button', { name: /SOC 滤波边界复查/ })
    expect(within(socReportButton).getByTitle('svn://192.168.8.20/bms/algorithm/trunk/soc-estimation')).toHaveTextContent(
      'svn://192.168.8.20/bms/algorithm/trunk/soc-estimation'
    )
    expect(socReportButton).toHaveTextContent('CR-240806-007 · r8920 → r8934')
    await user.click(socReportButton)
    expect(socReportButton).toHaveAttribute('aria-current', 'page')
    expect(within(preview).getByRole('heading', { name: 'SOC 滤波边界复查' })).toBeInTheDocument()
    expect(within(preview).getByText(/未发现需要报告的问题/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已打开《SOC 滤波边界复查》PDF 报告。')
  })

  it('从任务表进入报告中心，并完成意见反馈页基础交互', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getAllByRole('button', { name: /查看报告/ })[0])
    expect(screen.getByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '低压上下电状态机复核' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '意见反馈' }))
    expect(screen.queryByRole('heading', { name: '创建审查任务' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '提交意见' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写问题描述。')

    await user.type(screen.getByLabelText('问题描述'), '任务在环境检查阶段停留，重新进入页面后仍未推进。')
    await user.click(screen.getByRole('button', { name: '添加截图' }))
    expect(screen.getByText('任务阶段停留在环境检查.png')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '提交意见' }))
    expect(await screen.findByRole('status')).toHaveTextContent('意见已提交，包含 1 张截图。')
    expect(screen.getByLabelText('问题描述')).toHaveValue('')
  })

  it('反馈截图最多添加五张且保持唯一，移除时只删除目标截图', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: '意见反馈' }))
    const addButton = screen.getByRole('button', { name: '添加截图' })
    const screenshotNames = [
      '任务阶段停留在环境检查.png',
      '报告列表未刷新.webp',
      '长路径显示问题.jpg',
      '任务等待序号异常.png',
      '报告预览滚动位置.webp'
    ]

    for (let index = 0; index < 5; index += 1) {
      await user.click(addButton)
    }

    screenshotNames.forEach((name) => expect(screen.getByText(name)).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(5)

    await user.click(addButton)
    expect(screen.getByRole('alert')).toHaveTextContent('最多只能添加 5 张截图。')
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(5)

    await user.click(screen.getByRole('button', { name: '移除 任务等待序号异常.png' }))
    expect(screen.queryByText('任务等待序号异常.png')).not.toBeInTheDocument()
    screenshotNames
      .filter((name) => name !== '任务等待序号异常.png')
      .forEach((name) => expect(screen.getByText(name)).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(4)
  })
})
