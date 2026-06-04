// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SvnBindingDialog } from './SvnBindingDialog'

afterEach(() => {
  cleanup()
})

describe('SvnBindingDialog', () => {
  it('可以切换 SVN 密码的可见性', async () => {
    const user = userEvent.setup()

    render(
      <SvnBindingDialog
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
        isSubmitting={false}
        error=""
      />
    )

    const passwordInput = screen.getByLabelText('SVN 密码') as HTMLInputElement
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: '显示 SVN 密码' }))

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏 SVN 密码' })).toBeInTheDocument()
  })
})
