import { FileText, FolderOpen, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import type {
  CustomReviewRetryViewModel,
  MaterialFileView,
  WorkbenchCommands
} from './types'

interface CustomReviewRetryDialogProps {
  retry: CustomReviewRetryViewModel
  commands: Pick<
    WorkbenchCommands,
    'chooseMaterial' | 'confirmCustomReviewRetry' | 'cancelCustomReviewRetry'
  >
}

const modeLabel = (mode: CustomReviewRetryViewModel['mode']): string =>
  mode === 'dual_revision' ? '变更代码审查模式' : '全量代码审查模式'

export function CustomReviewRetryDialog({
  retry,
  commands
}: CustomReviewRetryDialogProps): React.JSX.Element {
  const [materials, setMaterials] = useState<Record<string, MaterialFileView[]>>({})
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const chooseMaterial = async (field: CustomReviewRetryViewModel['materialFields'][number]) => {
    setError(undefined)
    const currentFiles = materials[field.id] ?? []
    if (field.maxFiles && currentFiles.length >= field.maxFiles) {
      setError(`${field.label}最多只能选择 ${field.maxFiles} 个文件。`)
      return
    }
    try {
      const file = await commands.chooseMaterial('DS-99', field.id, currentFiles.map((value) => value.id))
      if (!file) return
      if (field.maxFileBytes && file.sizeBytes && file.sizeBytes > field.maxFileBytes) {
        setError(`${field.label}单个文件不能超过 20 MB。`)
        return
      }
      setMaterials((current) => ({
        ...current,
        [field.id]: field.multiplicity === 'multiple'
          ? [...(current[field.id] ?? []).filter((value) => value.id !== file.id), file]
          : [file]
      }))
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : '材料选择失败。')
    }
  }

  const submit = async (): Promise<void> => {
    const missing = retry.materialFields.find((field) => (materials[field.id]?.length ?? 0) === 0)
    if (missing) {
      setError(`请重新选择原任务提供过的${missing.label}。`)
      return
    }
    const totalMaterialBytes = retry.materialFields
      .flatMap((field) => materials[field.id] ?? [])
      .reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
    if (totalMaterialBytes > 100 * 1024 * 1024) {
      setError('DS-99 三类材料总大小不能超过 100 MB。')
      return
    }
    if (!commands.confirmCustomReviewRetry) return
    setIsSubmitting(true)
    try {
      const result = await commands.confirmCustomReviewRetry(retry.taskId, materials)
      if (result.message.includes('失败') || result.message.includes('不能') || result.message.includes('必须')) {
        setError(result.message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const cancel = (): void => {
    void commands.cancelCustomReviewRetry?.()
  }

  return (
    <div className="wb-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) cancel()
    }}>
      <section className="wb-selector wb-custom-retry-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-retry-title">
        <header className="wb-selector-header">
          <div>
            <p className="wb-eyebrow">DS-99 自定义审查</p>
            <h2 id="custom-retry-title">补充重试材料</h2>
          </div>
          <button className="wb-icon-button" type="button" title="取消并关闭" onClick={cancel}>
            <X aria-hidden="true" />
            <span className="wb-sr-only">取消并关闭</span>
          </button>
        </header>

        <div className="wb-custom-retry-content">
          <p className="wb-custom-retry-guidance">
            本次重试会沿用原任务的规则和模式。需要修改规则、模式或材料类型时，请新建审查任务。
          </p>
          <label className="wb-rule-field">
            <span>原审查规则（不可修改）</span>
            <textarea value={retry.rule} readOnly rows={5} />
          </label>
          <div className="wb-custom-retry-mode" aria-label="原审查模式">
            <span>原审查模式（不可修改）</span>
            <strong>{modeLabel(retry.mode)}</strong>
          </div>
          {retry.materialFields.length > 0 && (
            <section className="wb-custom-retry-materials" aria-label="重新选择材料">
              <div>
                <span>重新选择材料</span>
                <small>以下类型在原任务中已提供，重试时每类至少选择一份。</small>
              </div>
              {retry.materialFields.map((field) => (
                <div className="wb-material-field" key={field.id}>
                  <div>
                    <strong>{field.label}</strong>
                    <small>{field.description}</small>
                  </div>
                  <button className="wb-secondary-button" type="button" onClick={() => void chooseMaterial(field)}>
                    <FolderOpen aria-hidden="true" />
                    选择材料
                  </button>
                  {(materials[field.id] ?? []).map((file) => (
                    <div className="wb-material-file" key={file.id}>
                      <FileText aria-hidden="true" />
                      <span title={file.name}>{file.name}</span>
                      <small>{file.sizeLabel}</small>
                      <button
                        className="wb-icon-button"
                        type="button"
                        title={`移除 ${file.name}`}
                        onClick={() => setMaterials((current) => ({
                          ...current,
                          [field.id]: (current[field.id] ?? []).filter((value) => value.id !== file.id)
                        }))}
                      >
                        <Trash2 aria-hidden="true" />
                        <span className="wb-sr-only">移除 {file.name}</span>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}
          {error && <p className="wb-inline-error" role="alert">{error}</p>}
        </div>

        <footer className="wb-selector-footer">
          <button className="wb-secondary-button" type="button" onClick={cancel}>取消</button>
          <button className="wb-primary-button" type="button" disabled={isSubmitting} onClick={() => void submit()}>
            {isSubmitting ? '加入中...' : '按原规则重试'}
          </button>
        </footer>
      </section>
    </div>
  )
}
