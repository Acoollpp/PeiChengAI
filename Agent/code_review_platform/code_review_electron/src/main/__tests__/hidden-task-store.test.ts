import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  }
}))

describe('HiddenTaskStore', () => {
  let tempDirs: string[] = []

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    return Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(() => {
      tempDirs = []
    })
  })

  const createStore = async (): Promise<{
    store: import('../hidden-task-store').HiddenTaskStore
    filePath: string
  }> => {
    const dir = await mkdtemp(join(tmpdir(), 'hidden-tasks-'))
    tempDirs.push(dir)
    const { HiddenTaskStore } = await import('../hidden-task-store')
    const filePath = join(dir, 'hidden-tasks.json')
    return { store: new HiddenTaskStore(filePath), filePath }
  }

  it('returns an empty list before anything is hidden', async () => {
    const { store } = await createStore()

    await expect(store.load()).resolves.toEqual([])
  })

  it('persists hidden task ids', async () => {
    const { store } = await createStore()

    await store.add('task-a')
    await store.add('task-b')

    await expect(store.load()).resolves.toEqual(['task-a', 'task-b'])
  })

  it('keeps adding the same task id idempotent', async () => {
    const { store } = await createStore()

    await store.add('task-a')
    await store.add('task-a')

    await expect(store.load()).resolves.toEqual(['task-a'])
  })

  it('falls back to an empty list when the file is corrupted', async () => {
    const { store, filePath } = await createStore()
    await writeFile(filePath, '{ not json')

    await expect(store.load()).resolves.toEqual([])
  })

  it('drops non-string entries from a malformed list', async () => {
    const { store, filePath } = await createStore()
    await writeFile(filePath, JSON.stringify(['task-a', 42, null, 'task-b']))

    await expect(store.load()).resolves.toEqual(['task-a', 'task-b'])
  })

  it('prunes ids that no longer exist on the server', async () => {
    const { store } = await createStore()
    await store.add('task-a')
    await store.add('task-b')

    await store.prune(['task-b', 'task-c'])

    await expect(store.load()).resolves.toEqual(['task-b'])
  })

  it('does not rewrite the file when pruning changes nothing', async () => {
    const { store } = await createStore()
    await store.add('task-a')

    await store.prune(['task-a'])

    await expect(store.load()).resolves.toEqual(['task-a'])
  })
})
