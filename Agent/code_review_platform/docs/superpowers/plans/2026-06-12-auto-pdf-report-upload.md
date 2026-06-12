# 自动生成并上传 PDF 报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在正式分支实现 Markdown 生成后自动生成 PDF、同时上传 Markdown 和 PDF，并支持跨电脑下载 PDF 报告。

**Architecture:** 服务端为 `review_task` 增加 PDF 报告元数据和 PDF 上传/下载接口；Electron 主进程在 Codex 生成 Markdown 后调用 PDF 生成器，再上传两份报告；客户端 UI 保持 Markdown 预览，把报告位置入口改成 PDF 查看/下载。Web 任务列表增加 PDF 下载入口。

**Tech Stack:** FastAPI + SQLModel + Alembic + pytest；Electron + TypeScript + Vitest；React + TanStack Query；现有 Electron `BrowserWindow.printToPDF` PDF 生成器。

---

## File Map

- `code_review_server/backend/app/models.py`: 增加 `pdf_report_path` 和 `pdf_report_name` 字段到 `ReviewTask` 与 `ReviewTaskPublic`。
- `code_review_server/backend/app/alembic/versions/20260612_add_review_task_pdf_report.py`: 增加数据库迁移。
- `code_review_server/backend/app/services/report_service.py`: 增加 PDF 保存路径和上传保存函数。
- `code_review_server/backend/app/api/routes/review_tasks.py`: 增加 PDF 上传/下载接口，删除任务时清理 PDF 文件。
- `code_review_server/backend/tests/api/routes/test_review_tasks.py`: 覆盖 PDF 上传、下载、权限、删除和旧任务 404。
- `code_review_server/frontend/src/client/*`: 通过 OpenAPI 生成后包含 `pdf_report_path`、`pdf_report_name` 类型和新接口；如果本地生成命令不可用，手工同步类型字段。
- `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`: 增加 PDF 下载按钮和下载函数。
- `code_review_server/frontend/tests/tasks.spec.ts`: 覆盖 PDF 按钮可见性。
- `code_review_electron/src/main/report-uploader.ts`: 扩展为上传 Markdown 和 PDF 文件。
- `code_review_electron/src/main/api-client.ts`: 增加 PDF 上传和下载方法。
- `code_review_electron/src/main/task-agent.ts`: 增加 PDF 生成依赖，任务成功前自动生成并上传 PDF。
- `code_review_electron/src/main/ipc.ts`: 增加历史任务 PDF 下载/打开 IPC，保留必要的本地打开逻辑。
- `code_review_electron/src/preload/index.ts`: 暴露 `openPdfReport(taskId?, localPdfPath?)`。
- `code_review_electron/src/renderer/src/code-review-api.ts`: 增加 PDF 字段和 API 类型。
- `code_review_electron/src/renderer/src/components/TaskPage.tsx`: 将按钮改为“查看PDF报告”，当前任务优先本地 PDF，历史任务走服务端下载。
- `code_review_electron/src/main/__tests__/*.test.ts`、`src/preload/index.test.ts`、`src/renderer/src/components/TaskPage.test.tsx`: 覆盖 Electron 新行为。

---

### Task 1: 服务端 PDF 报告存储模型和接口

**Files:**
- Modify: `code_review_server/backend/app/models.py`
- Create: `code_review_server/backend/app/alembic/versions/20260612_add_review_task_pdf_report.py`
- Modify: `code_review_server/backend/app/services/report_service.py`
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Test: `code_review_server/backend/tests/api/routes/test_review_tasks.py`

- [ ] **Step 1: 写失败测试：上传并下载 PDF 报告**

在 `code_review_server/backend/tests/api/routes/test_review_tasks.py` 中新增：

```python
def test_upload_and_download_review_task_pdf_report(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)

    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf-report",
        headers=normal_user_token_headers,
        files={"upload": ("代码审查报告.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )

    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    assert uploaded["pdf_report_path"]
    assert uploaded["pdf_report_name"] == "代码审查报告.pdf"

    download_response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("application/pdf")
    assert "代码审查报告.pdf" in unquote(download_response.headers["content-disposition"])
    assert download_response.content == b"%PDF-1.4\npdf\n"
```

- [ ] **Step 2: 写失败测试：旧任务没有 PDF 时返回 404**

同文件新增：

```python
def test_download_review_task_pdf_report_returns_404_when_missing(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    task = _create_review_task(client, normal_user_token_headers)

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "PDF report not found"
```

- [ ] **Step 3: 写失败测试：删除任务同时删除 PDF 文件**

同文件新增：

```python
def test_delete_review_task_removes_existing_pdf_report_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    task = _create_review_task(client, normal_user_token_headers)
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}/pdf-report",
        headers=normal_user_token_headers,
        files={"upload": ("report.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )
    assert upload_response.status_code == 200
    pdf_path = Path(upload_response.json()["pdf_report_path"])
    assert pdf_path.is_file()

    response = client.delete(
        f"{settings.API_V1_STR}/review-tasks/{task['id']}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert not pdf_path.exists()
```

- [ ] **Step 4: 写失败测试：普通用户不能下载别人的 PDF**

同文件新增：

```python
def test_download_review_task_pdf_report_requires_task_permission(
    client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REPORT_STORAGE_DIR", str(tmp_path))
    other = _create_named_svn_user_task(
        client=client,
        db=db,
        full_name="Other User",
        svn_username="other",
    )
    upload_response = client.post(
        f"{settings.API_V1_STR}/review-tasks/{other['task']['id']}/pdf-report",
        headers=other["headers"],
        files={"upload": ("report.pdf", b"%PDF-1.4\npdf\n", "application/pdf")},
    )
    assert upload_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/review-tasks/{other['task']['id']}/pdf/download",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
```

- [ ] **Step 5: 运行后端目标测试确认失败**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -k "pdf_report" -q
```

Expected: FAIL，错误包含 404 或字段缺失，因为接口和字段还不存在。

- [ ] **Step 6: 增加模型字段**

在 `code_review_server/backend/app/models.py` 的 `ReviewTask` 中紧跟 `report_name` 增加：

```python
    pdf_report_path: str | None = Field(default=None, max_length=2048)
    pdf_report_name: str | None = Field(default=None, max_length=255)
```

在 `ReviewTaskPublic` 中紧跟 `report_name` 增加：

```python
    pdf_report_path: str | None = None
    pdf_report_name: str | None = None
```

- [ ] **Step 7: 增加 Alembic 迁移**

创建 `code_review_server/backend/app/alembic/versions/20260612_add_review_task_pdf_report.py`：

```python
"""add review task pdf report

Revision ID: 20260612pdf01
Revises: 5b7c2d9e4f10
Create Date: 2026-06-12 10:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260612pdf01"
down_revision = "5b7c2d9e4f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_task",
        sa.Column("pdf_report_path", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "review_task",
        sa.Column("pdf_report_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("review_task", "pdf_report_name")
    op.drop_column("review_task", "pdf_report_path")
```

当前 `main` 的 review task 相关迁移 head 是 `5b7c2d9e4f10_add_review_task_report_name.py`，本迁移固定使用 `down_revision = "5b7c2d9e4f10"`。

- [ ] **Step 8: 扩展报告服务**

在 `code_review_server/backend/app/services/report_service.py` 中改为：

```python
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.core.config import settings


def path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.md"


def pdf_path_for_task(task_id: uuid.UUID) -> Path:
    return Path(settings.REPORT_STORAGE_DIR) / f"{task_id}.pdf"


async def save_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Report file must not be empty")

    report_path = path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path


async def save_pdf_upload(task_id: uuid.UUID, upload: UploadFile) -> Path:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="PDF report file must not be empty")

    report_path = pdf_path_for_task(task_id)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(content)
    return report_path
```

- [ ] **Step 9: 扩展后端路由**

在 `code_review_server/backend/app/api/routes/review_tasks.py` 中增加常量：

```python
PDF_REPORT_FILE_NAME = "代码审查报告.pdf"
```

增加读取 helper：

```python
def _read_pdf_report_path(task: ReviewTask) -> Path:
    report_path = Path(task.pdf_report_path) if task.pdf_report_path else None
    if not report_path or not report_path.is_file():
        raise HTTPException(status_code=404, detail="PDF report not found")
    return report_path
```

在 `delete_review_task` 中删除 Markdown 后增加：

```python
    pdf_report_path = Path(task.pdf_report_path) if task.pdf_report_path else None
    if pdf_report_path and pdf_report_path.is_file():
        try:
            pdf_report_path.unlink()
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail="Failed to delete review task PDF report"
            ) from exc
```

在 Markdown 上传接口后增加：

```python
@router.post("/{task_id}/pdf-report", response_model=ReviewTaskPublic)
async def upload_review_task_pdf_report(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    task_id: uuid.UUID,
    upload: UploadFile = File(...),
) -> Any:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = await report_service.save_pdf_upload(task_id, upload)
    now = _utcnow()
    task.pdf_report_path = str(report_path)
    task.pdf_report_name = upload.filename or PDF_REPORT_FILE_NAME
    task.updated_at = now

    session.add(task)
    session.commit()
    session.refresh(task)
    return task
```

在下载 Markdown 接口后增加：

```python
@router.get("/{task_id}/pdf/download")
def download_review_task_pdf_report(
    session: SessionDep, current_user: CurrentUser, task_id: uuid.UUID
) -> FileResponse:
    task = _get_task_for_user(
        session=session, current_user=current_user, task_id=task_id
    )
    report_path = _read_pdf_report_path(task)
    return FileResponse(
        report_path,
        media_type="application/pdf",
        filename=task.pdf_report_name or PDF_REPORT_FILE_NAME,
    )
```

- [ ] **Step 10: 运行后端测试确认通过**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -k "review_task_pdf_report or delete_review_task_removes_existing_pdf_report_file" -q
```

Expected: PASS。

- [ ] **Step 11: 提交**

```bash
git add code_review_server/backend/app/models.py code_review_server/backend/app/alembic/versions/20260612_add_review_task_pdf_report.py code_review_server/backend/app/services/report_service.py code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py
git commit -m "新增服务端PDF报告存储和下载接口"
```

---

### Task 2: Electron 自动生成 PDF 并上传两份报告

**Files:**
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/report-uploader.ts`
- Modify: `code_review_electron/src/main/task-agent.ts`
- Test: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Test: `code_review_electron/src/main/__tests__/report-uploader.test.ts`
- Test: `code_review_electron/src/main/__tests__/task-agent.test.ts`

- [ ] **Step 1: 写失败测试：ApiClient 上传 PDF**

在 `code_review_electron/src/main/__tests__/api-client.test.ts` 中新增：

```ts
it('uploads a generated PDF report with authorization header', async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }))
  const client = new ApiClient('https://server.example', fetchMock)
  const pdf = new Uint8Array([37, 80, 68, 70])

  await client.uploadPdfReport('token-123', 'task/1', {
    pdf_content: pdf,
    pdf_name: '代码审查报告.pdf'
  })

  expect(fetchMock).toHaveBeenCalledWith(
    'https://server.example/api/v1/review-tasks/task%2F1/pdf-report',
    expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123'
      },
      body: expect.any(FormData)
    })
  )
})
```

- [ ] **Step 2: 写失败测试：任务执行生成 PDF 后上传 Markdown 和 PDF**

在 `code_review_electron/src/main/__tests__/task-agent.test.ts` 中把现有“runs codex, uploads the report”用例扩展，或新增：

```ts
it('generates a PDF report before uploading markdown and PDF reports', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'task-agent-pdf-'))
  tempDirs.push(cwd)
  const reportPath = join(cwd, '代码审查报告.md')
  const pdfPath = join(cwd, '代码审查报告.pdf')
  const imagesDir = join(cwd, 'images')
  const calls: string[] = []
  const dependencies: TaskAgentDependencies = {
    api: {
      createTask: vi.fn(async () => {
        calls.push('createTask')
        return makeTask()
      }),
      updateTaskStatus: vi.fn(async (_token, _taskId, payload) => {
        calls.push(`status:${payload.status}`)
      })
    },
    checkEnvironment: vi.fn(async () => {
      calls.push('checkEnvironment')
      return { status: 'ready' as const }
    }),
    prepareWorkspace: vi.fn(async () => {
      calls.push('prepareWorkspace')
      return { cwd, reportPath, imagesDir }
    }),
    runCodex: vi.fn(async () => {
      calls.push('runCodex')
      await writeFile(reportPath, '# report\n')
    }),
    generatePdfReport: vi.fn(async () => {
      calls.push('generatePdfReport')
      await writeFile(pdfPath, '%PDF-1.4\n')
      return { status: 'ready', reportPath, pdfPath }
    }),
    uploadReport: vi.fn(async () => {
      calls.push('uploadReport')
    }),
    uploadPdfReport: vi.fn(async () => {
      calls.push('uploadPdfReport')
    })
  }

  const result = await executeReviewTask({ token: 'token-123', request }, dependencies)

  expect(result).toEqual({
    taskId: 'task-1',
    status: 'success',
    reportMarkdown: '# report\n',
    reportPath,
    pdfPath
  })
  expect(dependencies.generatePdfReport).toHaveBeenCalledWith(reportPath)
  expect(dependencies.uploadReport).toHaveBeenCalledWith('token-123', 'task-1', reportPath)
  expect(dependencies.uploadPdfReport).toHaveBeenCalledWith('token-123', 'task-1', pdfPath)
  expect(calls).toEqual([
    'createTask',
    'status:checking_environment',
    'checkEnvironment',
    'prepareWorkspace',
    'status:running_codex',
    'runCodex',
    'status:uploading_report',
    'generatePdfReport',
    'uploadReport',
    'uploadPdfReport'
  ])
})
```

- [ ] **Step 3: 写失败测试：PDF 生成失败会标记任务失败**

同文件新增：

```ts
it('marks task failed when PDF generation fails after markdown is ready', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'task-agent-pdf-fail-'))
  tempDirs.push(cwd)
  const reportPath = join(cwd, '代码审查报告.md')
  const imagesDir = join(cwd, 'images')
  const dependencies: TaskAgentDependencies = {
    api: {
      createTask: vi.fn(async () => makeTask()),
      updateTaskStatus: vi.fn(async () => undefined)
    },
    checkEnvironment: vi.fn(async () => ({ status: 'ready' as const })),
    prepareWorkspace: vi.fn(async () => ({ cwd, reportPath, imagesDir })),
    runCodex: vi.fn(async () => {
      await writeFile(reportPath, '# report\n')
    }),
    generatePdfReport: vi.fn(async () => {
      throw new Error('PDF报告生成失败：报告图片不存在')
    }),
    uploadReport: vi.fn(),
    uploadPdfReport: vi.fn()
  }

  await expect(executeReviewTask({ token: 'token-123', request }, dependencies)).rejects.toThrow(
    'PDF报告生成失败'
  )

  expect(dependencies.uploadReport).not.toHaveBeenCalled()
  expect(dependencies.uploadPdfReport).not.toHaveBeenCalled()
  expect(dependencies.api.updateTaskStatus).toHaveBeenLastCalledWith(
    'token-123',
    'task-1',
    expect.objectContaining({
      status: 'failed',
      error_message: expect.stringContaining('PDF报告生成失败')
    })
  )
})
```

- [ ] **Step 4: 运行 Electron 目标测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/task-agent.test.ts
```

Expected: FAIL，类型或属性不存在。

- [ ] **Step 5: 扩展 ApiClient**

在 `code_review_electron/src/main/api-client.ts` 增加：

```ts
export interface UploadPdfReportRequest {
  pdf_content: Uint8Array | ArrayBuffer | Blob
  pdf_name?: string
}
```

在 `ApiClient` 类中增加：

```ts
  uploadPdfReport(token: string, taskId: string, payload: UploadPdfReportRequest): Promise<unknown> {
    const body = new FormData()
    body.set(
      'upload',
      new File([payload.pdf_content], payload.pdf_name ?? '代码审查报告.pdf', {
        type: 'application/pdf'
      })
    )

    return this.request(
      `/api/v1/review-tasks/${encodeURIComponent(taskId)}/pdf-report`,
      {
        method: 'POST',
        headers: this.authHeaders(token),
        body
      },
      { json: false }
    )
  }
```

- [ ] **Step 6: 扩展报告上传器**

在 `code_review_electron/src/main/report-uploader.ts` 增加：

```ts
export interface PdfReportUploadApi {
  uploadPdfReport: ApiClient['uploadPdfReport']
}

export const ensurePdfReportReady = async (pdfPath: string): Promise<void> => {
  let reportStat

  try {
    reportStat = await stat(pdfPath)
  } catch {
    throw new Error(`PDF报告不存在：${pdfPath}`)
  }

  if (!reportStat.isFile() || reportStat.size <= 0) {
    throw new Error(`PDF报告为空：${pdfPath}`)
  }
}

export const uploadPdfReportFile = async (
  api: PdfReportUploadApi,
  token: string,
  taskId: string,
  pdfPath: string
): Promise<unknown> => {
  await ensurePdfReportReady(pdfPath)

  const pdfContent = await readFile(pdfPath)

  return api.uploadPdfReport(token, taskId, {
    pdf_content: pdfContent,
    pdf_name: basename(pdfPath)
  })
}
```

- [ ] **Step 7: 扩展任务代理类型和默认依赖**

在 `code_review_electron/src/main/task-agent.ts`：

```ts
import { generatePdfReport } from './report-pdf-generator'
import { ensureReportReady, uploadPdfReportFile, uploadReportFile } from './report-uploader'
```

扩展 `ExecuteReviewTaskResult`：

```ts
  pdfPath?: string
```

扩展 `TaskAgentDependencies`：

```ts
  generatePdfReport: (reportPath: string) => Promise<{ status: 'ready'; reportPath: string; pdfPath: string }>
  uploadPdfReport: (token: string, taskId: string, pdfPath: string) => Promise<unknown>
```

扩展 `createTaskAgentDependencies`：

```ts
  generatePdfReport,
  uploadPdfReport: (token, taskId, pdfPath) => uploadPdfReportFile(api, token, taskId, pdfPath)
```

- [ ] **Step 8: 改任务执行顺序**

在 `executeReviewTask` 的上传阶段替换为：

```ts
    await ensureReportReady(workspace.reportPath)
    throwIfCancelled(input.signal)
    const pdfResult = await dependencies.generatePdfReport(workspace.reportPath)
    throwIfCancelled(input.signal)
    await dependencies.uploadReport(input.token, task.id, workspace.reportPath)
    throwIfCancelled(input.signal)
    await dependencies.uploadPdfReport(input.token, task.id, pdfResult.pdfPath)
    throwIfCancelled(input.signal)
    const reportMarkdown = await readFile(workspace.reportPath, 'utf8')
```

返回值增加：

```ts
      pdfPath: pdfResult.pdfPath
```

- [ ] **Step 9: 更新现有 task-agent 测试依赖对象**

所有 `TaskAgentDependencies` 测试对象都要补：

```ts
generatePdfReport: vi.fn(),
uploadPdfReport: vi.fn()
```

环境错误、取消等路径中断言它们没有被调用。

- [ ] **Step 10: 运行 Electron 主进程测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/report-uploader.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/report-pdf-generator.test.ts
```

Expected: PASS。

- [ ] **Step 11: 提交**

```bash
git add code_review_electron/src/main/api-client.ts code_review_electron/src/main/report-uploader.ts code_review_electron/src/main/task-agent.ts code_review_electron/src/main/__tests__/api-client.test.ts code_review_electron/src/main/__tests__/report-uploader.test.ts code_review_electron/src/main/__tests__/task-agent.test.ts
git commit -m "实现客户端自动生成并上传PDF报告"
```

---

### Task 3: Electron 查看 PDF 报告入口

**Files:**
- Modify: `code_review_electron/src/shared/types.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`
- Modify: `code_review_electron/src/main/api-client.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Test: `code_review_electron/src/main/__tests__/api-client.test.ts`
- Test: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Test: `code_review_electron/src/preload/index.test.ts`
- Test: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`

- [ ] **Step 1: 写失败测试：ApiClient 下载 PDF 字节**

在 `code_review_electron/src/main/__tests__/api-client.test.ts` 新增：

```ts
it('downloads generated PDF report bytes with authorization header', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70])
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/pdf' }
    })
  )
  const client = new ApiClient('https://server.example', fetchMock)

  const result = await client.downloadPdfReport('token-123', 'task/1')

  expect(new Uint8Array(result)).toEqual(bytes)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://server.example/api/v1/review-tasks/task%2F1/pdf/download',
    {
      method: 'GET',
      headers: {
        authorization: 'Bearer token-123'
      }
    }
  )
})
```

- [ ] **Step 2: 写失败测试：TaskPage 按钮改为查看 PDF 报告**

在 `code_review_electron/src/renderer/src/components/TaskPage.test.tsx` 修改/新增：

```ts
it('点击查看PDF报告时优先打开当前任务本地 PDF', async () => {
  const user = userEvent.setup()
  window.codeReview.executeTask = vi.fn(async () => ({
    taskId: 'task-local-success',
    status: 'success' as const,
    reportMarkdown: '# 本地报告',
    reportPath: '/app/reports/task-local-success.md',
    pdfPath: '/app/reports/task-local-success.pdf'
  }))
  window.codeReview.openPdfReport = vi.fn(async () => ({
    status: 'ready' as const,
    pdfPath: '/app/reports/task-local-success.pdf'
  }))

  renderReadyTaskPage()

  await fillTaskForm(user, '21')
  await user.click(screen.getByRole('button', { name: '开始审查' }))
  await screen.findByText('本地报告')
  await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

  expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
    taskId: 'task-local-success',
    localPdfPath: '/app/reports/task-local-success.pdf'
  })
})
```

新增历史任务测试：

```ts
it('历史任务查看PDF报告时按任务 ID 下载服务端 PDF', async () => {
  const user = userEvent.setup()
  window.codeReview.listTasks = vi.fn(async () => ({
    data: [
      {
        id: 'task-history-pdf',
        svn_url: 'svn://repo/history',
        old_revision: '1',
        new_revision: '2',
        status: 'success' as const,
        report_path: '/server/reports/task-history-pdf.md',
        pdf_report_path: '/server/reports/task-history-pdf.pdf'
      }
    ],
    count: 1
  }))
  window.codeReview.readTaskReport = vi.fn(async () => '# 历史报告')
  window.codeReview.openPdfReport = vi.fn(async () => ({
    status: 'ready' as const,
    pdfPath: '/local/cache/task-history-pdf.pdf'
  }))

  renderReadyTaskPage()

  const historyPanel = await openHistoryTasks(user)
  await user.click(within(historyPanel).getByRole('button', { name: '查看报告' }))
  await screen.findByText('历史报告')
  await user.click(screen.getByRole('button', { name: '查看PDF报告' }))

  expect(window.codeReview.openPdfReport).toHaveBeenCalledWith({
    taskId: 'task-history-pdf'
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx
```

Expected: FAIL，`downloadPdfReport`、`openPdfReport` 或按钮不存在。

- [ ] **Step 4: 扩展共享类型**

在 `code_review_electron/src/shared/types.ts` 的 `ReviewTask` 增加：

```ts
  pdf_report_path?: string
  pdf_report_name?: string
```

在 `code_review_electron/src/renderer/src/code-review-api.ts`：

```ts
export interface ExecuteTaskResult {
  taskId: string
  status: ReviewTaskStatus
  reportMarkdown?: string
  reportPath?: string
  pdfPath?: string
}

export interface OpenPdfReportRequest {
  taskId?: string
  localPdfPath?: string
}

export interface OpenPdfReportResult {
  status: 'ready'
  pdfPath: string
}
```

`CodeReviewApi` 增加：

```ts
  openPdfReport(payload: OpenPdfReportRequest): Promise<OpenPdfReportResult>
```

- [ ] **Step 5: ApiClient 增加 PDF 下载**

在 `code_review_electron/src/main/api-client.ts` 增加：

```ts
  async downloadPdfReport(token: string, taskId: string): Promise<ArrayBuffer> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/review-tasks/${encodeURIComponent(taskId)}/pdf/download`,
      {
        method: 'GET',
        headers: this.authHeaders(token)
      }
    )

    if (!response.ok) {
      throw new ApiError(response.status, await this.readErrorMessage(response))
    }

    return response.arrayBuffer()
  }
```

- [ ] **Step 6: IPC 增加打开 PDF 报告**

在 `code_review_electron/src/main/ipc.ts` 增加类型：

```ts
interface OpenPdfReportRequest {
  taskId?: string
  localPdfPath?: string
}

interface OpenPdfReportResult {
  status: 'ready'
  pdfPath: string
}
```

增加 handler：

```ts
  ipcMain.handle('report:open-pdf', async (_event, payload: OpenPdfReportRequest): Promise<OpenPdfReportResult> => {
    if (payload.localPdfPath) {
      shell.showItemInFolder(payload.localPdfPath)
      return { status: 'ready', pdfPath: payload.localPdfPath }
    }

    if (!payload.taskId) {
      throw new Error('请先选择一个已完成任务报告。')
    }

    const tokens = await authStore.load()
    if (!tokens) {
      throw new Error('Not authenticated')
    }

    const taskApi = await createApiClient()
    const pdfBytes = await taskApi.downloadPdfReport(tokens.access_token, payload.taskId)
    const runtimePaths = await loadRuntimePaths()
    const pdfPath = runtimePaths.pdfReportPathForTask(payload.taskId)
    await mkdir(dirname(pdfPath), { recursive: true })
    await writeFile(pdfPath, Buffer.from(pdfBytes))
    shell.showItemInFolder(pdfPath)
    return { status: 'ready', pdfPath }
  })
```

如果 `runtimePaths.pdfReportPathForTask` 不存在，在 `runtime-paths.ts` 增加方法，返回 task workspace 下 `代码审查报告.pdf`。

- [ ] **Step 7: Preload 暴露 openPdfReport**

在 `code_review_electron/src/preload/index.ts` 增加：

```ts
  openPdfReport: (payload: OpenPdfReportRequest): Promise<OpenPdfReportResult> =>
    ipcRenderer.invoke('report:open-pdf', payload),
```

并更新 `src/preload/index.test.ts` 断言。

- [ ] **Step 8: TaskPage 改按钮和状态**

在 `TaskPage.tsx`：

1. 新增 `currentPdfPath` state/ref。
2. `handleTaskSuccess` 中保存 `task.pdfPath`。
3. `handleViewReport` 切换历史任务时清空本地 PDF 路径。
4. 把按钮文案改成 `查看PDF报告`。
5. 点击时调用：

```ts
await window.codeReview.openPdfReport({
  taskId: selectedTaskIdRef.current,
  localPdfPath: currentPdfPathRef.current
})
```

6. 成功提示：

```ts
setReportMessage(`PDF报告位置：${result.pdfPath}`)
```

7. 404 或缺失时提示：

```ts
setError('该历史任务没有 PDF 报告，请查看 Markdown 或重新生成报告。')
```

- [ ] **Step 9: 运行 Electron UI/IPC 测试确认通过**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx
```

Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add code_review_electron/src/shared/types.ts code_review_electron/src/renderer/src/code-review-api.ts code_review_electron/src/main/api-client.ts code_review_electron/src/main/ipc.ts code_review_electron/src/main/runtime-paths.ts code_review_electron/src/preload/index.ts code_review_electron/src/renderer/src/components/TaskPage.tsx code_review_electron/src/main/__tests__/api-client.test.ts code_review_electron/src/main/__tests__/ipc.test.ts code_review_electron/src/preload/index.test.ts code_review_electron/src/renderer/src/components/TaskPage.test.tsx
git commit -m "新增客户端PDF报告查看和下载入口"
```

---

### Task 4: 服务端 Web 增加 PDF 下载入口

**Files:**
- Modify: `code_review_server/frontend/src/client/types.gen.ts`
- Modify: `code_review_server/frontend/src/components/Tasks/TasksPage.tsx`
- Test: `code_review_server/frontend/tests/tasks.spec.ts`

- [ ] **Step 1: 写失败测试或组件断言**

在 `code_review_server/frontend/tests/tasks.spec.ts` 的任务列表测试中，使用测试后端数据创建一条带 `pdf_report_path` 的成功任务，并增加断言：

```ts
await expect(page.getByRole("button", { name: "下载 PDF 报告" })).toBeVisible()
```

- [ ] **Step 2: 同步前端类型**

运行 OpenAPI 生成：

```bash
cd code_review_server/frontend
npm run generate-client
```

- [ ] **Step 3: 修改 TasksPage 下载函数**

在 `code_review_server/frontend/src/components/Tasks/TasksPage.tsx` 中扩展 action：

```ts
function reportUrl(task: ReviewTask, action: "report" | "download" | "pdf/download") {
  return `${OpenAPI.BASE}/api/v1/review-tasks/${task.id}/${action}`
}
```

增加：

```ts
async function downloadPdfReport(task: ReviewTask) {
  const blob = await fetchReport(task, "pdf/download")
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = `review-task-${task.id}.pdf`
  link.click()
}
```

- [ ] **Step 4: 增加 PDF 下载按钮**

在 Markdown 下载按钮后增加：

```tsx
{task.pdf_report_path ? (
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    aria-label="下载 PDF 报告"
    onClick={() => void downloadPdfReport(task)}
  >
    <FileDown />
  </Button>
) : null}
```

如果 `FileDown` 未导入，从 `lucide-react` 导入：

```ts
import { Download, ExternalLink, FileDown, Trash2 } from "lucide-react"
```

- [ ] **Step 5: 运行前端检查**

Run:

```bash
cd code_review_server/frontend
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add code_review_server/frontend/src/client/types.gen.ts code_review_server/frontend/src/components/Tasks/TasksPage.tsx code_review_server/frontend/tests/tasks.spec.ts
git commit -m "新增服务端任务列表PDF下载入口"
```

---

### Task 5: 全量验证和收尾

**Files:**
- No production files unless verification finds gaps.

- [ ] **Step 1: Electron 验证**

Run:

```bash
cd code_review_electron
npm test -- src/main/__tests__/report-pdf-generator.test.ts src/main/__tests__/report-uploader.test.ts src/main/__tests__/task-agent.test.ts src/main/__tests__/api-client.test.ts src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx
npm run typecheck
```

Expected: PASS。

- [ ] **Step 2: 后端验证**

Run:

```bash
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

Expected: PASS。

- [ ] **Step 3: 前端验证**

Run:

```bash
cd code_review_server/frontend
npm run build
```

Expected: PASS。

- [ ] **Step 4: 人工冒烟路径**

启动后端、前端和 Electron 客户端后验证：

1. 新建审查任务。
2. 任务完成后服务端任务记录包含 `report_path` 和 `pdf_report_path`。
3. Electron 右侧显示 Markdown。
4. 点击“查看PDF报告”打开本地 PDF。
5. 换一台电脑或清空本机 PDF 缓存后，点击历史任务“查看报告”显示 Markdown，再点“查看PDF报告”从服务端下载 PDF。

- [ ] **Step 5: 最终状态检查**

Run:

```bash
git status --short
git log --oneline main..HEAD
```

Expected: 工作区干净；提交只包含正式 PDF 功能和设计/计划文档。

---

## Self-Review

- Spec coverage: 覆盖自动生成 PDF、上传 Markdown + PDF、跨电脑下载 PDF、旧任务无 PDF 兼容、服务端 Web 下载入口、测试分支不合并。
- Placeholder scan: 没有 TBD/TODO/待定；迁移文件名、接口路径、字段名和命令均为确定值。
- Type consistency: 后端字段统一为 `pdf_report_path` / `pdf_report_name`；Electron 本地返回字段统一为 `pdfPath`；服务端接口统一为 `pdf-report` 上传和 `pdf/download` 下载。
