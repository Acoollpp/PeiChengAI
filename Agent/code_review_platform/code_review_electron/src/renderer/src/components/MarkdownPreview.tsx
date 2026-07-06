import {
  Component,
  isValidElement,
  type ReactNode,
  useEffect,
  useState
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ReportHeadingOption = {
  id: string
  level: number
  text: string
}

type MarkdownPreviewProps = {
  markdown: string
  reportPath?: string
}

const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/

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
      options.push({ id: `${index}-${text}`, level: 4, text })
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
    options.push({ id: `${index}-${text}`, level: 4, text })
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
      text
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
  reportPath
}: MarkdownPreviewProps): React.JSX.Element {
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
              code: ({ className, children, ...props }) => (
                <code className={className} {...props}>
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
