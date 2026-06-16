import { FormEvent, useMemo, useState } from 'react'

import type { DepartmentPublic } from '../../../shared/types'

interface DepartmentSelectionDialogProps {
  departments: DepartmentPublic[]
  isLoading: boolean
  isSubmitting: boolean
  error: string
  onSubmit: (departmentId: string) => Promise<void>
}

export function DepartmentSelectionDialog({
  departments,
  isLoading,
  isSubmitting,
  error,
  onSubmit
}: DepartmentSelectionDialogProps): React.JSX.Element {
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const isDisabled = isLoading || isSubmitting || departments.length === 0
  const firstDepartmentId = departments[0]?.id ?? ''
  const selectedValue = useMemo(
    () => selectedDepartmentId || firstDepartmentId,
    [firstDepartmentId, selectedDepartmentId]
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!selectedValue) {
      return
    }
    await onSubmit(selectedValue)
  }

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="department-selection-title">
      <form className="dialog-card" onSubmit={handleSubmit}>
        <h2 id="department-selection-title">选择部门</h2>
        <p className="dialog-desc">
          当前账号尚未绑定部门，请选择所在部门后继续使用。
        </p>

        <label className="field auth-field">
          <span>部门</span>
          <select
            aria-label="部门"
            value={selectedValue}
            disabled={isDisabled}
            onChange={(event) => setSelectedDepartmentId(event.target.value)}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        {isLoading && <p className="dialog-desc">正在加载部门列表...</p>}
        {!isLoading && departments.length === 0 && (
          <p className="form-error">暂无可选部门，请联系管理员维护部门。</p>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="dialog-actions single-action">
          <button className="primary-button" type="submit" disabled={isDisabled}>
            {isSubmitting ? '保存中...' : '确认选择'}
          </button>
        </div>
      </form>
    </div>
  )
}
