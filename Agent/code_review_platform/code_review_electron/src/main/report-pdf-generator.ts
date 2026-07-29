import { readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path'

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

export interface GeneratePdfReportResult {
  status: 'ready'
  reportPath: string
  pdfPath: string
}

type PdfWindowLike = {
  loadFile(path: string): Promise<void>
  webContents: {
    printToPDF(options?: Electron.PrintToPDFOptions): Promise<Buffer>
  }
  close(): void
}

export interface GeneratePdfReportDependencies {
  createWindow?: (options: BrowserWindowConstructorOptions) => PdfWindowLike
  removeFile?: typeof rm
  markdown?: string
}

const imageContentTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}${sep}`)

const isExternalUrl = (value: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(value)

const isLocalImagePath = (value: string): boolean =>
  Boolean(value) && !isExternalUrl(value) && !isAbsolute(value) && !value.startsWith('#')

const assertRelativeImagePath = (value: string): void => {
  if (!isLocalImagePath(value)) {
    throw new Error(`PDF生成失败：报告图片必须使用相对路径：${value}`)
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const toPdfPath = (reportPath: string): string => reportPath.replace(/\.md$/i, '.pdf')

const toTemporaryHtmlPath = (reportPath: string): string =>
  `${reportPath.replace(/\.md$/i, '')}.pdf-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.html`

const safelyDecodePath = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const readRequiredImage = async (
  reportDirectory: string,
  realReportDirectory: string,
  rawImagePath: string
): Promise<{ rawImagePath: string; dataUrl: string }> => {
  const decodedImagePath = safelyDecodePath(rawImagePath)
  const imagePath = resolve(reportDirectory, decodedImagePath)

  if (!isInsideDirectory(imagePath, reportDirectory)) {
    throw new Error(`PDF生成失败：报告图片路径不能指向报告目录外：${rawImagePath}`)
  }

  const contentType = imageContentTypes[extname(imagePath).toLowerCase()]
  if (!contentType) {
    throw new Error(`PDF生成失败：不支持的报告图片格式：${rawImagePath}`)
  }

  let realImagePath: string
  try {
    realImagePath = await realpath(imagePath)
  } catch {
    throw new Error(`PDF生成失败：报告图片不存在：${rawImagePath}`)
  }

  if (!isInsideDirectory(realImagePath, realReportDirectory)) {
    throw new Error(`PDF生成失败：报告图片路径不能指向报告目录外：${rawImagePath}`)
  }

  try {
    const imageStat = await stat(realImagePath)
    if (!imageStat.isFile()) {
      throw new Error('not-file')
    }
  } catch {
    throw new Error(`PDF生成失败：报告图片不存在：${rawImagePath}`)
  }

  const content = await readFile(realImagePath)
  return {
    rawImagePath,
    dataUrl: `data:${contentType};base64,${content.toString('base64')}`
  }
}

type MarkdownImage = {
  alt: string
  rawImagePath: string
  markup: string
}

const parseMarkdownImageTarget = (value: string): string => {
  const trimmed = value.trim()
  const titleMatch = /^(.+?)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/.exec(trimmed)
  return (titleMatch?.[1] ?? trimmed).trim()
}

const findCodeSpanEnd = (
  value: string,
  startIndex: number
): { delimiterEnd: number; closingIndex: number; spanEnd: number } | undefined => {
  if (value[startIndex] !== '`') {
    return undefined
  }

  let delimiterEnd = startIndex
  while (delimiterEnd < value.length && value[delimiterEnd] === '`') {
    delimiterEnd += 1
  }

  const delimiter = value.slice(startIndex, delimiterEnd)
  const closingIndex = value.indexOf(delimiter, delimiterEnd)
  if (closingIndex === -1) {
    return undefined
  }

  return {
    delimiterEnd,
    closingIndex,
    spanEnd: closingIndex + delimiter.length
  }
}

const maskInlineCode = (line: string): string => {
  let masked = ''
  let index = 0

  while (index < line.length) {
    if (line[index] !== '`') {
      masked += line[index]
      index += 1
      continue
    }

    const codeSpan = findCodeSpanEnd(line, index)
    if (!codeSpan) {
      masked += line[index]
      index += 1
      continue
    }

    masked += ' '.repeat(codeSpan.spanEnd - index)
    index = codeSpan.spanEnd
  }

  return masked
}

const getFenceMarker = (line: string): { char: '`' | '~'; length: number } | undefined => {
  const match = /^\s*(`{3,}|~{3,})/.exec(line)
  if (!match) {
    return undefined
  }

  return {
    char: match[1][0] as '`' | '~',
    length: match[1].length
  }
}

const isClosingFence = (line: string, marker: { char: '`' | '~'; length: number }): boolean => {
  const match = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
  return Boolean(match && match[1][0] === marker.char && match[1].length >= marker.length)
}

const maskNonImageMarkdown = (markdown: string): string => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const maskedLines: string[] = []
  let fenceMarker: { char: '`' | '~'; length: number } | undefined

  for (const line of lines) {
    if (fenceMarker) {
      const closesFence = isClosingFence(line, fenceMarker)
      maskedLines.push(' '.repeat(line.length))
      if (closesFence) {
        fenceMarker = undefined
      }
      continue
    }

    const openingFence = getFenceMarker(line)
    if (openingFence) {
      fenceMarker = openingFence
      maskedLines.push(' '.repeat(line.length))
      continue
    }

    maskedLines.push(maskInlineCode(line))
  }

  return maskedLines.join('\n')
}

const collectMarkdownImages = (markdown: string): MarkdownImage[] => {
  const images: MarkdownImage[] = []
  let index = 0

  while (index < markdown.length) {
    const markerIndex = markdown.indexOf('![', index)
    if (markerIndex === -1) {
      break
    }

    let precedingBackslashes = 0
    for (let cursor = markerIndex - 1; cursor >= 0 && markdown[cursor] === '\\'; cursor -= 1) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 === 1) {
      index = markerIndex + 2
      continue
    }

    const altEnd = markdown.indexOf('](', markerIndex + 2)
    if (altEnd === -1) {
      index = markerIndex + 2
      continue
    }

    let cursor = altEnd + 2
    let target = ''
    let isEscaped = false
    let inSingleQuote = false
    let inDoubleQuote = false
    let nestedParens = 0
    let targetEnd = -1

    while (cursor < markdown.length) {
      const char = markdown[cursor]

      if (isEscaped) {
        target += char
        isEscaped = false
        cursor += 1
        continue
      }

      if (char === '\\') {
        target += char
        isEscaped = true
        cursor += 1
        continue
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        target += char
        cursor += 1
        continue
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        target += char
        cursor += 1
        continue
      }

      if (!inSingleQuote && !inDoubleQuote) {
        if (char === '(') {
          nestedParens += 1
          target += char
          cursor += 1
          continue
        }

        if (char === ')') {
          if (nestedParens === 0) {
            targetEnd = cursor
            break
          }
          nestedParens -= 1
        }
      }

      target += char
      cursor += 1
    }

    if (targetEnd === -1) {
      index = markerIndex + 2
      continue
    }

    images.push({
      alt: markdown.slice(markerIndex + 2, altEnd),
      rawImagePath: parseMarkdownImageTarget(target),
      markup: markdown.slice(markerIndex, targetEnd + 1)
    })
    index = targetEnd + 1
  }

  return images
}

const collectImageDataUrls = async (
  markdown: string,
  reportDirectory: string
): Promise<Map<string, string>> => {
  const imagePaths = new Set<string>()
  for (const image of collectMarkdownImages(maskNonImageMarkdown(markdown))) {
    assertRelativeImagePath(image.rawImagePath)
    imagePaths.add(image.rawImagePath)
  }

  const realReportDirectory = await realpath(reportDirectory)
  const dataUrls = new Map<string, string>()
  for (const imagePath of imagePaths) {
    const image = await readRequiredImage(reportDirectory, realReportDirectory, imagePath)
    dataUrls.set(image.rawImagePath, image.dataUrl)
  }
  return dataUrls
}

const renderInline = (value: string, imageDataUrls: Map<string, string>): string => {
  const codeTokens: string[] = []
  let valueWithoutCode = ''
  let index = 0

  while (index < value.length) {
    if (value[index] !== '`') {
      valueWithoutCode += value[index]
      index += 1
      continue
    }

    const codeSpan = findCodeSpanEnd(value, index)
    if (!codeSpan) {
      valueWithoutCode += value[index]
      index += 1
      continue
    }

    const code = value.slice(codeSpan.delimiterEnd, codeSpan.closingIndex)
    codeTokens.push(`<code>${escapeHtml(code)}</code>`)
    valueWithoutCode += `\u0000CODE${codeTokens.length - 1}\u0000`
    index = codeSpan.spanEnd
  }

  let html = escapeHtml(valueWithoutCode)
  for (const image of collectMarkdownImages(maskInlineCode(value))) {
    const resolvedSrc = imageDataUrls.get(image.rawImagePath) ?? image.rawImagePath
    const imageHtml = `<img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(image.alt)}" />`
    html = html.replaceAll(escapeHtml(image.markup), imageHtml)
  }
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_match, text, href) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
  })

  return html
    .replace(/&lt;br\s*\/?&gt;/gi, '<br />')
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => codeTokens[Number(index)])
}

const isTableDivider = (line: string): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let isEscaped = false
  let index = 0

  while (index < trimmed.length) {
    const char = trimmed[index]

    if (isEscaped) {
      current += char
      isEscaped = false
      index += 1
      continue
    }

    if (char === '\\') {
      if (trimmed[index + 1] === '|') {
        isEscaped = true
      } else {
        current += char
      }
      index += 1
      continue
    }

    if (char === '`') {
      const codeSpan = findCodeSpanEnd(trimmed, index)
      if (codeSpan) {
        current += trimmed.slice(index, codeSpan.spanEnd)
        index = codeSpan.spanEnd
      } else {
        current += char
        index += 1
      }
      continue
    }

    if (char === '|') {
      cells.push(current.trim())
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  cells.push(current.trim())
  return cells
}

const renderMarkdownToHtml = (markdown: string, imageDataUrls: Map<string, string>): string => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const html: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = getFenceMarker(line)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !isClosingFence(lines[index], fence)) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2], imageDataUrls)}</h${level}>`)
      index += 1
      continue
    }

    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      html.push(
        `<table><thead><tr>${headers
          .map((cell) => `<th>${renderInline(cell, imageDataUrls)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${renderInline(cell, imageDataUrls)}</td>`)
                .join('')}</tr>`
          )
          .join('')}</tbody></table>`
      )
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      html.push(`<ul>${items.map((item) => `<li>${renderInline(item, imageDataUrls)}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item, imageDataUrls)}</li>`).join('')}</ol>`)
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      html.push(`<blockquote>${quote.map((item) => renderInline(item, imageDataUrls)).join('<br />')}</blockquote>`)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index])
      index += 1
    }
    html.push(`<p>${renderInline(paragraph.join(' '), imageDataUrls)}</p>`)
  }

  return html.join('\n')
}

const buildPrintHtml = (body: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    body { color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.7; margin: 32px; }
    h1, h2, h3, h4, h5, h6 { color: #111827; line-height: 1.35; margin: 24px 0 10px; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 14px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 7px 9px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    pre { background: #111827; color: #f9fafb; overflow-wrap: break-word; padding: 12px; white-space: pre-wrap; }
    code { font-family: "SFMono-Regular", Consolas, monospace; }
    p code, li code, td code { background: #f3f4f6; color: #111827; padding: 1px 4px; }
    blockquote { border-left: 4px solid #10b981; color: #4b5563; padding: 8px 0 8px 12px; }
    img { display: block; max-width: 100%; margin: 10px 0; }
    a { color: #0369a1; text-decoration: none; }
  </style>
</head>
<body>${body}</body>
</html>`

export const generatePdfReport = async (
  reportPath: string,
  dependencies: GeneratePdfReportDependencies = {}
): Promise<GeneratePdfReportResult> => {
  if (!reportPath) {
    throw new Error('PDF生成失败：请先选择一个本地 Markdown 报告')
  }
  if (extname(reportPath).toLowerCase() !== '.md') {
    throw new Error('PDF生成失败：请选择 Markdown 报告文件')
  }

  let markdown = dependencies.markdown
  if (markdown === undefined) {
    let reportStat
    try {
      reportStat = await stat(reportPath)
    } catch {
      throw new Error(`PDF生成失败：报告文件不存在：${reportPath}`)
    }
    if (!reportStat.isFile()) {
      throw new Error(`PDF生成失败：报告文件不存在：${reportPath}`)
    }
    markdown = await readFile(reportPath, 'utf8')
  }
  if (!markdown.trim()) {
    throw new Error('PDF生成失败：报告文件为空')
  }

  const reportDirectory = resolve(dirname(reportPath))
  const imageDataUrls = await collectImageDataUrls(markdown, reportDirectory)
  const html = buildPrintHtml(renderMarkdownToHtml(markdown, imageDataUrls))
  const pdfPath = toPdfPath(reportPath)
  const htmlPath = toTemporaryHtmlPath(reportPath)
  const createWindow = dependencies.createWindow ?? ((options) => new BrowserWindow(options))
  const removeFile = dependencies.removeFile ?? rm
  const window = createWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  try {
    await writeFile(htmlPath, html)
    await window.loadFile(htmlPath)
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    await writeFile(pdfPath, pdf)
  } finally {
    try {
      window.close()
    } finally {
      try {
        await removeFile(htmlPath, { force: true })
      } catch {
        // Best-effort cleanup must not hide load/print/write errors.
      }
    }
  }

  return {
    status: 'ready',
    reportPath,
    pdfPath
  }
}
