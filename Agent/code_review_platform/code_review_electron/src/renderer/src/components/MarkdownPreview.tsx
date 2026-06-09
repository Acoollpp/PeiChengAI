import { Component, isValidElement, type ReactNode, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownPreviewProps = {
  markdown: string
  reportPath?: string
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

export function MarkdownPreview({ markdown, reportPath }: MarkdownPreviewProps): React.JSX.Element {
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
