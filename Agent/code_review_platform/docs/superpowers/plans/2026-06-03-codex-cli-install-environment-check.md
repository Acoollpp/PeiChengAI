# Codex CLI 自动安装与环境检查分阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Electron 客户端增加通过已有 npm 安装 Codex CLI 的入口，并让本地环境检查先检查 Codex，Codex 缺失时不检查或展示 SVN 与 Skill。

**Architecture:** 主进程新增 Codex CLI 安装器，复用现有扩展 PATH 与命令检查能力；环境检查改为分阶段执行，Codex 就绪后才检查 SVN 与 Skill。渲染层新增 Codex 安装动作、检查/安装 loading 状态与只展示 Codex 缺失卡片的分支，现有 `codex exec` 审查执行链保持不变。

**Tech Stack:** Electron main/preload IPC、React 19、TypeScript、Vitest、Node `child_process.spawn`、CSS 动画。

---

## 文件结构

- 修改 `code_review_electron/src/main/environment-checker.ts`
  - 导出命令查找能力，支持安装器复用。
  - 将 `checkEnvironment()` 调整为 Codex 优先的分阶段检查。
  - `EnvironmentCheckResult` 增加 `codexError?: string`。
- 创建 `code_review_electron/src/main/codex-cli-installer.ts`
  - 查找 npm。
  - 执行 `npm install -g @openai/codex`。
  - 安装后验证 `codex --version`。
  - 返回带 `codexError` 的 `EnvironmentCheckResult`。
- 修改 `code_review_electron/src/main/ipc.ts`
  - 依赖注入新增 `installCodexCli`。
  - 注册 `codex:install`。
  - `environment:check` 在 Codex 缺失时跳过 Skill 同步。
- 修改 `code_review_electron/src/preload/index.ts`
  - 暴露 `installCodex()`。
- 修改 `code_review_electron/src/shared/types.ts`
  - 主共享类型保持 `EnvironmentStatus` 不变。
- 修改 `code_review_electron/src/renderer/src/code-review-api.ts`
  - `EnvironmentCheckResult` 增加 `codexError?: string`。
  - `CodeReviewApi` 增加 `installCodex()`。
- 修改 `code_review_electron/src/renderer/src/App.tsx`
  - 新增 `isCheckingEnvironment`、`isInstallingCodex` 状态。
  - 新增 `installCodex` 回调。
- 修改 `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - 向 `EnvironmentStatus` 传入 Codex 安装和 loading props。
- 修改 `code_review_electron/src/renderer/src/components/EnvironmentStatus.tsx`
  - Codex 缺失时只渲染 Codex 卡片。
  - 增加检查中、Codex 安装中、Skill 安装中 spinner。
- 修改 `code_review_electron/src/renderer/src/styles.css`
  - 增加 spinner 样式。
  - 增加禁用按钮视觉状态。
- 修改 `code_review_electron/src/main/__tests__/environment-checker.test.ts`
  - 覆盖分阶段检查与命令查找。
- 创建 `code_review_electron/src/main/__tests__/codex-cli-installer.test.ts`
  - 覆盖 npm 缺失、安装失败、安装后未检测到、安装成功。
- 修改 `code_review_electron/src/main/__tests__/ipc.test.ts`
  - 覆盖 `codex:install` 注册和环境检查跳过 Skill 同步。

---

### Task 1: 环境检查分阶段与命令查找复用

**Files:**
- Modify: `code_review_electron/src/main/environment-checker.ts`
- Test: `code_review_electron/src/main/__tests__/environment-checker.test.ts`

- [ ] **Step 1: 写失败测试，覆盖 Codex 缺失时不检查 SVN 和 Skill**

在 `code_review_electron/src/main/__tests__/environment-checker.test.ts` 追加以下测试。测试通过依赖注入避免真实执行本机命令：

```ts
import type { CommandResult } from '../environment-checker'

describe('checkEnvironment', () => {
  it('returns missing_codex without checking SVN or Skill when Codex is unavailable', async () => {
    const findVersionCommand = vi.fn(
      async (command: string): Promise<CommandResult> =>
        command === 'codex' ? { ok: false } : { ok: true, output: '1.14.0', path: 'svn' }
    )
    const checkRuntimeWritable = vi.fn(async () => true)
    const checkSkillPackageReady = vi.fn(async () => true)
    const getRuntimePaths = vi.fn(async () => ({
      runtimeRoot: '/tmp/code-review-runtime',
      skillPackagesDir: '/tmp/code-review-runtime/skill-packages',
      skillManifestPath: '/tmp/code-review-runtime/skill-packages/manifest.json',
      workspacesDir: '/tmp/code-review-runtime/workspaces',
      workspaceForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}`,
      reportPathForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/report.md`
    }))
    const { checkEnvironment } = await import('../environment-checker')

    await expect(
      checkEnvironment({
        findVersionCommand,
        checkRuntimeWritable,
        checkSkillPackageReady,
        getRuntimePaths
      })
    ).resolves.toEqual({
      status: 'missing_codex'
    })

    expect(findVersionCommand).toHaveBeenCalledTimes(1)
    expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
    expect(checkRuntimeWritable).toHaveBeenCalledWith('/tmp/code-review-runtime')
    expect(checkSkillPackageReady).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/environment-checker.test.ts
```

Expected: FAIL，原因是 `CommandResult` 未导出，`checkEnvironment()` 还不接受依赖注入。

- [ ] **Step 3: 导出命令结果类型与依赖注入接口**

修改 `code_review_electron/src/main/environment-checker.ts`。将 `CommandResult` 导出，并增加依赖接口：

```ts
export interface CommandResult {
  ok: boolean
  output?: string
  path?: string
}

export interface EnvironmentCheckDependencies {
  getRuntimePaths?: typeof getRuntimePaths
  findVersionCommand?: typeof findVersionCommand
  checkRuntimeWritable?: typeof checkRuntimeWritable
  checkSkillPackageReady?: typeof checkSkillPackageReady
}
```

将 `findVersionCommand` 从内部常量改为导出：

```ts
export const findVersionCommand = async (
  command: string,
  args: string[]
): Promise<CommandResult> => {
  for (const candidate of commandCandidates[command] ?? [command]) {
    const result = await runVersionCommand(candidate, args)
    if (result.ok) {
      return result
    }
  }

  return { ok: false }
}
```

- [ ] **Step 4: 实现分阶段 `checkEnvironment()`**

将 `checkEnvironment` 改为以下结构：

```ts
export const checkEnvironment = async (
  dependencies: EnvironmentCheckDependencies = {}
): Promise<EnvironmentCheckResult> => {
  const loadRuntimePaths = dependencies.getRuntimePaths ?? getRuntimePaths
  const findCommand = dependencies.findVersionCommand ?? findVersionCommand
  const runtimeWritableCheck = dependencies.checkRuntimeWritable ?? checkRuntimeWritable
  const skillPackageReadyCheck = dependencies.checkSkillPackageReady ?? checkSkillPackageReady

  try {
    const runtimePaths = await loadRuntimePaths()
    const [codexResult, runtimeWritable] = await Promise.all([
      findCommand('codex', ['--version']),
      runtimeWritableCheck(runtimePaths.runtimeRoot)
    ])

    if (!runtimeWritable) {
      return {
        status: 'failed',
        codexVersion: codexResult.output,
        codexPath: codexResult.path,
        skillError: `客户端运行目录不可写：${runtimePaths.runtimeRoot}`
      }
    }

    if (!codexResult.ok) {
      return {
        status: 'missing_codex'
      }
    }

    const [svnResult, skillOk] = await Promise.all([
      findCommand('svn', ['--version', '--quiet']),
      skillPackageReadyCheck(runtimePaths.skillManifestPath)
    ])

    return {
      status: classifyEnvironment({
        codexOk: codexResult.ok,
        svnOk: svnResult.ok,
        skillOk
      }),
      codexVersion: codexResult.output,
      svnVersion: svnResult.output,
      codexPath: codexResult.path,
      svnPath: svnResult.path
    }
  } catch (error) {
    return {
      status: 'failed',
      skillError: error instanceof Error ? error.message : String(error)
    }
  }
}
```

- [ ] **Step 5: 写测试，覆盖 Codex 就绪后继续检查 SVN 和 Skill**

在同一测试文件追加：

```ts
it('checks SVN and Skill after Codex is available', async () => {
  const findVersionCommand = vi.fn(
    async (command: string): Promise<CommandResult> =>
      command === 'codex'
        ? { ok: true, output: 'codex-cli 0.130.0', path: 'codex' }
        : { ok: false }
  )
  const checkRuntimeWritable = vi.fn(async () => true)
  const checkSkillPackageReady = vi.fn(async () => true)
  const getRuntimePaths = vi.fn(async () => ({
    runtimeRoot: '/tmp/code-review-runtime',
    skillPackagesDir: '/tmp/code-review-runtime/skill-packages',
    skillManifestPath: '/tmp/code-review-runtime/skill-packages/manifest.json',
    workspacesDir: '/tmp/code-review-runtime/workspaces',
    workspaceForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}`,
    reportPathForTask: (taskId: string) => `/tmp/code-review-runtime/workspaces/${taskId}/report.md`
  }))
  const { checkEnvironment } = await import('../environment-checker')

  await expect(
    checkEnvironment({
      findVersionCommand,
      checkRuntimeWritable,
      checkSkillPackageReady,
      getRuntimePaths
    })
  ).resolves.toEqual({
    status: 'missing_svn',
    codexVersion: 'codex-cli 0.130.0',
    codexPath: 'codex',
    svnVersion: undefined,
    svnPath: undefined
  })

  expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
  expect(findVersionCommand).toHaveBeenCalledWith('svn', ['--version', '--quiet'])
  expect(checkSkillPackageReady).toHaveBeenCalledWith(
    '/tmp/code-review-runtime/skill-packages/manifest.json'
  )
})
```

- [ ] **Step 6: 运行环境检查测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/environment-checker.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交环境检查改动**

```bash
git add code_review_electron/src/main/environment-checker.ts code_review_electron/src/main/__tests__/environment-checker.test.ts
git commit -m "feat: 分阶段检查本地环境"
```

---

### Task 2: Codex CLI 安装器

**Files:**
- Create: `code_review_electron/src/main/codex-cli-installer.ts`
- Create: `code_review_electron/src/main/__tests__/codex-cli-installer.test.ts`
- Modify: `code_review_electron/src/main/environment-checker.ts`

- [ ] **Step 1: 写失败测试，覆盖 npm 不存在**

创建 `code_review_electron/src/main/__tests__/codex-cli-installer.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'

import type { CommandResult } from '../environment-checker'

describe('installCodexCli', () => {
  it('returns a Codex error when npm is unavailable', async () => {
    const findVersionCommand = vi.fn(async (): Promise<CommandResult> => ({ ok: false }))
    const runInstallCommand = vi.fn()
    const checkEnvironment = vi.fn()
    const { installCodexCli } = await import('../codex-cli-installer')

    await expect(
      installCodexCli({
        findVersionCommand,
        runInstallCommand,
        checkEnvironment
      })
    ).resolves.toEqual({
      status: 'missing_codex',
      codexError: '未检测到 npm，请先安装 Node.js 后重试或联系管理员。'
    })

    expect(findVersionCommand).toHaveBeenCalledWith('npm', ['--version'])
    expect(runInstallCommand).not.toHaveBeenCalled()
    expect(checkEnvironment).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-cli-installer.test.ts
```

Expected: FAIL，原因是 `codex-cli-installer.ts` 不存在。

- [ ] **Step 3: 扩展 npm 命令候选**

在 `code_review_electron/src/main/environment-checker.ts` 的 `commandCandidates` 中加入 npm：

```ts
const commandCandidates: Record<string, string[]> = {
  codex: [
    'codex',
    'codex.cmd',
    join(process.env.HOME ?? '', '.local/bin/codex'),
    '/Applications/Codex.app/Contents/Resources/codex'
  ],
  npm: ['npm', 'npm.cmd'],
  svn: ['svn', '/opt/homebrew/bin/svn', '/usr/local/bin/svn', '/usr/bin/svn']
}
```

- [ ] **Step 4: 创建安装器最小实现**

创建 `code_review_electron/src/main/codex-cli-installer.ts`：

```ts
import { spawn } from 'node:child_process'

import {
  buildVersionCommandOptions,
  checkEnvironment,
  findVersionCommand,
  type CommandResult,
  type EnvironmentCheckResult
} from './environment-checker'

export interface InstallCommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export interface InstallCodexCliDependencies {
  findVersionCommand?: (command: string, args: string[]) => Promise<CommandResult>
  runInstallCommand?: (command: string, args: string[]) => Promise<InstallCommandResult>
  checkEnvironment?: typeof checkEnvironment
}

export const MissingNpmMessage = '未检测到 npm，请先安装 Node.js 后重试或联系管理员。'
export const CodexNotDetectedAfterInstallMessage =
  'Codex CLI 已安装但当前客户端暂未检测到，请重启客户端或检查 npm 全局路径。'

export const installCodexCli = async (
  dependencies: InstallCodexCliDependencies = {}
): Promise<EnvironmentCheckResult> => {
  const findCommand = dependencies.findVersionCommand ?? findVersionCommand
  const runInstall = dependencies.runInstallCommand ?? runInstallCommand
  const refreshEnvironment = dependencies.checkEnvironment ?? checkEnvironment

  const npmResult = await findCommand('npm', ['--version'])
  if (!npmResult.ok) {
    return {
      status: 'missing_codex',
      codexError: MissingNpmMessage
    }
  }

  const installResult = await runInstall(npmResult.path ?? 'npm', [
    'install',
    '-g',
    '@openai/codex'
  ])

  if (!installResult.ok) {
    return {
      status: 'missing_codex',
      codexError: `通过 npm 安装 Codex CLI 失败：${summarizeInstallError(installResult)}`
    }
  }

  const codexResult = await findCommand('codex', ['--version'])
  if (!codexResult.ok) {
    return {
      status: 'missing_codex',
      codexError: CodexNotDetectedAfterInstallMessage
    }
  }

  return refreshEnvironment()
}

export const summarizeInstallError = ({ stdout, stderr }: InstallCommandResult): string => {
  const output = `${stderr}\n${stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n')

  return output || 'npm 未返回错误详情'
}

export const runInstallCommand = (
  command: string,
  args: string[]
): Promise<InstallCommandResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, buildVersionCommandOptions())
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const settle = (result: InstallCommandResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => {
      settle({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: error.message
      })
    })
    child.on('close', (code) => {
      settle({
        ok: code === 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      })
    })
  })
```

- [ ] **Step 5: 写安装失败和安装后未检测到测试**

在 `codex-cli-installer.test.ts` 追加：

```ts
it('returns npm output when installing Codex CLI fails', async () => {
  const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
    command === 'npm' ? { ok: true, output: '10.0.0', path: 'npm' } : { ok: false }
  )
  const runInstallCommand = vi.fn(async () => ({
    ok: false,
    stdout: '',
    stderr: 'npm ERR! code EACCES\nnpm ERR! permission denied'
  }))
  const checkEnvironment = vi.fn()
  const { installCodexCli } = await import('../codex-cli-installer')

  await expect(
    installCodexCli({
      findVersionCommand,
      runInstallCommand,
      checkEnvironment
    })
  ).resolves.toEqual({
    status: 'missing_codex',
    codexError: '通过 npm 安装 Codex CLI 失败：npm ERR! code EACCES\nnpm ERR! permission denied'
  })

  expect(runInstallCommand).toHaveBeenCalledWith('npm', ['install', '-g', '@openai/codex'])
  expect(checkEnvironment).not.toHaveBeenCalled()
})

it('returns a restart hint when install succeeds but Codex is not detected', async () => {
  const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
    command === 'npm' ? { ok: true, output: '10.0.0', path: 'npm' } : { ok: false }
  )
  const runInstallCommand = vi.fn(async () => ({
    ok: true,
    stdout: 'added 1 package',
    stderr: ''
  }))
  const checkEnvironment = vi.fn()
  const { installCodexCli, CodexNotDetectedAfterInstallMessage } = await import(
    '../codex-cli-installer'
  )

  await expect(
    installCodexCli({
      findVersionCommand,
      runInstallCommand,
      checkEnvironment
    })
  ).resolves.toEqual({
    status: 'missing_codex',
    codexError: CodexNotDetectedAfterInstallMessage
  })

  expect(findVersionCommand).toHaveBeenCalledWith('codex', ['--version'])
  expect(checkEnvironment).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: 写安装成功测试**

在同一文件追加：

```ts
it('refreshes the environment after Codex CLI is installed and detected', async () => {
  const findVersionCommand = vi.fn(async (command: string): Promise<CommandResult> =>
    command === 'npm'
      ? { ok: true, output: '10.0.0', path: 'npm' }
      : { ok: true, output: 'codex-cli 0.130.0', path: 'codex' }
  )
  const runInstallCommand = vi.fn(async () => ({
    ok: true,
    stdout: 'added 1 package',
    stderr: ''
  }))
  const checkEnvironment = vi.fn(async () => ({
    status: 'missing_svn' as const,
    codexVersion: 'codex-cli 0.130.0',
    codexPath: 'codex'
  }))
  const { installCodexCli } = await import('../codex-cli-installer')

  await expect(
    installCodexCli({
      findVersionCommand,
      runInstallCommand,
      checkEnvironment
    })
  ).resolves.toEqual({
    status: 'missing_svn',
    codexVersion: 'codex-cli 0.130.0',
    codexPath: 'codex'
  })

  expect(checkEnvironment).toHaveBeenCalled()
})
```

- [ ] **Step 7: 运行安装器测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/codex-cli-installer.test.ts src/main/__tests__/environment-checker.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交安装器改动**

```bash
git add code_review_electron/src/main/codex-cli-installer.ts code_review_electron/src/main/environment-checker.ts code_review_electron/src/main/__tests__/codex-cli-installer.test.ts
git commit -m "feat: 增加 Codex CLI npm 安装器"
```

---

### Task 3: IPC、preload 和共享类型接入

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: 写失败测试，覆盖新增 IPC channel**

修改 `ipc.test.ts` 中 `registers only the renderer-facing IPC channels` 的期望列表，加入 `codex:install`，位置放在 `skill:install` 之前：

```ts
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
  'report:download-current'
])
```

- [ ] **Step 2: 写失败测试，覆盖 `codex:install` 调用**

在 `ipc.test.ts` 追加：

```ts
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

  const installHandler = handleMock.mock.calls.find(([channel]) => channel === 'codex:install')?.[1]

  await expect(installHandler()).resolves.toEqual({
    status: 'missing_svn',
    codexVersion: 'codex-cli 0.130.0',
    codexPath: 'codex'
  })
  expect(installCodexCli).toHaveBeenCalled()
})
```

- [ ] **Step 3: 写失败测试，覆盖 Codex 缺失时跳过 Skill 同步**

在 `ipc.test.ts` 追加：

```ts
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
```

- [ ] **Step 4: 运行 IPC 测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: FAIL，原因是 `codex:install` 未注册，依赖类型没有 `installCodexCli`，环境检查仍先同步 Skill。

- [ ] **Step 5: 修改 `ipc.ts` 接入安装器**

在 `code_review_electron/src/main/ipc.ts` 顶部导入：

```ts
import { installCodexCli } from './codex-cli-installer'
```

在 `IpcHandlerDependencies` 增加：

```ts
installCodexCli?: () => Promise<EnvironmentCheckResult>
```

在 `registerIpcHandlers` 内定义：

```ts
const installLocalCodexCli = dependencies.installCodexCli ?? installCodexCli
```

在 `task:report` 后、`skill:install` 前注册：

```ts
ipcMain.handle('codex:install', (): Promise<EnvironmentCheckResult> => installLocalCodexCli())
```

- [ ] **Step 6: 修改 `environment:check` 跳过 Skill 同步**

将 `environment:check` handler 改成先执行本地检查：

```ts
ipcMain.handle('environment:check', async (): Promise<EnvironmentCheckResult> => {
  const firstPass = await checkLocalEnvironment()

  if (firstPass.status === 'missing_codex' || firstPass.status === 'failed') {
    return firstPass
  }

  const skillError = await syncSkillForCurrentUser(authStore, syncSkill)
  const result = await checkLocalEnvironment()

  if (skillError) {
    return {
      ...result,
      skillError
    }
  }

  return result
})
```

保留 `skill:install` 的现有行为不变，因为用户显式点击安装 Skill 时仍应尝试同步。

- [ ] **Step 7: 修改 preload 暴露安装方法**

在 `code_review_electron/src/preload/index.ts` 中加入：

```ts
installCodex: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('codex:install'),
```

放在 `installSkill` 前后均可，但保持 API 顺序和 `code-review-api.ts` 一致。

- [ ] **Step 8: 修改渲染 API 类型**

在 `code_review_electron/src/renderer/src/code-review-api.ts` 的 `EnvironmentCheckResult` 增加：

```ts
codexError?: string
```

在 `CodeReviewApi` 增加：

```ts
installCodex(): Promise<EnvironmentCheckResult>
```

- [ ] **Step 9: 运行 IPC 与类型检查**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/ipc.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 10: 提交 IPC 接入改动**

```bash
git add code_review_electron/src/main/ipc.ts code_review_electron/src/preload/index.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "feat: 接入 Codex CLI 安装 IPC"
```

---

### Task 4: 渲染层安装交互与分阶段展示

**Files:**
- Modify: `code_review_electron/src/renderer/src/App.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/EnvironmentStatus.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

- [ ] **Step 1: 更新 `EnvironmentStatus` props**

在 `EnvironmentStatus.tsx` 中把 props 改为：

```ts
type EnvironmentStatusProps = {
  result: EnvironmentCheckResult | null
  isChecking: boolean
  isInstallingCodex: boolean
  onRefresh: () => Promise<void>
  onInstallCodex: () => Promise<void>
  onInstallSkill: () => Promise<void>
}
```

组件签名同步解构：

```ts
export function EnvironmentStatus({
  result,
  isChecking,
  isInstallingCodex,
  onRefresh,
  onInstallCodex,
  onInstallSkill
}: EnvironmentStatusProps): React.JSX.Element {
```

- [ ] **Step 2: 在 `App.tsx` 增加检查和安装状态**

在 `App()` 内已有 environment state 后加入：

```ts
const [isCheckingEnvironment, setIsCheckingEnvironment] = useState(false)
const [isInstallingCodex, setIsInstallingCodex] = useState(false)
```

将 `checkEnvironment` 改为：

```ts
const checkEnvironment = useCallback(async (): Promise<void> => {
  setIsCheckingEnvironment(true)
  try {
    setEnvironment(await window.codeReview.checkEnvironment())
  } catch {
    setEnvironment(fallbackEnvironment)
  } finally {
    setIsCheckingEnvironment(false)
  }
}, [])
```

新增 `installCodex`：

```ts
const installCodex = useCallback(async (): Promise<void> => {
  setIsInstallingCodex(true)
  try {
    setEnvironment(await window.codeReview.installCodex())
  } catch {
    setEnvironment({
      status: 'missing_codex',
      codexError: 'Codex 安装失败'
    })
  } finally {
    setIsInstallingCodex(false)
  }
}, [])
```

传给 `TaskPage`：

```tsx
<TaskPage
  environment={environment}
  isCheckingEnvironment={isCheckingEnvironment}
  isInstallingCodex={isInstallingCodex}
  svnUsername={session.displayName}
  onRefreshEnvironment={checkEnvironment}
  onInstallCodex={installCodex}
  onInstallSkill={installSkill}
/>
```

- [ ] **Step 3: 更新 `TaskPage` props 并透传**

在 `TaskPage.tsx` props 中加入：

```ts
isCheckingEnvironment: boolean
isInstallingCodex: boolean
onInstallCodex: () => Promise<void>
```

组件参数解构加入这些字段。

调用 `EnvironmentStatus` 时改为：

```tsx
<EnvironmentStatus
  result={environment}
  isChecking={isCheckingEnvironment}
  isInstallingCodex={isInstallingCodex}
  onRefresh={onRefreshEnvironment}
  onInstallCodex={onInstallCodex}
  onInstallSkill={onInstallSkill}
/>
```

- [ ] **Step 4: Codex 缺失时只渲染 Codex 卡片**

在 `EnvironmentStatus.tsx` 中新增派生状态：

```ts
const codexMissing = status === 'missing_codex'
const showDownstreamDependencies = result !== null && !codexMissing
```

将 `items` 由固定三项改为先构建 Codex，再按状态追加：

```ts
const items: DependencyItem[] = [
  {
    key: 'codex',
    name: 'Codex CLI',
    ok: Boolean(result?.codexVersion),
    version: result?.codexVersion,
    path: result?.codexPath,
    missingText: result?.codexError ?? 'Codex 缺失，请点击安装',
    actionText: isInstallingCodex ? '安装中...' : '安装 Codex'
  }
]

if (showDownstreamDependencies) {
  items.push(
    {
      key: 'svn',
      name: 'SVN CLI',
      ok: Boolean(result?.svnVersion),
      version: result?.svnVersion,
      path: result?.svnPath,
      missingText: 'SVN 缺失，请联系管理员安装',
      actionText: '联系管理员'
    },
    {
      key: 'skill',
      name: '代码审查 Skill',
      ok: result ? result.status !== 'missing_skill' && !result.skillError : false,
      path: '通用-代码变更审查/SKILL.md',
      missingText: result?.skillError
        ? `Skill 同步失败：${result.skillError}`
        : 'Skill 缺失，请点击安装',
      actionText: installingSkill ? '安装中...' : '安装'
    }
  )
}
```

环境详情文案改为：

```tsx
<p className="environment-detail">
  {codexMissing
    ? `Codex ${result?.codexVersion ?? '-'}`
    : `Codex ${result?.codexVersion ?? '-'} · SVN ${result?.svnVersion ?? '-'}`}
</p>
```

- [ ] **Step 5: 增加按钮点击逻辑和禁用状态**

在 `EnvironmentStatus.tsx` 增加：

```ts
const busy = isChecking || isInstallingCodex || installingSkill
```

刷新按钮：

```tsx
<button className="ghost-button" type="button" disabled={busy} onClick={() => void onRefresh()}>
  {isChecking && <span className="button-spinner" aria-hidden="true" />}
  {isChecking ? '检查中...' : '重新检查'}
</button>
```

依赖卡片按钮点击逻辑：

```tsx
onClick={() => {
  if (item.key === 'codex') {
    void onInstallCodex()
    return
  }
  if (item.key === 'skill') {
    void handleInstallSkill()
  }
}}
```

按钮禁用逻辑：

```tsx
disabled={busy || item.key === 'svn'}
```

SVN 按钮当前文案是“联系管理员”，没有实际动作。实现时保留按钮但禁用，避免用户误以为客户端能自动安装 SVN。

按钮内容：

```tsx
{((item.key === 'codex' && isInstallingCodex) ||
  (item.key === 'skill' && installingSkill)) && (
  <span className="button-spinner" aria-hidden="true" />
)}
{item.actionText}
```

- [ ] **Step 6: 添加 CSS spinner 和禁用样式**

在 `styles.css` 的按钮样式附近加入：

```css
.ghost-button:disabled,
.install-button:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.button-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  margin-right: 7px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  vertical-align: -2px;
  animation: button-spinner-spin 0.75s linear infinite;
}

@keyframes button-spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

.ghost-button,
.install-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 7: 运行类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 8: 提交渲染层改动**

```bash
git add code_review_electron/src/renderer/src/App.tsx code_review_electron/src/renderer/src/components/TaskPage.tsx code_review_electron/src/renderer/src/components/EnvironmentStatus.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "feat: 增加 Codex 安装交互"
```

---

### Task 5: 端到端验证与收尾

**Files:**
- No planned file edits in this task.
- If verification fails, return to the task that introduced the failing behavior, fix the exact implementation file and test listed in that task, then rerun Task 5 from Step 1.

- [ ] **Step 1: 运行主进程相关测试**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/environment-checker.test.ts src/main/__tests__/codex-cli-installer.test.ts src/main/__tests__/ipc.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行全量 Electron 测试**

Run:

```bash
cd code_review_electron
npm test
```

Expected: PASS。

- [ ] **Step 3: 运行类型检查**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS。

- [ ] **Step 4: 启动客户端做手工验证**

Run:

```bash
cd code_review_electron
npm run dev
```

Expected: Electron 客户端启动。

手工检查：

1. Codex 已安装机器上，环境状态继续展示 Codex 与 SVN 信息，不影响任务创建入口。
2. 临时模拟 Codex 缺失时，只展示 Codex 卡片。可通过在开发环境中临时调整 `commandCandidates.codex` 或注入 mock 验证，验证后撤销临时代码。
3. 点击“重新检查”时显示“检查中...”和 spinner。
4. 点击“安装 Codex”时显示“安装中...”和 spinner，按钮禁用。
5. 安装失败文案不暗示客户端会安装 Node/npm。

- [ ] **Step 5: 检查 git 状态**

Run:

```bash
git status --short
```

Expected: 只看到本任务相关改动；用户原有未跟踪文件如果仍存在，保持不处理。

- [ ] **Step 6: 最终提交或确认无需额外提交**

如果 Task 5 修复了验证问题，提交：

```bash
git add code_review_electron
git commit -m "fix: 完善 Codex 安装验证"
```

如果没有新增改动，不提交。

---

## 自查结果

1. Spec 覆盖：计划覆盖了 Codex 安装入口、只检测 npm 不安装 Node/npm、环境检查分阶段、spinner、IPC、类型、兼容现有 `codex exec` 调用和测试计划。
2. 占位符扫描：无占位描述或未决实现项。
3. 类型一致性：`codexError`、`installCodex()`、`installCodexCli()`、`findVersionCommand()` 在任务中定义后再使用，命名保持一致。
