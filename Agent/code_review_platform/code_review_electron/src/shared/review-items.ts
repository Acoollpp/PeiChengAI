export const REVIEW_ITEM_CATALOG_VERSION = 4

export const BMS_CODE_REVIEW_SKILL_NAME = 'bms-code-reviewer'

export type ReviewItemId = 'DS-01' | 'DS-02' | 'DS-03' | 'DS-04' | 'DS-05' | 'DS-06'

export interface ReviewItemMaterialFieldDefinition {
  id: string
  name: string
  description: string
  required: boolean
  multiple: boolean
  allowedExtensions: readonly string[]
}

export interface ReviewItemDefinition {
  id: ReviewItemId
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
      id: 'daily-submission',
      name: '日常提交审核'
    },
    name: '需求变更审查',
    summary: '核对两个真实 SVN revision 之间的代码变更是否完整承接产品开发需求表。',
    details: {
      target: '建立需求与代码变更之间的可追溯证据，识别漏改、错改和影响范围遗漏。',
      process: '读取产品开发需求表的软件项和协议，再结合双 revision 变更形成结论。',
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
      }
    ]
  },
  {
    id: 'DS-02',
    category: {
      id: 'daily-submission',
      name: '日常提交审核'
    },
    name: '编码规范审查',
    summary: '检查本次审查范围内影响可靠性、可维护性与一致性的编码质量问题。',
    details: {
      target: '以可定位的代码证据识别编码质量偏差，为修复与复核提供清晰依据。',
      process: '读取任务公共输入和用户额外规则，由 Skill 确定审查范围、执行检查并形成结论。',
      specification: '无需专项材料；具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 20,
    enabled: true,
    materialFields: []
  },
  {
    id: 'DS-03',
    category: {
      id: 'control-logic',
      name: '控制逻辑专项审核'
    },
    name: 'MOS 充放电状态机审查',
    summary: '检查 MOS 充放电状态与受控输出一致性。',
    details: {
      target: '对指定新 revision 的 MOS 充放电状态、状态转换和受控输出执行一致性审查。',
      process: '由 Skill 检查相关 if、switch、状态变量及充放电 MOS 控制输出调用路径。',
      specification: '具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 30,
    enabled: true,
    materialFields: []
  },
  {
    id: 'DS-04',
    category: {
      id: 'driver',
      name: '驱动专项审核'
    },
    name: 'AFE 驱动审核',
    summary: '依据一份或多份芯片规格书 PDF 审查 AFE 驱动配置、寄存器访问和异常处理。',
    details: {
      target: '核对 AFE 驱动实现与芯片规格书约束，识别寄存器、时序、异常处理和边界配置风险。',
      process: '读取用户提供的芯片规格书 PDF，由 Skill 决定证据范围、审查流程和问题判定。',
      specification: '可连续选择多份 PDF 芯片规格书；具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 40,
    enabled: true,
    materialFields: [
      {
        id: 'chip-specs',
        name: '芯片规格书',
        description: '用于核对 AFE 驱动配置、寄存器和时序约束的一份或多份 PDF 文件。',
        required: true,
        multiple: true,
        allowedExtensions: ['.pdf']
      }
    ]
  },
  {
    id: 'DS-05',
    category: {
      id: 'daily-submission',
      name: '日常提交审核'
    },
    name: '变更点风险检查',
    summary: '基于新旧 revision 对变更点执行开放性风险检查。',
    details: {
      target: '识别代码变更本身引入的功能、可靠性、边界条件和回归风险。',
      process: '读取任务公共输入和用户额外规则，由 Skill 确定审查范围、执行检查并形成结论。',
      specification: '无需专项材料；具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 50,
    enabled: true,
    materialFields: []
  },
  {
    id: 'DS-06',
    category: {
      id: 'spec-consistency',
      name: '规格一致性审核'
    },
    name: '规格书审查',
    summary: '依据产品规格书 PDF 审查指定新 revision 的参数与配置一致性。',
    details: {
      target: '核对产品规格书中的参数、配置与新 revision 实现，识别不一致和遗漏。',
      process: '读取产品规格书 PDF，由 Skill 根据当前审查项规则建立证据并形成结论。',
      specification: '必须提供一份 PDF 产品规格书；具体审查规则、证据模式和失败策略由 bms-code-reviewer Skill 维护。'
    },
    sortOrder: 60,
    enabled: true,
    materialFields: [
      {
        id: 'product-spec',
        name: '产品规格书',
        description: '用于核对指定新 revision 参数与配置一致性的 PDF 文件。',
        required: true,
        multiple: false,
        allowedExtensions: ['.pdf']
      }
    ]
  }
] as const

const reviewItemsById = new Map<string, ReviewItemDefinition>(
  REVIEW_ITEM_CATALOG.map((item) => [item.id, item])
)

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
