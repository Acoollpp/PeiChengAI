// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFixtureWorkbenchAdapter } from './fixture-adapter'
import { ReviewWorkbenchPreview } from './ReviewWorkbenchPreview'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ReviewWorkbenchPreview', () => {
  it('运行中任务显示旋转活动反馈并按固定节奏轮换业务提示，非运行状态不显示', () => {
    vi.useFakeTimers()
    const { unmount } = render(<ReviewWorkbenchPreview adapter={createFixtureWorkbenchAdapter()} />)

    const runningRow = screen.getByRole('article', { name: /CR-240806-017/ })
    const preparingRow = screen.getByRole('article', { name: /CR-240806-016/ })
    const waitingRow = screen.getByRole('article', { name: /CR-240806-018/ })

    expect(within(runningRow).getByText('正在执行审查规则与代码证据。')).toBeInTheDocument()
    expect(within(preparingRow).getByText('正在准备任务专属工作区。')).toBeInTheDocument()
    expect(runningRow.querySelector('.wb-task-activity-spinner')).not.toBeNull()
    expect(preparingRow.querySelector('.wb-task-activity-spinner')).not.toBeNull()
    expect(waitingRow.querySelector('.wb-task-activity-spinner')).toBeNull()
    expect(within(waitingRow).getByText('本机等待第 1 位')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4000))

    expect(within(runningRow).getByText('审查正在继续，请保持客户端打开。')).toBeInTheDocument()
    expect(within(preparingRow).getByText('正在整理本次审查输入。')).toBeInTheDocument()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('显示沛城品牌 Logo，并从 view model 派生头像和空选择入口文案', () => {
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

    expect(screen.getByRole('img', { name: '沛城科技' })).toHaveAttribute(
      'src',
      expect.stringContaining('pace-logo.png')
    )
    expect(screen.queryByText('AI 代码审查')).not.toBeInTheDocument()
    expect(screen.getByText('王', { selector: '.wb-avatar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /选择 DS-03、DS-02、DS-01/ })).toBeInTheDocument()
  })

  it('旧 adapter 不提供统计字段时继续显示原有本地计数', () => {
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => {
        const { taskStats: _taskStats, ...legacyViewModel } = fixtureAdapter.getViewModel()
        return legacyViewModel
      }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    const overview = screen.getByLabelText('任务总览')
    expect(within(overview).getByText('正在执行').closest('div')).toHaveTextContent('2')
    expect(within(overview).getByText('本机等待').closest('div')).toHaveTextContent('3')
    expect(within(overview).getByText('今日失败').closest('div')).toHaveTextContent('1')
    expect(within(overview).getByText('今日完成').closest('button')).toHaveTextContent('3')
  })

  it('初始优先当前任务，手动选择需要处理后刷新不覆盖选择', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getByRole('tab', { name: '当前任务 5' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '待处理失败任务 1' }))
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
    await adapter.commands.advanceTasks()

    expect(screen.getByRole('tab', { name: /待处理失败任务/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
  })

  it('没有当前任务但存在失败任务时初始选择需要处理', () => {
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => {
        const viewModel = fixtureAdapter.getViewModel()
        return {
          ...viewModel,
          tasks: viewModel.tasks.filter((task) => task.stage === 'failed')
        }
      }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getByRole('tab', { name: '待处理失败任务 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
  })

  it('只有已完成任务时初始选择已完成任务', () => {
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => {
        const viewModel = fixtureAdapter.getViewModel()
        return {
          ...viewModel,
          tasks: viewModel.tasks.filter((task) => task.stage === 'completed')
        }
      }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getByRole('tab', { name: '已完成任务 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('CR-240806-009 低压上下电状态机复核')).toBeInTheDocument()
    expect(screen.queryByText('暂无当前任务')).not.toBeInTheDocument()
  })

  it('从已完成任务行查看报告时进入报告中心，任务管理页不内嵌 Markdown 预览', async () => {
    const user = userEvent.setup()
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const openReport = vi.fn(fixtureAdapter.commands.openReport)
    const adapter = {
      ...fixtureAdapter,
      commands: { ...fixtureAdapter.commands, openReport }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('tab', { name: '已完成任务 1' }))
    expect(screen.getByLabelText('CR-240806-009 低压上下电状态机复核')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Markdown 报告预览' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '低压上下电状态机复核' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看报告' }))

    expect(openReport).toHaveBeenCalledWith('report-009')
    expect(screen.getByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    const preview = screen.getByRole('article', { name: 'Markdown 报告预览' })
    expect(within(preview).getByRole('heading', { name: '低压上下电状态机复核' })).toBeInTheDocument()
  })

  it('失败任务提供移除按钮并调用隐藏命令', async () => {
    const user = userEvent.setup()
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const hideTask = vi.fn(async () => ({ message: '已从本机列表移除' }))
    const adapter = {
      ...fixtureAdapter,
      commands: { ...fixtureAdapter.commands, hideTask }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('tab', { name: '待处理失败任务 1' }))
    await user.click(
      screen.getByRole('button', { name: '从本机列表移除 CR-240806-012' })
    )

    expect(hideTask).toHaveBeenCalledWith('CR-240806-012')
  })

  it('当前任务不提供移除按钮', async () => {
    const user = userEvent.setup()
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      commands: { ...fixtureAdapter.commands, hideTask: vi.fn() }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('tab', { name: '当前任务 5' }))

    expect(screen.queryByRole('button', { name: /从本机列表移除/ })).not.toBeInTheDocument()
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
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审查' }))
    await user.click(screen.getByRole('button', { name: '完成选择（1）' }))
    const selectionSection = screen.getByRole('heading', { name: '审查项' }).closest('section')
    expect(selectionSection).not.toBeNull()
    expect(within(selectionSection as HTMLElement).getByText('DS-03').closest('.wb-selected-item')).toHaveTextContent('状态机审查')

    await user.click(screen.getByRole('button', { name: '调整' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审查' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    await user.click(screen.getByRole('button', { name: '调整' }))
    expect(screen.getByRole('checkbox', { name: '选择 DS-03 状态机审查' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '选择 DS-02 编码规范审查' })).not.toBeChecked()
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
    expect(screen.queryByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).not.toBeInTheDocument()
    expect(screen.queryByText('任务已由当前用户取消。')).not.toBeInTheDocument()
    expect(screen.queryByText('低压上下电状态机复核')).not.toBeInTheDocument()
    expect(screen.queryByText('可查看报告')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '当前任务 5' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: '待处理失败任务 1' }))
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
    expect(screen.queryByText('本机等待第 3 位')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CR-240806-017 电池包主控状态机变更')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '从头重试 CR-240806-012' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已从头重试')
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: '关闭提示' }))

    await user.click(screen.getByRole('tab', { name: /当前任务/ }))
    const currentRunningTask = screen.getByLabelText('CR-240806-017 电池包主控状态机变更')
    expect(within(currentRunningTask).getByTitle('svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller')).toHaveTextContent(
      'svn://192.168.8.20/bms/platform/trunk/vehicle-control/pack-controller'
    )
    await user.click(screen.getByRole('button', { name: '取消任务 CR-240806-018' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已取消任务 CR-240806-018')

    await user.click(screen.getByRole('button', { name: '推进任务阶段' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已推进一轮本地任务阶段')
  })

  it('报告列表刷新失败时保留错误重试入口和已有报告操作', async () => {
    const user = userEvent.setup()
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => ({
        ...fixtureAdapter.getViewModel(),
        reportListState: {
          status: 'error' as const,
          message: '服务端暂时无法刷新报告列表。'
        }
      }),
      commands: {
        ...fixtureAdapter.commands,
        reloadReportList: async () => ({ message: '正在重新加载报告列表。' })
      }
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: '报告中心' }))

    const errorState = screen.getByRole('alert', { name: '报告列表加载失败' })
    expect(errorState).toHaveTextContent('服务端暂时无法刷新报告列表。')
    expect(within(errorState).getByRole('button', { name: '重新加载报告列表' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /低压上下电状态机复核/ }))

    expect(screen.getByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '低压上下电状态机复核' })).toBeInTheDocument()
  })

  it('报告列表刷新中保留加载提示和已有报告操作', async () => {
    const user = userEvent.setup()
    const fixtureAdapter = createFixtureWorkbenchAdapter()
    const adapter = {
      ...fixtureAdapter,
      getViewModel: () => ({
        ...fixtureAdapter.getViewModel(),
        reportListState: { status: 'loading' as const }
      })
    }

    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: '报告中心' }))

    expect(screen.getByRole('status')).toHaveTextContent('正在加载报告列表。')
    await user.click(screen.getByRole('button', { name: /低压上下电状态机复核/ }))

    expect(screen.getByRole('heading', { name: '报告中心' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '低压上下电状态机复核' })).toBeInTheDocument()
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

  it('从完成数量进入报告中心，并完成意见反馈页基础交互', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    await user.click(screen.getByRole('button', { name: /^今日完成/ }))
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

describe('ReviewWorkbenchPreview · SVN 地址历史', () => {
  const seedRecentSvnUrls = (urls: string[]): void => {
    localStorage.setItem('code-review:recent-svn-urls', JSON.stringify(urls))
  }

  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('聚焦 SVN 地址输入框时显示最近地址并可点击回填', async () => {
    const user = userEvent.setup()
    seedRecentSvnUrls(['https://svn.example.com/A', 'svn://server/legacy'])
    render(<ReviewWorkbenchPreview adapter={createFixtureWorkbenchAdapter()} />)

    const svnInput = screen.getByLabelText('SVN 地址')
    await user.click(svnInput)

    const history = screen.getByRole('listbox', { name: '最近 SVN 地址' })
    expect(within(history).getAllByRole('option')).toHaveLength(2)

    await user.click(within(history).getByRole('option', { name: 'svn://server/legacy' }))

    expect(svnInput).toHaveValue('svn://server/legacy')
    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()
  })

  it('输入 SVN 地址时只显示忽略大小写的包含匹配项，完全匹配时收起', async () => {
    const user = userEvent.setup()
    seedRecentSvnUrls(['https://svn.example.com/A', 'svn://server/legacy'])
    render(<ReviewWorkbenchPreview adapter={createFixtureWorkbenchAdapter()} />)

    const svnInput = screen.getByLabelText('SVN 地址')
    await user.click(svnInput)
    await user.type(svnInput, 'LEGACY')

    const history = screen.getByRole('listbox', { name: '最近 SVN 地址' })
    expect(within(history).getAllByRole('option')).toHaveLength(1)
    expect(within(history).getByRole('option', { name: 'svn://server/legacy' })).toBeInTheDocument()

    await user.clear(svnInput)
    await user.type(svnInput, 'https://svn.example.com/A')

    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()
  })

  it('使用上下方向键高亮历史地址并用 Enter 回填', async () => {
    const user = userEvent.setup()
    seedRecentSvnUrls(['https://svn.example.com/A', 'svn://server/legacy'])
    render(<ReviewWorkbenchPreview adapter={createFixtureWorkbenchAdapter()} />)

    const svnInput = screen.getByLabelText('SVN 地址')
    await user.click(svnInput)
    await user.keyboard('{ArrowDown}')

    const history = screen.getByRole('listbox', { name: '最近 SVN 地址' })
    expect(within(history).getByRole('option', { name: 'https://svn.example.com/A' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{ArrowDown}')
    expect(within(history).getByRole('option', { name: 'svn://server/legacy' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{Enter}')

    expect(svnInput).toHaveValue('svn://server/legacy')
    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()
  })

  it('Escape 和 Tab 收起历史列表且 Tab 直接进入旧 revision', async () => {
    const user = userEvent.setup()
    seedRecentSvnUrls(['https://svn.example.com/A'])
    render(<ReviewWorkbenchPreview adapter={createFixtureWorkbenchAdapter()} />)

    const svnInput = screen.getByLabelText('SVN 地址')
    await user.click(svnInput)
    expect(screen.getByRole('listbox', { name: '最近 SVN 地址' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()

    await user.click(svnInput)
    await user.keyboard('{Tab}')

    expect(screen.queryByRole('listbox', { name: '最近 SVN 地址' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('旧 revision')).toHaveFocus()
  })
})
