// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
