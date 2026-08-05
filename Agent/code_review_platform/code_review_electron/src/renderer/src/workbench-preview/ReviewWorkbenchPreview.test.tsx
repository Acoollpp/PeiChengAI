// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

  it('覆盖空数据、取消、重试、阶段推进和报告摘要交互', async () => {
    const user = userEvent.setup()
    const adapter = createFixtureWorkbenchAdapter()
    render(<ReviewWorkbenchPreview adapter={adapter} />)

    expect(screen.getAllByText('正在执行').length).toBeGreaterThan(0)
    expect(screen.getByText('本机等待第 3 位')).toBeInTheDocument()
    expect(screen.getByText('产品规格书在任务开始前已被移动，请重新选择材料后从头重试。')).toBeInTheDocument()
    expect(screen.getByText('任务已由当前用户取消。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '从头重试 CR-240806-012' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已从头重试')
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: '关闭提示' }))

    await user.click(screen.getByRole('button', { name: '取消任务 CR-240806-018' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已取消任务 CR-240806-018')

    await user.click(screen.getByRole('button', { name: '推进模拟阶段' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已推进一轮本地任务阶段')

    await user.click(screen.getByRole('button', { name: /查看 低压上下电状态机复核 报告摘要/ }))
    expect(await screen.findByRole('complementary', { name: '低压上下电状态机复核' })).toHaveTextContent(
      '4 个问题'
    )
    await user.click(screen.getByRole('button', { name: '关闭报告摘要' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '低压上下电状态机复核' })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '空数据' }))
    expect(screen.getByText('暂无执行或等待任务')).toBeInTheDocument()
    expect(screen.getByText('暂无可查看报告')).toBeInTheDocument()
  })
})
