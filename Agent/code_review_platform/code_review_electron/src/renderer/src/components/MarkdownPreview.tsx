import {
  Component,
  isValidElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ReportHeadingOption = {
  id: string
  level: number
  text: string
  anchorId: string
}

type MarkdownPreviewProps = {
  markdown: string
  reportPath?: string
  activeFeedbackAnchorId?: string
}

const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/

const anchorIdForLine = (lineIndex: number): string => `report-option-${lineIndex}`

const stripMarkerListPrefix = (value: string): string =>
  value.replace(/^\s*\d+[\.)、]\s*/, '').trim()

const stripMarkdownInline = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

const normalizeCellText = (value?: string): string =>
  stripMarkdownInline(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const isPlaceholderText = (value: string): boolean =>
  !value ||
  value === '无' ||
  value === '待填写' ||
  value === '待填写。' ||
  value.includes('填写') ||
  value.includes('高风险/中风险/低风险/建议')

const isTableSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

const splitTableRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(normalizeCellText)

const makeUniqueOptions = (options: ReportHeadingOption[]): ReportHeadingOption[] => {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (seen.has(option.text)) {
      return false
    }
    seen.add(option.text)
    return true
  })
}

const getHeaderIndex = (headers: string[], names: string[]): number =>
  headers.findIndex((header) => names.some((name) => header.includes(name)))

const buildTemplateTwoTableOption = (
  sectionTitle: string,
  headers: string[],
  cells: string[]
): string | null => {
  const risk = cells[getHeaderIndex(headers, ['风险级别'])] ?? ''
  const direction = cells[getHeaderIndex(headers, ['专项检查方向', '规范违反条目'])] ?? ''
  const description =
    cells[
      getHeaderIndex(headers, [
        '触发规则/缺陷描述',
        '缺陷描述',
        '不合规现象描述',
        '修改建议',
        '整改建议'
      ])
    ] ?? ''
  const parts = [sectionTitle, risk, direction, description].filter((part) => !isPlaceholderText(part))

  if (parts.length < 2) {
    return null
  }

  return parts.join(' · ')
}

const extractTemplateTwoTableOptions = (markdown: string): ReportHeadingOption[] => {
  const options: ReportHeadingOption[] = []
  const lines = markdown.split(/\r?\n/)
  let inCodeBlock = false
  let currentSection = ''
  let currentHeaders: string[] | null = null

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) {
      return
    }

    const headingMatch = headingLinePattern.exec(line)
    if (headingMatch) {
      currentSection = stripMarkerListPrefix(stripMarkdownInline(headingMatch[2]))
      currentHeaders = null
      return
    }

    if (!line.trim().startsWith('|')) {
      currentHeaders = null
      return
    }
    if (isTableSeparator(line)) {
      return
    }

    const cells = splitTableRow(line)
    if (currentHeaders === null) {
      currentHeaders = cells
      return
    }

    const text = buildTemplateTwoTableOption(currentSection, currentHeaders, cells)
    if (text) {
      options.push({ id: `${index}-${text}`, level: 4, text, anchorId: anchorIdForLine(index) })
    }
  })

  return makeUniqueOptions(options)
}

const extractTemplateTwoConclusionOptions = (markdown: string): ReportHeadingOption[] => {
  const options: ReportHeadingOption[] = []
  let inCodeBlock = false
  let inConclusion = false
  let currentSection = ''

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) {
      return
    }

    const headingMatch = headingLinePattern.exec(line)
    if (headingMatch) {
      const headingText = stripMarkerListPrefix(stripMarkdownInline(headingMatch[2]))
      const level = headingMatch[1].length
      if (level === 2) {
        inConclusion = headingText === '结论'
      }
      if (inConclusion && level >= 3) {
        currentSection = headingText
      }
      return
    }

    if (!inConclusion || !currentSection) {
      return
    }

    const itemMatch = /^\s*[-*]\s+(.+?)\s*$/.exec(line)
    if (!itemMatch) {
      return
    }

    const item = stripMarkdownInline(itemMatch[1])
    if (isPlaceholderText(item)) {
      return
    }

    const text = `${currentSection} · ${item}`
    options.push({ id: `${index}-${text}`, level: 4, text, anchorId: anchorIdForLine(index) })
  })

  return makeUniqueOptions(options)
}

const isTemplateTwoReport = (markdown: string): boolean =>
  /代码审查报告模?板二/.test(markdown)

export const extractDetailedHeadingOptions = (markdown: string): ReportHeadingOption[] => {
  if (isTemplateTwoReport(markdown)) {
    const tableOptions = extractTemplateTwoTableOptions(markdown)
    if (tableOptions.length > 0) {
      return tableOptions
    }
    return extractTemplateTwoConclusionOptions(markdown)
  }

  const headings: ReportHeadingOption[] = []
  let inCodeBlock = false

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      return
    }
    if (inCodeBlock) {
      return
    }
    const match = headingLinePattern.exec(line)
    if (!match) {
      return
    }
    const text = stripMarkerListPrefix(stripMarkdownInline(match[2]))
    if (!text) {
      return
    }
    headings.push({
      id: `${index}-${text}`,
      level: match[1].length,
      text,
      anchorId: anchorIdForLine(index)
    })
  })

  const leafHeadings = headings.filter((heading, index) => {
    const nextSameOrHigher = headings.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && candidate.level <= heading.level
    )
    const children = headings.slice(
      index + 1,
      nextSameOrHigher === -1 ? headings.length : nextSameOrHigher
    )
    return children.length === 0
  })
  const detailed = leafHeadings.filter((heading) => heading.level >= 3)
  const fallback = leafHeadings.filter((heading) => heading.level >= 2)

  return makeUniqueOptions(detailed.length > 0 ? detailed : fallback)
}

const safeUrl = (href?: string): string | undefined => {
  if (!href) {
    return undefined
  }

  if (/^(https?|mailto):/i.test(href)) {
    return href
  }

  return undefined
}

const isRelativeImagePath = (src?: string): src is string => {
  if (!src) {
    return false
  }

  return !/^[a-z][a-z\d+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('#')
}

const decodeAssetPath = (src: string): string => {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

const getCodeLanguage = (children: ReactNode): string | undefined => {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<{ className?: string }>(child)) {
    return undefined
  }

  return /language-(\w+)/.exec(child.props.className ?? '')?.[1]
}

const buildFeedbackAnchorMap = (markdown: string): Map<string, string> => {
  const anchors = new Map<string, string>()

  try {
    extractDetailedHeadingOptions(markdown).forEach((option) => {
      anchors.set(option.text, option.anchorId)
    })
  } catch {
    return anchors
  }

  return anchors
}

const getPlainText = (children: ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children)
  }

  if (Array.isArray(children)) {
    return children.map(getPlainText).join('')
  }

  if (isValidElement<{ children?: ReactNode }>(children)) {
    return getPlainText(children.props.children)
  }

  return ''
}

const stripRenderedMarkerPrefix = (value: string): string =>
  value.replace(/^\s*\d+[\.)、]\s*/, '').trim()

const normalizeRenderedAnchorText = (value: string): string =>
  stripRenderedMarkerPrefix(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compactAnchorText = (value: string): string =>
  normalizeRenderedAnchorText(value).replace(/\s+/g, '')

const isActiveReportAnchor = (
  anchorId: string | undefined,
  activeFeedbackAnchorId: string | undefined
): boolean => Boolean(anchorId) && anchorId === activeFeedbackAnchorId

const findAnchorForRenderedText = (
  anchorMap: Map<string, string>,
  renderedText: string
): string | undefined => {
  const normalized = normalizeRenderedAnchorText(renderedText)

  if (!normalized) {
    return undefined
  }

  return anchorMap.get(normalized)
}

const findAnchorForRenderedTableRow = (
  anchorMap: Map<string, string>,
  renderedText: string
): string | undefined => {
  const normalized = normalizeRenderedAnchorText(renderedText)
  if (!normalized) {
    return undefined
  }
  const compactRenderedText = compactAnchorText(normalized)

  return (
    anchorMap.get(normalized) ??
    [...anchorMap.entries()].find(([text]) => {
      const parts = text
        .split('·')
        .map(normalizeRenderedAnchorText)
        .filter((part) => part.length >= 2)
      const rowParts = parts.slice(1)
      const directMatches = rowParts.filter((part) => compactRenderedText.includes(compactAnchorText(part)))
      if (directMatches.length >= 2) {
        return true
      }

      const hasRiskLevel = rowParts.some((part) => /风险|建议/.test(part) && compactRenderedText.includes(compactAnchorText(part)))
      const hasDescriptionFragment = rowParts
        .flatMap((part) => part.split(/[，。；、,.;:：]/))
        .map(normalizeRenderedAnchorText)
        .filter((part) => part.length >= 8)
        .some((part) => compactRenderedText.includes(compactAnchorText(part)))

      return hasRiskLevel && hasDescriptionFragment
    })?.[1]
  )
}

type MarkdownErrorBoundaryProps = {
  children: ReactNode
  resetKey: unknown
}

type MarkdownErrorBoundaryState = {
  hasError: boolean
  resetKey: unknown
}

class MarkdownErrorBoundary extends Component<
  MarkdownErrorBoundaryProps,
  MarkdownErrorBoundaryState
> {
  state: MarkdownErrorBoundaryState = { hasError: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<MarkdownErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: MarkdownErrorBoundaryProps,
    state: MarkdownErrorBoundaryState
  ): Partial<MarkdownErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey }
    }

    return null
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="preview-empty">报告渲染失败，请下载报告查看原始 Markdown。</div>
    }

    return this.props.children
  }
}

function ReportImage({
  alt,
  reportPath,
  src
}: {
  alt?: string
  reportPath?: string
  src?: string
}): React.JSX.Element {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() =>
    isRelativeImagePath(src) ? undefined : safeUrl(src)
  )

  useEffect(() => {
    let isMounted = true

    if (!isRelativeImagePath(src)) {
      setResolvedSrc(safeUrl(src))
      return
    }

    if (!reportPath) {
      setResolvedSrc(undefined)
      return
    }

    setResolvedSrc(undefined)
    window.codeReview
      .readReportAsset({ reportPath, assetPath: decodeAssetPath(src) })
      .then((asset) => {
        if (isMounted) {
          setResolvedSrc(asset.dataUrl)
        }
      })
      .catch(() => {
        if (isMounted) {
          setResolvedSrc(undefined)
        }
      })

    return () => {
      isMounted = false
    }
  }, [reportPath, src])

  return <img src={resolvedSrc} alt={alt ?? ''} />
}

export function MarkdownPreview({
  markdown,
  reportPath,
  activeFeedbackAnchorId
}: MarkdownPreviewProps): React.JSX.Element {
  const feedbackAnchorMap = useMemo(() => buildFeedbackAnchorMap(markdown), [markdown])

  if (!markdown.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">审查完成后，Markdown 报告会显示在这里。</div>
      </div>
    )
  }

  return (
    <div className="preview-scroll">
      <MarkdownErrorBoundary resetKey={markdown}>
        <article className="markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url, key) =>
              key === 'src' && isRelativeImagePath(url) ? url : safeUrl(url)
            }
            components={{
              h1: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h1
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h1>
                )
              },
              h2: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h2
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h2>
                )
              },
              h3: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h3
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h3>
                )
              },
              h4: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h4
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h4>
                )
              },
              h5: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h5
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h5>
                )
              },
              h6: ({ children }) => {
                const anchorId = findAnchorForRenderedText(feedbackAnchorMap, getPlainText(children))
                return (
                  <h6
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </h6>
                )
              },
              a: ({ href, children }) => {
                const safeHref = safeUrl(href)
                if (!safeHref) {
                  return <span>{children}</span>
                }

                return (
                  <a href={safeHref} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                )
              },
              code: ({ className, children }) => (
                <code className={className}>
                  {children}
                </code>
              ),
              pre: ({ children }) => {
                const language = getCodeLanguage(children)
                return (
                  <div className="markdown-code-block">
                    {language && <div className="markdown-code-language">{language}</div>}
                    <pre>{children}</pre>
                  </div>
                )
              },
              table: ({ children }) => (
                <div className="markdown-table-wrapper" style={{ overflowX: 'auto' }}>
                  <table>{children}</table>
                </div>
              ),
              tr: ({ children }) => {
                const anchorId = findAnchorForRenderedTableRow(feedbackAnchorMap, getPlainText(children))
                return (
                  <tr
                    data-report-anchor-id={anchorId}
                    className={
                      isActiveReportAnchor(anchorId, activeFeedbackAnchorId)
                        ? 'report-anchor-highlight'
                        : undefined
                    }
                  >
                    {children}
                  </tr>
                )
              },
              img: ({ alt, src }) => <ReportImage alt={alt} src={src} reportPath={reportPath} />
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </MarkdownErrorBoundary>
    </div>
  )
}
