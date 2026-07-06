import { Component, isValidElement, type ReactNode, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ReportHeadingOption = {
  id: string
  level: number
  text: string
}

type UsefulIssueSelection = {
  enabled: boolean
  selectedIssues: string[]
  onToggle: (issue: string) => void
}

type MarkdownPreviewProps = {
  markdown: string
  reportPath?: string
  usefulIssueSelection?: UsefulIssueSelection
}

const headingLinePattern = /^(#{1,6})\s+(.+?)\s*$/

const stripMarkdownInline = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()

export const extractDetailedHeadingOptions = (markdown: string): ReportHeadingOption[] => {
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
    const text = stripMarkdownInline(match[2])
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

  return detailed.length > 0 ? detailed : fallback
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
  reportPath,
  usefulIssueSelection
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
          {usefulIssueSelection?.enabled && (
            <div className="report-heading-options" aria-label="可标记的有用信息">
              {extractDetailedHeadingOptions(markdown).map((option) => (
                <label className="report-heading-option" key={option.id}>
                  <input
                    type="checkbox"
                    checked={usefulIssueSelection.selectedIssues.includes(option.text)}
                    onChange={() => usefulIssueSelection.onToggle(option.text)}
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </div>
          )}
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
