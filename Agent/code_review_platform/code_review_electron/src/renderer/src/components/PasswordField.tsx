import { useState } from 'react'

type PasswordFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  disabled = false,
  required = true
}: PasswordFieldProps): React.JSX.Element {
  const [isVisible, setIsVisible] = useState(false)
  const toggleLabel = `${isVisible ? '隐藏' : '显示'} ${label}`

  return (
    <label className="field auth-field">
      <span>{label}</span>
      <span className="password-input-wrap">
        <input
          required={required}
          type={isVisible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          disabled={disabled}
          onClick={() => setIsVisible((current) => !current)}
        >
          {isVisible ? '◉' : '◎'}
        </button>
      </span>
    </label>
  )
}
