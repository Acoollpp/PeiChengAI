import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import type { ApiClient } from './api-client'
import { extractReviewIssues } from '../shared/review-issues'
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

type MarkdownAstNode = {
  type: string
  url?: unknown
  identifier?: unknown
  children?: MarkdownAstNode[]
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

const extractRelativeImagePaths = (markdown: string): string[] => {
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

const isImageContentValid = (extension: string, content: Buffer): boolean => {
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
        content.subarray(8, 12).toString('ascii') === 'WEBP'
      )
    case '.svg': {
      const source = content.toString('utf8').replace(/^\uFEFF/, '').trimStart()
      return (
        !/<!DOCTYPE|<!ENTITY/i.test(source) &&
        /^(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg(?:\s|>)/i.test(source)
      )
    }
    default:
      return false
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
  const issues = extractReviewIssues(reportContent).map((issue) => ({
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
  const assets = await readReportAssets(reportPath, reportContent)

  return api.uploadReport(token, taskId, {
    report_content: reportContent,
    report_path: reportPath,
    report_name: basename(reportPath),
    feedback_protocol_version: 1,
    issues,
    assets
  })
}

export const prepareReportForPublishing = async (reportPath: string): Promise<string> => {
  await ensureReportReady(reportPath)

  const originalReport = await readFile(reportPath, 'utf8')
  const cleanedReport = stripReviewReportOutputMetadata(originalReport)
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
): Promise<unknown> => {
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
