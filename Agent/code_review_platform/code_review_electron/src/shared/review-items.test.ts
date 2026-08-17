import { describe, expect, it } from 'vitest'

import {
  BMS_CODE_REVIEW_SKILL_NAME,
  REVIEW_ITEM_CATALOG,
  REVIEW_ITEM_CATALOG_VERSION,
  resolveReviewItemInputs
} from './review-items'

describe('审查项目录', () => {
  it('以稳定顺序发布 DS-01 到 DS-06 的正式元数据和材料定义', () => {
    expect(REVIEW_ITEM_CATALOG_VERSION).toBe(4)
    expect(BMS_CODE_REVIEW_SKILL_NAME).toBe('bms-code-reviewer')
    expect(REVIEW_ITEM_CATALOG.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category.name,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
      materialFields: item.materialFields.map((field) => ({
        id: field.id,
        name: field.name,
        required: field.required,
        multiple: field.multiple,
        allowedExtensions: field.allowedExtensions
      }))
    }))).toEqual([
      expect.objectContaining({
        id: 'DS-01',
        name: '需求变更审查',
        category: '日常提交审核',
        sortOrder: 10,
        enabled: true,
        materialFields: [
          {
            id: 'requirement-sheet',
            name: '产品开发需求表',
            required: true,
            multiple: false,
            allowedExtensions: ['.xlsx', '.xls']
          }
        ]
      }),
      expect.objectContaining({
        id: 'DS-02',
        category: '日常提交审核',
        name: '编码规范审查',
        sortOrder: 20,
        enabled: true,
        materialFields: []
      }),
      expect.objectContaining({
        id: 'DS-03',
        category: '控制逻辑专项审核',
        name: 'MOS 充放电状态机审查',
        sortOrder: 30,
        enabled: true,
        materialFields: []
      }),
      expect.objectContaining({
        id: 'DS-04',
        category: '驱动专项审核',
        name: 'AFE 驱动审核',
        sortOrder: 40,
        enabled: true,
        materialFields: [{
          id: 'chip-specs',
          name: '芯片规格书',
          required: true,
          multiple: true,
          allowedExtensions: ['.pdf']
        }]
      }),
      expect.objectContaining({
        id: 'DS-05',
        category: '日常提交审核',
        name: '变更点风险检查',
        sortOrder: 50,
        enabled: true,
        materialFields: []
      }),
      expect.objectContaining({
        id: 'DS-06',
        category: '规格一致性审核',
        name: '规格书审查',
        sortOrder: 60,
        enabled: true,
        materialFields: [{
          id: 'product-spec',
          name: '产品规格书',
          required: true,
          multiple: false,
          allowedExtensions: ['.pdf']
        }]
      })
    ])
    expect(REVIEW_ITEM_CATALOG.map((item) => item.id)).toEqual([
      'DS-01', 'DS-02', 'DS-03', 'DS-04', 'DS-05', 'DS-06'
    ])
    expect(REVIEW_ITEM_CATALOG.map((item) => item.id as string)).not.toContain('DS-99')
  })

  it('解析逐项额外规则并拒绝空选择、重复项和未知项', () => {
    expect(resolveReviewItemInputs([{ id: 'DS-03', user_extra_rules: '  检查休眠唤醒  ' }])).toEqual([
      { id: 'DS-03', name: 'MOS 充放电状态机审查', user_extra_rules: '检查休眠唤醒', materials: [] }
    ])
    expect(() => resolveReviewItemInputs([])).toThrow('请至少选择一个审查项。')
    expect(() => resolveReviewItemInputs([{ id: 'DS-03' }, { id: 'DS-03' }])).toThrow(
      '审查项 DS-03 不能重复选择。'
    )
    expect(() => resolveReviewItemInputs([{ id: 'DS-99' }])).toThrow(
      '审查项 DS-99 不存在或未启用。'
    )
  })

  it('把 DS-01 原始本地路径绑定到需求表材料字段', () => {
    expect(resolveReviewItemInputs([{
      id: 'DS-01',
      materials: [
        { field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] }
      ]
    }])[0]).toEqual(expect.objectContaining({
      id: 'DS-01',
      name: '需求变更审查',
      materials: [
        expect.objectContaining({ fieldId: 'requirement-sheet', filePaths: ['/input/requirements.xlsx'] })
      ]
    }))
  })

  it('组合解析保持逐项规则，并拒绝向 DS-03 夹带专项材料', () => {
    expect(resolveReviewItemInputs([
      {
        id: 'DS-01',
        user_extra_rules: '  只核对协议导入  ',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '   ' }
    ])).toEqual([
      expect.objectContaining({ id: 'DS-01', user_extra_rules: '只核对协议导入' }),
      { id: 'DS-03', name: 'MOS 充放电状态机审查', materials: [] }
    ])

    expect(() => resolveReviewItemInputs([{
      id: 'DS-03',
      materials: [{ field_id: 'product-spec', file_paths: ['/input/specification.pdf'] }]
    }])).toThrow('审查项 DS-03 不支持材料字段 product-spec。')
  })

  it('支持 DS-02 单独解析且不产生材料字段', () => {
    expect(resolveReviewItemInputs([{
      id: 'DS-02',
      user_extra_rules: '  重点核对本次新增模块  '
    }])).toEqual([{
      id: 'DS-02',
      name: '编码规范审查',
      user_extra_rules: '重点核对本次新增模块',
      materials: []
    }])
  })

  it('组合解析 DS-01 + DS-02 时材料只属于 DS-01', () => {
    const resolved = resolveReviewItemInputs([
      {
        id: 'DS-01',
        user_extra_rules: '只核对需求边界',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] }
        ]
      },
      { id: 'DS-02', user_extra_rules: '只核对编码质量' }
    ])

    expect(resolved.map((item) => item.id)).toEqual(['DS-01', 'DS-02'])
    expect(resolved[0]).toEqual(expect.objectContaining({
      id: 'DS-01',
      user_extra_rules: '只核对需求边界',
      materials: [
        expect.objectContaining({ fieldId: 'requirement-sheet', filePaths: ['/input/requirements.xlsx'] })
      ]
    }))
    expect(resolved[1]).toEqual({
      id: 'DS-02',
      name: '编码规范审查',
      user_extra_rules: '只核对编码质量',
      materials: []
    })
  })

  it('组合解析 DS-02 + DS-03 时保持两项额外规则且均无材料', () => {
    expect(resolveReviewItemInputs([
      { id: 'DS-02', user_extra_rules: '只核对编码质量' },
      { id: 'DS-03', user_extra_rules: '只核对状态恢复' }
    ])).toEqual([
      {
        id: 'DS-02',
        name: '编码规范审查',
        user_extra_rules: '只核对编码质量',
        materials: []
      },
      {
        id: 'DS-03',
        name: 'MOS 充放电状态机审查',
        user_extra_rules: '只核对状态恢复',
        materials: []
      }
    ])
  })

  it('拒绝向 DS-02 夹带不属于自身的材料字段', () => {
    expect(() => resolveReviewItemInputs([{
      id: 'DS-02',
      materials: [{ field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] }]
    }])).toThrow('审查项 DS-02 不支持材料字段 requirement-sheet。')
  })

  it('组合解析 DS-01 + DS-04 + DS-06 时按审查项隔离规则和材料', () => {
    const resolved = resolveReviewItemInputs([
      {
        id: 'DS-01',
        user_extra_rules: '只核对需求变更',
        materials: [{ field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] }]
      },
      {
        id: 'DS-04',
        user_extra_rules: '重点核对 AFE 配置寄存器',
        materials: [{
          field_id: 'chip-specs',
          file_paths: ['/input/afe-a.pdf', '/input/afe-b.pdf']
        }]
      },
      {
        id: 'DS-06',
        user_extra_rules: '只核对第五章配置',
        materials: [{ field_id: 'product-spec', file_paths: ['/input/product-spec.pdf'] }]
      }
    ])

    expect(resolved).toEqual([
      expect.objectContaining({
        id: 'DS-01',
        name: '需求变更审查',
        user_extra_rules: '只核对需求变更',
        materials: [expect.objectContaining({ fieldId: 'requirement-sheet' })]
      }),
      expect.objectContaining({
        id: 'DS-04',
        name: 'AFE 驱动审核',
        user_extra_rules: '重点核对 AFE 配置寄存器',
        materials: [expect.objectContaining({
          fieldId: 'chip-specs',
          multiple: true,
          filePaths: ['/input/afe-a.pdf', '/input/afe-b.pdf']
        })]
      }),
      expect.objectContaining({
        id: 'DS-06',
        name: '规格书审查',
        user_extra_rules: '只核对第五章配置',
        materials: [expect.objectContaining({
          fieldId: 'product-spec',
          multiple: false,
          filePaths: ['/input/product-spec.pdf']
        })]
      })
    ])
  })
})
