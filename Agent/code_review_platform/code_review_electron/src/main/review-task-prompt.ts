import { isAbsolute, win32 as windowsPath } from 'node:path'

import {
  BMS_CODE_REVIEW_SKILL_NAME,
  type ResolvedReviewItemInput
} from '../shared/review-items'

export interface BmsReviewTaskPromptInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  departmentName?: string
  reviewItems: readonly ResolvedReviewItemInput[]
  reportPath: string
  evidenceDir?: string
}

// 平台指定证据落盘位置，只为把 SVN 导出的源码树压进 Windows MAX_PATH 260 之内；
// 不触碰 Skill 自身的证据模式、编排策略和失败策略（见 issue #76）。
export const buildEvidenceDirSection = (evidenceDir: string | undefined): string[] => {
  const trimmed = evidenceDir?.trim()
  if (!trimmed) {
    return []
  }

  return [
    '',
    '## 证据工作目录',
    `- 证据工作目录：${trimmed}`,
    '',
    'SVN 取证必须以该目录作为输出目录，不得在其他位置新建工作目录。该目录已由平台清空且仅供本次任务使用。指定它是因为 Windows 路径长度上限为 260 字符，工作目录过深会让 PowerShell 读不到导出的源文件。本约束只规定证据落盘位置，不改变 Skill 自身的证据模式、编排策略和失败策略。'
  ]
}

const isAbsoluteOnSupportedPlatform = (value: string): boolean =>
  isAbsolute(value) || windowsPath.isAbsolute(value)

export const buildBmsReviewTaskPrompt = ({
  svnUrl,
  oldRevision,
  newRevision,
  departmentName,
  reviewItems,
  reportPath,
  evidenceDir
}: BmsReviewTaskPromptInput): string => {
  if (!isAbsoluteOnSupportedPlatform(reportPath)) {
    throw new Error('Markdown 报告输出路径必须是绝对路径。')
  }
  if (reviewItems.length === 0) {
    throw new Error('请至少选择一个审查项。')
  }

  const reviewItemSections = reviewItems.map((item) => {
    const extraRules = item.user_extra_rules?.trim() || '无'
    const materials = item.materials.filter((material) => material.filePaths.length > 0)
    const materialLines = materials.length === 0
      ? ['- 专项材料：无']
      : [
          '- 专项材料：',
          ...materials.flatMap((material) => {
            material.filePaths.forEach((filePath) => {
              if (!isAbsoluteOnSupportedPlatform(filePath)) {
                throw new Error(`${item.id} ${material.name}路径必须是绝对路径。`)
              }
            })
            return [
              `  - ${material.name}（${material.fieldId}）：`,
              ...material.filePaths.map((filePath) => `    - ${filePath}`)
            ]
          })
        ]
    return [
      `### ${item.id}：${item.name}`,
      `- 用户额外规则：${extraRules}`,
      ...materialLines
    ].join('\n')
  })

  return [
    `请强制使用本机 Codex 已安装的 Skill：${BMS_CODE_REVIEW_SKILL_NAME}`,
    '',
    '请读取并严格按照该 Skill 的 SKILL.md 执行本次审查。平台只传递任务输入，不解释或覆盖 Skill 内部的审查规则、证据模式、编排策略和失败策略。',
    '',
    '## 任务公共输入',
    `- SVN 地址：${svnUrl}`,
    `- 旧 revision：${oldRevision}`,
    `- 新 revision：${newRevision}`,
    `- 所属部门：${departmentName?.trim() || '未设置'}`,
    '',
    '旧 revision 是用户原始输入，必须原样交给 Skill。不得由平台提示词把 0 或 r0 解释为整单的全量审查模式；每个审查项的证据模式只由 Skill 决定。',
    '',
    '## 已选审查项',
    reviewItemSections.join('\n\n'),
    '',
    '每项用户额外规则只属于紧邻的该审查项，不得应用到其他审查项或扩展为未选择的审查方向。',
    ...buildEvidenceDirSection(evidenceDir),
    '',
    '## 报告输出',
    `- Markdown 报告完整路径：${reportPath}`,
    '',
    '只生成 Markdown 审查报告并写入上述完整路径。报告内容、问题格式和最终错误标记均按 bms-code-reviewer Skill 自身约定执行。报告正文不得包含报告输出路径或其他本机内部路径。'
  ].join('\n')
}
