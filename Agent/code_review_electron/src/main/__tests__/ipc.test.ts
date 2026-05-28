import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const handleMock = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  },
  ipcMain: {
    handle: handleMock
  }
}))

describe('registerIpcHandlers', () => {
  let tempDirs: string[] = []

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    return Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(() => {
      tempDirs = []
    })
  })

  it('registers only the renderer-facing IPC channels', async () => {
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    expect(handleMock.mock.calls.map(([channel]) => channel)).toEqual([
      'auth:register',
      'auth:login',
      'credentials:save',
      'credentials:load',
      'credentials:clear',
      'server-config:load',
      'skill:install',
      'environment:check',
      'task:execute',
      'report:download-current'
    ])
  })

  it('loads the default server config for the login page', async () => {
    const serverConfigStore = {
      load: vi.fn(async () => ({ server_url: 'http://172.23.17.190:8000' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      serverConfigStore: serverConfigStore as never
    })

    const loadServerConfigHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'server-config:load'
    )?.[1]

    await expect(loadServerConfigHandler()).resolves.toEqual({
      server_url: 'http://172.23.17.190:8000'
    })
  })

  it('uses the submitted server URL when logging in', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'token-123',
          refresh_token: 'refresh-token'
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const authStore = {
      load: vi.fn(),
      save: vi.fn()
    }
    const serverConfigStore = {
      load: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      serverConfigStore: serverConfigStore as never
    })

    const loginHandler = handleMock.mock.calls.find(([channel]) => channel === 'auth:login')?.[1]

    await expect(
      loginHandler({}, {
        server_url: 'http://172.23.17.190:8000/',
        svn_username: 'ada',
        svn_password: 'secret'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('http://172.23.17.190:8000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        svn_username: 'ada',
        svn_password: 'secret'
      })
    })
    expect(serverConfigStore.save).toHaveBeenCalledWith({
      server_url: 'http://172.23.17.190:8000'
    })
    expect(authStore.save).toHaveBeenCalledWith({
      access_token: 'token-123',
      refresh_token: 'refresh-token'
    })
  })

  it('returns the latest successful report path from download IPC', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-report-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, 'report.md')
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# latest report\n')
      })
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]
    const downloadHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:download-current'
    )?.[1]

    await expect(
      executeHandler({}, {
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2'
      })
    ).resolves.toMatchObject({
      status: 'success',
      reportPath: expect.stringContaining('report.md')
    })

    await expect(downloadHandler()).resolves.toMatchObject({
      status: 'ready',
      reportPath: expect.stringContaining('report.md')
    })
  })

  it('syncs the active skill before checking the environment when authenticated', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => ({
      status: 'synced' as const,
      skillPath: '/tmp/code-review-user-data/skills/通用-代码变更审查/SKILL.md'
    }))
    const checkEnvironment = vi.fn(async () => ({ status: 'ready' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toEqual({ status: 'ready' })
    expect(syncSkill).toHaveBeenCalledWith('token-123')
    expect(checkEnvironment).toHaveBeenCalled()
  })

  it('installs the active skill on demand and then checks the environment', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => ({
      status: 'synced' as const,
      skillPath: '/tmp/code-review-user-data/skills/通用-代码变更审查/SKILL.md'
    }))
    const checkEnvironment = vi.fn(async () => ({ status: 'ready' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const installHandler = handleMock.mock.calls.find(([channel]) => channel === 'skill:install')?.[1]

    await expect(installHandler()).resolves.toEqual({ status: 'ready' })
    expect(syncSkill).toHaveBeenCalledWith('token-123')
    expect(checkEnvironment).toHaveBeenCalled()
  })

  it('reports that login is required when installing skill without a token', async () => {
    const authStore = {
      load: vi.fn(async () => null),
      save: vi.fn()
    }
    const syncSkill = vi.fn()
    const checkEnvironment = vi.fn(async () => ({ status: 'missing_skill' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const installHandler = handleMock.mock.calls.find(([channel]) => channel === 'skill:install')?.[1]

    await expect(installHandler()).resolves.toEqual({
      status: 'missing_skill',
      skillError: '请先登录后安装 Skill'
    })
    expect(syncSkill).not.toHaveBeenCalled()
    expect(checkEnvironment).toHaveBeenCalled()
  })

  it('includes the sync error when active skill sync fails', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => {
      throw new Error('No active skill')
    })
    const checkEnvironment = vi.fn(async () => ({ status: 'missing_skill' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toEqual({
      status: 'missing_skill',
      skillError: 'No active skill'
    })
    expect(checkEnvironment).toHaveBeenCalled()
  })

  it('keeps sync error visible even when an older local skill exists', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => {
      throw new Error('No active skill')
    })
    const checkEnvironment = vi.fn(async () => ({ status: 'ready' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toEqual({
      status: 'ready',
      skillError: 'No active skill'
    })
  })
})
