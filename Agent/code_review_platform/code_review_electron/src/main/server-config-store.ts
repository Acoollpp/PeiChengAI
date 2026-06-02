import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SERVER_CONFIG_FILE_NAME = 'server-config.json'
export const DEFAULT_API_BASE_URL =
  process.env.CODE_REVIEW_API_BASE_URL ?? 'http://172.23.17.242:8000'

export interface ServerConfig {
  server_url: string
}

export class ServerConfigStore {
  private readonly filePath: string
  private readonly defaultServerUrl: string

  constructor(
    filePath = join(app.getPath('userData'), SERVER_CONFIG_FILE_NAME),
    defaultServerUrl = DEFAULT_API_BASE_URL
  ) {
    this.filePath = filePath
    this.defaultServerUrl = normalizeServerUrl(defaultServerUrl)
  }

  async save(config: ServerConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(
      this.filePath,
      `${JSON.stringify({ server_url: normalizeServerUrl(config.server_url) }, null, 2)}\n`
    )
  }

  async load(): Promise<ServerConfig> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown

      if (this.isServerConfig(parsed)) {
        return {
          server_url: normalizeServerUrl(parsed.server_url)
        }
      }
    } catch {
      // Use the default configured server below.
    }

    return {
      server_url: this.defaultServerUrl
    }
  }

  private isServerConfig(value: unknown): value is ServerConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'server_url' in value &&
      typeof value.server_url === 'string' &&
      value.server_url.trim().length > 0
    )
  }
}

export function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim()
  if (!trimmed) {
    throw new Error('服务端地址不能为空')
  }

  const url = new URL(trimmed)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('服务端地址必须以 http:// 或 https:// 开头')
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}
