const outputMetadataPattern =
  /^\s*(?:>\s*)?(?:[-*+]\s*)?(?:\*\*|__)?报告输出(?:路径|地址)(?:(?:\*\*|__)\s*[：:]|[：:](?:\*\*|__)?)\s*.*$/

const splitLinesWithEndings = (markdown: string): string[] =>
  markdown.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? []

const withoutLineEnding = (line: string): string => line.replace(/(?:\r\n|\n|\r)$/, '')

export const stripReviewReportOutputMetadata = (markdown: string): string => {
  let fence: { marker: '`' | '~'; length: number } | null = null

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
        fence = {
          marker: fenceMatch[1][0] as '`' | '~',
          length: fenceMatch[1].length
        }
        return true
      }

      return !outputMetadataPattern.test(text)
    })
    .join('')
}
