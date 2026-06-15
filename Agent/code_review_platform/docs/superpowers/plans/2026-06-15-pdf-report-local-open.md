# PDF报告本地优先打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“查看PDF报告”优先打开当前客户端 workspace 中已有的同名 PDF，只在本地缺失时从服务端下载，并保持下载文件名与原报告名一致。

**Architecture:** 渲染进程把当前任务的 `pdf_report_name` 传给主进程；主进程在 `report:open-pdf` IPC 中先校验显式本地路径，再按 `runtimePaths.workspaceForTask(taskId)` 和 `pdf_report_name` 推导本地 PDF 路径，最后才下载服务端 PDF。保存和打开统一由主进程负责，UI 文案不变。

**Tech Stack:** Electron IPC、React、TypeScript、Vitest、Node `fs/promises`、Electron `shell.showItemInFolder`。

---

## File Structure

- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
  - 为 `OpenPdfReportRequest` 增加可选 `pdfReportName?: string`。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
  - 保存当前选中任务的 `pdf_report_name`，调用 `openPdfReport` 时传给主进程。
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
  - 验证历史任务点击“查看PDF报告”时传入 `pdfReportName`，按钮文案保持不变。
- Modify: `code_review_electron/src/main/ipc.ts`
  - 在 `report:open-pdf` 中增加本地文件存在性检查、workspace 同名文件优先逻辑、按 `pdfReportName` 保存远程下载结果。
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
  - 覆盖本地路径存在、本地路径缺失后 workspace 命中、远程下载按原文件名保存、缺失文件名 fallback。
- Modify: `code_review_electron/src/preload/index.test.ts`
  - 验证 preload 透传 `pdfReportName`。

## Task 1: 主进程 PDF 打开策略

**Files:**
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Add these test cases to `code_review_electron/src/main/__tests__/ipc.test.ts` near the existing `report:open-pdf` tests:

```ts
  it('opens a workspace PDF by original report name before downloading historical PDF', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-runtime-pdf-local-first-'))
    tempDirs.push(runtimeRoot)
    const existingPdfPath = join(
      runtimeRoot,
      'workspaces',
      'task-remote',
      'r3_r4审查报告_20260615_143000.pdf'
    )
    await mkdir(dirname(existingPdfPath), { recursive: true })
    await writeFile(existingPdfPath, '%PDF-1.4\nlocal\n')
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
      openPdfHandler(
        {},
        {
          taskId: 'task-remote',
          pdfReportName: 'r3_r4审查报告_20260615_143000.pdf'
        }
      )
    ).resolves.toEqual({
      status: 'ready',
      pdfPath: existingPdfPath
    })
    expect(api.downloadPdfReport).not.toHaveBeenCalled()
    expect(showItemInFolderMock).toHaveBeenCalledWith(existingPdfPath)
  })

  it('falls back to server download when explicit local PDF path no longer exists', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-runtime-pdf-missing-local-'))
    tempDirs.push(runtimeRoot)
    const missingLocalPath = join(runtimeRoot, 'workspaces', 'task-remote', 'missing.pdf')
    const downloadedPdfPath = join(
      runtimeRoot,
      'workspaces',
      'task-remote',
      'r3_r4审查报告_20260615_143000.pdf'
    )
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
      openPdfHandler(
        {},
        {
          taskId: 'task-remote',
          localPdfPath: missingLocalPath,
          pdfReportName: 'r3_r4审查报告_20260615_143000.pdf'
        }
      )
    ).resolves.toEqual({
      status: 'ready',
      pdfPath: downloadedPdfPath
    })
    await expect(readFile(downloadedPdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70]))
    expect(api.downloadPdfReport).toHaveBeenCalledWith('token-123', 'task-remote')
    expect(showItemInFolderMock).toHaveBeenCalledWith(downloadedPdfPath)
  })
```

Update the existing `downloads a historical PDF report into the local runtime workspace before opening it` test so the payload includes `pdfReportName` and the expected path uses that name:

```ts
    const pdfPath = join(
      runtimeRoot,
      'workspaces',
      'task-remote',
      'r3_r4审查报告_20260615_143000.pdf'
    )

    await expect(
      openPdfHandler(
        {},
        {
          taskId: 'task-remote',
          pdfReportName: 'r3_r4审查报告_20260615_143000.pdf'
        }
      )
    ).resolves.toEqual({
      status: 'ready',
      pdfPath
    })
```

Add one fallback assertion in the same test file:

```ts
  it('uses default PDF report name when remote PDF name is missing', async () => {
    const api = {
      downloadPdfReport: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
    }
    const authStore = {
      load: vi.fn(async () => ({ access_token: 'token-123', refresh_token: 'refresh-token' })),
      save: vi.fn()
    }
    const runtimeRoot = await mkdtemp(join(tmpdir(), 'ipc-runtime-pdf-default-name-'))
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
    await expect(readFile(pdfPath)).resolves.toEqual(Buffer.from([37, 80, 68, 70]))
  })
```

- [ ] **Step 2: Run IPC tests to verify RED**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: at least one new/updated `report:open-pdf` assertion fails because `OpenPdfReportRequest` has no `pdfReportName` behavior and downloads still save as `代码审查报告.pdf`.

- [ ] **Step 3: Extend request type**

In `code_review_electron/src/renderer/src/code-review-api.ts`, update `OpenPdfReportRequest`:

```ts
export interface OpenPdfReportRequest {
  taskId?: string
  localPdfPath?: string
  pdfReportName?: string
}
```

- [ ] **Step 4: Implement local-first IPC behavior**

In `code_review_electron/src/main/ipc.ts`, add `stat` to the existing `fs/promises` import:

```ts
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
```

Add helper functions near other local helpers:

```ts
const isExistingFile = async (filePath: string | undefined): Promise<boolean> => {
  if (!filePath) {
    return false
  }

  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

const sanitizeReportFileName = (fileName: string | undefined, fallback: string): string => {
  const trimmed = fileName?.trim()
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
    return fallback
  }

  return trimmed
}
```

Replace the `report:open-pdf` handler with:

```ts
  ipcMain.handle('report:open-pdf', async (_event, payload: OpenPdfReportRequest): Promise<OpenPdfReportResult> => {
    if (await isExistingFile(payload.localPdfPath)) {
      shell.showItemInFolder(payload.localPdfPath)
      return { status: 'ready', pdfPath: payload.localPdfPath }
    }

    if (!payload.taskId) {
      throw new Error('请先选择一个已完成任务报告。')
    }

    const runtimePaths = await loadRuntimePaths()
    const fallbackPdfPath =
      runtimePaths.pdfReportPathForTask?.(payload.taskId) ??
      runtimePaths.reportPathForTask(payload.taskId).replace(/\.md$/i, '.pdf')
    const pdfFileName = sanitizeReportFileName(payload.pdfReportName, '代码审查报告.pdf')
    const workspacePdfPath = join(runtimePaths.workspaceForTask(payload.taskId), pdfFileName)

    if (await isExistingFile(workspacePdfPath)) {
      shell.showItemInFolder(workspacePdfPath)
      return { status: 'ready', pdfPath: workspacePdfPath }
    }

    const tokens = await authStore.load()

    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    const pdfBytes = await taskApi.downloadPdfReport(tokens.access_token, payload.taskId)
    const pdfPath = payload.pdfReportName ? workspacePdfPath : fallbackPdfPath
    await mkdir(dirname(pdfPath), { recursive: true })
    await writeFile(pdfPath, Buffer.from(pdfBytes))
    shell.showItemInFolder(pdfPath)

    return { status: 'ready', pdfPath }
  })
```

- [ ] **Step 5: Run IPC tests to verify GREEN**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/ipc.test.ts
```

Expected: `ipc.test.ts` passes.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/code-review-api.ts \
  Agent/code_review_platform/code_review_electron/src/main/ipc.ts \
  Agent/code_review_platform/code_review_electron/src/main/__tests__/ipc.test.ts
git commit -m "实现PDF报告本地优先打开"
```

## Task 2: 渲染层传递 PDF 原文件名

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Test: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Test: `code_review_electron/src/preload/index.test.ts`

- [ ] **Step 1: Write failing renderer and preload tests**

In `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`, update the existing test `历史任务查看PDF报告时按任务 ID 下载服务端 PDF` expected call:

```ts
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-history-2',
      pdfReportName: undefined
    })
```

Then update the test data to include the original PDF name and expected call:

```ts
          pdf_report_path: '/app/reports/task-history-2.pdf',
          pdf_report_name: 'r3_r4审查报告_20260615_143000.pdf'
```

```ts
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-history-2',
      pdfReportName: 'r3_r4审查报告_20260615_143000.pdf'
    })
```

Keep the existing test `点击查看PDF报告时优先打开当前任务本地 PDF`, but update its expected call so it includes `pdfReportName: undefined`:

```ts
    expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
      taskId: 'task-local-success',
      localPdfPath: '/app/reports/task-local-success.pdf',
      pdfReportName: undefined
    })
```

In `code_review_electron/src/preload/index.test.ts`, update the existing PDF open test payload:

```ts
    await api.openPdfReport({
      taskId: 'task-1',
      localPdfPath: '/tmp/runtime/workspaces/task-1/代码审查报告.pdf',
      pdfReportName: 'r1_r2审查报告_20260615_143000.pdf'
    })

    expect(invokeMock).toHaveBeenCalledWith('report:open-pdf', {
      taskId: 'task-1',
      localPdfPath: '/tmp/runtime/workspaces/task-1/代码审查报告.pdf',
      pdfReportName: 'r1_r2审查报告_20260615_143000.pdf'
    })
```

- [ ] **Step 2: Run renderer/preload tests to verify RED**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx src/preload/index.test.ts
```

Expected: `TaskPage.test.tsx` fails because `TaskPage` does not pass `pdfReportName`.

- [ ] **Step 3: Store and pass current PDF report name**

In `code_review_electron/src/renderer/src/components/TaskPage.tsx`, add a ref near `currentPdfPathRef`:

```ts
  const currentPdfReportNameRef = useRef<string | undefined>(undefined)
```

Add a setter:

```ts
  const setActivePdfReportName = useCallback((pdfReportName: string | undefined): void => {
    currentPdfReportNameRef.current = pdfReportName
  }, [])
```

Update current task success handling:

```ts
    setActivePdfPath(task.pdfPath)
    setActivePdfReportName(task.pdf_report_name)
```

Update template change reset:

```ts
      setActivePdfPath(undefined)
      setActivePdfReportName(undefined)
```

Update `handleViewReport` for cached task path:

```ts
      setActivePdfPath(task.pdfPath)
      setActivePdfReportName(task.pdf_report_name)
      return
```

Update `handleViewReport` before loading server Markdown:

```ts
    setActivePdfPath(undefined)
    setActivePdfReportName(task.pdf_report_name)
```

Update `handleOpenPdfReport` call:

```ts
      const result = await window.codeReview.openPdfReport({
        taskId,
        localPdfPath: currentPdfPathRef.current,
        pdfReportName: currentPdfReportNameRef.current
      })
```

After a successful open/download, keep the report name when possible:

```ts
      setReportMessage(`PDF报告位置：${result.pdfPath}`)
      setActivePdfPath(result.pdfPath)
      setActivePdfReportName(currentPdfReportNameRef.current)
```

- [ ] **Step 4: Run renderer/preload tests to verify GREEN**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/renderer/src/components/TaskPage.test.tsx src/preload/index.test.ts
```

Expected: both test files pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskPage.tsx \
  Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskPage.test.tsx \
  Agent/code_review_platform/code_review_electron/src/preload/index.test.ts
git commit -m "传递PDF报告原文件名"
```

## Task 3: 全量验证和清理检查

**Files:**
- Verify only.

- [ ] **Step 1: Run focused Electron tests**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/ipc.test.ts src/renderer/src/components/TaskPage.test.tsx src/preload/index.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run existing PDF/task regression tests**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm test -- src/main/__tests__/report-pdf-generator.test.ts src/main/__tests__/report-uploader.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx
```

Expected: all listed Electron tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI/Agent/code_review_platform/code_review_electron
npm run typecheck
```

Expected: TypeScript exits 0.

- [ ] **Step 4: Inspect git status**

Run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git status --short --branch
```

Expected: only intended commits are present. Pre-existing `Agent/code_review_platform/code_review_electron/package.json` and `package-lock.json` version changes may remain unstaged if they were not part of this task.

- [ ] **Step 5: Commit verification note if needed**

If Task 3 required no file changes, do not create a commit. If a small test-only adjustment was needed, commit only the concrete changed file. For example, if only `TaskPage.test.tsx` changed, run:

```bash
cd /Users/chenghao/Desktop/yhc/PeiChengAI
git add Agent/code_review_platform/code_review_electron/src/renderer/src/components/TaskPage.test.tsx
git commit -m "补充PDF报告本地优先打开验证"
```

---

## Self-Review

- Spec coverage:
  - 本地 workspace 优先打开：Task 1。
  - 下载文件名使用 `pdf_report_name`：Task 1。
  - UI 文案保持“查看PDF报告”：Task 2 测试覆盖。
  - 不新增本地索引文件：所有任务都只使用 `runtimePaths.workspaceForTask`。
  - 打开文件夹并选中文件：Task 1 继续断言 `shell.showItemInFolder`。
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: request property统一为 `pdfReportName`，来源字段为服务端 `pdf_report_name`。
