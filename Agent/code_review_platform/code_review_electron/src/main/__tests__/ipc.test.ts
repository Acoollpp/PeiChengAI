import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SubmitFeedbackRequest } from '../api-client'

const handleMock = vi.fn()
const showItemInFolderMock = vi.fn()
const showOpenDialogMock = vi.hoisted(() => vi.fn())
const notificationIsSupportedMock = vi.hoisted(() => vi.fn(() => true))
const notificationShowMock = vi.hoisted(() => vi.fn())
const notificationOnMock = vi.hoisted(() => vi.fn())
const notificationOnceMock = vi.hoisted(() => vi.fn())

const NotificationMock = vi.fn(function NotificationMock() {
  return {
    show: notificationShowMock,
    on: notificationOnMock,
    once: notificationOnceMock
  }
})
;(NotificationMock as unknown as { isSupported: typeof notificationIsSupportedMock }).isSupported =
  notificationIsSupportedMock

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/code-review-user-data')
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  BrowserWindow: vi.fn(function BrowserWindowMock() {
    return {
      loadFile: vi.fn(async () => undefined),
      webContents: {
        printToPDF: vi.fn(async () => Buffer.from('%PDF-1.4\nfake-pdf'))
      },
      close: vi.fn()
    }
  }),
  ipcMain: {
    handle: handleMock
  },
  Notification: NotificationMock,
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
      'user:me',
      'department:list-available',
      'user:set-department',
      'credentials:save',
      'credentials:load',
      'credentials:clear',
      'server-config:load',
      'app-update:check',
      'app-update:download',
      'app-update:install',
      'notification:show-task-completed',
      'task:list',
      'task:report',
      'requirement-file:select',
      'codex:install',
      'svn:install',
      'skill:install',
      'environment:check',
      'task:execute',
      'task:retry',
      'task:cancel',
      'task:open-log',
      'feedback:submit',
      'report-feedback:open',
      'report-feedback:submit-negative',
      'report-feedback-window:get-context',
      'report-feedback-window:focus-anchor',
      'report-feedback-window:submit',
      'report-feedback-window:close',
      'report:asset',
      'report:download-current',
      'report:open-pdf'
    ])
  })

  it('selects a requirement Excel file through IPC', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/产品开发需求表.xls']
    })
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'requirement-file:select'
    )?.[1]

    await expect(handler()).resolves.toEqual({
      status: 'selected',
      filePath: '/tmp/产品开发需求表.xls'
    })
  })

  it('returns cancelled when requirement file dialog is cancelled', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: true,
      filePaths: []
    })
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'requirement-file:select'
    )?.[1]

    await expect(handler()).resolves.toEqual({
      status: 'cancelled'
    })
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

  it('shows task completion notification and sends click event to renderer', async () => {
    const send = vi.fn()
    const restore = vi.fn()
    const show = vi.fn()
    const focus = vi.fn()
    const isMinimized = vi.fn(() => true)
    const isDestroyed = vi.fn(() => false)
    const mainWindow = {
      isMinimized,
      isDestroyed,
      restore,
      show,
      focus,
      webContents: {
        send,
        isDestroyed
      }
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      getMainWindow: () => mainWindow as never
    })

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]
    const payload = {
      taskId: 'task-1',
      localTaskId: 'local-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12',
      reportPath: '/tmp/report.md'
    }

    const result = handler({}, payload)
    expect(notificationShowMock).toHaveBeenCalledWith()
    const showHandler = notificationOnceMock.mock.calls.find(([eventName]) => eventName === 'show')?.[1]
    expect(showHandler).toBeDefined()
    showHandler()

    await expect(result).resolves.toEqual({ status: 'shown' })
    const clickHandler = notificationOnMock.mock.calls.find(([eventName]) => eventName === 'click')?.[1]
    expect(clickHandler).toBeDefined()

    clickHandler()

    expect(restore).toHaveBeenCalledWith()
    expect(show).toHaveBeenCalledWith()
    expect(focus).toHaveBeenCalledWith()
    expect(send).toHaveBeenCalledWith('notification:task-completed-clicked', payload)
  })

  it('ignores destroyed window errors during task completion notification click', async () => {
    const send = vi.fn()
    const restore = vi.fn()
    const show = vi.fn(() => {
      throw new Error('Object has been destroyed')
    })
    const focus = vi.fn()
    const isMinimized = vi.fn(() => false)
    const isDestroyed = vi.fn(() => false)
    const mainWindow = {
      isMinimized,
      isDestroyed,
      restore,
      show,
      focus,
      webContents: {
        send,
        isDestroyed
      }
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      getMainWindow: () => mainWindow as never
    })

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]
    const payload = {
      taskId: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12'
    }

    const result = handler({}, payload)
    const showHandler = notificationOnceMock.mock.calls.find(([eventName]) => eventName === 'show')?.[1]
    expect(showHandler).toBeDefined()
    showHandler()

    await expect(result).resolves.toEqual({ status: 'shown' })
    const clickHandler = notificationOnMock.mock.calls.find(([eventName]) => eventName === 'click')?.[1]
    expect(clickHandler).toBeDefined()

    expect(() => clickHandler()).not.toThrow()

    expect(show).toHaveBeenCalledWith()
    expect(focus).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('returns failed when task completion notification emits failed', async () => {
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]

    const result = handler({}, {
      taskId: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: 'r10',
      new_revision: 'r12'
    })
    expect(notificationShowMock).toHaveBeenCalledWith()
    const failedHandler = notificationOnceMock.mock.calls.find(([eventName]) => eventName === 'failed')?.[1]
    expect(failedHandler).toBeDefined()

    failedHandler({}, 'Windows toast failed')

    await expect(result).resolves.toEqual({
      status: 'failed',
      message: 'Windows toast failed'
    })
  })

  it('returns unsupported when task completion notification is unavailable', async () => {
    notificationIsSupportedMock.mockReturnValueOnce(false)
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]

    await expect(
      handler({}, {
        taskId: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: 'r10',
        new_revision: 'r12'
      })
    ).resolves.toEqual({ status: 'unsupported' })
    expect(notificationShowMock).not.toHaveBeenCalled()
  })

  it('returns failed when task completion notification support check throws', async () => {
    notificationIsSupportedMock.mockImplementationOnce(() => {
      throw new Error('通知能力检查失败')
    })
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers()

    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'notification:show-task-completed'
    )?.[1]

    await expect(
      handler({}, {
        taskId: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: 'r10',
        new_revision: 'r12'
      })
    ).resolves.toEqual({
      status: 'failed',
      message: '通知能力检查失败'
    })
    expect(notificationShowMock).not.toHaveBeenCalled()
  })

  it('passes user and department IPC calls through to the API client', async () => {
    const api = {
      readCurrentUser: vi.fn(async () => ({
        id: 'user-1',
        full_name: '张三',
        svn_username: 'zhangsan',
        department_id: null,
        department_name: null,
        role: 'user'
      })),
      listAvailableDepartments: vi.fn(async () => ({
        data: [{ id: 'dept-1', name: '研发部', is_active: true }],
        count: 1
      })),
      setMyDepartment: vi.fn(async () => ({
        id: 'user-1',
        full_name: '张三',
        svn_username: 'zhangsan',
        department_id: 'dept-1',
        department_name: '研发部',
        role: 'user'
      }))
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never
    })

    const readUserHandler = handleMock.mock.calls.find(([channel]) => channel === 'user:me')?.[1]
    const listDepartmentsHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'department:list-available'
    )?.[1]
    const setDepartmentHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'user:set-department'
    )?.[1]

    await expect(readUserHandler()).resolves.toMatchObject({ id: 'user-1' })
    await expect(listDepartmentsHandler()).resolves.toMatchObject({ count: 1 })
    await expect(
      setDepartmentHandler({}, { department_id: 'dept-1' })
    ).resolves.toMatchObject({
      department_id: 'dept-1'
    })
    expect(api.readCurrentUser).toHaveBeenCalledWith('token-123')
    expect(api.listAvailableDepartments).toHaveBeenCalledWith('token-123')
    expect(api.setMyDepartment).toHaveBeenCalledWith('token-123', 'dept-1')
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
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
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
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
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
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
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
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
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

  it('retries an existing failed task through IPC without creating a new task', async () => {
    const api = {
      createTask: vi.fn(),
      readTask: vi.fn(async () => ({
        id: 'task-retry',
        svn_url: 'svn://repo/retry',
        old_revision: '10',
        new_revision: '12',
        template_key: 'template_2',
        skill_name: '通用-代码审查-模版二',
        status: 'failed'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-retry-task-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const sender = { send: vi.fn() }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
      runCodex: vi.fn(async () => {
        await writeFile(reportPath, '# retry report\n')
      })
    })

    const retryHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:retry')?.[1]

    await expect(
      retryHandler(
        { sender },
        {
          task_id: 'task-retry',
          client_task_id: 'task-retry',
          requirement_file_path: '/tmp/产品开发需求表.xls'
        }
      )
    ).resolves.toMatchObject({
      taskId: 'task-retry',
      status: 'success',
      reportMarkdown: '# retry report\n'
    })
    expect(api.createTask).not.toHaveBeenCalled()
    expect(api.readTask).toHaveBeenCalledWith('token-123', 'task-retry')
    expect(sender.send).toHaveBeenCalledWith(
      'task:progress',
      expect.objectContaining({
        clientTaskId: 'task-retry',
        taskId: 'task-retry'
      })
    )
  })

  it('ignores task progress events after the renderer sender has been destroyed', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-1',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-destroyed-sender-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const sender = {
      isDestroyed: vi.fn(() => true),
      send: vi.fn(() => {
        throw new TypeError('Object has been destroyed')
      })
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
      runCodex: vi.fn(async ({ onProgress }) => {
        onProgress?.({
          taskId: 'task-1',
          type: 'codex_output',
          stream: 'stdout',
          message: '审查中'
        })
        await writeFile(reportPath, '# report\n')
      })
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]

    await expect(
      executeHandler({ sender }, {
        client_task_id: 'local-task-1',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    ).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'success'
    })
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('writes Codex output to a local task log and opens it from IPC', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-log',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-task-log-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const sender = { send: vi.fn() }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      runtimePaths: {
        runtimeRoot: cwd,
        skillPackagesDir: join(cwd, 'skill-packages'),
        skillManifestPath: join(cwd, 'skill-packages', 'manifest.json'),
        workspacesDir: join(cwd, '..'),
        workspaceForTask: () => cwd,
        reportPathForTask: () => reportPath,
        codexLogPathForTask: () => join(cwd, 'codex-review.log'),
        imagesDirForTask: () => imagesDir
      },
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
      runCodex: vi.fn(async ({ onProgress }) => {
        onProgress?.({
          taskId: 'task-log',
          type: 'codex_output',
          stream: 'stdout',
          message: '读取 Skill\n'
        })
        onProgress?.({
          taskId: 'task-log',
          type: 'codex_output',
          stream: 'stderr',
          message: 'Codex warning\n'
        })
        await writeFile(reportPath, '# report\n')
      })
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]
    const openLogHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:open-log')?.[1]

    await expect(
      executeHandler({ sender }, {
        client_task_id: 'local-task-log',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        template_key: 'template_1',
        skill_name: '通用-代码审查-模版一'
      })
    ).resolves.toMatchObject({
      taskId: 'task-log',
      status: 'success',
      codexLogPath: join(cwd, 'codex-review.log')
    })

    const logPath = join(cwd, 'codex-review.log')
    await expect(readFile(logPath, 'utf8')).resolves.toContain('[stdout] 读取 Skill')
    await expect(readFile(logPath, 'utf8')).resolves.toContain('[stderr] Codex warning')

    await expect(openLogHandler({}, { taskId: 'task-log' })).resolves.toEqual({
      status: 'ready',
      logPath
    })
    expect(showItemInFolderMock).toHaveBeenCalledWith(logPath)
  })

  it('取消运行中的任务时更新服务端状态并删除任务工作区', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-cancel',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-cancel-workspace-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    let resolveRunCodex!: () => void
    const runCodexPromise = new Promise<void>((resolve) => {
      resolveRunCodex = resolve
    })
    const runCodex = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await mkdir(imagesDir, { recursive: true })
      await writeFile(reportPath, '# partial\n')
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      resolveRunCodex()
    })
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
      runCodex: runCodex as never
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]
    const cancelHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:cancel')?.[1]

    const executePromise = executeHandler({ sender: { send: vi.fn() } }, {
      client_task_id: 'local-cancel',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      template_key: 'template_1',
      skill_name: '通用-代码审查-模版一'
    })
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1))

    await expect(
      cancelHandler({}, { client_task_id: 'local-cancel', task_id: 'task-cancel' })
    ).resolves.toEqual({ status: 'cancelled' })
    await runCodexPromise
    await expect(executePromise).resolves.toMatchObject({
      taskId: 'task-cancel',
      status: 'cancelled'
    })

    expect(api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-cancel', {
      status: 'cancelled',
      error_message: '任务已取消'
    })
    await expect(readFile(reportPath, 'utf8')).rejects.toThrow()
  })

  it('正常关闭客户端时取消所有运行中的任务', async () => {
    const api = {
      createTask: vi.fn(async () => ({
        id: 'task-close',
        svn_url: 'svn://repo/project',
        old_revision: '1',
        new_revision: '2',
        status: 'created'
      })),
      updateTaskStatus: vi.fn(async () => undefined),
      uploadReport: vi.fn(async () => undefined),
      uploadPdfReport: vi.fn(async () => undefined)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123' })),
      save: vi.fn()
    }
    const cwd = await mkdtemp(join(tmpdir(), 'ipc-close-workspace-'))
    tempDirs.push(cwd)
    const reportPath = join(cwd, '代码审查报告.md')
    const imagesDir = join(cwd, 'images')
    const runCodex = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await mkdir(imagesDir, { recursive: true })
      await writeFile(reportPath, '# partial\n')
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    })
    const { cancelAllActiveReviewTasks, registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      api: api as never,
      authStore: authStore as never,
      syncSkill: vi.fn(async () => ({ status: 'current' as const, skills: [] })),
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
      preflightSvn: vi.fn(),
      runCodex: runCodex as never
    })

    const executeHandler = handleMock.mock.calls.find(([channel]) => channel === 'task:execute')?.[1]

    const executePromise = executeHandler({ sender: { send: vi.fn() } }, {
      client_task_id: 'local-close',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      template_key: 'template_1',
      skill_name: '通用-代码审查-模版一'
    })
    await vi.waitFor(() => expect(runCodex).toHaveBeenCalledTimes(1))

    await cancelAllActiveReviewTasks()
    await expect(executePromise).resolves.toMatchObject({
      taskId: 'task-close',
      status: 'cancelled'
    })

    expect(api.updateTaskStatus).toHaveBeenLastCalledWith('token-123', 'task-close', {
      status: 'cancelled',
      error_message: '任务已取消'
    })
    await expect(readFile(reportPath, 'utf8')).rejects.toThrow()
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

  it('opens a local PDF report path without downloading it', async () => {
    const authStore = {
      load: vi.fn(),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-local-pdf-report-'))
    tempDirs.push(runtimeRoot)
    const pdfPath = join(runtimeRoot, 'workspaces', 'task-local', '代码审查报告.pdf')
    await mkdir(join(runtimeRoot, 'workspaces', 'task-local'), { recursive: true })
    await writeFile(pdfPath, Buffer.from([37, 80, 68, 70]))
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]

    await expect(openPdfHandler({}, { taskId: 'task-local', localPdfPath: pdfPath })).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    expect(authStore.load).not.toHaveBeenCalled()
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
  })

  it('rejects opening a PDF report without taskId before authentication', async () => {
    const authStore = {
      load: vi.fn(),
      save: vi.fn()
    }
    const { registerIpcHandlers } = await import('../ipc')

    registerIpcHandlers({
      authStore: authStore as never
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]

    await expect(openPdfHandler({}, {})).rejects.toThrow('请先选择一个已完成任务报告。')
    expect(authStore.load).not.toHaveBeenCalled()
  })

  it('opens an existing named PDF report from the workspace without downloading it', async () => {
    const api = {
      downloadPdfReport: vi.fn()
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-existing-pdf-report-'))
    tempDirs.push(runtimeRoot)
    const workspaceDir = join(runtimeRoot, 'workspaces', 'task-local')
    const pdfPath = join(workspaceDir, '自定义报告.pdf')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(pdfPath, Buffer.from([37, 80, 68, 70]))
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
        pdfReportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.pdf'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]

    await expect(
      openPdfHandler({}, { taskId: 'task-local', pdfReportName: '自定义报告.pdf' })
    ).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    expect(api.downloadPdfReport).not.toHaveBeenCalled()
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
  })

  it('downloads a PDF report when localPdfPath is missing and saves it with the requested name', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-missing-local-pdf-report-'))
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
        pdfReportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.pdf'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]
    const missingPdfPath = join(runtimeRoot, 'workspaces', 'task-remote', 'missing.pdf')
    const pdfPath = join(runtimeRoot, 'workspaces', 'task-remote', '历史报告.pdf')

    await expect(
      openPdfHandler(
        {},
        {
          taskId: 'task-remote',
          localPdfPath: missingPdfPath,
          pdfReportName: '历史报告.pdf'
        }
      )
    ).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    await expect(readFile(pdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70]))
    expect(api.downloadPdfReport).toHaveBeenCalledWith('token-123', 'task-remote')
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
  })

  it('downloads a historical PDF report into the local runtime workspace before opening it', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-runtime-pdf-report-'))
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
        pdfReportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.pdf'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]
    const pdfPath = join(runtimeRoot, 'workspaces', 'task-remote', '历史报告.pdf')

    await expect(
      openPdfHandler({}, { taskId: 'task-remote', pdfReportName: '历史报告.pdf' })
    ).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    await expect(readFile(pdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70]))
    expect(api.downloadPdfReport).toHaveBeenCalledWith('token-123', 'task-remote')
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
  })

  it('opens an existing default PDF report path when pdfReportName is missing', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45, 110, 101, 119]).buffer)
    }
    const authStore = {
      load: vi.fn(),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-fallback-pdf-report-'))
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
        pdfReportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.pdf'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]
    const workspaceDir = join(runtimeRoot, 'workspaces', 'task-remote')
    const pdfPath = join(workspaceDir, '代码审查报告.pdf')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(pdfPath, Buffer.from([37, 80, 68, 70, 45, 111, 108, 100]))

    await expect(openPdfHandler({}, { taskId: 'task-remote' })).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    await expect(readFile(pdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70, 45, 111, 108, 100]))
    expect(authStore.load).not.toHaveBeenCalled()
    expect(api.downloadPdfReport).not.toHaveBeenCalled()
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
  })

  it('downloads to the default PDF report path when pdfReportName is missing and no local PDF exists', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45, 110, 101, 119]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-fallback-pdf-download-'))
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
        pdfReportPathForTask: (taskId: string) =>
          join(runtimeRoot, 'workspaces', taskId, '代码审查报告.pdf'),
        imagesDirForTask: (taskId: string) => join(runtimeRoot, 'workspaces', taskId, 'images')
      }
    })

    const openPdfHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report:open-pdf'
    )?.[1]
    const pdfPath = join(runtimeRoot, 'workspaces', 'task-remote', '代码审查报告.pdf')

    await expect(openPdfHandler({}, { taskId: 'task-remote' })).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
    await expect(readFile(pdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70, 45, 110, 101, 119]))
    expect(api.downloadPdfReport).toHaveBeenCalledWith('token-123', 'task-remote')
    expect(showItemInFolderMock).toHaveBeenCalledWith(pdfPath)
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
      uploadPdfReport: vi.fn(async () => undefined),
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
      checkEnvironment: vi.fn(async () => ({ status: 'ready' as const, svnPath: '/fake/bin/svn' })),
      prepareWorkspace: vi.fn(async () => ({
        cwd: latestWorkspace,
        reportPath: latestReportPath,
        imagesDir: join(latestWorkspace, 'images')
      })),
      preflightSvn: vi.fn(),
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

  it('lists only tasks owned by the authenticated user', async () => {
    const api = {
      readCurrentUser: vi.fn(async () => ({
        id: 'user-1',
        full_name: '张三',
        svn_username: 'zhangsan',
        department_id: null,
        department_name: null,
        role: 'department_admin'
      })),
      listTasks: vi.fn(async () => ({
        data: [
          {
            id: 'task-1',
            user_id: 'user-1',
            svn_url: 'svn://repo/project',
            old_revision: '1',
            new_revision: '2',
            status: 'success'
          },
          {
            id: 'task-2',
            user_id: 'user-2',
            svn_url: 'svn://repo/other',
            old_revision: '3',
            new_revision: '4',
            status: 'success'
          },
          {
            id: 'task-without-user',
            svn_url: 'svn://repo/missing-user',
            old_revision: '5',
            new_revision: '6',
            status: 'success'
          }
        ],
        count: 3
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
          user_id: 'user-1',
          svn_url: 'svn://repo/project',
          old_revision: '1',
          new_revision: '2',
          status: 'success'
        }
      ],
      count: 1
    })
    expect(api.readCurrentUser).toHaveBeenCalledWith('token-123')
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
      feedbackHandler({}, { description: '按钮点击后没有响应', screenshots: [] })
    ).rejects.toThrow('Not authenticated')
    expect(api.submitFeedback).not.toHaveBeenCalled()
  })

  it('submits feedback with the current access token', async () => {
    const firstBytes = new TextEncoder().encode('png-bytes').buffer
    const secondBytes = new TextEncoder().encode('jpeg-bytes').buffer
    const payload = {
      description: '按钮点击后没有响应',
      screenshots: [
        {
          name: 'screen.png',
          type: 'image/png',
          bytes: firstBytes
        },
        {
          name: 'screen-2.jpg',
          type: 'image/jpeg',
          bytes: secondBytes
        }
      ]
    }
    const submitFeedback = vi.fn(async (_token: string, _payload: SubmitFeedbackRequest) => ({
      id: 'feedback-1',
      status: 'pending' as const
    }))
    const api = {
      submitFeedback
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
    expect(submitFeedback).toHaveBeenCalledOnce()
    const [, submitPayload] = submitFeedback.mock.calls[0]
    expect(submitPayload.description).toBe('按钮点击后没有响应')
    expect(submitPayload.screenshotNames).toEqual(['screen.png', 'screen-2.jpg'])
    const screenshots = submitPayload.screenshots
    expect(screenshots).toHaveLength(2)
    expect(screenshots?.[0]).toBeInstanceOf(Blob)
    expect(screenshots?.[0].type).toBe('image/png')
    await expect(screenshots?.[0].text()).resolves.toBe('png-bytes')
    expect(screenshots?.[1]).toBeInstanceOf(Blob)
    expect(screenshots?.[1].type).toBe('image/jpeg')
    await expect(screenshots?.[1].text()).resolves.toBe('jpeg-bytes')
  })

  it('submits negative report feedback with a fixed payload', async () => {
    const send = vi.fn()
    const closeTask = vi.fn(() => false)
    const mainWindow = { webContents: { id: 11, send, isDestroyed: () => false } }
    const submitReportFeedback = vi.fn(async () => ({
      id: 'report-feedback-1',
      task_id: 'task-1',
      user_id: 'user-1',
      helpful: false,
      useful_issues_text: null
    }))
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback } as never,
      authStore: {
        load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh' }))
      } as never,
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    await expect(
      handler({ sender: { id: 11 } }, 'task-1')
    ).resolves.toEqual({ taskId: 'task-1', helpful: false, usefulIssuesText: null })
    expect(submitReportFeedback).toHaveBeenCalledWith('token-123', 'task-1', {
      helpful: false,
      useful_issues_text: null
    })
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(closeTask).toHaveBeenCalledWith('task-1')
  })

  it('同一任务负反馈先成功、正反馈后冲突时以服务端负反馈状态为准', async () => {
    let resolveNegative!: (value: unknown) => void
    const negativePending = new Promise((resolve) => {
      resolveNegative = resolve
    })
    const { ApiError } = await import('../api-client')
    const { registerIpcHandlers } = await import('../ipc')
    const submitReportFeedback = vi
      .fn()
      .mockImplementationOnce(() => negativePending)
      .mockRejectedValueOnce(new ApiError(409, 'report_feedback_exists'))
    const readTask = vi.fn(async () => ({
      id: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      status: 'success' as const,
      report_feedback_helpful: false,
      report_feedback_useful_issues_text: null
    }))
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => ({ webContents: { id: 11, send, isDestroyed: () => false } }) as never,
      getReportFeedbackWindowManager: () => ({
        getContext: () => context,
        close: vi.fn(() => true),
        closeTask
      } as never)
    })
    const negativeHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]
    const positiveHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:submit'
    )?.[1]

    const negativeResult = negativeHandler({ sender: { id: 11 } }, 'task-1')
    const positiveResult = positiveHandler(
      { sender: { id: 22 } },
      { taskId: 'task-1', selectedOptionIds: ['option-1'], manualText: '' }
    )
    void positiveResult.catch(() => undefined)
    await vi.waitFor(() => expect(submitReportFeedback).toHaveBeenCalled())
    expect(submitReportFeedback).toHaveBeenCalledTimes(1)

    resolveNegative({
      id: 'feedback-negative', task_id: 'task-1', user_id: 'user-1', helpful: false,
      useful_issues_text: null
    })

    await expect(negativeResult).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    await expect(positiveResult).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(readTask).toHaveBeenCalledWith('token-123', 'task-1')
    expect(send).toHaveBeenLastCalledWith('report-feedback:submitted', {
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(send.mock.calls.filter(([channel]) => channel === 'report-feedback:submitted')).toHaveLength(1)
    expect(closeTask).toHaveBeenCalledTimes(1)
    expect(closeTask).toHaveBeenCalledWith('task-1')
  })

  it('同一任务正反馈先成功、负反馈后冲突时以服务端正反馈状态为准', async () => {
    let resolvePositive!: (value: unknown) => void
    const positivePending = new Promise((resolve) => {
      resolvePositive = resolve
    })
    const { ApiError } = await import('../api-client')
    const submitReportFeedback = vi
      .fn()
      .mockImplementationOnce(() => positivePending)
      .mockRejectedValueOnce(new ApiError(409, 'report_feedback_exists'))
    const readTask = vi.fn(async () => ({
      id: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      status: 'success' as const,
      report_feedback_helpful: true,
      report_feedback_useful_issues_text: '1. 空指针风险'
    }))
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => ({ webContents: { id: 11, send, isDestroyed: () => false } }) as never,
      getReportFeedbackWindowManager: () => ({
        getContext: () => context,
        close: vi.fn(() => true),
        closeTask
      } as never)
    })
    const negativeHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]
    const positiveHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:submit'
    )?.[1]

    const positiveResult = positiveHandler(
      { sender: { id: 22 } },
      { taskId: 'task-1', selectedOptionIds: ['option-1'], manualText: '' }
    )
    const negativeResult = negativeHandler({ sender: { id: 11 } }, 'task-1')
    void negativeResult.catch(() => undefined)
    await vi.waitFor(() => expect(submitReportFeedback).toHaveBeenCalled())
    expect(submitReportFeedback).toHaveBeenCalledTimes(1)

    resolvePositive({
      id: 'feedback-positive', task_id: 'task-1', user_id: 'user-1', helpful: true,
      useful_issues_text: '1. 空指针风险'
    })

    await expect(positiveResult).resolves.toEqual({
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 空指针风险'
    })
    await expect(negativeResult).resolves.toEqual({
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 空指针风险'
    })
    expect(readTask).toHaveBeenCalledWith('token-123', 'task-1')
    expect(send.mock.calls.filter(([channel]) => channel === 'report-feedback:submitted')).toHaveLength(1)
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 空指针风险'
    })
    expect(closeTask).toHaveBeenCalledTimes(1)
    expect(closeTask).toHaveBeenCalledWith('task-1')
  })

  it('同一任务队列排空后新一轮冲突会重新发布真实状态', async () => {
    const { ApiError } = await import('../api-client')
    const submitReportFeedback = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'feedback-1', task_id: 'task-1', user_id: 'user-1', helpful: false,
        useful_issues_text: null
      })
      .mockRejectedValueOnce(new ApiError(409, 'report_feedback_exists'))
    const readTask = vi.fn(async () => ({
      id: 'task-1', svn_url: 'svn://repo/project', old_revision: '1', new_revision: '2',
      status: 'success' as const, report_feedback_helpful: false,
      report_feedback_useful_issues_text: null
    }))
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const mainWindow = {
      webContents: { id: 11, send, isDestroyed: () => false }
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    await expect(handler({ sender: { id: 11 } }, 'task-1')).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    await Promise.resolve()
    await expect(handler({ sender: { id: 11 } }, 'task-1')).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(closeTask).toHaveBeenCalledTimes(2)
    expect(readTask).toHaveBeenCalledTimes(1)
  })

  it('不同任务并发提交时各自发布和关闭且互不等待', async () => {
    let resolveTask1!: (value: unknown) => void
    const task1Pending = new Promise((resolve) => {
      resolveTask1 = resolve
    })
    const submitReportFeedback = vi.fn(
      async (_token: string, taskId: string) => {
        if (taskId === 'task-1') {
          return task1Pending
        }
        return {
          id: 'feedback-2', task_id: 'task-2', user_id: 'user-1', helpful: false,
          useful_issues_text: null
        }
      }
    )
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const mainWindow = {
      webContents: { id: 11, send, isDestroyed: () => false }
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    const task1Result = handler({ sender: { id: 11 } }, 'task-1')
    const task2Result = handler({ sender: { id: 11 } }, 'task-2')
    await expect(task2Result).resolves.toEqual({
      taskId: 'task-2', helpful: false, usefulIssuesText: null
    })
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-2', helpful: false, usefulIssuesText: null
    })
    expect(closeTask).toHaveBeenCalledWith('task-2')
    expect(send).not.toHaveBeenCalledWith('report-feedback:submitted', expect.objectContaining({
      taskId: 'task-1'
    }))

    resolveTask1({
      id: 'feedback-1', task_id: 'task-1', user_id: 'user-1', helpful: false,
      useful_issues_text: null
    })
    await expect(task1Result).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(send.mock.calls.filter(([channel]) => channel === 'report-feedback:submitted')).toHaveLength(2)
    expect(closeTask).toHaveBeenCalledTimes(2)
    expect(closeTask).toHaveBeenCalledWith('task-1')
  })

  it('首次通知目标已销毁时不标记已发布，后续冲突可在可用窗口补发', async () => {
    const { ApiError } = await import('../api-client')
    const submitReportFeedback = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'feedback-1', task_id: 'task-1', user_id: 'user-1', helpful: false,
        useful_issues_text: null
      })
      .mockRejectedValueOnce(new ApiError(409, 'report_feedback_exists'))
    const readTask = vi.fn(async () => ({
      id: 'task-1', svn_url: 'svn://repo/project', old_revision: '1', new_revision: '2',
      status: 'success' as const, report_feedback_helpful: false,
      report_feedback_useful_issues_text: null
    }))
    const send = vi.fn()
    let destroyed = true
    const mainWindow = {
      webContents: { id: 11, send, isDestroyed: () => destroyed }
    }
    const closeTask = vi.fn(() => true)
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    await expect(handler({ sender: { id: 11 } }, 'task-1')).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(send).not.toHaveBeenCalled()
    destroyed = false

    await expect(handler({ sender: { id: 11 } }, 'task-1')).resolves.toEqual({
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-1', helpful: false, usefulIssuesText: null
    })
  })

  it('通知发送异常时仍关闭反馈窗口且后续冲突可重新通知', async () => {
    const { ApiError } = await import('../api-client')
    const submitReportFeedback = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'feedback-1', task_id: 'task-1', user_id: 'user-1', helpful: true,
        useful_issues_text: '1. 空指针风险'
      })
      .mockRejectedValueOnce(new ApiError(409, 'report_feedback_exists'))
    const readTask = vi.fn(async () => ({
      id: 'task-1', svn_url: 'svn://repo/project', old_revision: '1', new_revision: '2',
      status: 'success' as const, report_feedback_helpful: true,
      report_feedback_useful_issues_text: '1. 空指针风险'
    }))
    const send = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('renderer transport failed')
      })
      .mockImplementationOnce(() => undefined)
    const closeTask = vi.fn(() => true)
    const mainWindow = {
      webContents: { id: 11, send, isDestroyed: () => false }
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    await expect(handler({ sender: { id: 11 } }, 'task-1')).rejects.toThrow(
      'renderer transport failed'
    )
    expect(closeTask).toHaveBeenCalledTimes(1)
    expect(closeTask).toHaveBeenCalledWith('task-1')

    await expect(handler({ sender: { id: 11 } }, 'task-1')).resolves.toEqual({
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 空指针风险'
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(closeTask).toHaveBeenCalledTimes(2)
  })

  it('反馈冲突后仍查不到服务端真实反馈时拒绝成功', async () => {
    const { ApiError } = await import('../api-client')
    const submitReportFeedback = vi.fn(async () => {
      throw new ApiError(409, 'report_feedback_exists')
    })
    const readTask = vi.fn(async () => ({
      id: 'task-1', svn_url: 'svn://repo/project', old_revision: '1', new_revision: '2',
      status: 'success' as const, report_feedback_helpful: null
    }))
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => ({ webContents: { id: 11 } }) as never
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:submit-negative'
    )?.[1]

    await expect(handler({ sender: { id: 11 } }, 'task-1')).rejects.toThrow(
      '无法确认服务端反馈状态'
    )
  })

  it('opens report feedback window only for the main renderer sender', async () => {
    const open = vi.fn(async () => true as const)
    const mainWindow = { webContents: { id: 11 } }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      getMainWindow: () => mainWindow as never,
      getReportFeedbackWindowManager: () => ({ open } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback:open'
    )?.[1]
    const payload = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }

    await expect(handler({ sender: { id: 99 } }, payload)).rejects.toThrow('无权')
    await expect(handler({ sender: { id: 11 } }, { taskId: '', options: [] })).rejects.toThrow(
      '上下文'
    )
    await expect(handler({ sender: { id: 11 } }, {
      taskId: 'task-1',
      options: [payload.options[0], payload.options[0]]
    })).rejects.toThrow('重复')
    await expect(handler({ sender: { id: 11 } }, payload)).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith(payload)
  })

  it('gets context and closes only for the active feedback window sender', async () => {
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    const getContext = vi.fn((senderId: number) => {
      if (senderId !== 22) throw new Error('无权访问当前反馈窗口')
      return context
    })
    const close = vi.fn((senderId: number) => {
      if (senderId !== 22) throw new Error('无权关闭当前反馈窗口')
      return true as const
    })
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({ getReportFeedbackWindowManager: () => ({ getContext, close } as never) })
    const getHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:get-context'
    )?.[1]
    const closeHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:close'
    )?.[1]

    await expect(getHandler({ sender: { id: 99 } })).rejects.toThrow('无权')
    await expect(getHandler({ sender: { id: 22 } })).resolves.toEqual(context)
    await expect(closeHandler({ sender: { id: 99 } })).rejects.toThrow('无权')
    await expect(closeHandler({ sender: { id: 22 } })).resolves.toBe(true)
  })

  it('maps feedback option IDs to anchors and clears focus without an option ID', async () => {
    const send = vi.fn()
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    const manager = {
      isCurrentSender: vi.fn((id: number) => id === 22),
      getContext: vi.fn((senderId: number) => {
        if (senderId !== 22) throw new Error('无权访问当前反馈窗口')
        return context
      })
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      getMainWindow: () => ({ webContents: { send, isDestroyed: () => false } }) as never,
      getReportFeedbackWindowManager: () => manager as never
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:focus-anchor'
    )?.[1]

    await expect(
      handler({ sender: { id: 99 } }, { taskId: 'task-1', optionId: 'option-1' })
    ).rejects.toThrow('无权')
    await expect(
      handler({ sender: { id: 22 } }, { taskId: 'task-1', optionId: 'unknown' })
    ).rejects.toThrow('未知')
    await expect(
      handler({ sender: { id: 22 } }, { taskId: 'task-1', optionId: 'option-1' })
    ).resolves.toBe(true)
    await expect(
      handler({ sender: { id: 22 } }, { taskId: 'task-1' })
    ).resolves.toBe(true)
    expect(send.mock.calls).toEqual([
      ['report-feedback:focus-anchor', { taskId: 'task-1', anchorId: 'anchor-1' }],
      ['report-feedback:focus-anchor', { taskId: 'task-1' }]
    ])
  })

  it('validates and submits helpful feedback in context order with deduplicated manual lines', async () => {
    const submitReportFeedback = vi.fn(async () => ({
      id: 'feedback-1',
      helpful: true,
      useful_issues_text: '1. 空指针风险\n2. 越界风险\n3. 手工补充'
    }))
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const context = {
      taskId: 'task-1',
      options: [
        { id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' },
        { id: 'option-2', text: '越界风险', anchorId: 'anchor-2' }
      ]
    }
    const manager = {
      isCurrentSender: vi.fn((id: number) => id === 22),
      getContext: vi.fn((senderId: number) => {
        if (senderId !== 22) throw new Error('无权访问当前反馈窗口')
        return context
      }),
      closeTask
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => ({ webContents: { send, isDestroyed: () => false } }) as never,
      getReportFeedbackWindowManager: () => manager as never
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:submit'
    )?.[1]

    await expect(
      handler({ sender: { id: 99 } }, {
        taskId: 'task-1',
        selectedOptionIds: ['option-1'],
        manualText: ''
      })
    ).rejects.toThrow('无权')
    await expect(
      handler({ sender: { id: 22 } }, {
        taskId: 'task-1',
        selectedOptionIds: ['option-2', 'option-1'],
        manualText: ' 空指针风险\n 手工补充 \n手工补充\n'
      })
    ).resolves.toEqual({
      taskId: 'task-1',
      helpful: true,
      usefulIssuesText: '1. 空指针风险\n2. 越界风险\n3. 手工补充'
    })
    expect(submitReportFeedback).toHaveBeenCalledWith('token-123', 'task-1', {
      helpful: true,
      useful_issues_text: '1. 空指针风险\n2. 越界风险\n3. 手工补充'
    })
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-1',
      helpful: true,
      usefulIssuesText: '1. 空指针风险\n2. 越界风险\n3. 手工补充'
    })
    expect(closeTask).toHaveBeenCalledWith('task-1')
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(closeTask.mock.invocationCallOrder[0])
  })

  it('反馈已存在时读取服务端真实状态并关闭反馈窗口', async () => {
    const submitReportFeedback = vi.fn(async () => {
      const { ApiError } = await import('../api-client')
      throw new ApiError(409, 'report_feedback_exists')
    })
    const readTask = vi.fn(async () => ({
      id: 'task-1',
      svn_url: 'svn://repo/project',
      old_revision: '1',
      new_revision: '2',
      status: 'success' as const,
      report_feedback_helpful: true,
      report_feedback_useful_issues_text: '1. 服务端已保存内容'
    }))
    const send = vi.fn()
    const closeTask = vi.fn(() => true)
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      api: { submitReportFeedback, readTask } as never,
      authStore: { load: vi.fn(async () => ({ access_token: 'token-123' })) } as never,
      getMainWindow: () => ({ webContents: { send, isDestroyed: () => false } }) as never,
      getReportFeedbackWindowManager: () => ({ getContext: () => context, closeTask } as never)
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:submit'
    )?.[1]

    await expect(handler({ sender: { id: 22 } }, {
      taskId: 'task-1', selectedOptionIds: ['option-1'], manualText: ''
    })).resolves.toEqual({
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 服务端已保存内容'
    })
    expect(send).toHaveBeenCalledWith('report-feedback:submitted', {
      taskId: 'task-1', helpful: true, usefulIssuesText: '1. 服务端已保存内容'
    })
    expect(closeTask).toHaveBeenCalledWith('task-1')
  })

  it.each([
    [{ taskId: 'other-task', selectedOptionIds: ['option-1'], manualText: '' }, '任务'],
    [{ taskId: 'task-1', selectedOptionIds: ['unknown'], manualText: '' }, '未知'],
    [{ taskId: 'task-1', selectedOptionIds: ['option-1', 'option-1'], manualText: '' }, '重复'],
    [{ taskId: 'task-1', selectedOptionIds: [], manualText: '  \n ' }, '至少']
  ])('rejects invalid helpful feedback payload %#', async (payload, message) => {
    const context = {
      taskId: 'task-1',
      options: [{ id: 'option-1', text: '空指针风险', anchorId: 'anchor-1' }]
    }
    const { registerIpcHandlers } = await import('../ipc')
    registerIpcHandlers({
      getReportFeedbackWindowManager: () => ({
        isCurrentSender: () => true,
        getContext: () => context
      }) as never
    })
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'report-feedback-window:submit'
    )?.[1]

    await expect(handler({ sender: { id: 22 } }, payload)).rejects.toThrow(message)
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
