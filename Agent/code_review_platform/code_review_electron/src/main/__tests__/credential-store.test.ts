import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  },
  safeStorage: {
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
  }
}))

describe('CredentialStore', () => {
  let tempDirs: string[] = []

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    return Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(() => {
      tempDirs = []
    })
  })

  it('persists remembered key credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'key-credentials-'))
    tempDirs.push(dir)
    const { CredentialStore } = await import('../credential-store')
    const store = new CredentialStore(join(dir, 'credentials.bin'))

    await store.save({
      mode: 'key',
      server_url: 'http://172.23.17.190:8000',
      key: 'sk-cch-test'
    })

    await expect(store.load()).resolves.toEqual({
      mode: 'key',
      server_url: 'http://172.23.17.190:8000',
      key: 'sk-cch-test'
    })
  })

  it('keeps loading legacy remembered SVN credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'svn-credentials-'))
    tempDirs.push(dir)
    const { CredentialStore } = await import('../credential-store')
    const store = new CredentialStore(join(dir, 'credentials.bin'))

    await store.save({
      server_url: 'http://172.23.17.190:8000',
      svn_username: 'ada',
      svn_password: 'secret'
    })

    await expect(store.load()).resolves.toEqual({
      server_url: 'http://172.23.17.190:8000',
      svn_username: 'ada',
      svn_password: 'secret'
    })
  })
})
