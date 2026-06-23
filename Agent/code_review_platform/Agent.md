# Agent 开发流程

本文档总结本项目历史开发对话中沉淀出的 Agent 开发流程。后续 Agent 接手任何开发任务时，先读本文档，再读 `CLAUDE.md`。如果本文档与代码或 `CLAUDE.md` 冲突，以代码和 `CLAUDE.md` 为准；如果历史设计文档与代码冲突，以代码为准。

## 0. 硬性规则

1. 任何情况下都使用中文输出，包括 spec、plan、说明文档、测试记录和 git commit。
2. 后续所有开发默认在 `Test` 分支进行。用户测试确认没有问题后，才允许合并到 `main`。
3. 禁止在 `main` 分支直接开发功能、修 bug 或提交代码，除非用户明确要求。
4. 新功能不能破坏旧功能。每次改动都必须识别受影响的旧链路，并做针对性回归验证。
5. 代码是唯一事实来源。`docs/superpowers/{specs,plans}/` 是增量参考，`docs/代码审查平台系统设计文档.md` 只作为旧基线快照。
6. 不回滚用户已有改动，不清理无关未跟踪文件，不用破坏性 git 命令。

## 1. 接任务后的第一步

先确认当前分支：

```bash
git branch --show-current
```

如果不是 `Test`，优先切到 `Test`：

```bash
git switch Test
```

如果本地没有 `Test` 分支，从当前基线创建：

```bash
git switch -c Test
```

然后查看工作区状态：

```bash
git status --short
```

只处理本次任务相关文件。遇到无关脏文件时忽略；遇到会影响当前任务的用户改动时，先读懂再协同修改，不要覆盖。

## 2. 读资料顺序

每个任务开始前按以下顺序建立上下文：

1. `CLAUDE.md`：工程契约、跨端边界、命令、陷阱。
2. 相关代码：后端、Web、Electron 以实际实现为准。
3. `docs/superpowers/specs/`：查找相近功能的增量设计。
4. `docs/superpowers/plans/`：查找相近功能的实施拆分和测试方式。
5. `docs/代码审查平台系统设计文档.md`：只在需要理解初始设计时参考。

不要只按文件名或旧文档推断当前行为。涉及 API、IPC、数据库模型、权限、状态机、文件存储时，必须回到代码核对。

## 3. 标准开发流程

### 3.1 明确需求边界

先把需求拆成：

- 本次目标。
- 非目标。
- 已确认决策。
- 兼容性要求。
- 旧功能回归范围。

历史开发对话的稳定模式是先控制范围，再实施。不要把下一期能力混进本期，尤其是权限扩展、通知、灰度发布、多端支持、AI 自动总结等高成本能力。

### 3.2 先写设计 spec

中大型功能必须先写设计文档，路径：

```text
docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
```

设计至少包含：

- 背景。
- 目标和非目标。
- 推荐方案和备选方案取舍。
- 数据模型或状态模型。
- API / IPC / UI / 文件存储 / 权限设计。
- 错误处理。
- 兼容性。
- 测试计划。
- 验收标准。

小修复也要在动手前写清楚原因、影响范围和验证方式，可以不单独建长 spec，但最终说明必须覆盖这些点。

### 3.3 再写 implementation plan

实施计划路径：

```text
docs/superpowers/plans/YYYY-MM-DD-<topic>.md
```

计划必须能让另一个 Agent 逐步执行，通常包含：

- Goal。
- Architecture。
- Tech Stack。
- File Structure。
- 按 Task 拆分的步骤。
- 每个 Task 的文件清单、测试、预期失败、实现、预期通过。
- 最终验证和自检清单。

计划拆分原则：

- 先后端契约和测试，再前端或 Electron 消费端。
- 先共享类型、API、IPC，再 UI。
- 先主流程，再错误处理和兼容兜底。
- 每个 Task 完成后跑局部测试，避免最后集中排雷。

### 3.4 TDD 实施

优先按以下节奏执行：

1. 写失败测试。
2. 运行测试确认失败原因正确。
3. 写最小实现。
4. 运行测试确认通过。
5. 再进入下一个 Task。

后端重点覆盖 API 权限、状态流转、数据库迁移、文件清理和兼容旧 payload。Electron 重点覆盖主进程、IPC、preload、renderer 类型和任务队列。Web 重点覆盖路由、权限、表格/表单行为和 OpenAPI 客户端消费。

## 4. 旧功能保护规则

每次新功能或修复都必须回答：

1. 这次改动影响哪些旧入口？
2. 哪些旧字段、旧接口、旧 IPC、旧文件路径需要兼容？
3. 旧客户端或历史数据不带新字段时会怎样？
4. 失败时是否会阻断原有主流程？
5. 是否需要保留原按钮文案、原下载逻辑、原状态语义或原权限范围？

默认策略：

- 新字段尽量 nullable，并为历史数据留空值兜底。
- 旧接口需要继续支持时，不删除旧字段或旧上传参数。
- 文件存储新目录要独立，避免混用报告、Skill、客户端发布包、反馈附件。
- 附件上传、PDF 上传、反馈截图等副流程失败时，除非需求明确，否则不阻断核心审查任务。
- 新 UI 入口不要改变用户已有关键工作流，除非需求明确。
- 新统计口径必须说明时间范围、权限范围和空值处理。

回归验证不能只跑新测试。至少要跑受影响模块的旧测试，并对关键链路做一次人工或端到端验证。

## 5. 跨端同步清单

本项目高风险点是三端契约不同步。改动以下内容时必须同步检查：

### 5.1 后端 API

后端 API 改动后必须检查：

- `code_review_server/backend/app/api/routes/*.py`
- `code_review_server/backend/app/models.py`
- `code_review_server/backend/app/api/main.py`
- `code_review_server/frontend/src/client/` 是否需要重新生成。
- `code_review_electron/src/main/api-client.ts` 是否需要手动同步。
- `code_review_electron/src/shared/types.ts` 是否需要同步字段。

Web 前端客户端是生成的，Electron API 客户端是手写的。改后端 API 时漏改 Electron 是历史高发问题。

### 5.2 Electron IPC

Electron IPC 改动必须同步三层：

- `code_review_electron/src/main/ipc.ts`
- `code_review_electron/src/preload/index.ts`
- `code_review_electron/src/renderer/src/code-review-api.ts`

同时检查：

- `code_review_electron/src/main/__tests__/ipc.test.ts`
- `code_review_electron/src/preload/index.test.ts`
- 相关 renderer 组件测试。

### 5.3 任务和报告字段

改 `ReviewTask`、报告、PDF、模板、Skill、任务状态时，必须同步检查：

- 后端 `ReviewTaskPublic` 和路由返回。
- Electron `ReviewTask` 类型。
- Web 任务管理页面。
- Electron 任务看板、任务队列、报告预览、PDF 打开。
- 历史任务空字段兼容。

## 6. 各端验证命令

根据改动范围选择最小但足够的验证集。涉及跨端契约时不能只跑单端。

### 6.1 后端

在 `code_review_server/backend` 下：

```bash
bash scripts/tests-start.sh
uv run ruff check app tests
uv run mypy app tests
```

如果环境不支持完整脚本，至少运行相关 pytest 文件，并说明未跑完整验证的原因。

### 6.2 Web 前端

在 `code_review_server` 或 `code_review_server/frontend` 下：

```bash
bash scripts/generate-client.sh
cd frontend && bun run build
cd frontend && bun run test
```

不要手改 `frontend/src/client/` 和 `frontend/src/routeTree.gen.ts`，除非它们由生成工具更新。

### 6.3 Electron

在 `code_review_electron` 下：

```bash
npm run typecheck
npm test
npm run build
```

Electron 没有和后端一样稳定的 CI 兜底，改完必须手动跑类型检查和测试。涉及 UI、报告、PDF、更新、任务队列时，应尽量启动客户端做一次人工验证。

## 7. 收尾流程

完成实现后必须做：

1. `git status --short`，确认只包含本任务相关变更。
2. 跑对应测试和回归验证。
3. 记录未能运行的验证项和原因。
4. 自查是否触碰跨端契约、权限、历史数据、文件路径、旧客户端兼容。
5. 用中文总结改动、验证结果、风险和后续需要用户测试的点。

如果需要提交 commit，commit message 使用中文。开发提交留在 `Test` 分支，等待用户测试后再合并到 `main`。

## 8. 常见高风险边界

- 权限判断使用 `role == "admin"`，不要用 `is_superuser` 授权。
- 后端不执行 Codex、不跑 SVN diff、不生成审查报告；这些属于 Electron 本机职责。
- 上传 Markdown 报告会决定任务成功状态；PDF 上传不负责置成功。
- `started_at`、`finished_at` 由后端派生，客户端不要直接写。
- Electron 历史任务列表按 `finished_at -> started_at -> createdAtMs` 倒序展示，不要引入不存在的 `updated_at` 兜底。
- Electron 审查完成后不自动切换右侧报告预览；用户要看报告时通过应用内提醒、系统通知点击或历史任务“查看报告”显式打开。
- Electron 审查完成提醒规则：渲染层用 `document.visibilityState === "visible" && document.hasFocus()` 判断前台；前台只显示应用内右下角提醒，后台/最小化/失焦才调用系统通知。
- 系统通知 payload 不传 `reportMarkdown`；只传任务 ID、SVN 地址、旧新版本、报告路径和 PDF 信息，报告正文从渲染层任务状态按 ID 回查。
- Windows 系统通知必须设置 `app.setAppUserModelId("com.peicheng.code-review")`；通知点击由主进程恢复/显示/聚焦窗口，再通过 `notification:task-completed-clicked` 回传渲染层。
- Electron 39.2.6 的本地类型没有 `Notification.handleActivation`；当前通知点击使用实例 `click` 事件，并用主进程 `activeNotifications` 保留实例。系统通知 `failed` 事件必须返回 `failed`，让渲染层显示应用内兜底提醒。
- `SVN_CREDENTIAL_MASTER_KEY` 上线后不可变。
- `REPORT_STORAGE_DIR`、`SKILL_STORAGE_DIR`、`CLIENT_RELEASE_STORAGE_DIR`、`FEEDBACK_STORAGE_DIR` 改路径会影响历史文件读取。
- Feedback 需要兼容旧单图字段和新多图结构。
- 自动更新文件下载需要 Authorization。
- 旧 Electron 客户端可能不传新字段，后端接口必须兼容。

## 9. 合并规则

开发完成后保持在 `Test` 分支。推荐流程：

1. Agent 在 `Test` 分支完成开发和自测。
2. 用户在 `Test` 分支对应环境或构建产物中测试。
3. 用户确认没有问题后，再由用户或 Agent 按明确指令合并到 `main`。
4. 合并前再次确认 `Test` 相对 `main` 的差异只包含本次通过测试的内容。

没有用户确认时，不主动把 `Test` 合并到 `main`。
