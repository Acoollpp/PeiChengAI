import { FileText, FolderOpen, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import type {
  CustomReviewRetryViewModel,
  MaterialFileView,
  ReviewItemId,
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
  const [customMaterials, setCustomMaterials] = useState<Record<string, MaterialFileView[]>>({})
  const [fixedMaterials, setFixedMaterials] = useState<
    Record<string, Record<string, MaterialFileView[]>>
  >({})
  const [error, setError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const chooseMaterial = async (
    itemId: ReviewItemId,
    field: CustomReviewRetryViewModel['materialFields'][number],
    currentFiles: MaterialFileView[],
    onSelect: (nextFiles: MaterialFileView[]) => void
  ) => {
    setError(undefined)
    if (field.maxFiles && currentFiles.length >= field.maxFiles) {
      setError(`${field.label}最多只能选择 ${field.maxFiles} 个文件。`)
      return
    }
    try {
      const file = await commands.chooseMaterial(itemId, field.id, currentFiles.map((value) => value.id))
      if (!file) return
      if (field.maxFileBytes && file.sizeBytes && file.sizeBytes > field.maxFileBytes) {
        setError(`${field.label}单个文件不能超过 20 MB。`)
        return
      }
      onSelect(field.multiplicity === 'multiple'
        ? [...currentFiles.filter((value) => value.id !== file.id), file]
        : [file])
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : '材料选择失败。')
    }
  }

  const submit = async (): Promise<void> => {
    const missing = retry.materialFields.find((field) => (customMaterials[field.id]?.length ?? 0) === 0)
    if (missing) {
      setError(`请重新选择原任务提供过的${missing.label}。`)
      return
    }
    const missingFixedField = retry.fixedReviewItems
      .flatMap((item) => item.materialFields.filter((field) => field.required).map((field) => ({ item, field })))
      .find(({ item, field }) => (fixedMaterials[item.id]?.[field.id]?.length ?? 0) === 0)
    if (missingFixedField) {
      setError(`请重新选择 ${missingFixedField.item.id} ${missingFixedField.field.label}。`)
      return
    }
    const totalMaterialBytes = retry.materialFields
      .flatMap((field) => customMaterials[field.id] ?? [])
      .reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
    if (totalMaterialBytes > 100 * 1024 * 1024) {
      setError('DS-99 三类材料总大小不能超过 100 MB。')
      return
    }
    if (!commands.confirmCustomReviewRetry) return
    setIsSubmitting(true)
    try {
      const result = await commands.confirmCustomReviewRetry(
        retry.taskId,
        customMaterials,
        fixedMaterials
      )
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

  const renderMaterialField = (
    itemId: ReviewItemId,
    field: CustomReviewRetryViewModel['materialFields'][number],
    files: MaterialFileView[],
    onChange: (nextFiles: MaterialFileView[]) => void
  ) => (
    <div className="wb-material-field" key={`${itemId}-${field.id}`}>
      <div>
        <strong>{field.label}</strong>
        <small>{field.description}</small>
      </div>
      <button className="wb-secondary-button" type="button" onClick={() => void chooseMaterial(itemId, field, files, onChange)}>
        <FolderOpen aria-hidden="true" />
        选择材料
      </button>
      {files.map((file) => (
        <div className="wb-material-file" key={file.id}>
          <FileText aria-hidden="true" />
          <span title={file.name}>{file.name}</span>
          <small>{file.sizeLabel}</small>
          <button
            className="wb-icon-button"
            type="button"
            title={`移除 ${file.name}`}
            onClick={() => onChange(files.filter((value) => value.id !== file.id))}
          >
            <Trash2 aria-hidden="true" />
            <span className="wb-sr-only">移除 {file.name}</span>
          </button>
        </div>
      ))}
    </div>
  )

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
              {retry.materialFields.map((field) => renderMaterialField(
                'DS-99',
                field,
                customMaterials[field.id] ?? [],
                (nextFiles) => setCustomMaterials((current) => ({ ...current, [field.id]: nextFiles }))
              ))}
            </section>
          )}
          {retry.fixedReviewItems.filter((item) => item.materialFields.length > 0).map((item) => (
            <section className="wb-custom-retry-materials" aria-label={`${item.id} 固定材料`} key={item.id}>
              <div>
                <span>{item.id} · {item.name}</span>
                <small>固定审查项材料仅用于本审查项，不属于 DS-99 自定义材料。</small>
              </div>
              {item.materialFields.map((field) => renderMaterialField(
                item.id,
                field,
                fixedMaterials[item.id]?.[field.id] ?? [],
                (nextFiles) => setFixedMaterials((current) => ({
                  ...current,
                  [item.id]: { ...current[item.id], [field.id]: nextFiles }
                }))
              ))}
            </section>
          ))}
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
