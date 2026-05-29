import { renderMarkdown } from '../markdown'

type MarkdownPreviewProps = {
  markdown: string
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
      <article
        className="markdown-preview"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </div>
  )
}
