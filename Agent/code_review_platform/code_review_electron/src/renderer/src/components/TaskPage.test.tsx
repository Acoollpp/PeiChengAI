// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskPage } from './TaskPage'
import type { CodeReviewApi, TaskCompletionNotificationPayload } from '../code-review-api'

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
    retryTask: vi.fn(),
    cancelTask: vi.fn(async () => ({ status: 'cancelled' })),
    openTaskLog: vi.fn(),
    onTaskProgress: vi.fn(() => vi.fn()),
    downloadCurrentReport: vi.fn(),
    openPdfReport: vi.fn(),
    showTaskCompletionNotification: vi.fn(async () => ({ status: 'shown' })),
    onTaskCompletionNotificationClicked: vi.fn(() => vi.fn()),
    installCodex: vi.fn(),
    installSvn: vi.fn(),
    installSkill: vi.fn(),
    checkEnvironment: vi.fn(),
    onEnvironmentProgress: vi.fn(() => vi.fn()),
    bindSvnCredential: vi.fn(),
    submitFeedback: vi.fn(async () => ({ id: 'feedback-1', status: 'pending' })),
    openReportFeedbackWindow: vi.fn(async () => true),
    submitNegativeReportFeedback: vi.fn(async (taskId: string) => ({
      taskId,
      helpful: false,
      usefulIssuesText: null
    })),
    onReportFeedbackFocusAnchor: vi.fn(() => vi.fn()),
    onReportFeedbackSubmitted: vi.fn(() => vi.fn())
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
  vi.restoreAllMocks()
})

describe('TaskPage', () => {
  it('环境检查通过且无安装任务时隐藏环境状态卡片', () => {
    renderReadyTaskPage()

    expect(screen.queryByLabelText('本地环境状态')).not.toBeInTheDocument()
    expect(screen.queryByText('环境就绪')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始审查' })).toBeEnabled()
  })

  it('环境异常时仍显示环境状态卡片和处理入口', () => {
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

    expect(screen.getByLabelText('本地环境状态')).toBeInTheDocument()
    expect(screen.getByText('缺少 SVN CLI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始审查' })).toBeDisabled()
  })

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

  it('取消运行中任务时调用取消接口并在历史任务显示已取消', async () => {
    const user = userEvent.setup()
    const runningTask = createDeferred<Awaited<ReturnType<CodeReviewApi['executeTask']>>>()
    const executeTask = vi.fn<CodeReviewApi['executeTask']>(() => runningTask.promise)
    window.codeReview.executeTask = executeTask
    window.codeReview.cancelTask = vi.fn(async () => ({ status: 'cancelled' as const }))

    renderReadyTaskPage()

    await fillTaskForm(user, '1')
    await user.click(screen.getByRole('button', { name: '开始审查' }))
    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))

    const clientTaskId = executeTask.mock.calls[0][0].client_task_id
    await user.click(screen.getByRole('button', { name: '取消任务' }))

    expect(window.codeReview.cancelTask).toHaveBeenCalledWith({
      client_task_id: clientTaskId,
      task_id: clientTaskId
    })

    const historyPanel = await openHistoryTasks(user)
    expect(within(historyPanel).getByText('已取消')).toBeInTheDocument()
    expect(within(historyPanel).queryByRole('button', { name: '查看报告' })).not.toBeInTheDocument()
  })

  it('历史任务查看PDF报告时按任务 ID 下载服务端 PDF', async () => {
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
          report_path: '/app/reports/task-history-2.md',
          pdf_report_path: '/app/reports/task-history-2.pdf',
          pdf_report_name: 'r3_r4审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 历史报告 2')
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/cache/task-history-2.pdf'
    }))

    renderReadyTaskPage()

    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getAllByRole('button', { name: '查看报告' })[1])
    await screen.findByText('历史报告 2')
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-history-2',
      pdfReportName: 'r3_r4审查报告_20260615_143000.pdf'
    })
    expect(await screen.findByText('PDF报告位置：/local/cache/task-history-2.pdf')).toBeInTheDocument()
  })

  it('快速切换历史报告时忽略旧请求返回，避免覆盖当前 PDF 报告名', async () => {
    const user = userEvent.setup()
    const reportA = createDeferred<string>()
    const reportB = createDeferred<string>()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-a',
          svn_url: 'svn://repo/history-a',
          old_revision: '1',
          new_revision: '2',
          status: 'success' as const,
          report_path: '/app/reports/task-history-a.md',
          pdf_report_path: '/app/reports/task-history-a.pdf',
          pdf_report_name: 'A审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
        },
        {
          id: 'task-history-b',
          svn_url: 'svn://repo/history-b',
          old_revision: '3',
          new_revision: '4',
          status: 'success' as const,
          report_path: '/app/reports/task-history-b.md',
          pdf_report_path: '/app/reports/task-history-b.pdf',
          pdf_report_name: 'B审查报告_20260615_143000.pdf',
          report_feedback_helpful: false
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn((taskId: string) => {
      if (taskId === 'task-history-a') {
        return reportA.promise
      }

      return reportB.promise
    })
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/cache/task-history-b.pdf'
    }))

    renderReadyTaskPage()

    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(viewButtons[1])

    reportB.resolve('# B 报告')
    expect(await screen.findByRole('heading', { name: 'B 报告' })).toBeInTheDocument()

    reportA.resolve('# A 报告')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'A 报告' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'B 报告' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-history-b',
      pdfReportName: 'B审查报告_20260615_143000.pdf'
    })
  })

  it('点击查看PDF报告时优先打开当前任务本地 PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-local-success',
      status: 'success' as const,
      reportMarkdown: '# 本地报告',
      reportPath: '/app/reports/task-local-success.md',
      pdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
    }))
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/app/reports/task-local-success.pdf'
    }))
    window.codeReview.submitNegativeReportFeedback = vi.fn(async () => ({
      taskId: 'task-local-success',
      helpful: false,
      usefulIssuesText: null
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '7')
    await user.click(screen.getByRole('button', { name: '开始审查' }))
    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    await user.click(within(notice).getByRole('button', { name: '查看报告' }))
    await screen.findByText('本地报告')
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '没帮助' }))

    expect(window.codeReview.submitNegativeReportFeedback).toHaveBeenCalledWith(
      'task-local-success'
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '查看PDF报告' })).toBeInTheDocument())
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-local-success',
      localPdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
    })
  })

  it('任务完成后不自动切换右侧报告预览', async () => {
    const user = userEvent.setup()
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-local-success',
      status: 'success' as const,
      reportMarkdown: '# 本地报告',
      reportPath: '/app/reports/task-local-success.md',
      pdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: 'r7_r2审查报告_20260615_143000.pdf'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '7')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    await waitFor(() => expect(window.codeReview.executeTask).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('本地报告')).not.toBeInTheDocument()
    expect(await screen.findByText('审查完成')).toBeInTheDocument()
  })

  it('前台任务完成时显示应用内提醒且不发送系统通知', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-notice',
      status: 'success' as const,
      reportMarkdown: '# 完成报告',
      reportPath: '/tmp/done.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '8')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    expect(within(notice).getByText('svn://repo/project-8')).toBeInTheDocument()
    expect(within(notice).getByText('80 → 81')).toBeInTheDocument()
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalled()
  })

  it('后台任务完成时发送系统通知且payload不包含报告正文', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-background',
      status: 'success' as const,
      reportMarkdown: '# 后台报告',
      reportPath: '/tmp/background.md',
      pdfPath: '/tmp/background.pdf',
      pdfReportName: '后台审查报告.pdf'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '9')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledTimes(1))
    expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-background',
        svn_url: 'svn://repo/project-9',
        old_revision: '90',
        new_revision: '91',
        reportPath: '/tmp/background.md',
        pdfPath: '/tmp/background.pdf',
        pdfReportName: '后台审查报告.pdf'
      })
    )
    expect(window.codeReview.showTaskCompletionNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ reportMarkdown: expect.any(String) })
    )
  })

  it('点击应用内提醒查看报告后打开刚完成任务报告', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-open-from-notice',
      status: 'success' as const,
      reportMarkdown: '# 提醒打开报告',
      reportPath: '/tmp/notice-report.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '10')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    const notice = await screen.findByRole('status', { name: '审查完成提醒' })
    await user.click(within(notice).getByRole('button', { name: '查看报告' }))

    expect(await screen.findByRole('heading', { name: '提醒打开报告' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: '审查完成提醒' })).not.toBeInTheDocument()
  })

  it('后台系统通知失败时显示应用内兜底提醒', async () => {
    const user = userEvent.setup()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.showTaskCompletionNotification = vi.fn(async () => ({
      status: 'unsupported' as const
    }))
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-fallback',
      status: 'success' as const,
      reportMarkdown: '# 兜底报告',
      reportPath: '/tmp/fallback.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '11')
    await user.click(screen.getByRole('button', { name: '开始审查' }))

    expect(await screen.findByRole('status', { name: '审查完成提醒' })).toBeInTheDocument()
  })

  it('收到系统通知点击事件后打开对应任务报告', async () => {
    const user = userEvent.setup()
    let notificationClickHandler: ((payload: TaskCompletionNotificationPayload) => void) | undefined
    window.codeReview.onTaskCompletionNotificationClicked = vi.fn((callback) => {
      notificationClickHandler = callback
      return vi.fn()
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.codeReview.executeTask = vi.fn(async () => ({
      taskId: 'task-clicked',
      status: 'success' as const,
      reportMarkdown: '# 点击通知报告',
      reportPath: '/tmp/clicked.md'
    }))

    renderReadyTaskPage()

    await fillTaskForm(user, '12')
    await user.click(screen.getByRole('button', { name: '开始审查' }))
    await waitFor(() => expect(window.codeReview.showTaskCompletionNotification).toHaveBeenCalled())

    notificationClickHandler?.({
      taskId: 'task-clicked',
      svn_url: 'svn://repo/project-12',
      old_revision: '120',
      new_revision: '121',
      reportPath: '/tmp/clicked.md'
    })

    expect(await screen.findByRole('heading', { name: '点击通知报告' })).toBeInTheDocument()
  })

  it('未选中任务时右侧显示当前审查模板且不显示 PDF 报告按钮', async () => {
    const user = userEvent.setup()

    renderReadyTaskPage()

    await waitFor(() => expect(window.codeReview.listTasks).toHaveBeenCalled())
    expect(await screen.findByText('暂无运行中任务。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '代码审查报告-模版一' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '代码审查报告模板二' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('模板二'))

    expect(screen.getByRole('heading', { name: '代码审查报告模板二' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '代码审查报告-模版一' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
  })

  it('选择任务报告后再切换模板会回到模板预览', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history',
          svn_url: 'svn://repo/history',
          old_revision: '1',
          new_revision: '2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md'
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 历史报告')

    renderReadyTaskPage()

    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    expect(await screen.findByRole('heading', { name: '历史报告' })).toBeInTheDocument()

    await user.click(screen.getByLabelText('模板二'))

    expect(screen.getByRole('heading', { name: '代码审查报告模板二' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '历史报告' })).not.toBeInTheDocument()
    expect(within(historyPanel).getByRole('button', { name: '查看报告' })).toBeEnabled()
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

  it('未反馈历史任务查看报告后直接展示报告反馈选择和用途说明', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))

    expect(screen.getByRole('button', { name: '有帮助' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '没帮助' })).toBeInTheDocument()
    expect(screen.getByText('用于统计这份 AI 审查报告是否真的有参考价值。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
  })

  it('点击没帮助会提交报告反馈并打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告')
    window.codeReview.submitNegativeReportFeedback = vi.fn(async () => ({
      taskId: 'task-history-1',
      helpful: false,
      usefulIssuesText: null
    }))
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '没帮助' }))

    expect(window.codeReview.submitNegativeReportFeedback).toHaveBeenCalledWith(
      'task-history-1'
    )
    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '查看PDF报告' })).toBeInTheDocument()
  })

  it('负反馈提交期间切换任务后更新原任务但不打开当前任务PDF', async () => {
    const user = userEvent.setup()
    const feedback = createDeferred<{
      taskId: string
      helpful: boolean
      usefulIssuesText: null
    }>()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-a', svn_url: 'svn://repo/a', old_revision: '1', new_revision: '2',
          status: 'success' as const, report_path: '/reports/a.md', report_feedback_helpful: null
        },
        {
          id: 'task-b', svn_url: 'svn://repo/b', old_revision: '2', new_revision: '3',
          status: 'success' as const, report_path: '/reports/b.md', report_feedback_helpful: null
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async (taskId) => `# ${taskId}`)
    window.codeReview.submitNegativeReportFeedback = vi.fn(() => feedback.promise)
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/unexpected.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(screen.getByRole('button', { name: '没帮助' }))
    await user.click(viewButtons[1])

    feedback.resolve({
      taskId: 'task-a', helpful: false, usefulIssuesText: null
    })

    await waitFor(() => expect(within(historyPanel).getByText('已完成 · 没帮助')).toBeInTheDocument())
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    expect(screen.queryByText(/PDF报告位置/)).not.toBeInTheDocument()
  })

  it('PDF请求期间切换任务后忽略原任务返回结果', async () => {
    const user = userEvent.setup()
    const pdf = createDeferred<{ status: 'ready'; pdfPath: string }>()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-a', svn_url: 'svn://repo/a', old_revision: '1', new_revision: '2',
          status: 'success' as const, report_path: '/reports/a.md',
          report_feedback_helpful: true, report_feedback_useful_issues_text: '1. A'
        },
        {
          id: 'task-b', svn_url: 'svn://repo/b', old_revision: '2', new_revision: '3',
          status: 'success' as const, report_path: '/reports/b.md', report_feedback_helpful: null
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async (taskId) => `# ${taskId}`)
    window.codeReview.openPdfReport = vi.fn(() => pdf.promise)

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    await user.click(viewButtons[1])

    pdf.resolve({ status: 'ready', pdfPath: '/local/task-a.pdf' })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'task-b' })).toBeInTheDocument())
    expect(screen.queryByText('PDF报告位置：/local/task-a.pdf')).not.toBeInTheDocument()
  })

  it('PDF请求期间切换任务后忽略原任务迟到错误', async () => {
    const user = userEvent.setup()
    const pdf = createDeferred<{ status: 'ready'; pdfPath: string }>()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-a', svn_url: 'svn://repo/a', old_revision: '1', new_revision: '2',
          status: 'success' as const, report_path: '/reports/a.md',
          report_feedback_helpful: true, report_feedback_useful_issues_text: '1. A'
        },
        {
          id: 'task-b', svn_url: 'svn://repo/b', old_revision: '2', new_revision: '3',
          status: 'success' as const, report_path: '/reports/b.md', report_feedback_helpful: null
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async (taskId) => `# ${taskId}`)
    window.codeReview.openPdfReport = vi.fn(() => pdf.promise)

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))
    await user.click(viewButtons[1])

    pdf.reject(new Error('A任务PDF打开失败'))
    await pdf.promise.catch(() => undefined)

    expect(screen.getByRole('heading', { name: 'task-b' })).toBeInTheDocument()
    expect(screen.queryByText('A任务PDF打开失败')).not.toBeInTheDocument()
    expect(screen.queryByText(/PDF报告位置/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看PDF报告' })).not.toBeInTheDocument()
  })

  it('点击有帮助只打开原生反馈窗口并传递稳定候选项', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '有帮助' }))

    expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
      taskId: 'task-history-1',
      options: [
        {
          id: '2-空指针风险',
          level: 3,
          text: '空指针风险',
          anchorId: 'report-option-2'
        }
      ]
    })
    expect(screen.queryByRole('dialog', { name: '报告有用信息反馈' })).not.toBeInTheDocument()
  })

  it('历史失败任务点击重试后复用原任务重新执行', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-failed',
          svn_url: 'svn://repo/retry',
          old_revision: '10',
          new_revision: '12',
          template_key: 'template_2' as const,
          skill_name: '通用-代码审查-模版二',
          requirement_file_name: '需求.xlsx',
          focus_direction_id: 'focus-1',
          focus_direction_snapshot: '重点检查协议解析',
          status: 'failed' as const,
          error_message: 'Codex 执行失败'
        }
      ],
      count: 1
    }))
    window.codeReview.retryTask = vi.fn(async () => ({
      taskId: 'task-failed',
      status: 'success' as const,
      reportMarkdown: '# retry report',
      reportPath: '/tmp/retry.md'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '重试' }))

    await waitFor(() =>
      expect(window.codeReview.retryTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task-failed',
          client_task_id: expect.any(String)
        })
      )
    )
    expect(window.codeReview.executeTask).not.toHaveBeenCalled()
  })

  it('原生反馈窗口打开失败时显示固定错误', async () => {
    const user = userEvent.setup()
    window.codeReview.openReportFeedbackWindow = vi.fn(async () => {
      throw new Error('内部窗口创建错误')
    })
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '有帮助' }))

    expect(await screen.findByText('反馈窗口打开失败，请重试。')).toBeInTheDocument()
  })

  it('原生反馈窗口打开期间切换任务后忽略原任务迟到错误', async () => {
    const user = userEvent.setup()
    const open = createDeferred<true>()
    window.codeReview.openReportFeedbackWindow = vi.fn(() => open.promise)
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-a', svn_url: 'svn://repo/a', old_revision: '1', new_revision: '2',
          status: 'success' as const, report_path: '/reports/a.md', report_feedback_helpful: null
        },
        {
          id: 'task-b', svn_url: 'svn://repo/b', old_revision: '2', new_revision: '3',
          status: 'success' as const, report_path: '/reports/b.md', report_feedback_helpful: null
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async (taskId) => `# ${taskId}`)

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(screen.getByRole('button', { name: '有帮助' }))
    await user.click(viewButtons[1])

    open.reject(new Error('A任务反馈窗口打开失败'))
    await open.promise.catch(() => undefined)

    expect(screen.getByRole('heading', { name: 'task-b' })).toBeInTheDocument()
    expect(screen.queryByText('反馈窗口打开失败，请重试。')).not.toBeInTheDocument()
  })

  it('反馈窗口定位事件仅处理当前任务并可清除高亮', async () => {
    const user = userEvent.setup()
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () =>
      ['# 审查报告', '## 高风险问题', '### 空指针风险', '正文'].join('\n')
    )

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    const focusAnchor = vi.mocked(window.codeReview.onReportFeedbackFocusAnchor).mock.calls[0][0]
    focusAnchor({ taskId: 'other-task', anchorId: 'report-option-2' })
    expect(scrollIntoView).not.toHaveBeenCalled()
    focusAnchor({ taskId: 'task-history-1', anchorId: 'report-option-2' })

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' }))
    expect(screen.getByRole('heading', { name: '空指针风险' })).toHaveClass(
      'report-anchor-highlight'
    )

    focusAnchor({ taskId: 'task-history-1' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '空指针风险' })).not.toHaveClass(
        'report-anchor-highlight'
      )
    )
  })

  it('反馈窗口提交事件更新任务反馈并打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告\n\n### 空指针风险')
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    const submitted = vi.mocked(window.codeReview.onReportFeedbackSubmitted).mock.calls[0][0]
    submitted({ taskId: 'other-task', helpful: false, usefulIssuesText: null })
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    submitted({ taskId: 'task-history-1', helpful: true, usefulIssuesText: '1. 空指针风险' })

    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '查看PDF报告' })).toBeInTheDocument()
  })

  it('正反馈事件更新原任务但不为当前其他任务打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-a', svn_url: 'svn://repo/a', old_revision: '1', new_revision: '2',
          status: 'success' as const, report_path: '/reports/a.md', report_feedback_helpful: null
        },
        {
          id: 'task-b', svn_url: 'svn://repo/b', old_revision: '2', new_revision: '3',
          status: 'success' as const, report_path: '/reports/b.md', report_feedback_helpful: null
        }
      ],
      count: 2
    }))
    window.codeReview.readTaskReport = vi.fn(async (taskId) => `# ${taskId}`)
    window.codeReview.openPdfReport = vi.fn()

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    const viewButtons = within(historyPanel).getAllByRole('button', { name: '查看报告' })
    await user.click(viewButtons[0])
    await user.click(viewButtons[1])
    const submitted = vi.mocked(window.codeReview.onReportFeedbackSubmitted).mock.calls[0][0]

    submitted({ taskId: 'task-a', helpful: true, usefulIssuesText: '1. A问题' })

    await waitFor(() => expect(within(historyPanel).getByText('已完成 · 有帮助')).toBeInTheDocument())
    expect(window.codeReview.openPdfReport).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'task-b' })).toBeInTheDocument()
  })

  it('已反馈任务点击查看PDF报告直接打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: false,
          report_feedback_useful_issues_text: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告')
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

    expect(window.codeReview.openReportFeedbackWindow).not.toHaveBeenCalled()
    expect(window.codeReview.openPdfReport).toHaveBeenCalled()
  })

  it('负反馈冲突后主进程回查为正反馈时按真实状态放行打开PDF', async () => {
    const user = userEvent.setup()
    window.codeReview.listTasks = vi.fn(async () => ({
      data: [
        {
          id: 'task-history-1',
          svn_url: 'svn://repo/project',
          old_revision: 'r1',
          new_revision: 'r2',
          status: 'success' as const,
          report_path: '/app/reports/task-history.md',
          pdf_report_path: '/app/reports/task-history.pdf',
          report_feedback_helpful: null
        }
      ],
      count: 1
    }))
    window.codeReview.readTaskReport = vi.fn(async () => '# 审查报告')
    window.codeReview.submitNegativeReportFeedback = vi.fn(async () => ({
      taskId: 'task-history-1',
      helpful: true,
      usefulIssuesText: '1. 服务端已保存问题'
    }))
    window.codeReview.openPdfReport = vi.fn(async () => ({
      status: 'ready' as const,
      pdfPath: '/local/task-history.pdf'
    }))

    renderReadyTaskPage()
    const historyPanel = await openHistoryTasks(user)
    await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
    await user.click(screen.getByRole('button', { name: '没帮助' }))

    await waitFor(() => expect(window.codeReview.openPdfReport).toHaveBeenCalled())
    // 反馈选择面板不再展示（已放行）
    expect(screen.queryByRole('button', { name: '有帮助' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '没帮助' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看PDF报告' })).toBeInTheDocument()
    expect(within(historyPanel).getByText('已完成 · 有帮助')).toBeInTheDocument()
  })
})
