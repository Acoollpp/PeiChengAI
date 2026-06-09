// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    await user.click(screen.getByRole('tab', { name: '历史任务' }))
    await user.click(screen.getByRole('button', { name: '查看报告' }))

    await screen.findByRole('img', { name: '流程图' })
    expect(window.codeReview.readTaskReport).toHaveBeenCalledWith('task-history')
    expect(window.codeReview.readReportAsset).not.toHaveBeenCalled()
  })
})
