import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const handleMock = vi.fn()
const showItemInFolderMock = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  },
  ipcMain: {
    handle: handleMock
  },
  shell: {
    showItemInFolder: showItemInFolderMock
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
      'auth:key-login',
      'auth:svn-login',
      'svn:bind-credential',
      'credentials:save',
      'credentials:load',
      'credentials:clear',
      'server-config:load',
      'app-update:check',
      'app-update:download',
      'app-update:install',
      'task:list',
      'task:report',
      'codex:install',
      'svn:install',
      'skill:install',
      'environment:check',
      'task:execute',
      'feedback:submit',
      'report:asset',
      'report:download-current'
    ])
  })

  it('passes app update IPC calls through to the update service', async () => {
    const appUpdateService = {
      check: vi.fn(async () => false),
      download: vi.fn(async () => true),
      install: vi.fn(() => true)
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      appUpdateService: appUpdateService as never
    })

    const checkHandler = handleMock.mock.calls.find(([channel]) => channel === 'app-update:check')?.[1]
    const downloadHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'app-update:download'
    )?.[1]
    const installHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'app-update:install'
    )?.[1]

    await expect(checkHandler()).resolves.toBe(false)
    await expect(downloadHandler()).resolves.toBe(true)
    expect(installHandler()).toBe(true)
    expect(appUpdateService.check).toHaveBeenCalledTimes(1)
    expect(appUpdateService.download).toHaveBeenCalledTimes(1)
    expect(appUpdateService.install).toHaveBeenCalledTimes(1)
  })

  it('loads the default server config for the login page', async () => {
    const serverConfigStore = {
      load: vi.fn(async () => ({ server_url: 'http://172.23.17.242:8000' })),
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
      server_url: 'http://172.23.17.242:8000'
    })
  })

  it('uses the submitted server URL when logging in with an access key', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/key-login')) {
        return new Response(
          JSON.stringify({
            access_token: 'token-123',
            refresh_token: 'refresh-token'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('/me/svn-credential')) {
        return new Response(
          JSON.stringify({ detail: 'SVN credential not found' }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
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

    const loginHandler = handleMock.mock.calls.find(([channel]) => channel === 'auth:key-login')?.[1]

    await expect(
      loginHandler({}, {
        server_url: 'http://172.23.17.242:8000/',
        key: 'sk-cch-test'
      })
    ).resolves.toEqual({ needSvnBinding: true })

    expect(fetchMock).toHaveBeenCalledWith('http://172.23.17.242:8000/api/v1/auth/key-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-cch-test' })
    })
    expect(serverConfigStore.save).toHaveBeenCalledWith({
      server_url: 'http://172.23.17.242:8000'
    })
    expect(authStore.save).toHaveBeenCalledWith({
      access_token: 'token-123',
      refresh_token: 'refresh-token'
    })
  })

  it('uses the submitted server URL when logging in with SVN credentials', async () => {
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

    const loginHandler = handleMock.mock.calls.find(([channel]) => channel === 'auth:svn-login')?.[1]

    await expect(
      loginHandler({}, {
        server_url: 'http://172.23.17.242:8000/',
        svn_username: 'ada',
        svn_password: 'secret'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('http://172.23.17.242:8000/api/v1/auth/login', {
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
      server_url: 'http://172.23.17.242:8000'
    })
    expect(authStore.save).toHaveBeenCalledWith({
      access_token: 'token-123',
      refresh_token: 'refresh-token'
    })
  })

  it('opens the latest successful report location from download IPC', async () => {
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
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const syncSkill = vi.fn(async () => ({
      status: 'current' as const,
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码审查-模版一',
          version: '2026.05.29',
          package_path: '/tmp/code-review-runtime/skill-packages/skill.zip',
          installed_at: '2026-05-29T10:00:00.000Z'
        }
      ]
    }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill,
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
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
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    ).resolves.toMatchObject({
      status: 'success',
      reportPath: expect.stringContaining('代码审查报告.md')
    })
    expect(syncSkill).toHaveBeenCalledWith('token-123')

    await expect(downloadHandler()).resolves.toMatchObject({
      status: 'ready',
      reportPath: expect.stringContaining('代码审查报告.md')
    })
    expect(showItemInFolderMock).toHaveBeenCalledWith(reportPath)
  })

  it('syncs active Skills before executing a task and blocks stale local Skill execution on sync failure', async () => {
    const api = {
      createTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      uploadReport: vi.fn()
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => {
      throw new Error('No active skill is configured')
    })
    const checkEnvironment = vi.fn(async () => ({ status: 'ready' as const }))
    const runCodex = vi.fn()
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill,
      checkEnvironment,
      runCodex
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]

    await expect(
      executeHandler({}, {
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    ).rejects.toThrow('No active skill is configured')
    expect(syncSkill).toHaveBeenCalledWith('token-123')
    expect(api.createTask).not.toHaveBeenCalled()
    expect(checkEnvironment).not.toHaveBeenCalled()
    expect(runCodex).not.toHaveBeenCalled()
  })

  it('keeps renderer client_task_id out of the server create task payload', async () => {
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
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-client-task-id-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const sender = { send: vi.fn() }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# report\n')
      })
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]

    await executeHandler({ sender }, {
      client_task_id: 'local-task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      template_key: 'template_1',
      skill_name: '通用-代码审查-模版一'
    })

    expect(api.createTask).toHaveBeenCalledWith('token-123', {
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      template_key: 'template_1',
      skill_name: '通用-代码审查-模版一'
    })
    expect(sender.send).toHaveBeenCalledWith(
      'task:progress',
      expect.objectContaining({
        clientTaskId: 'local-task-1',
        taskId: 'task-1'
      })
    )
  })

  it('downloads a historical task report into the local runtime workspace before opening it', async () => {
    const api = {
      readTaskReport: vi.fn(async () => '# historical report\n')
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-runtime-report-'))
    tempDirs.push(runtimeRoot)
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.md'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const downloadHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:download-current'
    )?.[1]

    const reportPath = join(runtimeRoot, 'workspaces', 'task-remote', '代码审查报告.md')
    await expect(downloadHandler({}, 'task-remote')).resolves.toEqual({
      status: 'ready',
      taskId: 'task-remote',
      reportPath
    })
    await expect(readFile(reportPath, 'utf8')).resolves.toBe('# historical report\n')
    expect(api.readTaskReport).toHaveBeenCalledWith('token-123', 'task-remote')
    expect(showItemInFolderMock).toHaveBeenCalledWith(reportPath)
  })

  it('opens the selected historical report even when another task was the latest success', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-latest',
        svn_url: 'svn://repo/latest',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      readTaskReport: vi.fn(async () => '# selected report\n')
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-selected-report-'))
    tempDirs.push(runtimeRoot)
    const latestWorkspace = join(runtimeRoot, 'workspaces', 'task-latest')
    const latestReportPath = join(latestWorkspace, '代码审查报告.md')
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
      prepareWorkspace: vi.fn(async () => ({
        cwd: latestWorkspace,
        reportPath: latestReportPath,
        imagesDir: join(latestWorkspace, 'images')
      })),
      runCodex: vi.fn(async () => {
        await mkdir(latestWorkspace, { recursive: true })
        await writeFile(latestReportPath, '# latest report\n')
      }),
      runtimePaths: {
        runtimeRoot,
        skillPackagesDir: join(runtimeRoot, 'skill-packages'),
        skillManifestPath: join(runtimeRoot, 'skill-packages', 'manifest.json'),
        workspacesDir: join(runtimeRoot, 'workspaces'),
        workspaceForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId),
        reportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.md'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]
    const downloadHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:download-current'
    )?.[1]

    await executeHandler({}, {
      svn_url: 'svn://repo/latest',
      old_revision: '1',
      new_revision: '2',
      template_key: 'template_1',
      skill_name: '通用-代码审查-模版一'
    })

    const selectedReportPath = join(runtimeRoot, 'workspaces', 'task-selected', '代码审查报告.md')
    await expect(downloadHandler({}, 'task-selected')).resolves.toEqual({
      status: 'ready',
      taskId: 'task-selected',
      reportPath: selectedReportPath
    })
    await expect(readFile(selectedReportPath, 'utf8')).resolves.toBe('# selected report\n')
    expect(api.readTaskReport).toHaveBeenCalledWith('token-123', 'task-selected')
    expect(showItemInFolderMock).toHaveBeenLastCalledWith(selectedReportPath)
  })

  it('reads report image assets relative to a Chinese-named report file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-report-asset-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagePath = join(cwd, 'images', 'diagram.png')
    await mkdir(join(cwd, 'images'), { recursive: true })
    await writeFile(reportPath, '![流程图](images/diagram.png)\n')
    await writeFile(imagePath, Buffer.from('png-bytes'))

    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const assetHandler = handleMock.mock.calls.find(([channel]) => channel === 'report:asset')?.[1]

    await expect(
      assetHandler({}, {
        reportPath,
        assetPath: 'images/diagram.png'
      })
    ).resolves.toEqual({
      dataUrl: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
      contentType: 'image/png'
    })
  })

  it('lists tasks for the authenticated user', async () => {
    const api = {
      listTasks: vi.fn(async () => ({
        data: [
          {
            id: 'task-1',
            svn_url: 'svn://repo/project',
            old_revision: '1',
            new_revision: '2',
            status: 'success'
          }
        ],
        count: 1
      }))
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const listHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:list')?.[1]

    await expect(listHandler()).resolves.toEqual({
      data: [
        {
          id: 'task-1',
          svn_url: 'svn://repo/project',
          old_revision: '1',
          new_revision: '2',
          status: 'success'
        }
      ],
      count: 1
    })
    expect(api.listTasks).toHaveBeenCalledWith('token-123')
  })

  it('rejects task listing when unauthenticated', async () => {
    const api = {
      listTasks: vi.fn()
    }
    const authStore = {
      load: vi.fn(async () => null),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const listHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:list')?.[1]

    await expect(listHandler()).rejects.toThrow('Not authenticated')
    expect(api.listTasks).not.toHaveBeenCalled()
  })

  it('reads a task report for the authenticated user', async () => {
    const api = {
      readTaskReport: vi.fn(async () => '# Report\n')
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const reportHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:report')?.[1]

    await expect(reportHandler({}, 'task-1')).resolves.toBe('# Report\n')
    expect(api.readTaskReport).toHaveBeenCalledWith('token-123', 'task-1')
  })

  it('rejects task report reads when unauthenticated', async () => {
    const api = {
      readTaskReport: vi.fn()
    }
    const authStore = {
      load: vi.fn(async () => null),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const reportHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:report')?.[1]

    await expect(reportHandler({}, 'task-1')).rejects.toThrow('Not authenticated')
    expect(api.readTaskReport).not.toHaveBeenCalled()
  })

  it('rejects feedback submission when unauthenticated', async () => {
    const api = {
      submitFeedback: vi.fn()
    }
    const authStore = {
      load: vi.fn(async () => null),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const feedbackHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'feedback:submit'
    )?.[1]

    await expect(
      feedbackHandler({}, { description: '按钮点击后没有响应', screenshot: null })
    ).rejects.toThrow('Not authenticated')
    expect(api.submitFeedback).not.toHaveBeenCalled()
  })

  it('submits feedback with the current access token', async () => {
    const payload = {
      description: '按钮点击后没有响应',
      screenshot: null
    }
    const api = {
      submitFeedback: vi.fn(async () => ({
        id: 'feedback-1',
        status: 'pending'
      }))
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const feedbackHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'feedback:submit'
    )?.[1]

    await expect(feedbackHandler({}, payload)).resolves.toEqual({
      id: 'feedback-1',
      status: 'pending'
    })
    expect(api.submitFeedback).toHaveBeenCalledWith('token-123', {
      ...payload,
      screenshotName: null
    })
  })

  it('installs Codex CLI on demand', async () => {
    const installCodexCli = vi.fn(async () => ({
      status: 'missing_svn' as const,
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex'
    }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      installCodexCli
    })

    const installHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'codex:install'
    )?.[1]

    await expect(installHandler()).resolves.toEqual({
      status: 'missing_svn',
      codexVersion: 'codex-cli 0.130.0',
      codexPath: 'codex'
    })
    expect(installCodexCli).toHaveBeenCalledTimes(1)
  })

  it('installs SVN CLI on demand', async () => {
    const installSvnCli = vi.fn(async () => ({
      status: 'ready' as const,
      codexVersion: 'codex-cli 0.130.0',
      svnVersion: '1.14.5'
    }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      installSvnCli
    })

    const installHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'svn:install'
    )?.[1]

    await expect(installHandler()).resolves.toEqual({
      status: 'ready',
      codexVersion: 'codex-cli 0.130.0',
      svnVersion: '1.14.5'
    })
    expect(installSvnCli).toHaveBeenCalledTimes(1)
  })

  it('syncs the active skill before checking the environment when authenticated', async () => {
    const calls: string[] = []
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => {
      calls.push('syncSkill')
      return {
        status: 'synced' as const,
        skills: [
          {
            id: 'skill-1',
            name: '通用-代码审查-模版一',
            version: '2026.05.29',
            content_hash: 'hash',
            hash: 'hash',
            file_size: 9,
            package_path: '/tmp/code-review-runtime/skill-packages/skill.zip',
            installed_at: '2026-05-29T10:00:00.000Z'
          }
        ]
      }
    })
    const checkEnvironment = vi.fn(async () => {
      calls.push(`checkEnvironment:${calls.includes('syncSkill') ? 'second' : 'first'}`)
      return { status: 'ready' as const }
    })
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toMatchObject({
      status: 'ready',
      skills: [expect.objectContaining({ id: 'skill-1' })]
    })
    expect(syncSkill).toHaveBeenCalledWith('token-123')
    expect(syncSkill).toHaveBeenCalledTimes(1)
    expect(checkEnvironment).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['checkEnvironment:first', 'syncSkill', 'checkEnvironment:second'])
  })

  it('reports missing Skill when syncing active Skills fails even if stale local Skill exists', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => {
      throw new Error('No active skill is configured')
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
      status: 'missing_skill',
      skillError: 'No active skill is configured',
      skills: []
    })
  })

  it('notifies the renderer when environment check starts installing the active skill', async () => {
    const event = {
      sender: {
        send: vi.fn()
      }
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => ({
      status: 'synced' as const,
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码审查-模版一',
          version: '2026.05.29',
          content_hash: 'hash',
          hash: 'hash',
          file_size: 9,
          package_path: '/tmp/code-review-runtime/skill-packages/skill.zip',
          installed_at: '2026-05-29T10:00:00.000Z'
        }
      ]
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

    await environmentHandler(event)

    expect(event.sender.send).toHaveBeenCalledWith('environment:progress', {
      stage: 'installing_skill'
    })
  })

  it('skips skill sync while Codex CLI is missing', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn()
    const checkEnvironment = vi.fn(async () => ({ status: 'missing_codex' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toEqual({ status: 'missing_codex' })
    expect(checkEnvironment).toHaveBeenCalledTimes(1)
    expect(syncSkill).not.toHaveBeenCalled()
  })

  it('skips skill sync when the environment check fails locally', async () => {
    const failedResult = {
      status: 'failed' as const,
      skillError: '客户端运行目录不可写：/tmp/code-review-runtime'
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn()
    const checkEnvironment = vi.fn(async () => failedResult)
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const environmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'environment:check'
    )?.[1]

    await expect(environmentHandler()).resolves.toEqual(failedResult)
    expect(checkEnvironment).toHaveBeenCalledTimes(1)
    expect(syncSkill).not.toHaveBeenCalled()
  })

  it('installs the active skill on demand and then checks the environment', async () => {
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const syncSkill = vi.fn(async () => ({
      status: 'synced' as const,
      skills: [
        {
          id: 'skill-1',
          name: '通用-代码审查-模版一',
          version: '2026.05.29',
          content_hash: 'hash',
          hash: 'hash',
          file_size: 9,
          package_path: '/tmp/code-review-runtime/skill-packages/skill.zip',
          installed_at: '2026-05-29T10:00:00.000Z'
        }
      ]
    }))
    const checkEnvironment = vi.fn(async () => ({ status: 'ready' as const }))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      syncSkill,
      checkEnvironment
    })

    const installHandler = handleMock.mock.calls.find(([channel]) => channel === 'skill:install')?.[1]

    await expect(installHandler()).resolves.toMatchObject({
      status: 'ready',
      skills: [expect.objectContaining({ id: 'skill-1' })]
    })
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
      skillError: '请先登录后安装 Skill',
      skills: []
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
      skillError: 'No active skill',
      skills: []
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
      status: 'missing_skill',
      skillError: 'No active skill',
      skills: []
    })
  })

  it('returns needSvnBinding false when key login user already has svn credential', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/key-login')) {
        return new Response(
          JSON.stringify({ access_token: 'token-123', refresh_token: 'refresh-token' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('/me/svn-credential')) {
        return new Response(
          JSON.stringify({ svn_username: 'ada', svn_password: 'secret' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const authStore = { load: vi.fn(), save: vi.fn() }
    const serverConfigStore = {
      load: vi.fn(async () => ({ server_url: 'http://127.0.0.1:8000' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never,
      serverConfigStore: serverConfigStore as never
    })

    const loginHandler = handleMock.mock.calls.find(([channel]) => channel === 'auth:key-login')?.[1]

    await expect(
      loginHandler({}, { server_url: 'http://127.0.0.1:8000', key: 'sk-cch-test' })
    ).resolves.toEqual({ needSvnBinding: false })
  })

  it('binds svn credential for the authenticated user', async () => {
    const api = {
      updateSvnCredential: vi.fn(async () => ({
        svn_username: 'ada',
        svn_password: 'secret'
      }))
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const bindHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'svn:bind-credential'
    )?.[1]

    await expect(
      bindHandler({}, { svn_username: 'ada', svn_password: 'secret' })
    ).resolves.toBe(true)

    expect(api.updateSvnCredential).toHaveBeenCalledWith('token-123', {
      svn_username: 'ada',
      svn_password: 'secret'
    })
  })

  it('rejects svn binding when unauthenticated', async () => {
    const authStore = {
      load: vi.fn(async () => null),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({ authStore: authStore as never })

    const bindHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'svn:bind-credential'
    )?.[1]

    await expect(
      bindHandler({}, { svn_username: 'ada', svn_password: 'secret' })
    ).rejects.toThrow('Not authenticated')
  })
})
