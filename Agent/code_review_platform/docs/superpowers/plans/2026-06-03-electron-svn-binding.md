# Electron 端 Key 登录后 SVN 凭据绑定 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Key 登录成功后自动检测 SVN 凭据，缺失时弹出 Dialog 引导用户绑定，绑定后直接进入任务工作台。

**Architecture:** 复用现有后端 `GET/PUT /api/v1/me/svn-credential` 接口，Electron 主进程在 Key 登录成功后检查 SVN 凭据状态，通过 IPC 通知 Renderer 层弹出 `SvnBindingDialog`。后端零改动。

**Tech Stack:** Electron (ipcMain/ipcRenderer)、React (函数组件)、TypeScript、Vitest

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `code_review_electron/src/main/api-client.ts` | 修改 | 新增 `updateSvnCredential()` 方法 |
| `code_review_electron/src/main/__tests__/api-client.test.ts` | 修改 | 新增 `updateSvnCredential` 测试 |
| `code_review_electron/src/renderer/src/code-review-api.ts` | 修改 | 新增 `KeyLoginResult`、`SvnCredentialPayload` 类型和 `bindSvnCredential` 接口方法 |
| `code_review_electron/src/main/ipc.ts` | 修改 | 修改 `auth:key-login` 返回值，新增 `svn:bind-credential` handler |
| `code_review_electron/src/main/__tests__/ipc.test.ts` | 修改 | 更新 IPC channel 列表，新增 key-login SVN 检查测试、bind-credential 测试 |
| `code_review_electron/src/preload/index.ts` | 修改 | 暴露 `bindSvnCredential` 方法 |
| `code_review_electron/src/renderer/src/components/SvnBindingDialog.tsx` | 新增 | SVN 绑定弹窗组件 |
| `code_review_electron/src/renderer/src/App.tsx` | 修改 | 集成 SVN 绑定状态和 Dialog 渲染 |
| `code_review_electron/src/renderer/src/styles.css` | 修改 | 新增 Dialog 遮罩和弹窗样式 |

---

### Task 1: ApiClient 新增 `updateSvnCredential` 方法

**Files:**
- Modify: `code_review_electron/src/main/api-client.ts:129-134`（在 `getSvnCredential` 方法之后）
- Modify: `code_review_electron/src/main/__tests__/api-client.test.ts`

- [ ] **Step 1: 为 `updateSvnCredential` 写失败的测试**

在 `code_review_electron/src/main/__tests__/api-client.test.ts` 末尾（`it('adds the request URL...')` 之后）添加：

```typescript
  it('updates svn credentials via PUT with authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        svn_username: 'ada',
        svn_password: 'secret'
      })
    )
    const client = new ApiClient('https://server.example', fetchMock)

    const result = await client.updateSvnCredential('token-123', {
      svn_username: 'ada',
      svn_password: 'secret'
    })

    expect(result).toEqual({
      svn_username: 'ada',
      svn_password: 'secret'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://server.example/api/v1/me/svn-credential',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123'
        },
        body: JSON.stringify({
          svn_username: 'ada',
          svn_password: 'secret'
        })
      }
    )
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run code_review_electron/src/main/__tests__/api-client.test.ts`
Expected: FAIL — `client.updateSvnCredential is not a function`

- [ ] **Step 3: 实现 `updateSvnCredential` 方法**

在 `code_review_electron/src/main/api-client.ts` 的 `getSvnCredential` 方法之后（约第 134 行后）添加：

```typescript
  updateSvnCredential(
    token: string,
    body: { svn_username: string; svn_password: string }
  ): Promise<{ svn_username: string; svn_password: string }> {
    return this.request('/api/v1/me/svn-credential', {
      method: 'PUT',
      headers: this.authHeaders(token),
      body: JSON.stringify(body)
    })
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run code_review_electron/src/main/__tests__/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add code_review_electron/src/main/api-client.ts code_review_electron/src/main/__tests__/api-client.test.ts
git commit -m "feat(electron): add updateSvnCredential to ApiClient"
```

---

### Task 2: 更新 `code-review-api.ts` 类型定义

**Files:**
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`

- [ ] **Step 1: 新增 `KeyLoginResult` 和 `SvnCredentialPayload` 类型，更新 `CodeReviewApi` 接口**

在 `code_review_electron/src/renderer/src/code-review-api.ts` 的 `DownloadCurrentReportResult` 接口之后（约第 66 行后）添加：

```typescript
export interface KeyLoginResult {
  needSvnBinding: boolean
}

export interface SvnCredentialPayload {
  svn_username: string
  svn_password: string
}
```

然后在 `CodeReviewApi` 接口中，将 `keyLogin` 的返回类型从 `Promise<unknown>` 改为 `Promise<KeyLoginResult>`，并在接口末尾（`checkEnvironment` 之后）添加 `bindSvnCredential` 方法：

```typescript
export interface CodeReviewApi {
  keyLogin(payload: KeyLoginRequest): Promise<KeyLoginResult>
  svnLogin(payload: SvnLoginRequest): Promise<unknown>
  saveCredentials(payload: RememberedCredentials): Promise<unknown>
  loadCredentials(): Promise<RememberedCredentials | null>
  clearCredentials(): Promise<unknown>
  loadServerConfig(): Promise<{ server_url: string }>
  listTasks(): Promise<ReviewTasksResponse>
  readTaskReport(taskId: string): Promise<string>
  executeTask(payload: ExecuteTaskRequest): Promise<ExecuteTaskResult>
  onTaskProgress(callback: (event: TaskProgressEvent) => void): () => void
  downloadCurrentReport(): Promise<DownloadCurrentReportResult>
  installCodex(): Promise<EnvironmentCheckResult>
  installSkill(): Promise<EnvironmentCheckResult>
  checkEnvironment(): Promise<EnvironmentCheckResult>
  bindSvnCredential(payload: SvnCredentialPayload): Promise<true>
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --project code_review_electron/tsconfig.json 2>&1 | head -20`
Expected: 无类型错误（或有预期的 preload 类型不匹配，会在 Task 4 修复）

- [ ] **Step 3: 提交**

```bash
git add code_review_electron/src/renderer/src/code-review-api.ts
git commit -m "feat(electron): add KeyLoginResult and SvnCredentialPayload types"
```

---

### Task 3: 修改 IPC 层 — `auth:key-login` 返回 SVN 检查结果 + 新增 `svn:bind-credential`

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 为修改后的 `auth:key-login` 和新增的 `svn:bind-credential` 写失败的测试**

在 `code_review_electron/src/main/__tests__/ipc.test.ts` 中：

首先更新 IPC channel 列表测试（第 34-48 行），在 `'task:report'` 之后添加 `'svn:bind-credential'`：

```typescript
    expect(handleMock.mock.calls.map(([channel]) => channel)).toEqual([
      'auth:key-login',
      'auth:svn-login',
      'credentials:save',
      'credentials:load',
      'credentials:clear',
      'server-config:load',
      'task:list',
      'task:report',
      'codex:install',
      'skill:install',
      'environment:check',
      'task:execute',
      'report:download-current',
      'svn:bind-credential'
    ])
```

然后更新现有的 `it('uses the submitted server URL when logging in with an access key')` 测试（第 71-125 行），因为 `auth:key-login` 返回值从 `true` 变为 `{ needSvnBinding: true }`。需要 mock `getSvnCredential` 返回 404：

```typescript
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
```

在文件末尾添加新测试：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run code_review_electron/src/main/__tests__/ipc.test.ts`
Expected: FAIL — IPC channel 列表不匹配，key-login 返回值不匹配

- [ ] **Step 3: 修改 `ipc.ts` — 修改 `auth:key-login` handler**

在 `code_review_electron/src/main/ipc.ts` 中：

1. 在文件顶部 import 区新增导入 `ApiError`：

```typescript
import {
  ApiClient,
  ApiError,
  type CreateTaskRequest,
  type KeyLoginRequest,
  type SvnLoginRequest
} from './api-client'
```

2. 替换 `auth:key-login` handler（第 68-77 行），返回类型从 `Promise<true>` 改为 `Promise<{ needSvnBinding: boolean }>`：

```typescript
  ipcMain.handle('auth:key-login', async (_event, payload: KeyLoginRequest): Promise<{ needSvnBinding: boolean }> => {
    const serverUrl = normalizeServerUrl(payload.server_url)
    const api = apiOverride ?? new ApiClient(serverUrl)
    const tokens = await api.keyLogin({
      key: payload.key
    })
    await serverConfigStore.save({ server_url: serverUrl })
    await authStore.save(tokens)

    try {
      await api.getSvnCredential(tokens.access_token)
      return { needSvnBinding: false }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return { needSvnBinding: true }
      }
      return { needSvnBinding: true }
    }
  })
```

3. 在 `auth:svn-login` handler 之后（第 89 行后）新增 `svn:bind-credential` handler：

```typescript
  ipcMain.handle('svn:bind-credential', async (_event, body: { svn_username: string; svn_password: string }): Promise<true> => {
    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const api = await createApiClient()
    await api.updateSvnCredential(tokens.access_token, body)
    return true
  })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run code_review_electron/src/main/__tests__/ipc.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add code_review_electron/src/main/ipc.ts code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "feat(electron): check SVN credential on key login, add svn:bind-credential IPC"
```

---

### Task 4: 更新 Preload 暴露 `bindSvnCredential`

**Files:**
- Modify: `code_review_electron/src/preload/index.ts`

- [ ] **Step 1: 在 preload 中暴露新方法并修正 `keyLogin` 返回类型**

在 `code_review_electron/src/preload/index.ts` 中：

1. 更新 import，新增 `KeyLoginResult` 和 `SvnCredentialPayload`：

```typescript
import type {
  EnvironmentCheckResult,
  ExecuteTaskRequest,
  ExecuteTaskResult,
  KeyLoginRequest,
  KeyLoginResult,
  DownloadCurrentReportResult,
  RememberedCredentials,
  SvnCredentialPayload,
  SvnLoginRequest,
  ReviewTasksResponse,
  TaskProgressEvent
} from '../renderer/src/code-review-api'
```

2. 修改 `keyLogin` 返回类型，并在 `installCodex` 之前添加 `bindSvnCredential`：

```typescript
  keyLogin: (payload: KeyLoginRequest): Promise<KeyLoginResult> =>
    ipcRenderer.invoke('auth:key-login', payload),
  svnLogin: (payload: SvnLoginRequest): Promise<unknown> =>
    ipcRenderer.invoke('auth:svn-login', payload),
  saveCredentials: (payload: RememberedCredentials): Promise<unknown> =>
    ipcRenderer.invoke('credentials:save', payload),
  loadCredentials: (): Promise<RememberedCredentials | null> =>
    ipcRenderer.invoke('credentials:load'),
  clearCredentials: (): Promise<unknown> => ipcRenderer.invoke('credentials:clear'),
  loadServerConfig: (): Promise<{ server_url: string }> =>
    ipcRenderer.invoke('server-config:load'),
  listTasks: (): Promise<ReviewTasksResponse> => ipcRenderer.invoke('task:list'),
  readTaskReport: (taskId: string): Promise<string> => ipcRenderer.invoke('task:report', taskId),
  executeTask: (payload: ExecuteTaskRequest): Promise<ExecuteTaskResult> =>
    ipcRenderer.invoke('task:execute', payload),
  onTaskProgress: (callback: (event: TaskProgressEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progressEvent: TaskProgressEvent): void => {
      callback(progressEvent)
    }
    ipcRenderer.on('task:progress', listener)
    return () => {
      ipcRenderer.removeListener('task:progress', listener)
    }
  },
  downloadCurrentReport: (): Promise<DownloadCurrentReportResult> =>
    ipcRenderer.invoke('report:download-current'),
  bindSvnCredential: (payload: SvnCredentialPayload): Promise<true> =>
    ipcRenderer.invoke('svn:bind-credential', payload),
  installCodex: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('codex:install'),
  installSkill: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('skill:install'),
  checkEnvironment: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('environment:check')
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --project code_review_electron/tsconfig.json 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add code_review_electron/src/preload/index.ts
git commit -m "feat(electron): expose bindSvnCredential in preload, type keyLogin return"
```

---

### Task 5: 创建 `SvnBindingDialog` 组件

**Files:**
- Create: `code_review_electron/src/renderer/src/components/SvnBindingDialog.tsx`

- [ ] **Step 1: 创建 SvnBindingDialog 组件**

```tsx
import { FormEvent, useState } from 'react'

interface SvnBindingDialogProps {
  onSubmit: (credentials: { svn_username: string; svn_password: string }) => Promise<void>
  onSkip: () => void
  isSubmitting: boolean
  error: string
}

export function SvnBindingDialog({
  onSubmit,
  onSkip,
  isSubmitting,
  error
}: SvnBindingDialogProps): React.JSX.Element {
  const [svnUsername, setSvnUsername] = useState('')
  const [svnPassword, setSvnPassword] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await onSubmit({ svn_username: svnUsername.trim(), svn_password: svnPassword })
  }

  return (
    <div className="dialog-overlay" onClick={isSubmitting ? undefined : onSkip}>
      <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
        <button
          className="dialog-close"
          type="button"
          disabled={isSubmitting}
          onClick={onSkip}
          aria-label="关闭"
        >
          ✕
        </button>

        <h2>绑定 SVN 账号</h2>
        <p className="dialog-desc">
          使用 Key 登录需要绑定 SVN 账号才能执行代码审查任务。
        </p>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field auth-field">
            <span>SVN 账号</span>
            <input
              required
              value={svnUsername}
              autoComplete="username"
              placeholder="请输入 SVN 账号"
              disabled={isSubmitting}
              onChange={(event) => setSvnUsername(event.target.value)}
            />
          </label>

          <label className="field auth-field">
            <span>SVN 密码</span>
            <input
              required
              type="password"
              value={svnPassword}
              autoComplete="current-password"
              placeholder="请输入 SVN 密码"
              disabled={isSubmitting}
              onChange={(event) => setSvnPassword(event.target.value)}
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isSubmitting}
              onClick={onSkip}
            >
              跳过
            </button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '绑定中...' : '绑定并继续'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --project code_review_electron/tsconfig.json 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add code_review_electron/src/renderer/src/components/SvnBindingDialog.tsx
git commit -m "feat(electron): add SvnBindingDialog component"
```

---

### Task 6: 新增 Dialog CSS 样式

**Files:**
- Modify: `code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 在 styles.css 末尾添加 Dialog 样式**

```css
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 62%);
  backdrop-filter: blur(6px);
}

.dialog-card {
  position: relative;
  width: min(420px, calc(100vw - 48px));
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 16px;
  padding: 36px 40px 32px;
  color: #f5f7fb;
  background: rgb(26 27 32 / 92%);
  box-shadow: 0 24px 72px rgb(0 0 0 / 48%);
}

.dialog-card h2 {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.3;
}

.dialog-desc {
  margin: 0 0 22px;
  color: rgb(245 247 251 / 52%);
  font-size: 13px;
  line-height: 1.5;
}

.dialog-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  padding: 0;
  color: rgb(245 247 251 / 48%);
  background: transparent;
  font-size: 16px;
  line-height: 32px;
  text-align: center;
}

.dialog-close:hover {
  color: #f5f7fb;
  background: rgb(255 255 255 / 10%);
}

.dialog-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 4px;
}

.dialog-actions .primary-button,
.dialog-actions .secondary-button {
  width: 100%;
}
```

- [ ] **Step 2: 提交**

```bash
git add code_review_electron/src/renderer/src/styles.css
git commit -m "feat(electron): add dialog overlay and card styles for SvnBindingDialog"
```

---

### Task 7: 在 `App.tsx` 中集成 SVN 绑定流程

**Files:**
- Modify: `code_review_electron/src/renderer/src/App.tsx`

- [ ] **Step 1: 修改 `App.tsx` — 新增导入和状态**

1. 在 import 区新增 `SvnBindingDialog`：

```typescript
import { LoginPage } from './components/LoginPage'
import { SvnBindingDialog } from './components/SvnBindingDialog'
import { TaskPage } from './components/TaskPage'
```

2. 在组件内部，`isInstallingCodex` 状态之后，新增三个状态：

```typescript
  const [needSvnBinding, setNeedSvnBinding] = useState(false)
  const [bindingError, setBindingError] = useState('')
  const [isBinding, setIsBinding] = useState(false)
```

- [ ] **Step 2: 修改 `keyLogin` 回调处理 SVN 检查结果**

将 `authActions` 中的 `keyLogin` 方法从：

```typescript
      async keyLogin(payload: KeyLoginRequest): Promise<void> {
        await window.codeReview.keyLogin(payload)
        setSession({ displayName: 'Key 用户' })
        await checkEnvironment()
      },
```

改为：

```typescript
      async keyLogin(payload: KeyLoginRequest): Promise<void> {
        const result = await window.codeReview.keyLogin(payload)
        setSession({ displayName: 'Key 用户' })
        if (result.needSvnBinding) {
          setNeedSvnBinding(true)
        }
        await checkEnvironment()
      },
```

- [ ] **Step 3: 新增 `bindSvnCredential` 回调**

在 `installSkill` 的 `useCallback` 之后添加：

```typescript
  const bindSvnCredential = useCallback(
    async (credentials: { svn_username: string; svn_password: string }): Promise<void> => {
      setBindingError('')
      setIsBinding(true)
      try {
        await window.codeReview.bindSvnCredential(credentials)
        setNeedSvnBinding(false)
      } catch (error) {
        setBindingError(error instanceof Error ? error.message : 'SVN 绑定失败，请重试。')
      } finally {
        setIsBinding(false)
      }
    },
    []
  )
```

- [ ] **Step 4: 在渲染区添加 SvnBindingDialog**

将 `App` 函数的 return 部分（第 81-93 行）从：

```tsx
  return (
    <main className="app-shell">
      <TaskPage
        environment={environment}
        isCheckingEnvironment={isCheckingEnvironment}
        isInstallingCodex={isInstallingCodex}
        svnUsername={session.displayName}
        onRefreshEnvironment={checkEnvironment}
        onInstallCodex={installCodex}
        onInstallSkill={installSkill}
      />
    </main>
  )
```

改为：

```tsx
  return (
    <main className="app-shell">
      <TaskPage
        environment={environment}
        isCheckingEnvironment={isCheckingEnvironment}
        isInstallingCodex={isInstallingCodex}
        svnUsername={session.displayName}
        onRefreshEnvironment={checkEnvironment}
        onInstallCodex={installCodex}
        onInstallSkill={installSkill}
      />
      {needSvnBinding && (
        <SvnBindingDialog
          onSubmit={bindSvnCredential}
          onSkip={() => setNeedSvnBinding(false)}
          isSubmitting={isBinding}
          error={bindingError}
        />
      )}
    </main>
  )
```

- [ ] **Step 5: 验证 TypeScript 编译**

Run: `npx tsc --noEmit --project code_review_electron/tsconfig.json 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add code_review_electron/src/renderer/src/App.tsx
git commit -m "feat(electron): integrate SvnBindingDialog into App login flow"
```

---

### Task 8: 全量测试验证

**Files:** 无改动

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run code_review_electron/`
Expected: 所有测试 PASS

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit --project code_review_electron/tsconfig.json`
Expected: 无类型错误

- [ ] **Step 3: 确认最终 commit 历史**

Run: `git log --oneline -6`
Expected: 看到 6 个按顺序提交的 commit
