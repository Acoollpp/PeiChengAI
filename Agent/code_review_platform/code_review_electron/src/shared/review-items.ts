export const REVIEW_ITEM_CATALOG_VERSION = 2

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

export interface SelectedReviewItemMaterialInput {
  field_id: string
  file_paths: string[]
}

export interface SelectedReviewItemInput {
  id: string
  user_extra_rules?: string
  materials?: SelectedReviewItemMaterialInput[]
}

export interface ResolvedReviewItemMaterialInput {
  fieldId: string
  name: string
  required: boolean
  multiple: boolean
  allowedExtensions: readonly string[]
  filePaths: string[]
}

export interface ResolvedReviewItemInput {
  id: string
  user_extra_rules?: string
  name: string
  materials: ResolvedReviewItemMaterialInput[]
}

export const REVIEW_ITEM_CATALOG: readonly ReviewItemDefinition[] = [
  {
    id: 'DS-01',
    category: {
      id: 'requirements-and-change',
      name: '需求与变更'
    },
    name: '变更点审查',
    summary: '核对两个真实 SVN revision 之间的代码变更是否完整承接产品需求。',
    details: {
      target: '建立需求、规格与代码变更之间的可追溯证据，识别漏改、错改和影响范围遗漏。',
      process: '读取产品开发需求表的软件项和协议，核对产品规格书第五章，再结合双 revision 变更形成结论。',
      specification: '必须提供真实的旧、新 revision；平台仅整理输入，审查证据模式由 bms-code-reviewer Skill 决定。'
    },
    sortOrder: 10,
    enabled: true,
    materialFields: [
      {
        id: 'requirement-sheet',
        name: '产品开发需求表',
        description: '包含本次变更软件项和协议内容的 Excel 文件。',
        required: true,
        multiple: false,
        allowedExtensions: ['.xlsx', '.xls']
      },
      {
        id: 'product-spec',
        name: '产品规格书',
        description: '用于核对第五章基本参数设置和基本配置的 PDF 文件。',
        required: true,
        multiple: false,
        allowedExtensions: ['.pdf']
      }
    ]
  },
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

    const providedMaterials = input.materials ?? []
    const materialInputsByFieldId = new Map<string, SelectedReviewItemMaterialInput>()
    for (const material of providedMaterials) {
      if (materialInputsByFieldId.has(material.field_id)) {
        throw new Error(`审查项 ${input.id} 的材料字段 ${material.field_id} 不能重复。`)
      }
      if (!definition.materialFields.some((field) => field.id === material.field_id)) {
        throw new Error(`审查项 ${input.id} 不支持材料字段 ${material.field_id}。`)
      }
      materialInputsByFieldId.set(material.field_id, material)
    }

    resolved.push({
      id: definition.id,
      name: definition.name,
      ...(userExtraRules ? { user_extra_rules: userExtraRules } : {}),
      materials: definition.materialFields.map((field) => ({
        fieldId: field.id,
        name: field.name,
        required: field.required,
        multiple: field.multiple,
        allowedExtensions: field.allowedExtensions,
        filePaths: [...(materialInputsByFieldId.get(field.id)?.file_paths ?? [])]
      }))
    })
  }

  return resolved
}
