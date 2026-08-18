import { describe, expect, it } from 'vitest'

import {
  buildCustomReviewRetryInputs,
  getCustomReviewRetrySnapshot
} from './custom-review-retry'
import type { ReviewTask } from './types'

const task = (overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id: 'task-ds99',
  svn_url: 'svn://repo/project',
  old_revision: '10',
  new_revision: '12',
  review_item_ids: ['DS-99'],
  custom_review_rule: '保护状态必须有明确恢复路径。',
  custom_review_mode: 'dual_revision',
  has_custom_review_word_material: true,
  has_custom_review_excel_material: false,
  has_custom_review_pdf_material: true,
  status: 'failed',
  ...overrides
})

describe('DS-99 跨会话重试快照', () => {
  it('仅对规则、模式和三类材料状态完整的 DS-99 任务启用受限重试', () => {
    expect(getCustomReviewRetrySnapshot(task())).toEqual({
      rule: '保护状态必须有明确恢复路径。',
      mode: 'dual_revision',
      requiredMaterialFieldIds: ['word-materials', 'pdf-materials']
    })
    expect(getCustomReviewRetrySnapshot(task({ has_custom_review_pdf_material: null }))).toBeUndefined()
    expect(getCustomReviewRetrySnapshot(task({ review_item_ids: ['DS-03'] }))).toBeUndefined()
  })

  it('重试使用原规则和模式，只允许原任务已提供的材料类型', () => {
    const source = task({ review_item_ids: ['DS-03', 'DS-99'] })
    const snapshot = getCustomReviewRetrySnapshot(source)!

    expect(buildCustomReviewRetryInputs(source, snapshot, [{
      id: 'DS-99',
      user_extra_rules: snapshot.rule,
      custom_mode: snapshot.mode,
      materials: [
        { field_id: 'word-materials', file_paths: ['/retry/规则.docx'] },
        { field_id: 'pdf-materials', file_paths: ['/retry/规格书.pdf'] }
      ]
    }])).toEqual([
      { id: 'DS-03' },
      expect.objectContaining({
        id: 'DS-99',
        user_extra_rules: '保护状态必须有明确恢复路径。',
        custom_mode: 'dual_revision',
        materials: [
          { field_id: 'word-materials', file_paths: ['/retry/规则.docx'] },
          { field_id: 'pdf-materials', file_paths: ['/retry/规格书.pdf'] }
        ]
      })
    ])
  })

  it.each([
    {
      name: '漏选原有材料类型',
      input: [{
        id: 'DS-99',
        materials: [{ field_id: 'word-materials', file_paths: ['/retry/规则.docx'] }]
      }],
      message: '必须重新选择原任务提供过的 pdf-materials 材料'
    },
    {
      name: '新增原来未提供的材料类型',
      input: [{
        id: 'DS-99',
        materials: [
          { field_id: 'word-materials', file_paths: ['/retry/规则.docx'] },
          { field_id: 'excel-materials', file_paths: ['/retry/规则.xlsx'] },
          { field_id: 'pdf-materials', file_paths: ['/retry/规格书.pdf'] }
        ]
      }],
      message: '不能新增原任务未提供的 excel-materials 材料'
    },
    {
      name: '篡改规则',
      input: [{
        id: 'DS-99',
        user_extra_rules: '替换为另一条规则',
        materials: [
          { field_id: 'word-materials', file_paths: ['/retry/规则.docx'] },
          { field_id: 'pdf-materials', file_paths: ['/retry/规格书.pdf'] }
        ]
      }],
      message: '必须使用原任务的审查规则'
    }
  ])('$name会被执行层拒绝', ({ input, message }) => {
    const source = task()
    const snapshot = getCustomReviewRetrySnapshot(source)!
    expect(() => buildCustomReviewRetryInputs(source, snapshot, input)).toThrow(message)
  })
})
