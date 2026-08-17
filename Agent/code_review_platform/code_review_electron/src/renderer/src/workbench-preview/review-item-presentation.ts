import type { ReviewItemDefinition, ReviewItemId } from './types'

const WORKBENCH_REVIEW_ITEM_PRESENTATION: Record<
  ReviewItemId,
  Pick<ReviewItemDefinition, 'summary'> | undefined
> = {
  'DS-01': {
    summary: '重点依据产品开发需求表，核对代码变更是否完整、准确落实需求。'
  },
  'DS-02': undefined,
  'DS-03': undefined,
  'DS-04': undefined,
  'DS-05': undefined,
  'DS-06': undefined
}

export const applyWorkbenchReviewItemPresentation = (
  item: ReviewItemDefinition
): ReviewItemDefinition => {
  const presentation = WORKBENCH_REVIEW_ITEM_PRESENTATION[item.id]
  return {
    ...item,
    summary: presentation?.summary ?? item.summary
  }
}
