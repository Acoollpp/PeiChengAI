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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      closeList()
      continue
    }

    const tableHeader = parseTableRow(trimmed)

    if (tableHeader && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const rows: string[][] = []
      index += 2

      while (index < lines.length) {
        const row = parseTableRow(lines[index])

        if (!row || row.length !== tableHeader.length) {
          index -= 1
          break
        }

        rows.push(row)
        index += 1
      }

      closeList()
      html.push(renderTable(tableHeader, rows))
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

const parseTableRow = (line: string): string[] | null => {
  const trimmed = line.trim()

  if (!trimmed.includes('|')) {
    return null
  }

  const normalized = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = normalized.endsWith('|') ? normalized.slice(0, -1) : normalized
  const cells = withoutTrailing.split('|').map((cell) => cell.trim())

  return cells.length > 1 ? cells : null
}

const isTableDivider = (line: string): boolean => {
  const cells = parseTableRow(line)
  return Boolean(cells?.every((cell) => /^:?-{3,}:?$/.test(cell)))
}

const renderTable = (header: string[], rows: string[][]): string => {
  const head = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`
  const bodyRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('')

  return `<table>${head}<tbody>${bodyRows}</tbody></table>`
}
