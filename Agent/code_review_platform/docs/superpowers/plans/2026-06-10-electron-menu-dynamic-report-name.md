# Electron 默认菜单与动态报告文件名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 Electron Windows 默认菜单栏，并让新生成、上传、下载的审查报告使用 `r旧版本_r新版本审查报告_YYYYMMDD_HHmmss.md` 文件名。

**Architecture:** Electron 主进程负责清空原生菜单；共享报告工具负责生成动态文件名；任务执行流程在创建服务端任务后按版本号生成本地报告路径；上传时把本地 basename 作为 multipart 文件名。服务端给 `review_task` 增加 `report_name` 字段，上传时记录文件名，下载时优先使用该字段并兼容历史任务。

**Tech Stack:** Electron、TypeScript、Vitest、FastAPI、SQLModel、Alembic、Pytest。

---

## File Structure

- Modify: `code_review_electron/src/main/index.ts` - 在应用 ready 后创建窗口前清空 Electron 原生菜单。
- Modify: `code_review_electron/src/shared/report-artifacts.ts` - 保留图片目录常量，新增报告文件名生成和版本号规范化函数。
- Modify: `code_review_electron/src/main/runtime-paths.ts` - 将 `reportPathForTask` 改为支持自定义报告文件名。
- Modify: `code_review_electron/src/main/task-agent.ts` - 创建服务端任务后按任务版本号生成报告名，并传入工作区准备流程。
- Modify: `code_review_electron/src/main/report-uploader.ts` - 上传时使用 `basename(reportPath)` 作为 `report_name`。
- Test: `code_review_electron/src/shared/report-artifacts.test.ts` - 覆盖动态报告文件名格式和 `r` 前缀去重。
- Test: `code_review_electron/src/main/__tests__/runtime-paths.test.ts` - 覆盖自定义报告文件名路径。
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts` - 覆盖默认工作区使用动态报告名。
- Test: `code_review_electron/src/main/__tests__/report-uploader.test.ts` - 覆盖上传文件名来自报告路径 basename。
- Test: `code_review_electron/src/main/__tests__/main-window-menu.test.ts` - 覆盖主进程清空应用菜单。
- Modify: `code_review_server/backend/app/models.py` - 为 `ReviewTask` 和 `ReviewTaskPublic` 增加 `report_name`。
- Create: `code_review_server/backend/app/alembic/versions/5b7c2d9e4f10_add_review_task_report_name.py` - 增加数据库字段。
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py` - 上传时记录 `upload.filename`，下载时使用 `task.report_name` 或固定回退名。
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py` - 覆盖动态下载名和历史回退名。

### Task 1: 共享报告文件名生成

**Files:**
- Modify: `code_review_electron/src/shared/report-artifacts.ts`
- Create: `code_review_electron/src/shared/report-artifacts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `code_review_electron/src/shared/report-artifacts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  REVIEW_REPORT_FILE_NAME,
  buildReviewReportFileName,
  normalizeRevisionForReportName
} from './report-artifacts'

describe('report artifacts', () => {
  it('builds a dynamic report file name with normalized revisions and local timestamp', () => {
    const fileName = buildReviewReportFileName({
      oldRevision: '123',
      newRevision: '456',
      generatedAt: new Date(2026, 5, 10, 14, 25, 30)
    })

    expect(fileName).toBe('r123_r456审查报告_20260610_142530.md')
  })

  it('does not duplicate r prefixes in report file names', () => {
    expect(normalizeRevisionForReportName('r123')).toBe('r123')
    expect(normalizeRevisionForReportName('R456')).toBe('r456')
    expect(
      buildReviewReportFileName({
        oldRevision: 'r123',
        newRevision: 'R456',
        generatedAt: new Date(2026, 5, 10, 14, 25, 30)
      })
    ).toBe('r123_r456审查报告_20260610_142530.md')
  })

  it('keeps the historical fallback report file name available', () => {
    expect(REVIEW_REPORT_FILE_NAME).toBe('代码审查报告.md')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts
```

Expected: FAIL because `buildReviewReportFileName` and `normalizeRevisionForReportName` are not exported.

- [ ] **Step 3: Implement report file name helpers**

Update `code_review_electron/src/shared/report-artifacts.ts`:

```ts
export const REVIEW_REPORT_FILE_NAME = '代码审查报告.md'
export const REVIEW_REPORT_IMAGES_DIR_NAME = 'images'

export interface BuildReviewReportFileNameInput {
  oldRevision: string
  newRevision: string
  generatedAt?: Date
}

export const buildReviewReportFileName = ({
  oldRevision,
  newRevision,
  generatedAt = new Date()
}: BuildReviewReportFileNameInput): string => {
  const timestamp = formatReportTimestamp(generatedAt)

  return `${normalizeRevisionForReportName(oldRevision)}_${normalizeRevisionForReportName(
    newRevision
  )}审查报告_${timestamp}.md`
}

export const normalizeRevisionForReportName = (revision: string): string => {
  const trimmed = revision.trim()
  const withoutPrefix = trimmed.replace(/^[rR]+/, '')

  return `r${withoutPrefix}`
}

const formatReportTimestamp = (value: Date): string => {
  const year = value.getFullYear()
  const month = padDatePart(value.getMonth() + 1)
  const day = padDatePart(value.getDate())
  const hours = padDatePart(value.getHours())
  const minutes = padDatePart(value.getMinutes())
  const seconds = padDatePart(value.getSeconds())

  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

const padDatePart = (value: number): string => value.toString().padStart(2, '0')
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add code_review_electron/src/shared/report-artifacts.ts code_review_electron/src/shared/report-artifacts.test.ts
git commit -m "新增动态审查报告文件名生成"
```

### Task 2: Electron 菜单与本地报告路径

**Files:**
- Modify: `code_review_electron/src/main/index.ts`
- Modify: `code_review_electron/src/main/runtime-paths.ts`
- Modify: `code_review_electron/src/main/task-agent.ts`
- Test: `code_review_electron/src/main/__tests__/main-window-menu.test.ts`
- Test: `code_review_electron/src/main/__tests__/runtime-paths.test.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `code_review_electron/src/main/__tests__/main-window-menu.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

describe('main window menu', () => {
  it('clears Electron default application menu before creating the window', async () => {
    vi.resetModules()
    const setApplicationMenu = vi.fn()
    const whenReady = vi.fn(() => Promise.resolve())
    const on = vi.fn()
    const loadFile = vi.fn()
    const loadURL = vi.fn()
    const setWindowOpenHandler = vi.fn()

    vi.doMock('electron', () => ({
      app: {
        whenReady,
        on,
        quit: vi.fn(),
        getPath: vi.fn(),
        getAppPath: vi.fn()
      },
      BrowserWindow: vi.fn(() => ({
        loadFile,
        loadURL,
        webContents: {
          setWindowOpenHandler
        }
      })),
      Menu: {
        setApplicationMenu
      },
      shell: {
        openExternal: vi.fn()
      }
    }))

    await import('../index')
    await Promise.resolve()

    expect(setApplicationMenu).toHaveBeenCalledWith(null)
  })
})
```

Update `code_review_electron/src/main/__tests__/runtime-paths.test.ts` packaged test assertion:

```ts
expect(paths.reportPathForTask('task-1', 'r10_r20审查报告_20260610_142530.md')).toBe(
  'D:\\SoftWare\\code-review-electron-data\\workspaces\\task-1\\r10_r20审查报告_20260610_142530.md'
)
```

Update `code_review_electron/src/main/__tests__/task-agent.test.ts` by adding a test under `describe('executeReviewTask', ...)`:

```ts
it('prepares the default workspace with a dynamic report file name from task revisions', async () => {
  vi.doMock('electron', () => ({
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => '/tmp/code_review_electron')
    }
  }))
  const { defaultPrepareWorkspace } = await import('../task-agent')

  const workspace = await defaultPrepareWorkspace({
    taskId: 'task-dynamic-report',
    oldRevision: 'r12',
    newRevision: '14',
    generatedAt: new Date(2026, 5, 10, 14, 25, 30)
  })

  expect(workspace.reportPath).toBe(
    '/tmp/code_review_electron/.runtime-data/workspaces/task-dynamic-report/r12_r14审查报告_20260610_142530.md'
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/main-window-menu.test.ts src/main/__tests__/runtime-paths.test.ts src/main/__tests__/task-agent.test.ts
```

Expected: FAIL because `Menu` is not used, `reportPathForTask` does not accept a custom file name, and `defaultPrepareWorkspace` still accepts only `taskId: string`.

- [ ] **Step 3: Implement menu clearing and dynamic workspace path**

Update `code_review_electron/src/main/index.ts` imports and ready flow:

```ts
import { app, BrowserWindow, Menu } from 'electron'
```

```ts
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
```

Update `code_review_electron/src/main/runtime-paths.ts` interface and implementation:

```ts
reportPathForTask(taskId: string, reportFileName?: string): string
```

```ts
reportPathForTask: (taskId: string, reportFileName = REVIEW_REPORT_FILE_NAME) =>
  pathApi.join(workspacesDir, taskId, reportFileName),
```

Update `code_review_electron/src/main/task-agent.ts`:

```ts
import { buildReviewReportFileName } from '../shared/report-artifacts'
```

```ts
export interface PrepareWorkspaceInput {
  taskId: string
  oldRevision: string
  newRevision: string
  generatedAt?: Date
}
```

```ts
prepareWorkspace: (input: PrepareWorkspaceInput) => Promise<PreparedWorkspace>
```

```ts
export const defaultPrepareWorkspace = async ({
  taskId,
  oldRevision,
  newRevision,
  generatedAt
}: PrepareWorkspaceInput): Promise<PreparedWorkspace> => {
  const runtimePaths = await getRuntimePaths()
  const cwd = runtimePaths.workspaceForTask(taskId)
  const imagesDir = runtimePaths.imagesDirForTask(taskId)
  const reportFileName = buildReviewReportFileName({
    oldRevision,
    newRevision,
    generatedAt
  })

  await mkdir(cwd, { recursive: true })
  await mkdir(imagesDir, { recursive: true })

  return {
    cwd,
    reportPath: runtimePaths.reportPathForTask(taskId, reportFileName),
    imagesDir
  }
}
```

Update `executeReviewTask` workspace call:

```ts
const workspace = await dependencies.prepareWorkspace({
  taskId: task.id,
  oldRevision: task.old_revision,
  newRevision: task.new_revision
})
```

Update existing tests that mock `prepareWorkspace` to accept the input object or ignore arguments.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/main-window-menu.test.ts src/main/__tests__/runtime-paths.test.ts src/main/__tests__/task-agent.test.ts src/shared/report-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add code_review_electron/src/main/index.ts code_review_electron/src/main/runtime-paths.ts code_review_electron/src/main/task-agent.ts code_review_electron/src/main/__tests__/main-window-menu.test.ts code_review_electron/src/main/__tests__/runtime-paths.test.ts code_review_electron/src/main/__tests__/task-agent.test.ts
git commit -m "移除客户端默认菜单并使用动态报告路径"
```

### Task 3: 上传报告使用动态文件名

**Files:**
- Modify: `code_review_electron/src/main/report-uploader.ts`
- Test: `code_review_electron/src/main/__tests__/report-uploader.test.ts`

- [ ] **Step 1: Write failing test**

Update `code_review_electron/src/main/__tests__/report-uploader.test.ts` upload test:

```ts
it('uploads report content and file name from disk path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-uploader-'))
  tempDirs.push(dir)
  const reportPath = join(dir, 'r12_r14审查报告_20260610_142530.md')
  const api = {
    uploadReport: vi.fn(async () => ({ ok: true }))
  }
  await writeFile(reportPath, '# report\n')

  await uploadReportFile(api, 'token-123', 'task-1', reportPath)

  expect(api.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', {
    report_content: '# report\n',
    report_path: reportPath,
    report_name: 'r12_r14审查报告_20260610_142530.md'
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/report-uploader.test.ts
```

Expected: FAIL because upload still uses `REVIEW_REPORT_FILE_NAME`.

- [ ] **Step 3: Implement basename upload file name**

Update `code_review_electron/src/main/report-uploader.ts`:

```ts
import { basename } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
```

Remove the `REVIEW_REPORT_FILE_NAME` import and use:

```ts
report_name: basename(reportPath)
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/report-uploader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add code_review_electron/src/main/report-uploader.ts code_review_electron/src/main/__tests__/report-uploader.test.ts
git commit -m "上传审查报告时保留动态文件名"
```

### Task 4: 服务端记录并下载动态报告名

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Create: `code_review_server/backend/app/alembic/versions/5b7c2d9e4f10_add_review_task_report_name.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: Write failing backend tests**

Update `test_download_review_task_report_uses_chinese_report_filename` to become:

```python
def test_download_review_task_report_uses_uploaded_report_filename(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="10")
    report_name = "r10_r2审查报告_20260610_142530.md"
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": (report_name, b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200
    assert upload_response.json()["report_name"] == report_name

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert report_name in unquote(response.headers["content-disposition"])
    assert response.content == b"# Review\n"
```

Add a historical fallback test:

```python
def test_download_review_task_report_falls_back_to_default_report_filename(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from uuid import UUID

    from app.models import ReviewTask

    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers, old_revision="10")
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/report",
        headers=normal_user_token_headers,
        files={"upload": ("report.md", b"# Review\n", "text/markdown")},
    )
    assert upload_response.status_code == 200

    db_task = db.get(ReviewTask, UUID(task["id"]))
    assert db_task is not None
    db_task.report_name = None
    db.add(db_task)
    db.commit()

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert "代码审查报告.md" in unquote(response.headers["content-disposition"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'report_filename or upload_and_read_review_task_report'
```

Expected: FAIL because `report_name` is not present in API responses and download still uses the fixed filename.

- [ ] **Step 3: Implement backend model and route changes**

Update `code_review_server/backend/app/models.py`:

```python
report_name: str | None = Field(default=None, max_length=255)
```

Add it after `report_path` in both `ReviewTask` and `ReviewTaskPublic`.

Create `code_review_server/backend/app/alembic/versions/5b7c2d9e4f10_add_review_task_report_name.py`:

```python
"""add review task report name

Revision ID: 5b7c2d9e4f10
Revises: 4e9c1d7b2a65
Create Date: 2026-06-10 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "5b7c2d9e4f10"
down_revision = "4e9c1d7b2a65"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("report_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "report_name")
```

Update `code_review_server/backend/app/api/routes/review_tasks.py` upload route:

```python
task.report_path = str(report_path)
task.report_name = upload.filename or REVIEW_REPORT_FILE_NAME
```

Update download route:

```python
filename=task.report_name or REVIEW_REPORT_FILE_NAME,
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'report_filename or upload_and_read_review_task_report'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/alembic/versions/5b7c2d9e4f10_add_review_task_report_name.py code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "服务端支持动态审查报告下载名"
```

### Task 5: 全量验证

**Files:**
- Verify only

- [ ] **Step 1: Run Electron focused tests**

Run:

```bash
cd code_review_electron
npm test -- src/shared/report-artifacts.test.ts src/main/__tests__/main-window-menu.test.ts src/main/__tests__/runtime-paths.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/report-uploader.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Electron typecheck**

Run:

```bash
cd code_review_electron
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run backend focused tests**

Run:

```bash
cd code_review_server/backend
bash scripts/test.sh tests/api/routes/test_review_tasks.py -k 'report'
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git status --short
```

Expected: only intended files are changed, with no unrelated package metadata or skill archive changes included.

- [ ] **Step 5: Commit final verification note only if files changed**

If no files changed after verification, do not commit. If test snapshots or generated files changed unexpectedly, inspect them and only commit intentional changes. Example:

```bash
git add code_review_electron/src/main/__tests__/task-agent.test.ts
git commit -m "补充客户端报告命名验证"
```

---

## Self-Review

- Spec coverage: 菜单移除由 Task 2 覆盖；动态报告名由 Task 1 和 Task 2 覆盖；上传文件名由 Task 3 覆盖；服务端下载名与历史兼容由 Task 4 覆盖；验证由 Task 5 覆盖。
- Placeholder scan: 计划不包含未定义的后续实现占位；Task 4 的数据库会话写法明确使用 `db: Session` fixture。
- Type consistency: `report_name` 在客户端上传 payload、后端模型、公开模型和下载逻辑中统一；`reportPathForTask(taskId, reportFileName?)` 和 `defaultPrepareWorkspace(input)` 后续任务签名一致。
