export const REVIEW_TEMPLATES = [
  {
    key: 'template_1',
    label: '模板一',
    skillName: '通用-代码变更审查-模板一'
  },
  {
    key: 'template_2',
    label: '模板二',
    skillName: '通用-代码变更审查-模板二'
  }
] as const

export type ReviewTemplateKey = (typeof REVIEW_TEMPLATES)[number]['key']

export const DEFAULT_REVIEW_TEMPLATE_KEY: ReviewTemplateKey = 'template_1'

export const REQUIRED_REVIEW_SKILL_NAMES = Object.freeze(
  REVIEW_TEMPLATES.map((template) => template.skillName)
)

export const resolveReviewTemplate = (key: string): (typeof REVIEW_TEMPLATES)[number] => {
  const template = REVIEW_TEMPLATES.find((item) => item.key === key)
  if (!template) {
    throw new Error(`未知审查模板：${key}`)
  }
  return template
}
