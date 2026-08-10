import type { ReviewItemDefinition, ReviewItemId } from './types'

const WORKBENCH_REVIEW_ITEM_PRESENTATION: Record<
  ReviewItemId,
  Pick<ReviewItemDefinition, 'category' | 'name'> & { summary?: string }
> = {
  'DS-01': {
    category: '日常提交审核',
    name: '变更点审查',
    summary: '重点依据产品开发需求表和产品规格书，核对代码变更是否完整、准确落实需求与规格。'
  },
  'DS-02': {
    category: '日常提交审核',
    name: '编码规范审查'
  },
  'DS-03': {
    category: '控制逻辑专项审核',
    name: '状态机审查'
  }
}

export const applyWorkbenchReviewItemPresentation = (
  item: ReviewItemDefinition
): ReviewItemDefinition => ({
  ...item,
  ...WORKBENCH_REVIEW_ITEM_PRESENTATION[item.id],
  summary: WORKBENCH_REVIEW_ITEM_PRESENTATION[item.id].summary ?? item.summary
})
