import { createHash } from 'node:crypto'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { nativeImage } from 'electron'
import log from 'electron-log/main'
import remarkParse from 'remark-parse'
import { SaxesParser } from 'saxes'
import { unified } from 'unified'

import type { ApiClient } from './api-client'
import { inspectReviewIssues } from '../shared/review-issues'
import { stripReviewReportOutputMetadata } from '../shared/review-report-metadata'

export interface ReportUploadApi {
  uploadReport: ApiClient['uploadReport']
}

export interface PdfReportUploadApi {
  uploadPdfReport: ApiClient['uploadPdfReport']
}

export interface RequirementFileUploadApi {
  uploadRequirementFile: ApiClient['uploadRequirementFile']
}

const imageContentTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const MAX_REPORT_MARKDOWN_BYTES = 5 * 1024 * 1024
const MAX_REPORT_IMAGE_COUNT = 50
const MAX_REPORT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_REPORT_ASSETS_TOTAL_BYTES = 50 * 1024 * 1024
const MAX_REPORT_ISSUE_COUNT = 200
const MAX_REPORT_ISSUES_JSON_BYTES = 1024 * 1024
const MAX_REPORT_ISSUE_TEXT_LENGTH = 8 * 1024
const MAX_REPORT_ISSUE_DESCRIPTION_LENGTH = 64 * 1024
const MAX_REPORT_ISSUE_DISPLAY_SNAPSHOT_LENGTH = 256 * 1024
const MAX_REPORT_IMAGE_PIXELS = 40_000_000
const BLOCKED_SVG_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
  'style',
  'video'
])
const UNSAFE_SVG_VALUE_PATTERN = /(?:url\s*\(|@import|expression\s*\()/i

type MarkdownAstNode = {
  type: string
  url?: unknown
  identifier?: unknown
  children?: MarkdownAstNode[]
}

type SvgValidationFailureCode =
  | 'INVALID_UTF8'
  | 'FORBIDDEN_XML_DECLARATION'
  | 'INVALID_XML'
  | 'ROOT_NOT_SVG'
  | 'UNSAFE_SVG_CONTENT'

type SvgValidationResult =
  | { valid: true }
  | { valid: false; reasonCode: SvgValidationFailureCode }

const walkMarkdownAst = (
  node: MarkdownAstNode,
  visit: (node: MarkdownAstNode) => void
): void => {
  visit(node)
  for (const child of node.children ?? []) {
    walkMarkdownAst(child, visit)
  }
}

export const extractRelativeImagePaths = (markdown: string): string[] => {
  const tree = unified().use(remarkParse).parse(markdown) as MarkdownAstNode
  const definitions = new Map<string, string>()
  walkMarkdownAst(tree, (node) => {
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      typeof node.url === 'string' &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url)
    }
  })

  const paths: string[] = []
  walkMarkdownAst(tree, (node) => {
    const rawPath =
      node.type === 'image' && typeof node.url === 'string'
        ? node.url
        : node.type === 'imageReference' && typeof node.identifier === 'string'
          ? definitions.get(node.identifier)
          : undefined
    if (rawPath && !paths.includes(rawPath)) {
      paths.push(rawPath)
    }
  })
  return paths
}

const validateSafeSvg = (content: Buffer): SvgValidationResult => {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return { valid: false, reasonCode: 'INVALID_UTF8' }
  }
  const normalized = source.replace(/^\uFEFF/, '').trimStart()
  if (/<!DOCTYPE|<!ENTITY/i.test(normalized)) {
    return { valid: false, reasonCode: 'FORBIDDEN_XML_DECLARATION' }
  }

  let failureCode: SvgValidationFailureCode | undefined
  const reject = (reasonCode: SvgValidationFailureCode): void => {
    failureCode ??= reasonCode
  }
  let sawRoot = false
  const parser = new SaxesParser({ xmlns: true, position: false })
  parser.on('processinginstruction', () => {
    reject('UNSAFE_SVG_CONTENT')
  })
  parser.on('doctype', () => {
    reject('FORBIDDEN_XML_DECLARATION')
  })
  parser.on('opentag', (tag) => {
    if (!sawRoot) {
      sawRoot = true
      if (tag.local.toLowerCase() !== 'svg') {
        reject('ROOT_NOT_SVG')
      }
    }
    if (BLOCKED_SVG_ELEMENTS.has(tag.local.toLowerCase())) {
      reject('UNSAFE_SVG_CONTENT')
    }
    for (const attribute of Object.values(tag.attributes)) {
      const attributeName = attribute.local.toLowerCase()
      const value = attribute.value.trim()
      if (
        attributeName.startsWith('on') ||
        attributeName === 'base' ||
        attributeName === 'style' ||
        ((attributeName === 'href' || attributeName === 'src') && value && !value.startsWith('#')) ||
        UNSAFE_SVG_VALUE_PATTERN.test(value) ||
        value.includes('\\') ||
        value.includes('/*') ||
        value.includes('*/')
      ) {
        reject('UNSAFE_SVG_CONTENT')
      }
    }
  })

  try {
    parser.write(normalized).close()
  } catch {
    return { valid: false, reasonCode: 'INVALID_XML' }
  }
  if (failureCode) {
    return { valid: false, reasonCode: failureCode }
  }
  return sawRoot ? { valid: true } : { valid: false, reasonCode: 'ROOT_NOT_SVG' }
}

const isSafeSvg = (content: Buffer): boolean => validateSafeSvg(content).valid

const isPngStructurallyValid = (content: Buffer): boolean => {
  let offset = 8
  let sawImageHeader = false
  let sawImageEnd = false
  while (offset < content.length) {
    if (offset + 12 > content.length) {
      return false
    }
    const chunkSize = content.readUInt32BE(offset)
    const chunkType = content.subarray(offset + 4, offset + 8).toString('ascii')
    const nextOffset = offset + 12 + chunkSize
    if (nextOffset > content.length) {
      return false
    }
    if (chunkType === 'IHDR') {
      if (sawImageHeader || chunkSize !== 13) {
        return false
      }
      sawImageHeader = true
    } else if (chunkType === 'acTL') {
      if (chunkSize !== 8 || content.readUInt32BE(offset + 8) > 1) {
        return false
      }
    } else if (chunkType === 'IEND') {
      sawImageEnd = true
      return sawImageHeader && chunkSize === 0 && nextOffset === content.length
    }
    offset = nextOffset
  }
  return sawImageHeader && sawImageEnd
}

const readGifSubBlocks = (content: Buffer, startOffset: number): number => {
  let offset = startOffset
  while (offset < content.length) {
    const blockSize = content[offset]
    offset += 1
    if (blockSize === 0) {
      return offset
    }
    if (offset + blockSize > content.length) {
      return -1
    }
    offset += blockSize
  }
  return -1
}

const isGifStructurallyValid = (content: Buffer): boolean => {
  if (content.length < 14) {
    return false
  }
  const packedFields = content[10]
  let offset = 13
  if ((packedFields & 0x80) !== 0) {
    offset += 3 * 2 ** ((packedFields & 0x07) + 1)
  }
  if (offset >= content.length) {
    return false
  }

  let sawImage = false
  while (offset < content.length) {
    const introducer = content[offset]
    if (introducer === 0x3b) {
      return sawImage && offset === content.length - 1
    }
    if (introducer === 0x2c) {
      if (sawImage) {
        return false
      }
      if (offset + 10 > content.length) {
        return false
      }
      const imagePackedFields = content[offset + 9]
      offset += 10
      if ((imagePackedFields & 0x80) !== 0) {
        offset += 3 * 2 ** ((imagePackedFields & 0x07) + 1)
      }
      if (offset >= content.length || content[offset] < 2 || content[offset] > 8) {
        return false
      }
      offset = readGifSubBlocks(content, offset + 1)
      if (offset < 0) {
        return false
      }
      sawImage = true
      continue
    }
    if (introducer !== 0x21 || offset + 2 >= content.length) {
      return false
    }
    const extensionLabel = content[offset + 1]
    offset += 2
    if (extensionLabel === 0xf9) {
      if (
        offset + 6 > content.length ||
        content[offset] !== 4 ||
        content[offset + 5] !== 0
      ) {
        return false
      }
      offset += 6
      continue
    }
    if (extensionLabel === 0x01 || extensionLabel === 0xff) {
      const expectedHeaderSize = extensionLabel === 0x01 ? 12 : 11
      if (offset >= content.length || content[offset] !== expectedHeaderSize) {
        return false
      }
      offset += expectedHeaderSize + 1
    } else if (extensionLabel !== 0xfe) {
      return false
    }
    offset = readGifSubBlocks(content, offset)
    if (offset < 0) {
      return false
    }
  }
  return false
}

const isWebpStructurallyValid = (content: Buffer): boolean => {
  let offset = 12
  let sawImageData = false
  while (offset < content.length) {
    if (offset + 8 > content.length) {
      return false
    }
    const chunkType = content.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = content.readUInt32LE(offset + 4)
    const dataOffset = offset + 8
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2)
    if (nextOffset > content.length) {
      return false
    }
    if (chunkType === 'VP8 ') {
      if (sawImageData) {
        return false
      }
      if (
        chunkSize < 10 ||
        !content.subarray(dataOffset + 3, dataOffset + 6).equals(Buffer.from('9d012a', 'hex'))
      ) {
        return false
      }
      const width = content.readUInt16LE(dataOffset + 6) & 0x3fff
      const height = content.readUInt16LE(dataOffset + 8) & 0x3fff
      if (width === 0 || height === 0 || width * height > MAX_REPORT_IMAGE_PIXELS) {
        return false
      }
      sawImageData = true
    } else if (chunkType === 'VP8L') {
      if (sawImageData) {
        return false
      }
      if (chunkSize < 5 || content[dataOffset] !== 0x2f) {
        return false
      }
      const bits = content.readUInt32LE(dataOffset + 1)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >>> 14) & 0x3fff) + 1
      if (width * height > MAX_REPORT_IMAGE_PIXELS) {
        return false
      }
      sawImageData = true
    } else if (chunkType === 'VP8X') {
      if (chunkSize !== 10 || (content[dataOffset] & 0x02) !== 0) {
        return false
      }
    } else if (chunkType === 'ANIM' || chunkType === 'ANMF') {
      return false
    }
    offset = nextOffset
  }
  return sawImageData && offset === content.length
}

const hasExpectedImageSignature = (extension: string, content: Buffer): boolean => {
  switch (extension) {
    case '.png':
      return content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    case '.jpg':
    case '.jpeg':
      return (
        content.length >= 5 &&
        content[0] === 0xff &&
        content[1] === 0xd8 &&
        content[2] === 0xff &&
        content.at(-2) === 0xff &&
        content.at(-1) === 0xd9
      )
    case '.gif': {
      const signature = content.subarray(0, 6).toString('ascii')
      return signature === 'GIF87a' || signature === 'GIF89a'
    }
    case '.webp':
      return (
        content.length >= 12 &&
        content.subarray(0, 4).toString('ascii') === 'RIFF' &&
        content.readUInt32LE(4) + 8 === content.length &&
        content.subarray(8, 12).toString('ascii') === 'WEBP'
      )
    case '.svg':
      return isSafeSvg(content)
    default:
      return false
  }
}

const isImageContentValid = (extension: string, content: Buffer): boolean => {
  if (!hasExpectedImageSignature(extension, content)) {
    return false
  }
  if (
    (extension === '.png' && !isPngStructurallyValid(content)) ||
    (extension === '.gif' && !isGifStructurallyValid(content)) ||
    (extension === '.webp' && !isWebpStructurallyValid(content))
  ) {
    return false
  }
  // Electron nativeImage 只可靠解码 PNG/JPEG；其他格式由客户端做安全预检，
  // 再由服务端 Pillow/XML 校验器作为最终权威。
  if (extension === '.gif' || extension === '.webp' || extension === '.svg') {
    return true
  }
  try {
    const contentType = imageContentTypes[extension]
    const image = nativeImage.createFromDataURL(
      `data:${contentType};base64,${content.toString('base64')}`
    )
    const { width, height } = image.getSize()
    return (
      !image.isEmpty() &&
      width > 0 &&
      height > 0 &&
      width * height <= MAX_REPORT_IMAGE_PIXELS
    )
  } catch {
    return false
  }
}

const codePointLength = (value: string): number => Array.from(value).length

const validateIssueSnapshots = (
  issues: NonNullable<Parameters<ApiClient['uploadReport']>[2]['issues']>,
  reportContent: string
): void => {
  if (issues.length > MAX_REPORT_ISSUE_COUNT) {
    throw new Error('问题快照数量超过限制')
  }
  if (Buffer.byteLength(JSON.stringify(issues), 'utf8') > MAX_REPORT_ISSUES_JSON_BYTES) {
    throw new Error('问题快照总大小超过限制')
  }
  const reportLineCount = reportContent.split('\n').length
  for (const issue of issues) {
    if (
      codePointLength(issue.issue_text) > MAX_REPORT_ISSUE_TEXT_LENGTH ||
      codePointLength(issue.description_text) > MAX_REPORT_ISSUE_DESCRIPTION_LENGTH ||
      codePointLength(issue.display_snapshot) > MAX_REPORT_ISSUE_DISPLAY_SNAPSHOT_LENGTH ||
      codePointLength(issue.source) > 64
    ) {
      throw new Error('问题快照内容超过限制')
    }
    const location = issue.location
    if (
      location.start_offset > location.feedback_insertion_offset ||
      location.feedback_insertion_offset > location.end_offset ||
      location.end_offset > reportContent.length ||
      location.anchor_line >= reportLineCount
    ) {
      throw new Error('问题快照定位范围无效')
    }
  }
}

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}${sep}`)

const readReportAssets = async (
  reportPath: string,
  reportContent: string
): Promise<NonNullable<Parameters<ApiClient['uploadReport']>[2]['assets']>> => {
  const reportDirectory = resolve(dirname(reportPath))
  const imagesDirectory = resolve(reportDirectory, 'images')
  const imagePaths = extractRelativeImagePaths(reportContent)
  const validatedImagePathsByRelativePath = new Map<
    string,
    {
      rawImagePath: string
      imagePath: string
      relativePath: string
      contentType: string
      extension: string
    }
  >()
  for (const rawImagePath of imagePaths) {
    let decodedImagePath: string
    try {
      decodedImagePath = decodeURIComponent(rawImagePath)
    } catch {
      throw new Error(`报告图片路径编码无效：${rawImagePath}`)
    }
    if (isAbsolute(decodedImagePath)) {
      throw new Error(`报告图片必须使用相对路径：${rawImagePath}`)
    }

    const imagePath = resolve(reportDirectory, decodedImagePath)
    if (!isInsideDirectory(imagePath, imagesDirectory)) {
      throw new Error(`报告图片必须位于 images 目录：${rawImagePath}`)
    }
    const extension = extname(imagePath).toLowerCase()
    const contentType = imageContentTypes[extension]
    if (!contentType) {
      throw new Error(`不支持的报告图片格式：${rawImagePath}`)
    }
    const relativePath = relative(reportDirectory, imagePath).split(sep).join('/')
    if (!validatedImagePathsByRelativePath.has(relativePath)) {
      validatedImagePathsByRelativePath.set(relativePath, {
        rawImagePath,
        imagePath,
        relativePath,
        contentType,
        extension
      })
    }
  }
  const validatedImagePaths = [...validatedImagePathsByRelativePath.values()]
  if (validatedImagePaths.length > MAX_REPORT_IMAGE_COUNT) {
    throw new Error('报告图片数量超过限制')
  }
  let realReportDirectory: string | null = null
  let realImagesDirectory: string | null = null
  if (validatedImagePaths.length > 0) {
    try {
      realReportDirectory = await realpath(reportDirectory)
      realImagesDirectory = await realpath(imagesDirectory)
    } catch {
      throw new Error('报告图片目录不存在')
    }
    if (!isInsideDirectory(realImagesDirectory, realReportDirectory)) {
      throw new Error('报告图片目录不能指向报告目录外')
    }
  }

  const assets: NonNullable<Parameters<ApiClient['uploadReport']>[2]['assets']> = []
  let totalAssetBytes = 0
  for (const {
    rawImagePath,
    imagePath,
    relativePath,
    contentType,
    extension
  } of validatedImagePaths) {
    let realImagePath: string
    try {
      realImagePath = await realpath(imagePath)
    } catch {
      throw new Error(`报告图片不存在：${rawImagePath}`)
    }
    if (!realImagesDirectory || !isInsideDirectory(realImagePath, realImagesDirectory)) {
      throw new Error(`报告图片不能指向 images 目录外：${rawImagePath}`)
    }

    let imageStat
    try {
      imageStat = await stat(realImagePath)
    } catch {
      throw new Error(`报告图片不存在：${rawImagePath}`)
    }
    if (!imageStat.isFile()) {
      throw new Error(`报告图片不存在：${rawImagePath}`)
    }
    if (imageStat.size > MAX_REPORT_IMAGE_BYTES) {
      throw new Error(`单个报告图片超过大小限制：${rawImagePath}`)
    }
    totalAssetBytes += imageStat.size
    if (totalAssetBytes > MAX_REPORT_ASSETS_TOTAL_BYTES) {
      throw new Error('报告图片总大小超过限制')
    }

    const content = await readFile(realImagePath)
    if (content.length === 0) {
      throw new Error(`报告图片为空：${rawImagePath}`)
    }
    if (!isImageContentValid(extension, content)) {
      const svgValidation = extension === '.svg' ? validateSafeSvg(content) : undefined
      log.warn('[REPORT_IMAGE_VALIDATION_FAILED]', {
        relativePath,
        extension,
        reasonCode: svgValidation && !svgValidation.valid
          ? svgValidation.reasonCode
          : 'INVALID_IMAGE_CONTENT',
        sha256: createHash('sha256').update(content).digest('hex')
      })
      throw new Error(`报告图片内容与文件格式不一致：${rawImagePath}`)
    }

    assets.push({
      relative_path: relativePath,
      content,
      content_type: contentType
    })
  }
  return assets
}

export const ensureReportReady = async (reportPath: string): Promise<void> => {
  let reportStat

  try {
    reportStat = await stat(reportPath)
  } catch {
    throw new Error(`审查报告不存在：${reportPath}`)
  }

  if (!reportStat.isFile() || reportStat.size <= 0) {
    throw new Error(`审查报告为空：${reportPath}`)
  }
  if (reportStat.size > MAX_REPORT_MARKDOWN_BYTES) {
    throw new Error(`审查报告超过大小限制：${reportPath}`)
  }
}

export const uploadReportFile = async (
  api: ReportUploadApi,
  token: string,
  taskId: string,
  reportPath: string,
  preparedReportContent?: string
): Promise<unknown> => {
  const reportContent =
    preparedReportContent ?? (await prepareReportForPublishing(reportPath))
  if (Buffer.byteLength(reportContent, 'utf8') > MAX_REPORT_MARKDOWN_BYTES) {
    throw new Error(`审查报告超过大小限制：${reportPath}`)
  }
  const extraction = inspectReviewIssues(reportContent)
  const reportPayload = {
    report_content: reportContent,
    report_path: reportPath,
    report_name: basename(reportPath)
  }
  if (extraction.status === 'invalid') {
    return api.uploadReport(token, taskId, reportPayload)
  }

  const issues = extraction.issues.map((issue) => ({
    issue_text: issue.issueText,
    description_text: issue.descriptionText,
    display_snapshot: issue.displaySnapshot,
    order: issue.order,
    source: issue.source,
    location: {
      start_offset: issue.location.startOffset,
      end_offset: issue.location.endOffset,
      feedback_insertion_offset: issue.location.feedbackInsertionOffset,
      anchor_line: issue.location.anchorLine,
      heading_level: issue.location.headingLevel
    }
  }))
  validateIssueSnapshots(issues, reportContent)
  const assets = await readReportAssets(reportPath, reportContent)

  return api.uploadReport(token, taskId, {
    ...reportPayload,
    feedback_protocol_version: 1,
    issues,
    assets
  })
}

export const prepareReportForPublishing = async (reportPath: string): Promise<string> => {
  await ensureReportReady(reportPath)

  const originalReport = await readFile(reportPath, 'utf8')
  const reportWithoutBom = originalReport.startsWith('\uFEFF')
    ? originalReport.slice(1)
    : originalReport
  const cleanedReport = stripReviewReportOutputMetadata(reportWithoutBom)
  if (!cleanedReport.trim()) {
    throw new Error(`审查报告为空：${reportPath}`)
  }
  if (cleanedReport !== originalReport) {
    await writeFile(reportPath, cleanedReport, 'utf8')
  }

  return cleanedReport
}

export const ensurePdfReportReady = async (pdfPath: string): Promise<void> => {
  let reportStat

  try {
    reportStat = await stat(pdfPath)
  } catch {
    throw new Error(`PDF报告不存在：${pdfPath}`)
  }

  if (!reportStat.isFile() || reportStat.size <= 0) {
    throw new Error(`PDF报告为空：${pdfPath}`)
  }
}

export const uploadPdfReportFile = async (
  api: PdfReportUploadApi,
  token: string,
  taskId: string,
  pdfPath: string
): Promise<Awaited<ReturnType<ApiClient['uploadPdfReport']>>> => {
  await ensurePdfReportReady(pdfPath)

  const pdfContent = await readFile(pdfPath)

  return api.uploadPdfReport(token, taskId, {
    pdf_content: pdfContent,
    pdf_name: basename(pdfPath)
  })
}

export const ensureRequirementFileReady = async (filePath: string): Promise<void> => {
  let requirementStat

  try {
    requirementStat = await stat(filePath)
  } catch {
    throw new Error(`产品开发需求表不存在：${filePath}`)
  }

  if (!requirementStat.isFile() || requirementStat.size <= 0) {
    throw new Error(`产品开发需求表为空：${filePath}`)
  }
}

export const uploadRequirementFile = async (
  api: RequirementFileUploadApi,
  token: string,
  taskId: string,
  filePath: string
): Promise<unknown> => {
  await ensureRequirementFileReady(filePath)

  const fileContent = await readFile(filePath)

  return api.uploadRequirementFile(token, taskId, {
    file_content: fileContent,
    file_name: basename(filePath)
  })
}
