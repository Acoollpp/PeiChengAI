import { Check, ChevronRight, FileText, FolderOpen, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  ReviewItemDefinition,
  ReviewItemId,
  ReviewItemInput,
  ReviewSelection,
  WorkbenchCommands
} from './types'

interface ReviewItemSelectorProps {
  catalog: ReviewItemDefinition[]
  initialSelection: ReviewSelection
  commands: Pick<WorkbenchCommands, 'chooseMaterial'>
  onConfirm: (selection: ReviewSelection) => void
  onCancel: () => void
}

const makeEmptyInput = (itemId: ReviewItemId): ReviewItemInput => ({
  itemId,
  extraRules: '',
  materials: {}
})

const cloneSelection = (selection: ReviewSelection): ReviewSelection => structuredClone(selection)

export function ReviewItemSelector({
  catalog,
  initialSelection,
  commands,
  onConfirm,
  onCancel
}: ReviewItemSelectorProps): React.JSX.Element {
  const initialIds = Object.keys(initialSelection) as ReviewItemId[]
  const [selectedIds, setSelectedIds] = useState<Set<ReviewItemId>>(() => new Set(initialIds))
  const [inputs, setInputs] = useState<ReviewSelection>(() => cloneSelection(initialSelection))
  const [activeId, setActiveId] = useState<ReviewItemId>(initialIds[0] ?? catalog[0].id)
  const [query, setQuery] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [materialError, setMaterialError] = useState('')
  const selectorRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    return catalog.filter((item) => {
      if (selectedOnly && !selectedIds.has(item.id)) return false
      if (!normalized) return true
      return [item.id, item.name, item.category, item.summary].some((value) =>
        value.toLocaleLowerCase('zh-CN').includes(normalized)
      )
    })
  }, [catalog, query, selectedIds, selectedOnly])

  const categories = useMemo(
    () =>
      Array.from(new Set(visibleItems.map((item) => item.category))).map((category) => ({
        category,
        items: visibleItems.filter((item) => item.category === category),
        allItems: catalog.filter((item) => item.category === category)
      })),
    [catalog, visibleItems]
  )

  const activeItem = catalog.find((item) => item.id === activeId) ?? catalog[0]
  const activeInput = inputs[activeItem.id] ?? makeEmptyInput(activeItem.id)

  const updateInput = (itemId: ReviewItemId, update: (input: ReviewItemInput) => ReviewItemInput) => {
    setInputs((current) => ({
      ...current,
      [itemId]: update(current[itemId] ?? makeEmptyInput(itemId))
    }))
  }

  const setSelected = (itemId: ReviewItemId, selected: boolean): void => {
    if (selected) {
      setInputs((currentInputs) => ({
        ...currentInputs,
        [itemId]: currentInputs[itemId] ?? makeEmptyInput(itemId)
      }))
    }
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(itemId)
      } else {
        next.delete(itemId)
      }
      return next
    })
  }

  const toggleCategory = (items: ReviewItemDefinition[]): void => {
    const shouldSelect = items.some((item) => !selectedIds.has(item.id))
    setSelectedIds((current) => {
      const next = new Set(current)
      items.forEach((item) => (shouldSelect ? next.add(item.id) : next.delete(item.id)))
      return next
    })
    if (shouldSelect) {
      setInputs((current) => {
        const next = { ...current }
        items.forEach((item) => {
          next[item.id] ??= makeEmptyInput(item.id)
        })
        return next
      })
    }
  }

  const chooseMaterial = async (fieldId: string, multiple: boolean): Promise<void> => {
    setMaterialError('')
    try {
      const currentFiles = activeInput.materials[fieldId] ?? []
      const file = await commands.chooseMaterial(
        activeItem.id,
        fieldId,
        currentFiles.map((value) => value.id)
      )
      updateInput(activeItem.id, (input) => ({
        ...input,
        materials: {
          ...input.materials,
          [fieldId]: multiple
            ? [...(input.materials[fieldId] ?? []).filter((value) => value.id !== file.id), file]
            : [file]
        }
      }))
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : '模拟材料选择失败。')
    }
  }

  const confirm = (): void => {
    const confirmed: ReviewSelection = {}
    selectedIds.forEach((itemId) => {
      confirmed[itemId] = inputs[itemId] ?? makeEmptyInput(itemId)
    })
    onConfirm(cloneSelection(confirmed))
  }

  const handleSelectorKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return

    const focusableElements = Array.from(
      selectorRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
    const first = focusableElements[0]
    const last = focusableElements.at(-1)
    if (!first || !last) return

    const activeElement = document.activeElement
    if (event.shiftKey && (activeElement === first || !selectorRef.current?.contains(activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="wb-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onCancel()
    }}>
      <section
        ref={selectorRef}
        className="wb-selector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-selector-title"
        onKeyDown={handleSelectorKeyDown}
      >
        <header className="wb-selector-header">
          <div>
            <p className="wb-eyebrow">审查范围</p>
            <h2 id="review-selector-title">选择审查项</h2>
          </div>
          <div className="wb-selector-count" aria-live="polite">
            已选 <strong>{selectedIds.size}</strong> 项
          </div>
          <button className="wb-icon-button" type="button" title="取消并关闭" onClick={onCancel}>
            <X aria-hidden="true" />
            <span className="wb-sr-only">取消并关闭</span>
          </button>
        </header>

        <div className="wb-selector-body">
          <aside className="wb-selector-list" aria-label="审查项列表">
            <div className="wb-selector-tools">
              <label className="wb-search-field">
                <Search aria-hidden="true" />
                <span className="wb-sr-only">搜索审查项</span>
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 ID、名称或分类"
                />
              </label>
              <label className="wb-toggle-field">
                <input
                  type="checkbox"
                  checked={selectedOnly}
                  onChange={(event) => setSelectedOnly(event.target.checked)}
                />
                <span>仅看已选</span>
              </label>
              <button
                className="wb-icon-button"
                type="button"
                title="清空选择"
                disabled={selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                <Trash2 aria-hidden="true" />
                <span className="wb-sr-only">清空选择</span>
              </button>
            </div>

            <div className="wb-catalog-scroll">
              {categories.length === 0 ? (
                <div className="wb-selector-empty">
                  <Search aria-hidden="true" />
                  <p>没有匹配的审查项</p>
                  <button type="button" onClick={() => {
                    setQuery('')
                    setSelectedOnly(false)
                  }}>显示全部</button>
                </div>
              ) : (
                categories.map(({ category, items, allItems }) => {
                  const allSelected = allItems.every((item) => selectedIds.has(item.id))
                  const selectedCount = allItems.filter((item) => selectedIds.has(item.id)).length
                  return (
                    <section className="wb-category" key={category}>
                      <div className="wb-category-header">
                        <label>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            aria-label={`选择${category}全部审查项`}
                            onChange={() => toggleCategory(allItems)}
                          />
                          <span>{category}</span>
                        </label>
                        <span>{selectedCount}/{allItems.length}</span>
                      </div>
                      <div className="wb-category-items">
                        {items.map((item) => {
                          const selected = selectedIds.has(item.id)
                          return (
                            <div
                              className={`wb-catalog-item${activeId === item.id ? ' is-active' : ''}`}
                              key={item.id}
                            >
                              <label className="wb-item-check">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  aria-label={`选择 ${item.id} ${item.name}`}
                                  onChange={(event) => setSelected(item.id, event.target.checked)}
                                />
                              </label>
                              <button type="button" onClick={() => setActiveId(item.id)}>
                                <span className="wb-item-id">{item.id}</span>
                                <span className="wb-item-copy">
                                  <strong>{item.name}</strong>
                                  <span>{item.summary}</span>
                                </span>
                                <ChevronRight aria-hidden="true" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })
              )}
            </div>
          </aside>

          <article className="wb-selector-detail" aria-label={`${activeItem.id} ${activeItem.name} 详情`}>
            <div className="wb-detail-scroll">
              <div className="wb-detail-heading">
                <div>
                  <span className="wb-item-id">{activeItem.id}</span>
                  <h3>{activeItem.name}</h3>
                  <p>{activeItem.summary}</p>
                </div>
                <button
                  className={selectedIds.has(activeItem.id) ? 'wb-secondary-button' : 'wb-primary-button'}
                  type="button"
                  onClick={() => setSelected(activeItem.id, !selectedIds.has(activeItem.id))}
                >
                  {selectedIds.has(activeItem.id) ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
                  {selectedIds.has(activeItem.id) ? '移出本次审查' : '加入本次审查'}
                </button>
              </div>

              <div className="wb-detail-facts">
                <section>
                  <h4>审查目标</h4>
                  <p>{activeItem.goal}</p>
                </section>
                <section>
                  <h4>执行方式</h4>
                  <ol>
                    {activeItem.process.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </section>
                <section>
                  <h4>输入约束</h4>
                  <p>{activeItem.specification}</p>
                </section>
              </div>

              <section className="wb-detail-input-section">
                <div className="wb-section-heading">
                  <div>
                    <h4>本次额外规则</h4>
                    <p>只作用于 {activeItem.id}，不会传递给其他审查项。</p>
                  </div>
                  <span>可选</span>
                </div>
                <textarea
                  aria-label={`${activeItem.id} 额外规则`}
                  value={activeInput.extraRules}
                  disabled={!selectedIds.has(activeItem.id)}
                  maxLength={1200}
                  placeholder={selectedIds.has(activeItem.id) ? '例如：重点检查休眠唤醒与故障恢复交叉路径。' : '先加入本次审查后填写'}
                  onChange={(event) =>
                    updateInput(activeItem.id, (input) => ({ ...input, extraRules: event.target.value }))
                  }
                />
                <span className="wb-character-count">{activeInput.extraRules.length}/1200</span>
              </section>

              <section className="wb-detail-input-section">
                <div className="wb-section-heading">
                  <div>
                    <h4>专项材料</h4>
                    <p>预览只模拟本机文件名，不读取或上传文件。</p>
                  </div>
                  <span>{activeItem.materialFields.length === 0 ? '无需材料' : `${activeItem.materialFields.length} 项`}</span>
                </div>
                {activeItem.materialFields.length === 0 ? (
                  <div className="wb-no-materials">
                    <FileText aria-hidden="true" />
                    <span>此审查项不需要专项材料。</span>
                  </div>
                ) : (
                  <div className="wb-material-fields">
                    {activeItem.materialFields.map((field) => {
                      const files = activeInput.materials[field.id] ?? []
                      return (
                        <div className="wb-material-field" key={field.id}>
                          <div className="wb-material-label">
                            <div>
                              <strong>{field.label}</strong>
                              {field.required && <span className="wb-required">必填</span>}
                              <p>{field.description}</p>
                            </div>
                            <span>{field.extensions.join(' / ')} · {field.multiplicity === 'single' ? '单文件' : '多文件'}</span>
                          </div>
                          {files.map((file) => (
                            <div className="wb-file-row" key={file.id}>
                              <FileText aria-hidden="true" />
                              <span title={file.name}>{file.name}</span>
                              <small>{file.sizeLabel}</small>
                              <button
                                className="wb-icon-button"
                                type="button"
                                title={`移除 ${file.name}`}
                                onClick={() => updateInput(activeItem.id, (input) => ({
                                  ...input,
                                  materials: {
                                    ...input.materials,
                                    [field.id]: (input.materials[field.id] ?? []).filter((value) => value.id !== file.id)
                                  }
                                }))}
                              >
                                <X aria-hidden="true" />
                                <span className="wb-sr-only">移除 {file.name}</span>
                              </button>
                            </div>
                          ))}
                          <button
                            className="wb-file-button"
                            type="button"
                            disabled={!selectedIds.has(activeItem.id)}
                            onClick={() => void chooseMaterial(field.id, field.multiplicity === 'multiple')}
                          >
                            <FolderOpen aria-hidden="true" />
                            {files.length > 0 && field.multiplicity === 'single' ? '更换模拟文件' : '选择模拟文件'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {materialError && <p className="wb-inline-error" role="alert">{materialError}</p>}
              </section>
            </div>
          </article>
        </div>

        <footer className="wb-selector-footer">
          <p>确认后才会回填任务表单；取消会丢弃本次草稿。</p>
          <div>
            <button className="wb-secondary-button" type="button" onClick={onCancel}>取消</button>
            <button className="wb-primary-button" type="button" onClick={confirm}>
              <Check aria-hidden="true" />
              确认选择（{selectedIds.size}）
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
