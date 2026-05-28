import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { TokenPair } from './api-client'

const AUTH_FILE_NAME = 'auth.bin'

export class AuthStore {
  private readonly filePath: string

  constructor(filePath = join(app.getPath('userData'), AUTH_FILE_NAME)) {
    this.filePath = filePath
  }

  async save(tokens: TokenPair): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens))
    await writeFile(this.filePath, encrypted)
  }

  async load(): Promise<TokenPair | null> {
    try {
      const encrypted = await readFile(this.filePath)
      const raw = safeStorage.decryptString(encrypted)
      const parsed = JSON.parse(raw) as unknown

      if (this.isTokenPair(parsed)) {
        return parsed
      }
    } catch {
      return null
    }

    return null
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }

  private isTokenPair(value: unknown): value is TokenPair {
    return (
      typeof value === 'object' &&
      value !== null &&
      'access_token' in value &&
      'refresh_token' in value &&
      typeof value.access_token === 'string' &&
      typeof value.refresh_token === 'string'
    )
  }
}
