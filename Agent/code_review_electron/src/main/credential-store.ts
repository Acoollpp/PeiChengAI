import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface RememberedCredentials {
  server_url?: string
  svn_username: string
  svn_password: string
}

const CREDENTIAL_FILE_NAME = 'remembered-credentials.bin'

export class CredentialStore {
  private readonly filePath: string

  constructor(filePath = join(app.getPath('userData'), CREDENTIAL_FILE_NAME)) {
    this.filePath = filePath
  }

  async save(credentials: RememberedCredentials): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const encrypted = safeStorage.encryptString(JSON.stringify(credentials))
    await writeFile(this.filePath, encrypted)
  }

  async load(): Promise<RememberedCredentials | null> {
    try {
      const encrypted = await readFile(this.filePath)
      const raw = safeStorage.decryptString(encrypted)
      const parsed = JSON.parse(raw) as unknown

      if (this.isRememberedCredentials(parsed)) {
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

  private isRememberedCredentials(value: unknown): value is RememberedCredentials {
    return (
      typeof value === 'object' &&
      value !== null &&
      'svn_username' in value &&
      'svn_password' in value &&
      typeof value.svn_username === 'string' &&
      typeof value.svn_password === 'string' &&
      (!('server_url' in value) || typeof value.server_url === 'string')
    )
  }
}
