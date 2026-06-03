import { Component, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownPreviewProps = {
  markdown: string
}

const safeUrl = (href?: string): string | undefined => {
  if (!href) {
    return undefined
  }

  try {
    const parsed = new URL(href, 'https://code-review.local')
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return href
    }
  } catch {
    return undefined
  }

  return undefined
}

const getCodeLanguage = (children: ReactNode): string | undefined => {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<{ className?: string }>(child)) {
    return undefined
  }

  return /language-(\w+)/.exec(child.props.className ?? '')?.[1]
}

class MarkdownErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="preview-empty">报告渲染失败，请下载报告查看原始 Markdown。</div>
    }

    return this.props.children
  }
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps): React.JSX.Element {
  if (!markdown.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">审查完成后，Markdown 报告会显示在这里。</div>
      </div>
    )
  }

  return (
    <div className="preview-scroll">
      <MarkdownErrorBoundary>
        <article className="markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => safeUrl(url)}
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
              )
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </MarkdownErrorBoundary>
    </div>
  )
}
