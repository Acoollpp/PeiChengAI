import { readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path'

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import type { Root } from 'mdast'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type { Plugin } from 'unified'

import { prepareSvgForPublishing } from './report-svg-safety'

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

  const originalContent = await readFile(realImagePath)
  const content =
    contentType === 'image/svg+xml'
      ? prepareSvgForPublishing(originalContent).content
      : originalContent
  return {
    rawImagePath,
    dataUrl: `data:${contentType};base64,${content.toString('base64')}`
  }
}

type MarkdownImage = {
  alt: string
  rawImagePath: string
  targetStart: number
  targetEnd: number
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
      targetStart: altEnd + 2,
      targetEnd
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
    dataUrls.set(safelyDecodePath(image.rawImagePath), image.dataUrl)
    dataUrls.set(encodeURI(image.rawImagePath), image.dataUrl)
  }
  return dataUrls
}

type MarkdownTreeNode = {
  type?: string
  value?: unknown
  children?: MarkdownTreeNode[]
}

const isAllowedLink = (value: string): boolean => /^(?:https?:\/\/|mailto:)/i.test(value)

const remarkControlledLineBreaks: Plugin<[], Root> = () => (tree) => {
  const visit = (node: MarkdownTreeNode): void => {
    if (!node.children) {
      return
    }

    node.children = node.children.map((child) =>
      child.type === 'html' && typeof child.value === 'string' && /^<br\s*\/?\s*>$/i.test(child.value)
        ? { type: 'break' }
        : child
    )
    node.children.forEach(visit)
  }

  visit(tree as unknown as MarkdownTreeNode)
}

const remarkRemoveTrailingThematicBreak: Plugin<[], Root> = () => (tree) => {
  if (tree.children.at(-1)?.type === 'thematicBreak') {
    tree.children.pop()
  }
}

const isTableDivider = (line: string): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

const escapeTableCodePipes = (line: string): string => {
  let normalized = ''
  let index = 0

  while (index < line.length) {
    if (line[index] !== '`') {
      normalized += line[index]
      index += 1
      continue
    }

    const codeSpan = findCodeSpanEnd(line, index)
    if (!codeSpan) {
      normalized += line[index]
      index += 1
      continue
    }

    const code = line.slice(index, codeSpan.spanEnd).replace(/(?<!\\)\|/g, '\\|')
    normalized += code
    index = codeSpan.spanEnd
  }

  return normalized
}

const normalizeLegacyTableCodePipes = (markdown: string): string => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')

  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes('|') || !isTableDivider(lines[index + 1])) {
      continue
    }

    lines[index] = escapeTableCodePipes(lines[index])
    index += 2
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
      lines[index] = escapeTableCodePipes(lines[index])
      index += 1
    }
    index -= 1
  }

  return lines.join('\n')
}

const normalizeMarkdownImagePaths = (markdown: string): string => {
  const images = collectMarkdownImages(maskNonImageMarkdown(markdown))
  let normalized = ''
  let cursor = 0

  for (const image of images) {
    const encodedImagePath = encodeURI(image.rawImagePath)
    if (encodedImagePath === image.rawImagePath) {
      continue
    }

    normalized += markdown.slice(cursor, image.targetStart)
    normalized += encodedImagePath
    cursor = image.targetEnd
  }

  return normalized + markdown.slice(cursor)
}

const createPdfComponents = (imageDataUrls: Map<string, string>): Components => ({
  a: ({ children, href, node: _node, ...properties }) =>
    href && isAllowedLink(href)
      ? createElement('a', { ...properties, href }, children)
      : createElement('span', undefined, children),
  img: ({ alt, node: _node, src, ...properties }) => {
    const dataUrl =
      typeof src === 'string'
        ? imageDataUrls.get(src) ?? imageDataUrls.get(safelyDecodePath(src))
        : undefined
    if (!dataUrl) {
      throw new Error(`PDF生成失败：报告图片必须使用相对路径：${src ?? ''}`)
    }

    return createElement('img', { ...properties, alt, src: dataUrl })
  }
})

const renderMarkdownToHtml = (markdown: string, imageDataUrls: Map<string, string>): string =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        components: createPdfComponents(imageDataUrls),
        remarkPlugins: [
          remarkGfm,
          remarkBreaks,
          remarkControlledLineBreaks,
          remarkRemoveTrailingThematicBreak
        ],
        skipHtml: true,
        urlTransform: (url, key) => (key === 'href' && !isAllowedLink(url) ? '' : url)
      },
      normalizeMarkdownImagePaths(normalizeLegacyTableCodePipes(markdown))
    )
  )

const buildPrintHtml = (body: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    html, body { background: #ffffff; }
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
    strong { font-weight: 700; }
    em { font-style: italic; }
    del { color: #6b7280; text-decoration: line-through; }
    img { display: block; max-width: 100%; height: auto; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
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
