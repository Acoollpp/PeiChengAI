import type { SelectedReviewItemInput } from './review-items'
import type { ReviewTask } from './types'

export const CUSTOM_REVIEW_ITEM_ID = 'DS-99'

export const CUSTOM_REVIEW_MATERIAL_FIELD_IDS = [
  'word-materials',
  'excel-materials',
  'pdf-materials'
] as const

export type CustomReviewMaterialFieldId = (typeof CUSTOM_REVIEW_MATERIAL_FIELD_IDS)[number]

export interface CustomReviewRetrySnapshot {
  rule: string
  mode: NonNullable<ReviewTask['custom_review_mode']>
  requiredMaterialFieldIds: CustomReviewMaterialFieldId[]
}

const customMaterialAvailability: Record<
  CustomReviewMaterialFieldId,
  keyof Pick<
    ReviewTask,
    | 'has_custom_review_word_material'
    | 'has_custom_review_excel_material'
    | 'has_custom_review_pdf_material'
  >
> = {
  'word-materials': 'has_custom_review_word_material',
  'excel-materials': 'has_custom_review_excel_material',
  'pdf-materials': 'has_custom_review_pdf_material'
}

export const getCustomReviewRetrySnapshot = (
  task: ReviewTask
): CustomReviewRetrySnapshot | undefined => {
  if (!task.review_item_ids?.includes(CUSTOM_REVIEW_ITEM_ID)) return undefined

  const rule = task.custom_review_rule?.trim()
  const mode = task.custom_review_mode
  const snapshotFields = CUSTOM_REVIEW_MATERIAL_FIELD_IDS.map(
    (fieldId) => task[customMaterialAvailability[fieldId]]
  )
  if (!rule || !mode || snapshotFields.some((value) => value === null || value === undefined)) {
    return undefined
  }

  return {
    rule,
    mode,
    requiredMaterialFieldIds: CUSTOM_REVIEW_MATERIAL_FIELD_IDS.filter(
      (fieldId) => task[customMaterialAvailability[fieldId]] === true
    )
  }
}

const isCustomMaterialFieldId = (value: string): value is CustomReviewMaterialFieldId =>
  CUSTOM_REVIEW_MATERIAL_FIELD_IDS.includes(value as CustomReviewMaterialFieldId)

export const buildCustomReviewRetryInputs = (
  task: ReviewTask,
  snapshot: CustomReviewRetrySnapshot,
  inputs: readonly SelectedReviewItemInput[] | undefined
): SelectedReviewItemInput[] => {
  if (!inputs || inputs.length !== 1 || inputs[0]?.id !== CUSTOM_REVIEW_ITEM_ID) {
    throw new Error('DS-99 重试只能补充原任务已使用的材料类型；如需修改审查范围，请新建任务。')
  }

  const input = inputs[0]
  if (input.user_extra_rules?.trim() && input.user_extra_rules.trim() !== snapshot.rule) {
    throw new Error('DS-99 重试必须使用原任务的审查规则；如需修改规则，请新建任务。')
  }
  if (input.custom_mode && input.custom_mode !== snapshot.mode) {
    throw new Error('DS-99 重试必须使用原任务的审查模式；如需修改模式，请新建任务。')
  }

  const materialsByFieldId = new Map<string, string[]>()
  for (const material of input.materials ?? []) {
    if (!isCustomMaterialFieldId(material.field_id)) {
      throw new Error('DS-99 重试材料只能属于 Word、Excel 或 PDF 类型。')
    }
    if (materialsByFieldId.has(material.field_id)) {
      throw new Error(`DS-99 重试材料类型 ${material.field_id} 不能重复。`)
    }
    materialsByFieldId.set(material.field_id, material.file_paths)
  }

  const requiredFieldIds = new Set(snapshot.requiredMaterialFieldIds)
  for (const fieldId of CUSTOM_REVIEW_MATERIAL_FIELD_IDS) {
    const filePaths = materialsByFieldId.get(fieldId) ?? []
    if (requiredFieldIds.has(fieldId) && filePaths.length === 0) {
      throw new Error(`DS-99 重试必须重新选择原任务提供过的 ${fieldId} 材料。`)
    }
    if (!requiredFieldIds.has(fieldId) && filePaths.length > 0) {
      throw new Error(`DS-99 重试不能新增原任务未提供的 ${fieldId} 材料；如需修改材料类型，请新建任务。`)
    }
  }

  const customInput: SelectedReviewItemInput = {
    id: CUSTOM_REVIEW_ITEM_ID,
    user_extra_rules: snapshot.rule,
    custom_mode: snapshot.mode,
    ...(snapshot.requiredMaterialFieldIds.length > 0
      ? {
          materials: snapshot.requiredMaterialFieldIds.map((fieldId) => ({
            field_id: fieldId,
            file_paths: materialsByFieldId.get(fieldId) ?? []
          }))
        }
      : {})
  }
  const originalItemIds = task.review_item_ids ?? [CUSTOM_REVIEW_ITEM_ID]
  return originalItemIds.map((itemId) => itemId === CUSTOM_REVIEW_ITEM_ID ? customInput : { id: itemId })
}
