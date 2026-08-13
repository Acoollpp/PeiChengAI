import { Moon, Sun } from 'lucide-react'

import type { ClientTheme } from '../theme'

interface ThemeToggleButtonProps {
  theme: ClientTheme
  onToggle: () => void
  className?: string
}

export function ThemeToggleButton({
  theme,
  onToggle,
  className = ''
}: ThemeToggleButtonProps): React.JSX.Element {
  const isLight = theme === 'light'
  const label = isLight ? '切换到深色模式' : '切换到浅色模式'
  const Icon = isLight ? Moon : Sun

  return (
    <button
      className={`theme-toggle-button${className ? ` ${className}` : ''}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={2.2} />
    </button>
  )
}
