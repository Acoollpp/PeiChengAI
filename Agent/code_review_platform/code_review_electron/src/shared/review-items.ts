export const REVIEW_ITEM_CATALOG_VERSION = 1

export const BMS_CODE_REVIEW_SKILL_NAME = 'bms-code-reviewer'

export interface ReviewItemMaterialFieldDefinition {
  id: string
  name: string
  description: string
  required: boolean
  multiple: boolean
  allowedExtensions: readonly string[]
}

export interface ReviewItemDefinition {
  id: string
  category: {
    id: string
    name: string
  }
  name: string
  summary: string
  details: {
    target: string
    process: string
    specification: string
  }
  sortOrder: number
  enabled: boolean
  materialFields: readonly ReviewItemMaterialFieldDefinition[]
}

export interface SelectedReviewItemInput {
  id: string
  user_extra_rules?: string
}

export interface ResolvedReviewItemInput extends SelectedReviewItemInput {
  name: string
}

export const REVIEW_ITEM_CATALOG: readonly ReviewItemDefinition[] = [
  {
    id: 'DS-03',
    category: {
      id: 'design-safety',
      name: '设计与安全'
    },
    name: '状态机审核',
    summary: '检查状态条件、状态转换与最终控制输出是否一致。',
    details: {
      target: '对指定新 revision 的自研代码执行状态逻辑审查。',
      process: '由 Skill 检查相关 if、switch、状态变量及控制输出调用路径。',
      specification: '具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 30,
    enabled: true,
    materialFields: []
  }
] as const

const reviewItemsById = new Map(REVIEW_ITEM_CATALOG.map((item) => [item.id, item]))

export const findReviewItem = (id: string): ReviewItemDefinition | undefined =>
  reviewItemsById.get(id)

export const resolveReviewItemInputs = (
  inputs: readonly SelectedReviewItemInput[]
): ResolvedReviewItemInput[] => {
  if (inputs.length === 0) {
    throw new Error('请至少选择一个审查项。')
  }

  const resolved: ResolvedReviewItemInput[] = []
  const seenIds = new Set<string>()
  for (const input of inputs) {
    if (seenIds.has(input.id)) {
      throw new Error(`审查项 ${input.id} 不能重复选择。`)
    }
    seenIds.add(input.id)

    const definition = findReviewItem(input.id)
    if (!definition || !definition.enabled) {
      throw new Error(`审查项 ${input.id} 不存在或未启用。`)
    }

    const userExtraRules = input.user_extra_rules?.trim()
    if (userExtraRules && userExtraRules.length > 4096) {
      throw new Error(`审查项 ${input.id} 的用户额外规则不能超过 4096 个字符。`)
    }

    resolved.push({
      id: definition.id,
      name: definition.name,
      ...(userExtraRules ? { user_extra_rules: userExtraRules } : {})
    })
  }

  return resolved
}
