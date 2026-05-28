const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const renderMarkdown = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/)
  const html: string[] = []
  let inList = false

  const closeList = (): void => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)

    if (heading) {
      closeList()
      html.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`)
      continue
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed)

    if (listItem) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }

      html.push(`<li>${renderInline(listItem[1])}</li>`)
      continue
    }

    closeList()
    html.push(`<p>${renderInline(trimmed)}</p>`)
  }

  closeList()

  return html.join('')
}

const renderInline = (value: string): string =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
