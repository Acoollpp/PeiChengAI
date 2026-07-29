const outputMetadataPattern =
  /^\s{0,3}(?:>\s*)?(?:[-*+]\s*)?(?:\*\*|__)?报告输出(?:路径|地址)(?:(?:\*\*|__)\s*[：:]|[：:](?:\*\*|__)?)\s*.*$/
const leadingMetadataPattern =
  /^\s{0,3}(?:>\s*)?(?:[-*+]\s*)?(?:\*\*|__)?(?:项目路径|旧版本(?:号)?|新版本(?:号)?|审查日期|审查方式)(?:(?:\*\*|__)\s*[：:]|[：:](?:\*\*|__)?)\s*.*$/

const splitLinesWithEndings = (markdown: string): string[] =>
  markdown.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? []

const withoutLineEnding = (line: string): string => line.replace(/(?:\r\n|\n|\r)$/, '')

export const stripReviewReportOutputMetadata = (markdown: string): string => {
  let fence: { marker: '`' | '~'; length: number } | null = null
  let leadingMetadataOpen = true
  let documentTitleSeen = false

  return splitLinesWithEndings(markdown)
    .filter((line) => {
      const text = withoutLineEnding(line)
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text)

      if (fence) {
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence.marker &&
          fenceMatch[1].length >= fence.length &&
          fenceMatch[2].trim() === ''
        ) {
          fence = null
        }
        return true
      }

      if (fenceMatch) {
        leadingMetadataOpen = false
        fence = {
          marker: fenceMatch[1][0] as '`' | '~',
          length: fenceMatch[1].length
        }
        return true
      }

      if (!leadingMetadataOpen || !text.trim()) {
        return true
      }

      if (/^(?: {4}|\t)/.test(text)) {
        leadingMetadataOpen = false
        return true
      }

      const headingMatch = /^\s{0,3}(#{1,6})(?:\s+|$)/.exec(text)
      if (headingMatch) {
        if (!documentTitleSeen && headingMatch[1].length === 1) {
          documentTitleSeen = true
          return true
        }
        leadingMetadataOpen = false
        return true
      }

      if (outputMetadataPattern.test(text)) {
        return false
      }

      if (leadingMetadataPattern.test(text)) {
        return true
      }

      leadingMetadataOpen = false
      return true
    })
    .join('')
}
