import { spawn } from 'node:child_process'

import { buildReviewReportFileName } from '../shared/report-artifacts'
import { buildVersionCommandOptions } from './environment-checker'

const REVIEW_REPORT_SUFFIX = '_审查报告.md'
const MAX_REPORT_BASENAME_LENGTH = 180

export interface ResolveReviewReportFileNameInput {
  svnCommand: string
  svnUrl: string
  oldRevision: string
  newRevision: string
  generatedAt?: Date
  runSvnLog?: RunSvnLog
}

export interface RunSvnLogInput {
  svnUrl: string
  revision: string
}

export type RunSvnLog = (input: RunSvnLogInput) => Promise<string>

export const resolveReviewReportFileName = async ({
  svnCommand,
  svnUrl,
  oldRevision,
  newRevision,
  generatedAt,
  runSvnLog = (input) => defaultRunSvnLog(svnCommand, input)
}: ResolveReviewReportFileNameInput): Promise<string> => {
  const softwareVersion = await tryReadSoftwareVersionFromSvnLog({
    svnUrl,
    revision: newRevision,
    runSvnLog
  })
  const reportBaseName = softwareVersion ?? extractReportBaseNameFromSvnUrl(svnUrl)

  if (reportBaseName) {
    return buildSoftwareVersionReportFileName(reportBaseName)
  }

  return buildReviewReportFileName({
    oldRevision,
    newRevision,
    generatedAt
  })
}

export const extractSoftwareVersionFromSvnLogXml = (xml: string): string | null => {
  const match = xml.match(/<msg(?:\s[^>]*)?>([\s\S]*?)<\/msg>/i)
  if (!match) {
    return null
  }

  const message = decodeXmlEntities(match[1])
  const codeMatch = message.match(/代码\s*[:：]\s*([^\s\r\n]+)/)

  return codeMatch?.[1]?.trim() || null
}

export const buildSoftwareVersionReportFileName = (value: string): string => {
  const safeBaseName = sanitizeReportBaseName(value)
  if (!safeBaseName) {
    return buildReviewReportFileName({
      oldRevision: '',
      newRevision: ''
    })
  }

  return `${safeBaseName}${REVIEW_REPORT_SUFFIX}`
}

const tryReadSoftwareVersionFromSvnLog = async ({
  svnUrl,
  revision,
  runSvnLog
}: RunSvnLogInput & { runSvnLog: RunSvnLog }): Promise<string | null> => {
  try {
    const xml = await runSvnLog({ svnUrl, revision })
    return extractSoftwareVersionFromSvnLogXml(xml)
  } catch {
    return null
  }
}

const defaultRunSvnLog = (
  svnCommand: string,
  { svnUrl, revision }: RunSvnLogInput
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      svnCommand,
      buildSvnLogArgs({ svnUrl, revision }),
      buildVersionCommandOptions()
    )
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const settle = (callback: () => void): void => {
      if (!settled) {
        settled = true
        callback()
      }
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => settle(() => reject(error)))
    child.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderrChunks).toString('utf8').trim()))
          return
        }

        resolve(Buffer.concat(stdoutChunks).toString('utf8'))
      })
    })
  })

export const buildSvnLogArgs = ({ svnUrl, revision }: RunSvnLogInput): string[] => {
  const normalizedRevision = normalizeSvnRevision(revision)

  return ['log', '--xml', '-r', normalizedRevision, buildPegRevisionUrl(svnUrl, normalizedRevision)]
}

const normalizeSvnRevision = (revision: string): string => revision.trim().replace(/^[rR]+/, '')

const buildPegRevisionUrl = (svnUrl: string, revision: string): string => {
  const trimmedUrl = svnUrl.trim()
  if (trimmedUrl.endsWith(`@${revision}`)) {
    return trimmedUrl
  }

  return `${trimmedUrl}@${revision}`
}

const extractReportBaseNameFromSvnUrl = (svnUrl: string): string | null => {
  const path = tryReadUrlPathname(svnUrl) ?? svnUrl
  const segment = path
    .split(/[\\/]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1)

  if (!segment) {
    return null
  }

  return sanitizeReportBaseName(decodeUriComponentSafely(segment)) || null
}

const tryReadUrlPathname = (svnUrl: string): string | null => {
  try {
    return new URL(svnUrl).pathname
  } catch {
    return null
  }
}

const decodeUriComponentSafely = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const sanitizeReportBaseName = (value: string): string =>
  Array.from(
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
  )
    .slice(0, MAX_REPORT_BASENAME_LENGTH)
    .join('')
    .trim()

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
