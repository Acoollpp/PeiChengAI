import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { nativeImage } from 'electron'
import log from 'electron-log/main'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import type { ApiClient } from './api-client'
import { inspectReviewIssues } from '../shared/review-issues'
import { stripReviewReportOutputMetadata } from '../shared/review-report-metadata'
import { REPORT_IMAGE_INVALID_UTF8 } from '../shared/report-upload-recovery'
import { prepareSvgForPublishing, validateSafeSvg } from './report-svg-safety'

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
const ENCRYPTED_IMAGE_SVG_PLACEHOLDER = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="72" viewBox="0 0 720 72"><rect width="720" height="72" fill="#f3f4f6"/><text x="24" y="44" fill="#4b5563" font-size="20">代码图片因终端加密无法读取，已省略</text></svg>'
)

type ReportImageCandidate = {
  rawImageReferences: MarkdownImageReference[]
  imagePath: string
  originalImagePath: string
  relativePath: string
  contentType: string
  extension: string
  encryptedCandidate: boolean
}

type PreparedReportAssets = {
  reportContent: string
  assets: NonNullable<Parameters<ApiClient['uploadReport']>[2]['assets']>
}

export class ReportUploadRecoveryError extends Error {
  readonly code = REPORT_IMAGE_INVALID_UTF8

  constructor(readonly assetPaths: string[]) {
    super('报告图片不是有效的 UTF-8 SVG')
    this.name = 'ReportUploadRecoveryError'
  }
}

type MarkdownAstNode = {
  type: string
  url?: unknown
  identifier?: unknown
  children?: MarkdownAstNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

type MarkdownImageReference = {
  parsedUrl: string
  sourceUrl: string
  startOffset: number | null
  endOffset: number | null
  directIpgsd: boolean
}

const walkMarkdownAst = (
  node: MarkdownAstNode,
  visit: (node: MarkdownAstNode) => void
): void => {
  visit(node)
  for (const child of node.children ?? []) {
    walkMarkdownAst(child, visit)
  }
}

const findImageUrlReference = (
  markdown: string,
  node: MarkdownAstNode,
  parsedUrl: string
): MarkdownImageReference => {
  const startOffset = node.position?.start?.offset
  const endOffset = node.position?.end?.offset
  if (typeof startOffset !== 'number' || typeof endOffset !== 'number') {
    return { parsedUrl, sourceUrl: parsedUrl, startOffset: null, endOffset: null, directIpgsd: false }
  }
  const source = markdown.slice(startOffset, endOffset)
  const markerEnd = node.type === 'definition' ? source.indexOf(']:') + 2 : source.indexOf('](') + 2
  if (markerEnd < 2) {
    return { parsedUrl, sourceUrl: parsedUrl, startOffset: null, endOffset: null, directIpgsd: false }
  }
  let relativeStartOffset = markerEnd
  while (/\s/.test(source[relativeStartOffset] ?? '')) {
    relativeStartOffset += 1
  }
  const isAngleDestination = source[relativeStartOffset] === '<'
  if (isAngleDestination) {
    relativeStartOffset += 1
  }
  let relativeEndOffset = relativeStartOffset
  let nestedParentheses = 0
  let escaped = false
  while (relativeEndOffset < source.length) {
    const character = source[relativeEndOffset]
    if (escaped) {
      escaped = false
      relativeEndOffset += 1
      continue
    }
    if (character === '\\') {
      escaped = true
      relativeEndOffset += 1
      continue
    }
    if (
      (isAngleDestination && character === '>') ||
      (!isAngleDestination &&
        (/\s/.test(character) ||
          (node.type !== 'definition' && character === ')' && nestedParentheses === 0)))
    ) {
      break
    }
    if (!isAngleDestination && node.type !== 'definition') {
      if (character === '(') {
        nestedParentheses += 1
      } else if (character === ')' && nestedParentheses > 0) {
        nestedParentheses -= 1
      }
    }
    relativeEndOffset += 1
  }
  if (relativeEndOffset <= relativeStartOffset) {
    return { parsedUrl, sourceUrl: parsedUrl, startOffset: null, endOffset: null, directIpgsd: false }
  }
  return {
    parsedUrl,
    sourceUrl: source.slice(relativeStartOffset, relativeEndOffset),
    startOffset: startOffset + relativeStartOffset,
    endOffset: startOffset + relativeEndOffset,
    directIpgsd: false
  }
}

const extractMarkdownImageReferences = (markdown: string): MarkdownImageReference[] => {
  const tree = unified().use(remarkParse).parse(markdown) as MarkdownAstNode
  const definitions = new Map<string, MarkdownAstNode>()
  walkMarkdownAst(tree, (node) => {
    if (
      node.type === 'definition' &&
      typeof node.identifier === 'string' &&
      typeof node.url === 'string' &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node)
    }
  })

  const references: MarkdownImageReference[] = []
  const seenRanges = new Set<string>()
  walkMarkdownAst(tree, (node) => {
    const sourceNode =
      node.type === 'image' && typeof node.url === 'string'
        ? node
        : node.type === 'imageReference' && typeof node.identifier === 'string'
          ? definitions.get(node.identifier)
          : undefined
    const parsedUrl = sourceNode && typeof sourceNode.url === 'string' ? sourceNode.url : undefined
    if (parsedUrl && sourceNode) {
      const reference = findImageUrlReference(markdown, sourceNode, parsedUrl)
      const rangeKey = `${reference.startOffset}:${reference.endOffset}`
      if (!seenRanges.has(rangeKey)) {
        seenRanges.add(rangeKey)
        references.push(reference)
      }
    }
  })
  return references
}

export const extractRelativeImagePaths = (markdown: string): string[] =>
  [...new Set(extractMarkdownImageReferences(markdown).map(({ parsedUrl }) => parsedUrl))]

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
      return validateSafeSvg(content).valid
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

const hasExactDirectoryEntry = async (directory: string, fileName: string): Promise<boolean> => {
  try {
    return (await readdir(directory)).includes(fileName)
  } catch {
    return false
  }
}

const findEncryptedImageCandidate = async (imagePath: string): Promise<string | null> => {
  const imageDirectory = dirname(imagePath)
  const originalFileName = basename(imagePath)
  let entries: string[]
  try {
    entries = await readdir(imageDirectory)
  } catch {
    return null
  }
  const candidates = entries.filter((entry) => {
    const candidateExtension = extname(entry)
    return (
      candidateExtension.toLowerCase() === '.ipgsd' &&
      entry.slice(0, -candidateExtension.length) === originalFileName
    )
  })
  if (candidates.length !== 1) {
    return null
  }
  return resolve(imageDirectory, candidates[0])
}

const toSvgPlaceholderRelativePath = (imagePath: string, reportDirectory: string): string =>
  relative(reportDirectory, `${imagePath}.ipgsd-placeholder.svg`).split(sep).join('/')

const readReportAssets = async (
  reportPath: string,
  reportContent: string
): Promise<PreparedReportAssets> => {
  const reportDirectory = resolve(dirname(reportPath))
  const imagesDirectory = resolve(reportDirectory, 'images')
  const imageReferences = extractMarkdownImageReferences(reportContent)
  const validatedImagePathsByRelativePath = new Map<string, ReportImageCandidate>()
  for (const imageReference of imageReferences) {
    const rawImagePath = imageReference.parsedUrl
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
    const referenceExtension = extname(imagePath)
    const encryptedCandidate = referenceExtension.toLowerCase() === '.ipgsd'
    const originalImagePath = encryptedCandidate
      ? imagePath.slice(0, -referenceExtension.length)
      : imagePath
    const extension = extname(originalImagePath).toLowerCase()
    const contentType = imageContentTypes[extension]
    if (!contentType) {
      throw new Error(`不支持的报告图片格式：${rawImagePath}`)
    }
    let sourceImagePath = imagePath
    if (!encryptedCandidate && !(await hasExactDirectoryEntry(dirname(imagePath), basename(imagePath)))) {
      const candidate = await findEncryptedImageCandidate(imagePath)
      if (!candidate) {
        throw new Error(`报告图片不存在：${rawImagePath}`)
      }
      sourceImagePath = candidate
    } else if (encryptedCandidate && !(await hasExactDirectoryEntry(dirname(imagePath), basename(imagePath)))) {
      throw new Error(`报告图片不存在：${rawImagePath}`)
    }
    const relativePath = relative(reportDirectory, originalImagePath).split(sep).join('/')
    const resolvedImageReference = { ...imageReference, directIpgsd: encryptedCandidate }
    const existingCandidate = validatedImagePathsByRelativePath.get(relativePath)
    if (!existingCandidate) {
      validatedImagePathsByRelativePath.set(relativePath, {
        rawImageReferences: [resolvedImageReference],
        imagePath: sourceImagePath,
        originalImagePath,
        relativePath,
        contentType,
        extension,
        encryptedCandidate: encryptedCandidate || sourceImagePath !== imagePath
      })
    } else if (
      existingCandidate.imagePath !== sourceImagePath ||
      existingCandidate.originalImagePath !== originalImagePath
    ) {
      throw new Error(`报告图片规范化路径冲突：${rawImagePath}`)
    } else {
      existingCandidate.rawImageReferences.push(resolvedImageReference)
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
  const uploadReplacements = new Map<number, { endOffset: number; replacement: string }>()
  const originalPathsByUploadRelativePath = new Map<string, string>()
  const invalidUtf8SvgPaths: string[] = []
  let totalAssetBytes = 0
  for (const {
    rawImageReferences,
    imagePath,
    originalImagePath,
    relativePath,
    contentType,
    extension,
    encryptedCandidate
  } of validatedImagePaths) {
    const rawImagePath = rawImageReferences[0].parsedUrl
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
    const preparedSvg = extension === '.svg' ? prepareSvgForPublishing(content) : undefined
    if (preparedSvg?.outcome === 'PLACEHOLDER' && preparedSvg.reasonCode === 'INVALID_UTF8') {
      log.warn('[REPORT_IMAGE_VALIDATION_FAILED]', {
        relativePath,
        extension,
        reasonCode: preparedSvg.reasonCode,
        sha256: createHash('sha256').update(content).digest('hex'),
        result: 'WAITING_FOR_DECRYPTION'
      })
      invalidUtf8SvgPaths.push(relativePath)
      continue
    }
    const isContentValid = preparedSvg
      ? preparedSvg.outcome !== 'PLACEHOLDER'
      : isImageContentValid(extension, content)
    const validationReasonCode = preparedSvg?.outcome === 'PLACEHOLDER'
      ? preparedSvg.reasonCode
      : 'INVALID_IMAGE_CONTENT'
    if (!isContentValid && extension !== '.svg' && !encryptedCandidate) {
      log.warn('[REPORT_IMAGE_VALIDATION_FAILED]', {
        relativePath,
        extension,
        reasonCode: validationReasonCode,
        sha256: createHash('sha256').update(content).digest('hex')
      })
      throw new Error(`报告图片内容与文件格式不一致：${rawImagePath}`)
    }

    const useSvgPlaceholder = preparedSvg?.outcome === 'PLACEHOLDER' || !isContentValid
    if (preparedSvg?.outcome === 'NORMALIZED') {
      log.info('[REPORT_IMAGE_SVG_NORMALIZED]', {
        relativePath,
        extension,
        result: 'NORMALIZED',
        originalSha256: createHash('sha256').update(content).digest('hex'),
        normalizedSha256: createHash('sha256').update(preparedSvg.content).digest('hex')
      })
    }
    if (preparedSvg?.outcome === 'PLACEHOLDER') {
      log.warn('[REPORT_IMAGE_VALIDATION_FAILED]', {
        relativePath,
        extension,
        reasonCode: validationReasonCode,
        sha256: createHash('sha256').update(content).digest('hex'),
        result: 'PLACEHOLDER'
      })
    }
    const shouldKeepOriginalSvgPath = useSvgPlaceholder && extension === '.svg' && !encryptedCandidate
    const uploadRelativePath = useSvgPlaceholder
      ? shouldKeepOriginalSvgPath
        ? relativePath
        : toSvgPlaceholderRelativePath(originalImagePath, reportDirectory)
      : relativePath
    if (
      useSvgPlaceholder &&
      !shouldKeepOriginalSvgPath &&
      (await hasExactDirectoryEntry(
        dirname(originalImagePath),
        basename(`${originalImagePath}.ipgsd-placeholder.svg`)
      ))
    ) {
      throw new Error(`报告图片占位路径冲突：${rawImagePath}`)
    }
    const priorOriginalPath = originalPathsByUploadRelativePath.get(uploadRelativePath)
    if (priorOriginalPath && priorOriginalPath !== originalImagePath) {
      throw new Error(`报告图片上传路径冲突：${rawImagePath}`)
    }
    originalPathsByUploadRelativePath.set(uploadRelativePath, originalImagePath)
    for (const imageReference of rawImageReferences) {
      const sourceUrlWithoutIpgsd = imageReference.sourceUrl.slice(
        0,
        -extname(imageReference.sourceUrl).length
      )
      const normalizedSourceUrl =
        imageReference.directIpgsd
          ? sourceUrlWithoutIpgsd
          : imageReference.sourceUrl
      const replacement = useSvgPlaceholder
        ? shouldKeepOriginalSvgPath
          ? normalizedSourceUrl
          : `${normalizedSourceUrl}.ipgsd-placeholder.svg`
        : imageReference.directIpgsd
          ? sourceUrlWithoutIpgsd
          : imageReference.sourceUrl
      if (imageReference.sourceUrl === replacement) {
        continue
      }
      if (imageReference.startOffset === null || imageReference.endOffset === null) {
        throw new Error(`报告图片路径无法规范化：${imageReference.parsedUrl}`)
      }
      const existingReplacement = uploadReplacements.get(imageReference.startOffset)
      if (
        existingReplacement &&
        (existingReplacement.endOffset !== imageReference.endOffset ||
          existingReplacement.replacement !== replacement)
      ) {
        throw new Error(`报告图片上传路径冲突：${imageReference.parsedUrl}`)
      }
      uploadReplacements.set(imageReference.startOffset, {
        endOffset: imageReference.endOffset,
        replacement
      })
    }
    if (encryptedCandidate) {
      log[useSvgPlaceholder ? 'warn' : 'info'](
        useSvgPlaceholder
          ? '[REPORT_IMAGE_ENCRYPTED_CANDIDATE_PLACEHOLDER]'
          : '[REPORT_IMAGE_ENCRYPTED_CANDIDATE_UPLOADED]',
        {
          relativePath,
          extension,
          result: useSvgPlaceholder ? 'PLACEHOLDER' : 'UPLOADED',
          reasonCode: useSvgPlaceholder ? validationReasonCode : 'VALID_ORIGINAL_CONTENT',
          ...(useSvgPlaceholder ? { uploadRelativePath } : {})
        }
      )
    }
    assets.push({
      relative_path: uploadRelativePath,
      content: useSvgPlaceholder
        ? preparedSvg?.content ?? ENCRYPTED_IMAGE_SVG_PLACEHOLDER
        : preparedSvg?.content ?? content,
      content_type: useSvgPlaceholder ? imageContentTypes['.svg'] : contentType
    })
  }
  if (invalidUtf8SvgPaths.length > 0) {
    throw new ReportUploadRecoveryError(invalidUtf8SvgPaths)
  }
  let uploadedReportContent = reportContent
  for (const [startOffset, { endOffset, replacement }] of [...uploadReplacements.entries()].sort(
    ([leftStartOffset], [rightStartOffset]) => rightStartOffset - leftStartOffset
  )) {
    uploadedReportContent = `${uploadedReportContent.slice(0, startOffset)}${replacement}${uploadedReportContent.slice(endOffset)}`
  }
  return { reportContent: uploadedReportContent, assets }
}

const detectInvalidUtf8SvgForLegacyFallback = async (
  reportPath: string,
  reportContent: string
): Promise<void> => {
  const reportDirectory = resolve(dirname(reportPath))
  const imagesDirectory = resolve(reportDirectory, 'images')
  let realReportDirectory: string
  let realImagesDirectory: string
  try {
    realReportDirectory = await realpath(reportDirectory)
    realImagesDirectory = await realpath(imagesDirectory)
  } catch {
    return
  }
  if (!isInsideDirectory(realImagesDirectory, realReportDirectory)) return

  const candidatesByRealPath = new Map<
    string,
    { rawImagePath: string; relativePath: string; realSourcePath: string }
  >()
  let totalCandidateBytes = 0
  for (const reference of extractMarkdownImageReferences(reportContent)) {
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(reference.parsedUrl)
    } catch {
      continue
    }
    if (isAbsolute(decodedPath)) continue
    const imagePath = resolve(reportDirectory, decodedPath)
    if (!isInsideDirectory(imagePath, imagesDirectory)) continue
    const referenceExtension = extname(imagePath)
    const directIpgsd = referenceExtension.toLowerCase() === '.ipgsd'
    const originalImagePath = directIpgsd
      ? imagePath.slice(0, -referenceExtension.length)
      : imagePath
    if (extname(originalImagePath).toLowerCase() !== '.svg') continue

    let sourcePath = imagePath
    if (!directIpgsd && !(await hasExactDirectoryEntry(dirname(imagePath), basename(imagePath)))) {
      const encryptedCandidate = await findEncryptedImageCandidate(imagePath)
      if (!encryptedCandidate) continue
      sourcePath = encryptedCandidate
    } else if (
      directIpgsd && !(await hasExactDirectoryEntry(dirname(imagePath), basename(imagePath)))
    ) {
      continue
    }

    let realSourcePath: string
    try {
      realSourcePath = await realpath(sourcePath)
    } catch {
      continue
    }
    if (!isInsideDirectory(realSourcePath, realImagesDirectory)) continue

    let imageStat
    try {
      imageStat = await stat(realSourcePath)
    } catch {
      continue
    }
    if (!imageStat.isFile() || imageStat.size <= 0) continue
    if (imageStat.size > MAX_REPORT_IMAGE_BYTES) {
      throw new Error(`单个报告图片超过大小限制：${reference.parsedUrl}`)
    }
    if (candidatesByRealPath.has(realSourcePath)) continue

    candidatesByRealPath.set(realSourcePath, {
      rawImagePath: reference.parsedUrl,
      relativePath: relative(reportDirectory, originalImagePath).split(sep).join('/'),
      realSourcePath
    })
    if (candidatesByRealPath.size > MAX_REPORT_IMAGE_COUNT) {
      throw new Error('报告图片数量超过限制')
    }
    totalCandidateBytes += imageStat.size
    if (totalCandidateBytes > MAX_REPORT_ASSETS_TOTAL_BYTES) {
      throw new Error('报告图片总大小超过限制')
    }
  }

  const invalidUtf8Paths = new Set<string>()
  let totalReadBytes = 0
  for (const candidate of candidatesByRealPath.values()) {
    let content: Buffer
    try {
      content = await readFile(candidate.realSourcePath)
    } catch {
      continue
    }
    if (content.length > MAX_REPORT_IMAGE_BYTES) {
      throw new Error(`单个报告图片超过大小限制：${candidate.rawImagePath}`)
    }
    totalReadBytes += content.length
    if (totalReadBytes > MAX_REPORT_ASSETS_TOTAL_BYTES) {
      throw new Error('报告图片总大小超过限制')
    }
    try {
      const validation = validateSafeSvg(content)
      if (!validation.valid && validation.reasonCode === 'INVALID_UTF8') {
        invalidUtf8Paths.add(candidate.relativePath)
      }
    } catch {
      // 历史 Markdown-only 回退只识别可信的 INVALID_UTF8，不引入新的阻断条件。
    }
  }
  if (invalidUtf8Paths.size > 0) {
    throw new ReportUploadRecoveryError([...invalidUtf8Paths])
  }
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
  const initialExtraction = inspectReviewIssues(reportContent)
  const initialReportPayload = {
    report_content: reportContent,
    report_path: reportPath,
    report_name: basename(reportPath)
  }
  if (initialExtraction.status === 'invalid') {
    await detectInvalidUtf8SvgForLegacyFallback(reportPath, reportContent)
    return api.uploadReport(token, taskId, initialReportPayload)
  }

  const preparedAssets = await readReportAssets(reportPath, reportContent)
  const uploadedReportContent = preparedAssets.reportContent
  const extraction = inspectReviewIssues(uploadedReportContent)
  if (extraction.status === 'invalid') {
    return api.uploadReport(token, taskId, initialReportPayload)
  }
  const reportPayload = {
    report_content: uploadedReportContent,
    report_path: reportPath,
    report_name: basename(reportPath)
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
  validateIssueSnapshots(issues, uploadedReportContent)

  return api.uploadReport(token, taskId, {
    ...reportPayload,
    feedback_protocol_version: 1,
    issues,
    assets: preparedAssets.assets
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
