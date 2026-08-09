// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentStatus } from './EnvironmentStatus'

afterEach(() => {
  cleanup()
})

describe('EnvironmentStatus', () => {
  it('shows skill installation progress during environment check skill sync', () => {
    render(
      <EnvironmentStatus
        result={null}
        isChecking={true}
        isInstallingSkillDuringCheck={true}
        isInstallingCodex={false}
        isInstallingSvn={false}
        onRefresh={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getByText('安装 Skill 中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '安装 Skill 中...' })).toBeDisabled()
  })

  it('展示内置 CodeGraph 固定版本和实际路径', () => {
    render(
      <EnvironmentStatus
        result={{
          status: 'ready',
          codexVersion: 'codex-cli 0.130.0',
          svnVersion: '1.14.5',
          codegraphStatus: 'ready',
          codegraphRequiredVersion: '1.4.1',
          codegraphVersion: '1.4.1',
          codegraphPath:
            'C:\\Program Files\\AI代码审查客户端\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd'
        }}
        isChecking={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        onRefresh={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(screen.getByText(/CodeGraph 1\.4\.1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看本地依赖状态' }))
    expect(screen.getByText('内置 CodeGraph 已就绪')).toBeInTheDocument()
    expect(
      screen.getByText(
        /1\.4\.1 · C:\\Program Files\\AI代码审查客户端\\resources\\codegraph/
      )
    ).toBeInTheDocument()
  })

  it('CodeGraph 异常时自动展开详情且只提示重新安装客户端', () => {
    render(
      <EnvironmentStatus
        result={{
          status: 'failed',
          codexVersion: 'codex-cli 0.130.0',
          codegraphStatus: 'corrupt',
          codegraphRequiredVersion: '1.4.1',
          codegraphVersion: '1.4.1',
          codegraphPath:
            'C:\\Program Files\\AI代码审查客户端\\resources\\codegraph\\win32-x64\\bin\\codegraph.cmd',
          codegraphError: '内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。'
        }}
        isChecking={false}
        isInstallingSkillDuringCheck={false}
        isInstallingCodex={false}
        isInstallingSvn={false}
        onRefresh={vi.fn()}
        onInstallCodex={vi.fn()}
        onInstallSvn={vi.fn()}
        onInstallSkill={vi.fn()}
      />
    )

    expect(
      screen.getByText('内置 CodeGraph 1.4.1 资源损坏，请重新安装客户端。')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /安装 CodeGraph/ })).not.toBeInTheDocument()
  })

  it('CodeGraph 状态变化时就绪态收起、异常态自动展开并在恢复后重新收起', () => {
    const props = {
      isChecking: false,
      isInstallingSkillDuringCheck: false,
      isInstallingCodex: false,
      isInstallingSvn: false,
      onRefresh: vi.fn(),
      onInstallCodex: vi.fn(),
      onInstallSvn: vi.fn(),
      onInstallSkill: vi.fn()
    }
    const readyResult = {
      status: 'ready' as const,
      codexVersion: 'codex-cli 0.130.0',
      svnVersion: '1.14.5',
      codegraphStatus: 'ready' as const,
      codegraphRequiredVersion: '1.4.1',
      codegraphVersion: '1.4.1',
      codegraphPath: 'C:\\Program Files\\PeiCheng AI\\resources\\codegraph\\bin\\codegraph.cmd'
    }
    const { rerender } = render(<EnvironmentStatus {...props} result={readyResult} />)

    expect(screen.getByRole('button', { name: '查看本地依赖状态' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(
      <EnvironmentStatus
        {...props}
        result={{
          ...readyResult,
          status: 'failed',
          codegraphStatus: 'corrupt',
          codegraphError: '内置 CodeGraph 资源损坏，请重新安装客户端。'
        }}
      />
    )
    expect(screen.getByRole('button', { name: '查看本地依赖状态' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByText('内置 CodeGraph 资源损坏，请重新安装客户端。')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '查看本地依赖状态' }))
    expect(screen.getByRole('button', { name: '查看本地依赖状态' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByText('内置 CodeGraph 资源损坏，请重新安装客户端。')).not.toBeInTheDocument()

    rerender(<EnvironmentStatus {...props} result={readyResult} />)
    expect(screen.getByRole('button', { name: '查看本地依赖状态' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByText('内置 CodeGraph 资源损坏，请重新安装客户端。')).not.toBeInTheDocument()
  })
})
