import { describe, expect, it } from 'vitest'

import {
  BMS_CODE_REVIEW_SKILL_NAME,
  REVIEW_ITEM_CATALOG,
  REVIEW_ITEM_CATALOG_VERSION,
  resolveReviewItemInputs
} from './review-items'

describe('审查项目录', () => {
  it('以版本化类型配置发布 DS-01 材料字段并保留 DS-03', () => {
    expect(REVIEW_ITEM_CATALOG_VERSION).toBe(2)
    expect(BMS_CODE_REVIEW_SKILL_NAME).toBe('bms-code-reviewer')
    expect(REVIEW_ITEM_CATALOG).toEqual([
      expect.objectContaining({
        id: 'DS-01',
        name: '变更点审查',
        sortOrder: 10,
        enabled: true,
        materialFields: [
          expect.objectContaining({
            id: 'requirement-sheet',
            name: '产品开发需求表',
            required: true,
            multiple: false,
            allowedExtensions: ['.xlsx', '.xls']
          }),
          expect.objectContaining({
            id: 'product-spec',
            name: '产品规格书',
            required: true,
            multiple: false,
            allowedExtensions: ['.pdf']
          })
        ]
      }),
      expect.objectContaining({
        id: 'DS-03',
        category: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        name: '状态机审核',
        summary: expect.any(String),
        details: {
          target: expect.any(String),
          process: expect.any(String),
          specification: expect.any(String)
        },
        sortOrder: 30,
        enabled: true,
        materialFields: []
      })
    ])
  })

  it('解析逐项额外规则并拒绝空选择、重复项和未知项', () => {
    expect(resolveReviewItemInputs([{ id: 'DS-03', user_extra_rules: '  检查休眠唤醒  ' }])).toEqual([
      { id: 'DS-03', name: '状态机审核', user_extra_rules: '检查休眠唤醒', materials: [] }
    ])
    expect(() => resolveReviewItemInputs([])).toThrow('请至少选择一个审查项。')
    expect(() => resolveReviewItemInputs([{ id: 'DS-03' }, { id: 'DS-03' }])).toThrow(
      '审查项 DS-03 不能重复选择。'
    )
    expect(() => resolveReviewItemInputs([{ id: 'DS-99' }])).toThrow(
      '审查项 DS-99 不存在或未启用。'
    )
  })

  it('把 DS-01 原始本地路径绑定到各自材料字段', () => {
    expect(resolveReviewItemInputs([{
      id: 'DS-01',
      materials: [
        { field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] },
        { field_id: 'product-spec', file_paths: ['/input/spec.pdf'] }
      ]
    }])[0]).toEqual(expect.objectContaining({
      id: 'DS-01',
      name: '变更点审查',
      materials: [
        expect.objectContaining({ fieldId: 'requirement-sheet', filePaths: ['/input/requirements.xlsx'] }),
        expect.objectContaining({ fieldId: 'product-spec', filePaths: ['/input/spec.pdf'] })
      ]
    }))
  })

  it('组合解析保持逐项规则，并拒绝向 DS-03 夹带专项材料', () => {
    expect(resolveReviewItemInputs([
      {
        id: 'DS-01',
        user_extra_rules: '  只核对协议导入  ',
        materials: [
          { field_id: 'requirement-sheet', file_paths: ['/input/requirements.xlsx'] },
          { field_id: 'product-spec', file_paths: ['/input/specification.pdf'] }
        ]
      },
      { id: 'DS-03', user_extra_rules: '   ' }
    ])).toEqual([
      expect.objectContaining({ id: 'DS-01', user_extra_rules: '只核对协议导入' }),
      { id: 'DS-03', name: '状态机审核', materials: [] }
    ])

    expect(() => resolveReviewItemInputs([{
      id: 'DS-03',
      materials: [{ field_id: 'product-spec', file_paths: ['/input/specification.pdf'] }]
    }])).toThrow('审查项 DS-03 不支持材料字段 product-spec。')
  })
})
