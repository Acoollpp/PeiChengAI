// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskPage } from './TaskPage'
import type { CodeReviewApi } from '../code-review-api'

const setupCodeReviewApi = (): void => {
  window.codeReview = {
    loadServerConfig: vi.fn(),
    loadCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    keyLogin: vi.fn(),
    svnLogin: vi.fn(),
    listTasks: vi.fn(async () => ({ data: [], count: 0 })),
    readTaskReport: vi.fn(),
    readReportAsset: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      contentType: 'image/png'
    })),
    executeTask: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    downloadCurrentReport: vi.fn(),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(),
    onEnvironmentProgress: vi.fn(() => vi.fn()),
    bindSvnCredential: vi.fn(),
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' }))
  } as unknown as CodeReviewApi
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

const renderReadyTaskPage = (): ReturnType<typeof render> =>
  render(
    <TaskPage
      environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
      isCheckingEnvironment={false}
      isInstallingSkillDuringCheck={false}
      isInstallingCodex={false}
      isInstallingSvn={false}
      svnUsername="Key 用户"
      onRefreshEnvironment={vi.fn()}
      onInstallCodex={vi.fn()}
      onInstallSvn={vi.fn()}
      onInstallSkill={vi.fn()}
    />
  )

const fillTaskForm = async (
  user: ReturnType<typeof userEvent.setup>,
  suffix: string
): Promise<void> => {
  await user.clear(screen.getByLabelText('SVN 地址'))
  await user.type(screen.getByLabelText('SVN 地址'), `svn://repo/project-${suffix}`)
  await user.clear(screen.getByLabelText('旧版本号'))
  await user.type(screen.getByLabelText('旧版本号'), `${suffix}0`)
  await user.clear(screen.getByLabelText('新版本号'))
  await user.type(screen.getByLabelText('新版本号'), `${suffix}1`)
}

const openHistoryTasks = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await user.click(await screen.findByRole('tab', { name: /历史任务/ }))
  return screen.getByRole('tabpanel', { name: '历史任务' })
}

beforeEach(() => {
  setupCodeReviewApi()
})

afterEach(() => {
  cleanup()
})

describe('TaskPage', () => {
  it('提交任务时 executeTask payload 包含默认模板字段', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-1',
      status: 'success' as const,
      reportMarkdown: '# 审查报告',
      reportPath: '/tmp/report.md'
    }))

    render(
      <TaskPage
        environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        svn_url: 'svn://repo/project',
        old_revision: '12',
        new_revision: '14',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    )
  })

  it('连续提交任务不会等待前一个审查完成，表单按钮入队后恢复可点', async () => {
    const user = userEvent.setup()
    const firstTask = createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
    const secondTask = createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
    window.codeReview.executeTask = vi.fn((payload) => {
      if (payload.svn_url.endsWith('project-1')) {
        return firstTask.promise
      }

      return secondTask.promise
    })

    renderReadyTaskPage()

    await fillTaskForm(user, '1')
    await user.click(screen.getByRole('button', { name: '开始审查' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '开始审查' })).toBeEnabled())

    await fillTaskForm(user, '2')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(2))
    expect(window.codeReview.executeTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ svn_url: 'svn://repo/project-1' })
    )
    expect(window.codeReview.executeTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ svn_url: 'svn://repo/project-2' })
    )
    expect(screen.getByRole('button', { name: '开始审查' })).toBeEnabled()
  })

  it('查看报告位置时传入当前选中的 taskId', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/history-1',
          old_revision: '1',
          new_revision: '2',
          status: 'success' as const,
          report_path: '/app/reports/task-history-1.md'
        },
        {
          id: 'task-history-2',
          svn_url: 'svn://repo/history-2',
          old_revision: '3',
          new_revision: '4',
          status: 'success' as const,
          report_path: '/app/reports/task-history-2.md'
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 历史报告 2')
    window.codeReview.downloadCurrentReport = vi.fn(async () => ({
      status: 'ready' as const,
      reportPath: '/app/reports/task-history-2.md'
    }))

    renderReadyTaskPage()

    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getAllByRole('button', { name: '查看报告' })[1])
    await screen.findByText('历史报告 2')
    await user.click(screen.getByRole('button', { name: '查看报告位置' }))

    expect(window.codeReview.downloadCurrentReport).toHaveBeenCalledWith('task-history-2')
  })

  it('已有手动选择报告时，成功任务不会覆盖右侧预览', async () => {
    const user = userEvent.setup()
    const runningTask = createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history',
          svn_url: 'svn://repo/history',
          old_revision: '3',
          new_revision: '4',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md'
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 手动选择报告')
    window.codeReview.executeTask = vi.fn(() => runningTask.promise)

    renderReadyTaskPage()

    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await screen.findByText('手动选择报告')

    await fillTaskForm(user, '5')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    runningTask.resolve({
      taskId: 'task-new-success',
      status: 'success',
      reportMarkdown: '# 新完成报告',
      reportPath: '/tmp/new-report.md'
    })

    await waitFor(() => expect(screen.getByText('手动选择报告')).toBeInTheDocument())
    expect(screen.queryByText('新完成报告')).not.toBeInTheDocument()
  })

  it('只允许选择已同步 Skill 对应的审查模板', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-1',
      status: 'success' as const,
      reportMarkdown: '# 审查报告',
      reportPath: '/tmp/代码审查报告.md'
    }))

    render(
      <TaskPage
        environment={{
          status: 'ready',
          codexVersion: 'codex-cli 0.130.0',
          svnVersion: '1.14.5',
          skills: [
            {
              id: 'skill-1',
              name: '通用-代码审查-模版一',
              version: '2026.05.29',
              package_path: '/tmp/skill.zip',
              installed_at: '2026-05-29T10:00:00.000Z'
            }
          ]
        }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getByLabelText('模板一')).toBeEnabled()
    expect(screen.getByLabelText('模板二')).toBeDisabled()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/project')
    await user.type(screen.getByLabelText('旧版本号'), '12')
    await user.type(screen.getByLabelText('新版本号'), '14')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(window.codeReview.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    )
  })

  it('在工作台顶部打开提交意见弹窗', async () => {
    const user = userEvent.setup()

    render(
      <TaskPage
        environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getAllByRole('button', { name: '提交意见' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '联系管理员' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '提交意见' }))

    expect(screen.getByRole('dialog', { name: '提交意见' })).toBeInTheDocument()
    expect(screen.getByLabelText('问题描述')).toBeInTheDocument()
  })

  it('环境面板不再额外显示联系管理员入口', () => {
    render(
      <TaskPage
        environment={{ status: 'missing_svn' }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getAllByRole('button', { name: '提交意见' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '联系管理员' })).not.toBeInTheDocument()
  })

  it('环境同步存在 Skill 错误时禁止发起任务', () => {
    render(
      <TaskPage
        environment={{
          status: 'ready',
          codexVersion: 'codex-cli 0.130.0',
          svnVersion: '1.14.5',
          skillError: 'No active skill is configured'
        }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '开始审查' })).toBeDisabled()
  })

  it('查看服务端历史报告时不使用服务端 report_path 解析本地图片', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-current',
          svn_url: 'svn://repo/current',
          old_revision: '1',
          new_revision: '2',
          status: 'created' as const
        },
        {
          id: 'task-history',
          svn_url: 'svn://repo/history',
          old_revision: '3',
          new_revision: '4',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md'
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '![流程图](images/diagram.png)')

    render(
      <TaskPage
        environment={{ status: 'ready', codexVersion: 'codex-cli 0.130.0', svnVersion: '1.14.5' }}
        isCheckingEnvironment={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        svnUsername="Key 用户"
        onRefreshEnvironment={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    await screen.findByText('svn://repo/current')
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))

    await screen.findByRole('img', { name: '流程图' })
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('task-history')
    expect(window.codeReview.readReportAsset).not.toHaveBeenCalled()
  })

  it('查看本地完成报告时保留 reportPath 解析相对图片', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-local-success',
      status: 'success' as const,
      reportMarkdown: '![流程图](images/diagram.png)',
      reportPath: '/tmp/reports/task-local-success.md'
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 不应加载服务端报告')

    renderReadyTaskPage()

    await user.type(screen.getByLabelText('SVN 地址'), 'svn://repo/local')
    await user.type(screen.getByLabelText('旧版本号'), '10')
    await user.type(screen.getByLabelText('新版本号'), '11')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))

    await waitFor(() =>
      expect(window.codeReview.readReportAsset).toHaveBeenCalledWith({
        reportPath: '/tmp/reports/task-local-success.md',
        assetPath: 'images/diagram.png'
      })
    )
    expect(window.codeReview.readTaskReport).not.toHaveBeenCalled()
  })
})
