# Electron SVN 历史框、反馈工具窗口与 SVN 预检 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 SVN 地址历史交互，将“有帮助”表单迁移到可移出主客户端的原生工具窗口，并在 Codex 启动前完成与后端契约一致的 SVN 参数和可访问性预检。

**Architecture:** 改动按四个职责单元落地：后端先收紧版本顺序契约，`TaskForm` 独立处理内联历史列表，主进程窗口管理器承载反馈会话和草稿，`svn-preflight.ts` 在环境检查与工作区准备之间校验 SVN。反馈窗口使用独立 renderer/preload 多入口和最小 IPC API；预检使用环境检查探测到的 SVN 命令、相同进程环境与当前 Windows 用户的 SVN 认证缓存。

**Tech Stack:** Python 3 / FastAPI / SQLModel / pytest；Electron 39 / electron-vite 4 / React 19 / TypeScript 5.9 / Vitest / Testing Library；SVN CLI。

## Global Constraints

- 权威设计为 `docs/superpowers/specs/2026-07-10-electron-svn-history-feedback-window-preflight-design.md`。
- 版本契约固定为：`r0`/`0` 表示全量审查；其他情况必须满足 `old < new`；后端参数错误返回 HTTP 400 且不创建任务。
- 后端必须先部署，Electron 客户端随后发布，禁止反向发布。
- SVN 历史最多保留 3 条，列表必须位于正常文档流中，不得覆盖版本字段。
- 反馈窗口必须是单实例、非模态、有 `parent`、无全局 `alwaysOnTop`，允许移出主窗口边界。
- 原生关闭按钮销毁反馈窗口；“稍后提交”只隐藏窗口；草稿仅保存在主进程内存。
- 预检保持 `checking_environment` 状态，不增加后端状态枚举；每次 `svn info` 独立超时 30 秒。
- 预检必须发生在 `prepareWorkspace`、需求文件上传、Codex 和报告生成之前。
- 用户可读预检错误使用 `preflightErrorMessages`，不得再次经过 `sanitizeErrorSummary`；原始 stderr 只能分类并经专用脱敏后写受控日志。
- Electron IPC invoke 通道顺序必须与 `src/main/__tests__/ipc.test.ts` 的全等数组一致；send/listen 事件不进入该数组。
- 不修改无关的 `Agent/tb-ai-platform/public/index.html`、`Agent/tb-ai-platform/public/styles.css`，也不处理现有 `stash@{0}`。

## 实施注意事项

1. **SVN 凭据链路：** 当前实际审查不会把服务端 `/me/svn-credential` 返回的账号密码注入 Codex 或本地 SVN 子进程，而是由当前 Windows 用户运行 SVN CLI，并读取 SVN 全局认证缓存。预检必须使用同一 `svnCommand`、同一 `buildVersionCommandOptions()` 环境和同一 OS 用户，附加 `--non-interactive` 仅阻止交互等待，不得另取或拼接服务端凭据。
2. **历史反向任务：** 新客户端重试旧时代创建的 `old > new` 历史任务时会在预检防御性校验阶段失败，这是预期兼容性变化。发布说明必须明确“反向版本历史任务不可重试，请新建合法版本范围任务”。
3. **Windows shell 注入备忘：** 本次保持与环境检查一致的 `buildVersionCommandOptions()`，Windows 仍为 `shell: true`。命令必须继续使用 `spawn(command, args)` 的参数数组，禁止自行拼接命令字符串；另在发布说明记录后续安全改造应评估 `shell: false + 绝对 svnPath`。本次不扩大到安装器和既有 SVN 命令链路的统一重构。
4. **测试夹具范围：** 实施前执行 `rg -n "_create_review_task\\(" code_review_server/backend/tests/api/routes/test_review_tasks.py`，确认所有调用点。辅助函数必须根据 `old_revision` 计算合法的默认 `new_revision`，不能逐个修改无关测试数据。

## File Map

- Modify `code_review_server/backend/app/api/routes/review_tasks.py`: 服务端版本顺序校验。
- Modify `code_review_server/backend/tests/api/routes/test_review_tasks.py`: 反向范围契约和合法夹具。
- Modify `CLAUDE.md`: 400/422 契约说明。
- Modify `code_review_server/release-notes.md`: 发布顺序和历史反向任务兼容性说明。
- Modify `code_review_electron/src/renderer/src/components/TaskForm.tsx`: 历史过滤、收起和键盘行为。
- Modify `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`: 历史框回归测试。
- Modify `code_review_electron/src/renderer/src/styles.css`: 内联历史列表；移除主页面反馈弹窗样式。
- Create `code_review_electron/src/shared/report-feedback-window.ts`: 双 renderer 与主进程共享的反馈会话、草稿和 IPC payload 类型。
- Create `code_review_electron/src/main/report-feedback-window.ts`: BrowserWindow、草稿 Map、会话校验和生命周期。
- Create `code_review_electron/src/main/__tests__/report-feedback-window.test.ts`: 窗口管理器单元测试。
- Modify `code_review_electron/src/main/index.ts`: 窗口管理器注入和退出清理。
- Modify `code_review_electron/src/main/ipc.ts`: 反馈窗口 invoke handlers、提交业务复用和 sender 校验。
- Modify `code_review_electron/src/main/__tests__/ipc.test.ts`: IPC 顺序和反馈 handler 测试。
- Modify `code_review_electron/src/preload/index.ts`: 主窗口 open/sync 和事件监听 API。
- Modify `code_review_electron/src/preload/index.test.ts`: 主窗口反馈 API 契约。
- Create `code_review_electron/src/preload/report-feedback.ts`: 反馈窗口最小 preload。
- Create `code_review_electron/src/preload/report-feedback.test.ts`: 专用 preload 契约测试。
- Modify `code_review_electron/src/renderer/src/code-review-api.ts`: 主窗口 API 类型。
- Create `code_review_electron/src/renderer/feedback.html`: 独立反馈 renderer HTML。
- Create `code_review_electron/src/renderer/src/report-feedback-api.ts`: 反馈窗口全局 API 类型。
- Create `code_review_electron/src/renderer/src/report-feedback-main.tsx`: 反馈 renderer 入口。
- Create `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.tsx`: 独立反馈表单。
- Create `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.test.tsx`: 反馈表单测试。
- Create `code_review_electron/src/renderer/src/report-feedback.css`: 工具窗口专属样式。
- Modify `code_review_electron/electron.vite.config.ts`: renderer/preload 多入口构建。
- Modify `code_review_electron/src/renderer/src/components/TaskPage.tsx`: 打开/同步工具窗口并接收定位、提交事件。
- Modify `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`: 主报告联动和会话失效测试。
- Create `code_review_electron/src/main/svn-preflight.ts`: 参数规范化、`svn info`、超时、取消、分类和日志脱敏。
- Create `code_review_electron/src/main/__tests__/svn-preflight.test.ts`: 预检模块测试。
- Modify `code_review_electron/src/main/environment-checker.ts`: 导出统一 SVN spawn options 构造能力。
- Modify `code_review_electron/src/main/svn-report-name-resolver.ts`: 使用环境检查探测到的 SVN 命令。
- Modify `code_review_electron/src/main/__tests__/svn-report-name-resolver.test.ts`: 命令注入测试。
- Modify `code_review_electron/src/main/task-agent.ts`: 插入预检阶段和专用错误映射。
- Modify `code_review_electron/src/main/__tests__/task-agent.test.ts`: 顺序、失败短路、重试和取消测试。

---

### Task 1: 收紧后端版本契约并修复测试夹具

**Files:**
- Modify: `code_review_server/backend/app/api/routes/review_tasks.py`
- Modify: `code_review_server/backend/tests/api/routes/test_review_tasks.py`
- Modify: `CLAUDE.md`
- Modify: `code_review_server/release-notes.md`

**Interfaces:**
- Consumes: `_normalize_revision(value: str) -> str` 返回 `r` 加十进制数字。
- Produces: `r0` 全量模式或严格 `old < new` 的创建契约；非法顺序返回 HTTP 400。

- [ ] **Step 1: 核实夹具调用范围**

Run:

```powershell
rg -n "_create_review_task\(" code_review_server/backend/tests/api/routes/test_review_tasks.py
```

Expected: 输出辅助函数定义和全部调用点；记录传入 `0`、`1`、大于 `2` 的调用，确认只需改辅助函数默认新版本，不需批量改业务断言。

- [ ] **Step 2: 写反向版本失败测试并改造辅助函数签名**

在 `test_review_tasks.py` 把辅助函数改为显式允许覆盖新版本，并基于旧版本生成合法默认值：

```python
def _revision_number(value: str) -> int:
    return int(value.strip().removeprefix("r").removeprefix("R"))


def _create_review_task(
    client: TestClient,
    headers: dict[str, str],
    old_revision: str = "1",
    new_revision: str | None = None,
) -> dict:
    old_number = _revision_number(old_revision)
    normalized_new_revision = new_revision or f"r{max(old_number + 1, 1)}"
    data = {
        "svn_url": "https://svn.example.com/project/trunk",
        "old_revision": old_revision,
        "new_revision": normalized_new_revision,
    }
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=headers,
        json=data,
    )
    assert response.status_code == 200
    return response.json()
```

在相同版本测试后增加：

```python
def test_create_review_task_rejects_reverse_revision_range(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "r200",
            "new_revision": "r100",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "旧版本号必须小于新版本号"


def test_create_review_task_rejects_zero_new_revision(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/review-tasks",
        headers=normal_user_token_headers,
        json={
            "svn_url": "https://svn.example.com/project/trunk",
            "old_revision": "r1",
            "new_revision": "r0",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "新版本号不能为 0"
```

- [ ] **Step 3: 运行测试确认现有后端实现拒绝测试失败**

Run:

```powershell
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py::test_create_review_task_rejects_reverse_revision_range -q
```

Expected: FAIL，当前接口返回 200。

- [ ] **Step 4: 使用整数比较实现严格顺序校验**

在 `create_review_task` 中替换相同版本判断：

```python
    old_revision = _normalize_revision(task_in.old_revision)
    new_revision = _normalize_revision(task_in.new_revision)
    old_revision_number = int(old_revision[1:])
    new_revision_number = int(new_revision[1:])
    if new_revision_number == 0:
        raise HTTPException(status_code=400, detail="新版本号不能为 0")
    if old_revision_number != 0 and old_revision_number >= new_revision_number:
        raise HTTPException(status_code=400, detail="旧版本号必须小于新版本号")
```

- [ ] **Step 5: 运行路由文件完整测试**

Run:

```powershell
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
```

Expected: PASS；夹具中原先 `old > 2` 的无关测试不因新契约失败。

- [ ] **Step 6: 更新工程契约和发布说明**

把 `CLAUDE.md` §3.4-#3 改为：

```markdown
| 3 | **版本号必须匹配 `r?\d+`；`new > 0`；`old == 0` 或 `old < new`** | 请求结构/缺失字段由模型校验返回 422；版本规范化失败、零值和顺序错误由路由返回 400 |
```

在 `code_review_server/release-notes.md` 的 `Latest Changes` 下增加：

```markdown
### Code Review Platform

* 后端先收紧审查版本范围：除 `r0` 全量审查外必须满足 `old < new`，Electron 客户端随后发布。
* 旧后端创建的 `old > new` 历史任务在新客户端中不可重试；请按正确顺序新建任务。
* 安全备忘：Windows SVN 命令当前沿用 `shell: true`；后续统一评估 `shell: false` 与绝对 `svnPath`，本次不改变既有命令执行链。
```

- [ ] **Step 7: 提交后端契约变更**

```powershell
git add code_review_server/backend/app/api/routes/review_tasks.py code_review_server/backend/tests/api/routes/test_review_tasks.py CLAUDE.md code_review_server/release-notes.md
git commit -m "fix: 收紧审查任务版本顺序契约"
```

### Task 2: 将 SVN 历史记录改为过滤后的内联列表

**Files:**
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskForm.test.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `recentSvnUrls: string[]`，最多 3 条且按最近使用排序。
- Produces: `visibleRecentSvnUrls: string[]` 和不覆盖版本字段的 listbox。

- [ ] **Step 1: 写过滤、精确匹配、键盘和焦点测试**

在 `TaskForm.test.tsx` 增加以下独立用例：

```tsx
it('输入 SVN 地址时只显示忽略大小写的包含匹配项，完全匹配时收起', async () => {
  localStorage.setItem(
    'code-review:recent-svn-urls',
    JSON.stringify(['https://svn.example.com/Alpha', 'https://svn.example.com/Beta'])
  )
  const user = userEvent.setup()
  render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
  const input = screen.getByLabelText('SVN 地址')

  await user.click(input)
  await user.type(input, 'ALPHA')
  expect(screen.getByRole('option', { name: /Alpha/ })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /Beta/ })).not.toBeInTheDocument()

  await user.clear(input)
  await user.type(input, 'https://svn.example.com/Alpha')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('Escape 和 Tab 收起历史列表且 Tab 直接进入旧版本号', async () => {
  localStorage.setItem('code-review:recent-svn-urls', JSON.stringify(['https://svn.example.com/A']))
  const user = userEvent.setup()
  render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
  const svnInput = screen.getByLabelText('SVN 地址')

  await user.click(svnInput)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(svnInput).toHaveFocus()

  await user.click(svnInput)
  expect(screen.getByRole('option')).toHaveAttribute('tabindex', '-1')
  await user.tab()
  expect(screen.getByLabelText('旧版本号')).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

it('点击版本字段不会回填鼠标经过的历史地址', async () => {
  localStorage.setItem('code-review:recent-svn-urls', JSON.stringify(['https://svn.example.com/A']))
  const user = userEvent.setup()
  render(<TaskForm disabled={false} onSubmit={vi.fn()} />)
  const svnInput = screen.getByLabelText('SVN 地址')

  await user.click(svnInput)
  await user.click(screen.getByLabelText('旧版本号'))
  expect(svnInput).toHaveValue('')
  expect(screen.getByLabelText('旧版本号')).toHaveFocus()
})
```

- [ ] **Step 2: 运行 TaskForm 测试确认失败**

Run:

```powershell
cd code_review_electron
npx vitest run src/renderer/src/components/TaskForm.test.tsx
```

Expected: 新用例因未过滤、未处理 Escape/Tab 或缺少 `tabIndex=-1` 而 FAIL。

- [ ] **Step 3: 实现派生过滤结果和关闭规则**

在组件状态后增加：

```tsx
  const visibleRecentSvnUrls = useMemo(() => {
    const query = svnUrl.trim().toLocaleLowerCase()
    if (!query) {
      return recentSvnUrls
    }
    if (recentSvnUrls.some((item) => item.toLocaleLowerCase() === query)) {
      return []
    }
    return recentSvnUrls.filter((item) => item.toLocaleLowerCase().includes(query))
  }, [recentSvnUrls, svnUrl])
  const showSvnHistory = isSvnHistoryOpen && visibleRecentSvnUrls.length > 0
```

输入框与列表改为：

```tsx
<input
  id="svn-url-input"
  required
  value={svnUrl}
  placeholder="https://svn.example.com/project/trunk"
  aria-haspopup="listbox"
  aria-expanded={showSvnHistory}
  onFocus={() => setIsSvnHistoryOpen(true)}
  onBlur={() => setIsSvnHistoryOpen(false)}
  onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      setIsSvnHistoryOpen(false)
    }
  }}
  onChange={(event) => {
    setSvnUrl(event.target.value)
    setIsSvnHistoryOpen(true)
  }}
/>
{showSvnHistory ? (
  <div className="svn-url-history-list" role="listbox" aria-label="最近 SVN 地址">
    {visibleRecentSvnUrls.map((recentSvnUrl) => (
      <button
        key={recentSvnUrl}
        type="button"
        tabIndex={-1}
        className="svn-url-history-item"
        role="option"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setSvnUrl(recentSvnUrl)
          setIsSvnHistoryOpen(false)
        }}
      >
        {recentSvnUrl}
      </button>
    ))}
  </div>
) : null}
```

为两个版本输入分别增加 `aria-label="旧版本号"`、`aria-label="新版本号"`，保持测试和可访问名称稳定。

- [ ] **Step 4: 移除绝对定位并约束长地址**

把 `.svn-url-history-list`/`.svn-url-history-item` 改为正常文档流：

```css
.svn-url-history-list {
  display: grid;
  width: 100%;
  margin-top: 6px;
  overflow: hidden;
  border: 1px solid #c7ccd4;
  border-radius: 6px;
  background: #fff;
}

.svn-url-history-item {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  border: 0;
  border-bottom: 1px solid #e4e7eb;
  background: transparent;
  color: #28313d;
  text-align: left;
}
```

确保规则中不再存在 `.svn-url-history-list { position: absolute; ... }`。

- [ ] **Step 5: 运行组件测试和类型检查**

```powershell
cd code_review_electron
npx vitest run src/renderer/src/components/TaskForm.test.tsx
npm run typecheck
```

Expected: 两条命令 PASS。

- [ ] **Step 6: 提交历史框改动**

```powershell
git add code_review_electron/src/renderer/src/components/TaskForm.tsx code_review_electron/src/renderer/src/components/TaskForm.test.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "fix: 优化 SVN 地址历史交互"
```

### Task 3: 定义反馈窗口共享契约

**Files:**
- Create: `code_review_electron/src/shared/report-feedback-window.ts`
- Create: `code_review_electron/src/renderer/src/report-feedback-api.ts`
- Modify: `code_review_electron/src/renderer/src/code-review-api.ts`

**Interfaces:**
- Produces: `ReportFeedbackSession`、`ReportFeedbackDraft`、`OpenReportFeedbackWindowPayload`、`UpdateReportFeedbackDraftPayload`、`FocusReportAnchorPayload`、`SubmitReportFeedbackWindowPayload`。
- Consumers: Tasks 4-6 的 preload、窗口管理器、IPC 和两个 renderer。

- [ ] **Step 1: 创建共享类型，固定 `show`/`sync` 语义**

`src/shared/report-feedback-window.ts` 完整定义：

```ts
export interface ReportFeedbackOption {
  id: string
  text: string
  anchorId: string
}

export interface ReportFeedbackDraft {
  selectedIssueTexts: string[]
  manualText: string
  updatedAt: number
}

export interface ReportFeedbackSession {
  taskId: string
  allowed: boolean
  options: ReportFeedbackOption[]
  draft: ReportFeedbackDraft
}

export interface OpenReportFeedbackWindowPayload {
  mode: 'show' | 'sync'
  taskId: string
  allowed: boolean
  options: ReportFeedbackOption[]
}

export interface UpdateReportFeedbackDraftPayload {
  taskId: string
  selectedIssueTexts: string[]
  manualText: string
}

export interface FocusReportAnchorPayload {
  taskId: string
  anchorId?: string
}

export interface SubmitReportFeedbackWindowPayload {
  taskId: string
}

export interface ReportFeedbackWindowSubmitResult {
  status: 'submitted' | 'already_exists'
  taskId: string
  usefulIssuesText: string
}
```

`mode: 'sync'` 只更新或失效现有会话，绝不创建窗口；`mode: 'show'` 才创建/显示/聚焦窗口。

- [ ] **Step 2: 扩展主窗口 API 类型并定义反馈窗口最小 API**

在 `CodeReviewApi` 增加：

```ts
openReportFeedbackWindow(payload: OpenReportFeedbackWindowPayload): Promise<true>
onReportFeedbackFocusAnchor(callback: (payload: FocusReportAnchorPayload) => void): () => void
onReportFeedbackSubmitted(callback: (payload: ReportFeedbackWindowSubmitResult) => void): () => void
```

新建 `report-feedback-api.ts`：

```ts
import type {
  FocusReportAnchorPayload,
  ReportFeedbackSession,
  ReportFeedbackWindowSubmitResult,
  SubmitReportFeedbackWindowPayload,
  UpdateReportFeedbackDraftPayload
} from '../../shared/report-feedback-window'

export interface ReportFeedbackWindowApi {
  getSession(): Promise<ReportFeedbackSession | null>
  updateDraft(payload: UpdateReportFeedbackDraftPayload): Promise<ReportFeedbackSession>
  focusAnchor(payload: FocusReportAnchorPayload): Promise<true>
  submit(payload: SubmitReportFeedbackWindowPayload): Promise<ReportFeedbackWindowSubmitResult>
  hide(taskId: string): Promise<true>
  onSessionUpdated(callback: (session: ReportFeedbackSession) => void): () => void
  onInvalidated(callback: (payload: { taskId: string }) => void): () => void
}

declare global {
  interface Window {
    reportFeedback: ReportFeedbackWindowApi
  }
}
```

- [ ] **Step 3: 运行类型检查验证共享契约闭合**

```powershell
cd code_review_electron
npm run typecheck
```

Expected: PASS；主窗口和反馈窗口 API 引用的共享 payload/返回类型均能解析。

- [ ] **Step 4: 提交共享契约**

```powershell
git add code_review_electron/src/shared/report-feedback-window.ts code_review_electron/src/renderer/src/report-feedback-api.ts code_review_electron/src/renderer/src/code-review-api.ts
git commit -m "feat: 定义报告反馈窗口共享契约"
```

### Task 4: 实现专用 preload 和反馈窗口 React 界面

**Files:**
- Modify: `code_review_electron/electron.vite.config.ts`
- Create: `code_review_electron/src/renderer/feedback.html`
- Create: `code_review_electron/src/preload/report-feedback.ts`
- Create: `code_review_electron/src/preload/report-feedback.test.ts`
- Create: `code_review_electron/src/renderer/src/report-feedback-main.tsx`
- Create: `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.tsx`
- Create: `code_review_electron/src/renderer/src/components/ReportFeedbackWindow.test.tsx`
- Create: `code_review_electron/src/renderer/src/report-feedback.css`

**Interfaces:**
- Consumes: Task 3 的共享类型和 `window.reportFeedback` 类型。
- Produces: 最小权限 preload 与可独立加载的反馈工具窗口。

- [ ] **Step 1: 写专用 preload 契约测试**

测试应断言只暴露 `reportFeedback`，并验证 5 个 invoke 和 2 个监听通道：

```ts
expect(Object.keys(api).sort()).toEqual([
  'focusAnchor', 'getSession', 'hide', 'onInvalidated',
  'onSessionUpdated', 'submit', 'updateDraft'
])
await api.getSession()
expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:get-session')
await api.hide('task-1')
expect(invokeMock).toHaveBeenCalledWith('report-feedback-window:hide', { taskId: 'task-1' })
```

监听函数必须返回调用 `removeListener(channel, listener)` 的清理函数。

- [ ] **Step 2: 运行 preload 测试确认失败**

```powershell
cd code_review_electron
npx vitest run src/preload/report-feedback.test.ts
```

Expected: FAIL，因为专用 preload 尚不存在。

- [ ] **Step 3: 实现最小 preload**

`report-feedback.ts` 只导入 `contextBridge`/`ipcRenderer`，用统一 helper 注册监听，禁止暴露登录、任务执行、更新安装和文件读取 API：

```ts
const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('reportFeedback', {
  getSession: () => ipcRenderer.invoke('report-feedback-window:get-session'),
  updateDraft: (payload) => ipcRenderer.invoke('report-feedback-window:update-draft', payload),
  focusAnchor: (payload) => ipcRenderer.invoke('report-feedback-window:focus-anchor', payload),
  submit: (payload) => ipcRenderer.invoke('report-feedback-window:submit', payload),
  hide: (taskId: string) => ipcRenderer.invoke('report-feedback-window:hide', { taskId }),
  onSessionUpdated: (callback) => subscribe('report-feedback-window:session-updated', callback),
  onInvalidated: (callback) => subscribe('report-feedback-window:invalidated', callback)
} satisfies ReportFeedbackWindowApi)
```

- [ ] **Step 4: 写反馈组件测试**

覆盖：初始 `getSession`、勾选后更新草稿并定位锚点、取消当前项清空高亮、手工文本、空内容禁用提交、提交错误保留草稿、“稍后提交”调用 hide、invalidated 后关闭页面状态。关键断言：

```tsx
await user.click(screen.getByRole('checkbox', { name: '空指针风险' }))
expect(api.updateDraft).toHaveBeenCalledWith({
  taskId: 'task-1',
  selectedIssueTexts: ['空指针风险'],
  manualText: ''
})
expect(api.focusAnchor).toHaveBeenCalledWith({ taskId: 'task-1', anchorId: 'anchor-1' })
```

- [ ] **Step 5: 实现反馈窗口组件、HTML 和 renderer 入口**

组件只持有 session 展示状态；每次编辑先调用 `updateDraft`，以主进程返回的 session 为准。提交内容由主进程根据 option ID 和 manualText 统一编号，renderer 不直接调用旧 `report-feedback:submit`。

入口固定为：

```tsx
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ReportFeedbackWindow />
  </React.StrictMode>
)
```

`feedback.html` 只包含 `#root` 并加载 `/src/report-feedback-main.tsx`，不加载主应用入口。

样式使用原生标题栏，不设置 `-webkit-app-region: drag`，窗口移动完全交给 BrowserWindow；固定最小宽度，长问题文本 `overflow-wrap: anywhere`，操作区保持可见。

- [ ] **Step 6: 配置 renderer/preload 多入口**

把 `electron.vite.config.ts` 配置为：

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'report-feedback': resolve(__dirname, 'src/preload/report-feedback.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          feedback: resolve(__dirname, 'src/renderer/feedback.html')
        }
      }
    }
  }
})
```

- [ ] **Step 7: 运行专用测试、类型检查和构建**

```powershell
cd code_review_electron
npx vitest run src/preload/report-feedback.test.ts src/renderer/src/components/ReportFeedbackWindow.test.tsx
npm run typecheck
npm run build
```

Expected: 全部 PASS；`out/renderer/feedback.html` 和 `out/preload/report-feedback.mjs`（或 `.js`）存在。多 preload 入口的产物命名取决于 electron-vite 对 rollupOptions input key 的处理；若实际产物名不符，在此步调整 `electron.vite.config.ts` 的 input key 与 `resolveReportFeedbackPreloadPath()` 使其对齐，不得回退到单入口。

- [ ] **Step 8: 提交构建入口和反馈界面**

```powershell
git add code_review_electron/electron.vite.config.ts code_review_electron/src/preload/report-feedback.ts code_review_electron/src/preload/report-feedback.test.ts code_review_electron/src/renderer/feedback.html code_review_electron/src/renderer/src/report-feedback-main.tsx code_review_electron/src/renderer/src/components/ReportFeedbackWindow.tsx code_review_electron/src/renderer/src/components/ReportFeedbackWindow.test.tsx code_review_electron/src/renderer/src/report-feedback.css
git commit -m "feat: 新增报告反馈工具窗口入口"
```

### Task 5: 实现反馈 BrowserWindow 与内存会话管理器

**Files:**
- Create: `code_review_electron/src/main/report-feedback-window.ts`
- Create: `code_review_electron/src/main/__tests__/report-feedback-window.test.ts`
- Modify: `code_review_electron/src/main/index.ts`
- Modify: `code_review_electron/src/main/ipc.ts`: 仅扩展 `registerIpcHandlers` 的依赖类型以注入 manager（反馈窗口 handler 注册仍在 Task 6）。

**Interfaces:**
- Consumes: `OpenReportFeedbackWindowPayload` 和 Task 3 共享类型。
- Produces: `ReportFeedbackWindowManager`，方法为 `openOrSync`、`getSessionForSender`、`updateDraftForSender`、`hideForSender`、`invalidateTask`、`clearAllDrafts`、`destroy`、`isFeedbackSender`、`isMainSender`。

- [ ] **Step 1: 写窗口管理器生命周期测试**

使用注入的 `createWindow` mock 覆盖：

- `mode=sync` 且无窗口时不创建。
- `mode=show` 创建一次，设置 `parent`、`modal:false`、`alwaysOnTop:false`、`autoHideMenuBar:true`、`show:false`。
- `ready-to-show` 才 `show()`；再次 show 复用并 `focus()`。
- 开发加载 `${ELECTRON_RENDERER_URL}/feedback.html`，生产加载 `../renderer/feedback.html`。
- preload 解析 `report-feedback.mjs` 后回退 `.js`。
- 原生 close 后窗口引用清空但草稿保留；hide 不销毁。
- 主窗口 minimize 隐藏，restore 恢复；主窗口 closed 销毁。
- 不允许反馈、任务失效、提交成功清草稿并发送 invalidated。
- sender 或 taskId 不匹配时抛出 `Invalid report feedback window sender/session`。

- [ ] **Step 2: 运行窗口管理器测试确认失败**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/report-feedback-window.test.ts
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现管理器构造依赖与窗口选项**

核心构造类型固定为：

```ts
export interface ReportFeedbackWindowManagerDependencies {
  getMainWindow: () => BrowserWindow | undefined
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow
  rendererUrl?: string
  preloadPath?: string
}

export class ReportFeedbackWindowManager {
  private feedbackWindow?: BrowserWindow
  private session?: ReportFeedbackSession
  private readonly drafts = new Map<string, ReportFeedbackDraft>()
}
```

窗口选项固定包含：

```ts
{
  width: 520,
  height: 680,
  minWidth: 420,
  minHeight: 520,
  parent: mainWindow,
  modal: false,
  show: false,
  autoHideMenuBar: true,
  alwaysOnTop: false,
  title: '报告有用信息反馈',
  webPreferences: {
    preload: resolveReportFeedbackPreloadPath(),
    sandbox: false,
    contextIsolation: true
  }
}
```

初始位置以主窗口 bounds 右上区域为基准，并通过 `screen.getDisplayMatching()` 限制在当前显示器 workArea 内；之后不监听 move，不把用户拖动位置夹回主窗口。

- [ ] **Step 4: 实现草稿与会话失效规则**

默认草稿为 `{ selectedIssueTexts: [], manualText: '', updatedAt: Date.now() }`。更新时只保留当前 options 中存在且去重后的问题文本，manualText 最大 4096 字符；切换 taskId 从 `Map` 读取各自草稿。`allowed=false` 或当前任务变更时向窗口发送 invalidated 并销毁窗口；普通原生 close 不清草稿。

- [ ] **Step 5: 在主进程创建单实例并清理退出状态**

`index.ts` 在模块级创建 manager，`registerIpcHandlers` 注入 manager。`before-quit` 完成活动任务清理时调用 `manager.destroy({ clearDrafts: true })`。当前产品没有独立“退出登录”动作，不能把 `credentials:clear`（仅清记住的登录信息）误当退出登录；管理器保留 `clearAllDrafts()`，未来真实 logout handler 必须调用它。草稿按 `taskId` 索引，而任务读取受后端权限隔离（普通用户只看自己的任务、部门管理员只看本部门），换账号登录的用户看不到他人任务，也就无法触发他人 `taskId` 的反馈窗口读取对应草稿；`clearAllDrafts()` 仍需在真实 logout 调用，作为显式清理补充。

- [ ] **Step 6: 运行窗口管理器测试**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/report-feedback-window.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交窗口管理器**

```powershell
git add code_review_electron/src/main/report-feedback-window.ts code_review_electron/src/main/__tests__/report-feedback-window.test.ts code_review_electron/src/main/index.ts
git commit -m "feat: 管理报告反馈原生工具窗口"
```

### Task 6: 接通反馈 IPC 与主报告联动

**Files:**
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/__tests__/ipc.test.ts`
- Modify: `code_review_electron/src/preload/index.ts`
- Modify: `code_review_electron/src/preload/index.test.ts`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.tsx`
- Modify: `code_review_electron/src/renderer/src/components/TaskPage.test.tsx`
- Modify: `code_review_electron/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `ReportFeedbackWindowManager` 和既有 `ApiClient.submitReportFeedback`/PDF 打开逻辑。
- Produces: 6 个 invoke handlers、主窗口 3 个 API、锚点定位和提交完成事件。

- [ ] **Step 1: 更新 IPC 顺序测试并写 sender/session 安全测试**

在 `ipc.test.ts` 的全等数组中紧邻既有 `report-feedback:submit` 插入：

```ts
'report-feedback-window:open',
'report-feedback-window:get-session',
'report-feedback-window:update-draft',
'report-feedback-window:focus-anchor',
'report-feedback-window:submit',
'report-feedback-window:hide',
```

另写测试：主窗口 sender 才能 open；反馈 sender 才能 get/update/focus/submit/hide；taskId 不匹配拒绝；submit 成功和 `report_feedback_exists` 都清草稿并通知主窗口；其他错误保留草稿。

- [ ] **Step 2: 运行 IPC 测试确认失败**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/ipc.test.ts -t "registers only|report feedback window"
```

Expected: FAIL，新增通道未注册。

- [ ] **Step 3: 抽取反馈提交业务函数并注册 handlers**

把旧 `report-feedback:submit` 和新窗口 submit 都调用同一函数：

```ts
const submitReportFeedback = async (
  taskId: string,
  helpful: boolean,
  usefulIssuesText: string | null
): Promise<ReportFeedbackResult> => {
  const tokens = await authStore.load()
  if (!tokens) throw new Error('Not authenticated')
  const api = await createApiClient()
  return api.submitReportFeedback(tokens.access_token, taskId, {
    helpful,
    useful_issues_text: usefulIssuesText
  })
}
```

旧 `report-feedback:submit` 把 payload 的 `helpful` 传给该函数；窗口 submit 固定传 `true`，并先从 manager 当前 session/draft 生成去重、统一编号的文本，不信任 renderer 直接提交的文本。捕获 `ApiError` 中 `report_feedback_exists`，返回 `already_exists`；成功/已存在都向主窗口发送 `report-feedback-window:submitted`，随后 manager 清草稿并销毁窗口。所有反馈窗口 invoke handler 必须按以下顺序在 `registerIpcHandlers` 中注册，且与 `ipc.test.ts` 的全等数组完全一致：`open`、`get-session`、`update-draft`、`focus-anchor`、`submit`、`hide`，紧跟既有 `report-feedback:submit` 之后。“没帮助”流程不打开工具窗口，仍由 TaskPage 直接调用现有 `window.codeReview.submitReportFeedback({ helpful: false, ... })`（旧 `report-feedback:submit` 通道）提交并打开 PDF；只有“有帮助”才走新的工具窗口 submit。

- [ ] **Step 4: 实现主窗口 preload API 和事件清理**

新增：

```ts
openReportFeedbackWindow: (payload) =>
  ipcRenderer.invoke('report-feedback-window:open', payload),
onReportFeedbackFocusAnchor: (callback) =>
  subscribe('report-feedback-window:focus-anchor-requested', callback),
onReportFeedbackSubmitted: (callback) =>
  subscribe('report-feedback-window:submitted', callback),
```

在 `preload/index.test.ts` 断言 channel、payload 和 removeListener。

- [ ] **Step 5: 把 TaskPage 内嵌弹窗测试改为工具窗口契约测试**

删除“弹窗可以拖动”DOM 测试，新增：

```tsx
await user.click(screen.getByRole('button', { name: '有帮助' }))
expect(window.codeReview.openReportFeedbackWindow).toHaveBeenCalledWith({
  mode: 'show',
  taskId: 'task-1',
  allowed: true,
  options: expect.arrayContaining([
    expect.objectContaining({ text: expect.any(String), anchorId: expect.any(String) })
  ])
})
```

覆盖 `focus-anchor-requested` 只在当前选中 taskId 匹配时滚动/高亮；不匹配时发 `mode:'sync', allowed:false` 使会话失效；`submitted` 更新 task feedback 并调用现有 PDF 打开 API。

- [ ] **Step 6: 精简 TaskPage 状态和实现会话同步**

删除 `showUsefulFeedbackDialog`、位置、drag offset、dialog ref、Pointer Event listeners 和内嵌 `<section role="dialog">`。保留 `activeFeedbackAnchorId` 和滚动请求。点击“有帮助/继续标记”调用 `mode:'show'`；任务选择、状态、候选项变化时调用 `mode:'sync'`，但无窗口时 manager 不创建。

取消选择当前高亮项时，反馈窗口发送 `anchorId: undefined`，TaskPage 清除高亮且不滚动。“没帮助”按钮、`handleSubmitReportFeedback(false)` 及其调用 `window.codeReview.submitReportFeedback` 的链路保持不变，本任务只迁移“有帮助”弹窗，不改动“没帮助”直达提交逻辑。

- [ ] **Step 7: 移除旧反馈弹窗 CSS**

删除 `.report-feedback-dialog*`、`.report-feedback-option*`、`.report-feedback-dialog-field*` 等仅供主页面弹窗使用的规则；保留工具栏 `.report-feedback-actions` 和 `.report-feedback-copy`。

- [ ] **Step 8: 运行反馈链路测试**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/ipc.test.ts src/preload/index.test.ts src/renderer/src/components/TaskPage.test.tsx src/renderer/src/components/ReportFeedbackWindow.test.tsx
npm run typecheck
npm run build
```

Expected: 全部 PASS。

- [ ] **Step 9: 提交反馈窗口跨端链路**

```powershell
git add code_review_electron/src/main/ipc.ts code_review_electron/src/main/__tests__/ipc.test.ts code_review_electron/src/preload/index.ts code_review_electron/src/preload/index.test.ts code_review_electron/src/renderer/src/components/TaskPage.tsx code_review_electron/src/renderer/src/components/TaskPage.test.tsx code_review_electron/src/renderer/src/styles.css
git commit -m "feat: 接通报告反馈工具窗口交互"
```

### Task 7: 实现独立 SVN 预检模块

**Files:**
- Create: `code_review_electron/src/main/svn-preflight.ts`
- Create: `code_review_electron/src/main/__tests__/svn-preflight.test.ts`
- Modify: `code_review_electron/src/main/environment-checker.ts`

**Interfaces:**
- Produces: `runSvnPreflight(input, dependencies?) -> Promise<SvnPreflightResult>`、`SvnPreflightError`、`SvnPreflightErrorCode`、`sanitizeSvnDiagnostic`。
- Consumers: Task 8 的 `task-agent.ts`。

- [ ] **Step 1: 写参数和 args 构造测试**

覆盖空 URL、非数字、`new=0`、相同版本、反向版本、`r0`、`R12`，并断言 peg URL：

```ts
expect(buildSvnInfoArgs('https://svn.example.com/trunk', 'R12')).toEqual([
  'info',
  '--non-interactive',
  '-r',
  '12',
  'https://svn.example.com/trunk@12'
])
```

`r0` 只跳过旧版本命令，新版本仍必须校验。

- [ ] **Step 2: 写命令执行、分类、超时和取消测试**

注入 `runCommand` fake，覆盖：新版本先于旧版本；新版本失败后不执行旧版本；认证、权限、路径/版本不存在、网络、启动失败；每次 30 秒超时；AbortSignal 杀子进程并抛 `CANCELLED`。stderr 脱敏测试必须删除 URL 凭据、完整 SVN URL、本地路径、username/password/token；注入的 `logDiagnostic` 只能收到脱敏结果。

- [ ] **Step 3: 运行预检测试确认失败**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/svn-preflight.test.ts
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 4: 定义稳定错误码和输入类型**

```ts
export type SvnPreflightErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_REVISION_ORDER'
  | 'PATH_NOT_FOUND'
  | 'NEW_REVISION_UNAVAILABLE'
  | 'OLD_REVISION_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_FAILED'
  | 'TIMEOUT'
  | 'CLI_START_FAILED'
  | 'CANCELLED'

export interface SvnPreflightInput {
  svnUrl: string
  oldRevision: string
  newRevision: string
  svnCommand: string
  commandOptions: SpawnOptionsWithoutStdio
  signal?: AbortSignal
}

export interface SvnPreflightResult {
  svnUrl: string
  oldRevision: string
  newRevision: string
}

export interface RunSvnCommandInput {
  command: string
  args: string[]
  options: SpawnOptionsWithoutStdio
  timeoutMs: number
  signal?: AbortSignal
}

export interface RunSvnCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type RunSvnCommand = (input: RunSvnCommandInput) => Promise<RunSvnCommandResult>

export interface SvnPreflightDependencies {
  runCommand?: RunSvnCommand
  logDiagnostic?: (message: string) => void
}

export class SvnPreflightError extends Error {
  constructor(
    public readonly code: SvnPreflightErrorCode,
    message: string,
    public readonly revision?: string
  ) {
    super(message)
    this.name = 'SvnPreflightError'
  }
}
```

- [ ] **Step 5: 实现参数规范化和顺序校验**

使用 `/^[rR]?\d+$/`，返回纯数字字符串；用 `BigInt` 比较，避免超大版本号溢出。URL 只 trim，不在错误消息中回显。成功返回 `{ svnUrl: trimmedUrl, oldRevision: normalizedOld, newRevision: normalizedNew }`；顺序错误保留稳定 code，不把 CLI stderr 当用户消息。

- [ ] **Step 6: 实现 spawn、30 秒超时和 AbortSignal**

默认 `RunSvnCommand` 固定调用 `spawn(input.command, input.args, input.options)`；使用 args 数组，禁止命令字符串拼接。每一次 `svn info` 传 `timeoutMs: 30_000` 并创建自己的 timer；settle 后清 timer 和 abort listener；timeout/abort 时调用 `child.kill()`。Windows `shell:true` 是既有兼容约束，已在发布说明登记后续安全改造。

- [ ] **Step 7: 明确凭据链路并实现错误分类**

args 只加入 `--non-interactive`，不加入 `--username`/`--password`，不调用 `ApiClient.getSvnCredential`。这确保预检与实际 Codex/Skill 都读取当前 OS 用户的 SVN 全局认证缓存。按 SVN stderr 常见标识（`E170001` 认证、`E170013`/连接、`E200009`/`E160013` 路径或版本）分类，未知非零退出按当前校验对象映射为 NEW/OLD unavailable。原始 stderr 在分类完成后立即丢弃；如需诊断，只把 `sanitizeSvnDiagnostic(stderr)` 交给注入 logger，默认不记录，避免在工作区创建前虚构 task log 路径。

- [ ] **Step 8: 导出一致的命令 options**

保持 `buildVersionCommandOptions(platform)` 为唯一构造函数并供预检调用；如需测试 env 内容，仅导出 `buildCommandEnv`，不要复制 PATH 拼接逻辑。

- [ ] **Step 9: 运行预检和环境测试**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/svn-preflight.test.ts src/main/__tests__/environment-checker.test.ts
npm run typecheck
```

Expected: PASS。

- [ ] **Step 10: 提交预检模块**

```powershell
git add code_review_electron/src/main/svn-preflight.ts code_review_electron/src/main/__tests__/svn-preflight.test.ts code_review_electron/src/main/environment-checker.ts
git commit -m "feat: 新增 SVN 地址与版本预检"
```

### Task 8: 在 task-agent 中前置预检并统一 SVN 命令来源

**Files:**
- Modify: `code_review_electron/src/main/task-agent.ts`
- Modify: `code_review_electron/src/main/__tests__/task-agent.test.ts`
- Modify: `code_review_electron/src/main/ipc.ts`
- Modify: `code_review_electron/src/main/svn-report-name-resolver.ts`
- Modify: `code_review_electron/src/main/__tests__/svn-report-name-resolver.test.ts`

**Interfaces:**
- Consumes: `runSvnPreflight`、`EnvironmentCheckResult.svnPath`、`buildVersionCommandOptions()`。
- Produces: 环境检查后、工作区前的短路行为；报告名解析也使用探测成功的 SVN 命令。

- [ ] **Step 1: 写 task-agent 顺序和失败短路测试**

在 ready 成功用例的 calls 中插入 `preflight`：

```ts
expect(calls).toEqual([
  'status:checking_environment',
  'checkEnvironment',
  'preflight',
  'prepareWorkspace',
  'runCodex',
  'generatePdfReport',
  'uploadReport',
  'uploadPdfReport'
])
```

新增失败测试断言 `prepareWorkspace`、需求上传、Codex、PDF、报告上传均未调用，状态更新为 failed，stage 先出现“校验 SVN 地址和版本”。另覆盖 ready 但无 `svnPath`、历史反向任务重试、预检期间取消优先返回 cancelled。

- [ ] **Step 2: 运行 task-agent 测试确认失败**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/task-agent.test.ts -t "preflight|runs codex|retries"
```

Expected: FAIL，现有流程直接进入 prepareWorkspace。

- [ ] **Step 3: 扩展依赖和工作区输入**

在 `TaskAgentDependencies` 增加：

```ts
preflightSvn: (input: SvnPreflightInput) => Promise<SvnPreflightResult>
```

在 `PrepareWorkspaceInput` 增加 `svnCommand: string`。`createTaskAgentDependencies` 默认注入 `runSvnPreflight`；`ipc.ts` 的 execute/retry 依赖组装也显式传入可测试 override，避免测试走真实 SVN。

- [ ] **Step 4: 在正确位置调用预检**

环境 ready 后执行：

```ts
if (!environment.svnPath) {
  throw new Error('环境检查已通过但未返回 SVN CLI 路径')
}

emitStage(onProgress, task.id, input.clientTaskId, 'checking_environment', '校验 SVN 地址和版本')
await dependencies.preflightSvn({
  svnUrl: task.svn_url,
  oldRevision: task.old_revision,
  newRevision: task.new_revision,
  svnCommand: environment.svnPath,
  commandOptions: buildVersionCommandOptions(),
  signal: input.signal
})
throwIfCancelled(input.signal)
```

随后才 emit `preparing_workspace`，并把 `svnCommand` 传给 workspace。

- [ ] **Step 5: 增加专用用户消息映射**

定义 `preflightErrorMessages(error, task)`，例如：

```ts
case 'NEW_REVISION_UNAVAILABLE':
  return `新版本 ${task.new_revision} 在该 SVN 地址下不存在或不可访问。`
case 'OLD_REVISION_UNAVAILABLE':
  return `旧版本 ${task.old_revision} 在该 SVN 地址下不存在或不可访问。`
case 'AUTHENTICATION_FAILED':
  return 'SVN 认证失败，请先在本机 SVN 客户端更新登录凭据。'
case 'TIMEOUT':
  return 'SVN 地址或版本校验超时，请检查网络后重试。'
```

catch 中先判断取消，再判断 `SvnPreflightError` 并直接使用模板；仅未知错误进入 `sanitizeErrorSummary`。`task-agent` 不读取或记录原始 stderr，预检模块的可选诊断 logger 也只能接收 `sanitizeSvnDiagnostic` 的结果，任何诊断都不得进入服务端 `error_message`。

- [ ] **Step 6: 让报告名解析使用探测成功的命令**

把 resolver 输入扩展为必填 `svnCommand: string`，默认执行器改为闭包；使用 fake `runSvnLog` 的现有测试也传入固定测试命令，避免生产接口保留隐式回退：

```ts
const runSvnLog = input.runSvnLog ?? ((commandInput) =>
  defaultRunSvnLog(input.svnCommand, commandInput)
)
```

生产路径必须传 `environment.svnPath`；只有显式单元测试可注入 fake，不再硬编码 `spawn('svn', ...)`。命令 options 继续使用同一 `buildVersionCommandOptions()`，凭据缓存与预检一致。

- [ ] **Step 7: 运行 agent、resolver 和 IPC 测试**

```powershell
cd code_review_electron
npx vitest run src/main/__tests__/task-agent.test.ts src/main/__tests__/svn-report-name-resolver.test.ts src/main/__tests__/ipc.test.ts
npm run typecheck
```

Expected: PASS；失败短路用例中不存在 workspace/Codex/report 调用。

- [ ] **Step 8: 提交任务启动链路**

```powershell
git add code_review_electron/src/main/task-agent.ts code_review_electron/src/main/__tests__/task-agent.test.ts code_review_electron/src/main/ipc.ts code_review_electron/src/main/svn-report-name-resolver.ts code_review_electron/src/main/__tests__/svn-report-name-resolver.test.ts
git commit -m "feat: 在 Codex 启动前执行 SVN 预检"
```

### Task 9: 完整验证与 Windows 手工验收

**Files:**
- Verify only; only fix files already in scope when a check exposes a defect.

**Interfaces:**
- Consumes: Tasks 1-8 的完整实现。
- Produces: 可发布的后端优先、客户端随后版本。

- [ ] **Step 1: 执行后端目标测试和全量测试**

```powershell
cd code_review_server/backend
uv run pytest tests/api/routes/test_review_tasks.py -q
uv run pytest -q
```

Expected: PASS；无 `old > new` 夹具失败。

- [ ] **Step 2: 执行 Electron 全部门禁**

```powershell
cd code_review_electron
npm run typecheck
npm test
npm run build
```

Expected: 三条命令 PASS；构建输出包含主窗口和反馈窗口 renderer/preload。

- [ ] **Step 3: 检查 IPC 通道和遗留弹窗实现**

```powershell
rg -n "report-feedback-window:" code_review_electron/src
rg -n "showUsefulFeedbackDialog|usefulFeedbackDialogPosition|startUsefulFeedbackDialogDrag|report-feedback-dialog" code_review_electron/src
```

Expected: 第一条包含 spec 中 10 个通道且 invoke/listen 方向正确；第二条无输出。

- [ ] **Step 4: 检查命令与凭据约束**

```powershell
rg -n "spawn\('svn'|--username|--password|getSvnCredential" code_review_electron/src/main/svn-preflight.ts code_review_electron/src/main/svn-report-name-resolver.ts code_review_electron/src/main/task-agent.ts
```

Expected: 无硬编码 `spawn('svn')`、无账号密码参数、无服务端凭据读取；命令来自 `EnvironmentCheckResult.svnPath`。

- [ ] **Step 5: 在 Windows 开发模式手工验收历史框**

Run:

```powershell
cd code_review_electron
npm run dev
```

验收：空输入显示最多 3 条；输入过滤忽略大小写；完全匹配自动收起；Escape 收起并保焦点；Tab 直接进入旧版本；点击版本字段不会替换 SVN 地址；列表展开时版本字段下移而非被覆盖。

- [ ] **Step 6: 手工验收反馈工具窗口**

验收：点击“有帮助”创建原生窗口；可拖出主客户端边界；不覆盖其他应用为全局置顶；再次点击复用；“稍后提交”隐藏并恢复草稿；原生关闭后重开恢复草稿；主窗口最小化/恢复联动；切换任务不串草稿；提交成功/409 后更新主页面并打开 PDF。

- [ ] **Step 7: 手工验收 SVN 预检短路**

分别测试错误 URL、错误新版本、错误旧版本、认证失败、断网/超时、`r0`、正常范围、旧历史反向范围。确认失败发生在“校验 SVN 地址和版本”，任务没有 Codex 输出和报告文件；取消期间最终状态为 cancelled；正常范围继续生成报告。

- [ ] **Step 8: 复核发布顺序和工作树**

```powershell
git status --short
git log --oneline -12
```

Expected: 仅计划内文件有预期变更；`../tb-ai-platform/public/index.html` 和 `../tb-ai-platform/public/styles.css` 仍保持用户原有修改；提交顺序清晰支持后端先部署。

- [ ] **Step 9: 提交验证中产生的最小修正（仅在有修正时）**

先运行 `git diff --name-only`，只从输出中选择属于本计划 File Map 的实际修正文件，逐个执行 `git add path/to/file`，再执行：

```powershell
git commit -m "test: 完成 SVN 预检与反馈窗口验收"
```

没有修正时跳过该步骤，不创建空提交。
