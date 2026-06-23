# CLAUDE.md

> 这是给 AI 协作者和开发者的**工程契约**：架构导航、跨端契约、命令、约定、陷阱。
> **唯一事实来源是代码本身。** [`docs/代码审查平台系统设计文档.md`](docs/代码审查平台系统设计文档.md) 是 **v1.0.0 基线快照**（2026-06-04，1011 行），与当前代码已有多处偏差，**切勿当作权威清单**——详见下一节。
> 本项目用 AI 全流程开发，已迭代多次。改动前请先读完本文件，尤其是「⚠️ 文档资料的时效性」「§3 跨端契约」「§8 陷阱清单」。

## ⚠️ 文档资料的时效性（改动前务必先读）

仓库里有三类资料，**可信度不同**，弄混会基于过时信息做错误改动：

| 资料 | 定位 | 可信度 |
|---|---|---|
| **代码** | 唯一事实来源 | 🟢 永远以此为准 |
| `docs/superpowers/{specs,plans}/` | 每个功能的**增量**设计稿与实现计划（带日期，越新越准） | 🟡 较新，但仍要以代码核对 |
| [`docs/代码审查平台系统设计文档.md`](docs/代码审查平台系统设计文档.md) | **v1.0.0 初始设计快照**（2026-06-04，1011 行） | 🔴 **已过时，仅作基线参考** |

**原则：设计文档与代码冲突时，一律以代码为准。** 设计文档里的 REST API 表、IPC 表、需求清单（FR）都不再完整。

### 设计文档 v1.0.0 与当前代码的主要偏差（已迭代新增 / 变更）

**A. 设计文档列为「后续扩展」、现已实现：**
- **Electron 自动更新**：electron-updater + `/client-updates/*` + `app-update:*` IPC + `ClientRelease` 模型 + 管理后台「客户端版本发布」页。（设计文档把它放在文末「后续扩展事项」）
- **部门管理**（`/items`）：管理后台已有部门管理页面（部门级 Skill 分发状态待核实）。

**B. 设计文档完全没有、后来整个新增的模块：**
- **意见反馈（Feedback）**：`Feedback` / `FeedbackScreenshot` 模型、`/api/v1/feedback` 路由、多截图上传、管理后台 Feedback 管理、首页 Feedback 统计。（设计文档 FR-001~019 无此项）
- **PDF 报告**：客户端 `report-pdf-generator` 本地生成、`POST /pdf-report` 上传、`GET /pdf/download` 下载、`report:open-pdf` 本地优先打开。（设计文档只提 Markdown）
- **客户端版本发布管理（ClientRelease）**：模型 + `/client-releases` 路由 + 管理后台发布页，与自动更新形成闭环。

**C. 设计文档明确「不包含 / 预留」、现已实现：**
- **任务取消**：`cancelled` 状态 + `task:cancel` IPC + `AbortController` 取消机制 + `activeReviewTasks` 管理。（设计文档称 `cancelled` 为"预留状态，当前未看到前端主动取消入口"）
- **并发任务队列**：`renderer/hooks/useTaskQueue.ts`。（设计文档 §项目范围 写"不包含任务排队调度中心"）
- **多 Skill 模板选择**：`template_key` / `skill_name`、`getActiveSkills`（复数）、`downloadSkill(id)`。（设计文档称"任意时刻只有一个 active Skill"）

**D. 设计文档语义与代码不一致（安全相关，务必注意）：**
- **权限判断**：设计文档称"同时认可 `is_superuser == true` 或 `role == admin`"；**代码实际只用 `role == 'admin'`**，`is_superuser` 仅向后兼容镜像、**不授权任何东西**。用 `is_superuser` 判权限 = 安全漏洞。
- 设计文档 REST API 表缺失：PDF 上传/下载、feedback、`client-releases` / `client-updates`、`/skills/{id}/download` 等。
- 设计文档 IPC 表缺失：`task:cancel`、`feedback:submit`、`report:open-pdf`、`report:asset`、`app-update:*` 等。
- 环境变量表不全（缺 `CLIENT_RELEASE_STORAGE_DIR`、`FEEDBACK_STORAGE_DIR`、`SENTRY_DSN`）；设计文档提的 `CODE_REVIEW_API_BASE_URL`（Electron 默认地址）现由 `ServerConfigStore`（`server-config.json`）机制取代，以代码为准。

> 查某个功能"为什么这么设计"，优先去 `docs/superpowers/specs/<date>-<feature>-design.md` 找对应的**增量设计稿**（比 v1.0.0 总文档新得多）。

## 0. 速查（TL;DR）

- **三个应用 + 一个共享 REST API**：Electron 客户端（终端用户）+ 后端 FastAPI（中枢）+ Web 管理后台（管理员）。三者都消费后端 `/api/v1/*`。
- **后端只存储和调度，不跑审查**：Codex 执行、SVN diff、报告生成**全部在 Electron 客户端本机**完成，再回传后端。改代码时不要把这条边界搞混。
- **改后端 API 有两条同步链，其中一条是手写的**：Web 前端 `client/` 自动生成（有 pre-commit 兜底）；**Electron `api-client.ts` 是手写的，改后端 API 必须手动同步，没有任何自动机制**——这是跨端 bug 头号高发区。
- **质量门不对等**（已知缺口）：

  | 端 | CI | pre-commit | 测试 | 覆盖率门槛 |
  |---|---|---|---|---|
  | Backend | ✅ | ✅ prek | pytest（真 Postgres） | **90%** |
  | Web Frontend | ✅ | ✅ | Playwright E2E | — |
  | **Electron** | ❌ | ❌ | Vitest | — |

  > Electron 端**没有 CI、没有 git hook**——改完必须手动 `npm run typecheck && npm test`，这是当前唯一的回归防线（详见 §6）。这也是历史上"加新功能、老功能出 bug"的根因。

## 1. 平台架构与职责分工

```
                        ┌─────────────────────────────┐
                        │   code_review_server/backend  │
                        │   FastAPI + SQLModel + PG     │
                        │   （账户/凭据/任务/报告/Skill/  │
                        │    客户端版本/CCH 同步/统计）   │
                        └──────────────┬────────────────┘
                                       │ REST /api/v1/*
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
   ┌────────▼─────────┐      ┌─────────▼──────────┐      ┌────────▼─────────┐
   │ code_review_      │      │ code_review_server/ │      │  (管理员通过       │
   │ electron          │      │ frontend            │      │   Web 后台管理)    │
   │ 终端用户桌面端     │      │ Web 管理后台         │      │                  │
   │ Win x64 NSIS      │      │ React + TanStack    │      │                  │
   │ 本机调 Codex 审查  │      │ 用户/任务/报告/      │      │                  │
   │ → 回传报告         │      │ Skill/版本/统计      │      │                  │
   └───────────────────┘      └─────────────────────┘      └──────────────────┘
```

| 端 | 服务对象 | 核心职责 | **不做的事** |
|---|---|---|---|
| **Backend** | 全平台中枢 | 账户/角色、SVN 凭据加密存储、审查任务与报告统一管理、CCH 用户同步、Skill 分发、客户端版本发布、审计日志 | 不跑 Codex、不跑 SVN diff、不生成报告 |
| **Electron 客户端** | 终端审查人员 | 登录→领任务→检查本机环境（codex/svn/skill）→调本机 Codex Skill 执行审查→生成 MD+PDF→回传 | 不直接管理用户、不做后台统计 |
| **Web 管理后台** | 管理员 | 用户/部门管理、任务查看、报告下载、Skill 库上传激活、客户端版本发布、Feedback 管理、首页统计 | 不执行审查 |

**一次代码审查任务的数据流**（设计文档 v1.0.0 有基线时序图，但以代码实际实现为准）：
客户端建任务 → 后端落库（`created`）→ 客户端本机检查环境 → 调 Codex Skill（SVN diff + 分析 + 生成 MD）→ 客户端生成 PDF → 客户端逐阶段 `PATCH /status` 回报 → 上传 MD 报告（后端**强制置 `success`**）→ 上传 PDF 报告。

## 2. 目录导航

```
code_review_platform/
├── CLAUDE.md                      ← 本文件
├── docs/
│   ├── 代码审查平台系统设计文档.md   ← 权威设计（需求/架构/API/状态机/测试策略）
│   ├── AI代码审查平台使用手册.md     ← 用户手册
│   └── superpowers/{specs,plans}/  ← 每个功能的设计稿(spec)与实现计划(plan)，AI 开发产物
├── code_review_server/             ← 后端 + Web 管理后台（基于 fastapi full-stack template）
│   ├── backend/
│   │   ├── app/
│   │   │   ├── main.py            ← FastAPI app，挂载 /api/v1，CORS
│   │   │   ├── models.py          ← 【唯一】模型文件：表 + DTO + 枚举全在这
│   │   │   ├── crud.py            ← 薄 DB helper
│   │   │   ├── core/{config,security,db}.py  ← settings / JWT+Fernet / engine
│   │   │   ├── api/{deps,main}.py + routes/  ← 依赖注入 + 手动聚合路由
│   │   │   ├── services/          ← 业务逻辑（非 HTTP）
│   │   │   └── alembic/versions/  ← 【迁移在这，不是顶层 alembic/】
│   │   ├── tests/                 ← pytest（conftest 强制 _test 库 + 真 Postgres）
│   │   └── pyproject.toml         ← ruff/mypy strict/ty/pytest/coverage
│   ├── frontend/
│   │   └── src/{routes,components,hooks,lib,client}   ← client/ 自动生成，禁改
│   ├── compose*.yml               ← base/override(开发)/test/traefik(生产)
│   ├── scripts/                   ← generate-client.sh / prestart.sh / test.sh
│   └── .pre-commit-config.yaml    ← prek：ruff/mypy/ty/biome/自动重生 client
└── code_review_electron/          ← Electron 客户端（独立 npm 工程）
    └── src/{main,preload,renderer,shared}/   ← 详见该目录 README
```

## 3. 跨端契约（改错就出 bug 的地方）

### 3.1 REST API `/api/v1/*` 是三端的共享契约

后端 `backend/app/api/routes/*.py` 定义端点。两端各自消费：
- **Web 前端**：通过自动生成的 `frontend/src/client/sdk.gen.ts`（`*Service` 静态类）。
- **Electron**：通过**手写**的 `code_review_electron/src/main/api-client.ts`（`ApiClient` 类）。

### 3.2 改后端 API 时的两条同步链

| 消费方 | 同步方式 | 是否自动 |
|---|---|---|
| Web `frontend/src/client/` | `openapi-ts` 从 `openapi.json` 重新生成 | ✅ **pre-commit 的 `generate-frontend-sdk` hook 会在 `backend/` 改动时自动跑**；手动则 `bash scripts/generate-client.sh` |
| Electron `api-client.ts` | **人工对照修改** | ❌ **无任何自动机制**——改后端端点路径/方法/字段后，必须手动改 `api-client.ts` 并同步 `shared/types.ts` |

> 这是跨端 bug 的头号来源。**改后端任何 Electron 用到的端点（任务/报告/凭据/Skill/feedback/client-updates/auth），都必须手动同步 `code_review_electron/src/main/api-client.ts`**，否则客户端运行时才炸。

### 3.3 `ReviewTask` 跨端字段映射

后端 `ReviewTaskPublic`（`backend/app/models.py`）↔ Electron `ReviewTask`（`code_review_electron/src/shared/types.ts`）。共享字段：`id, svn_url, old_revision, new_revision, template_key, skill_name, status, report_path, pdf_report_path, pdf_report_name, started_at, finished_at, error_message`。Electron 另有纯本地字段（`progress_message, codex_log`）不来自后端。改任一端字段要同步另一端。

### 3.4 关键不对称陷阱（跨端，极易踩）

| # | 陷阱 | 后果 |
|---|---|---|
| 1 | **上传 MD 报告会强制 `status=success` + 设 `finished_at`；上传 PDF 报告不改状态** | 以为传完 PDF 就成功，实际状态由 MD 上传决定 |
| 2 | **`started_at`/`finished_at` 由后端派生**（进 running 态设 started，进终态设 finished）；客户端**不能**直接发这两个字段 | 客户端发的时间会被忽略；统计的 `average_duration` 依赖它 |
| 3 | **版本号必须匹配 `r?\d+`，且 `old != new`** | 裸数字、非数字、相同版本会被后端 422 拒绝 |
| 4 | **权限判定是 `role == "admin"`，不是 `is_superuser`**（`is_superuser` 仅向后兼容镜像，不授权任何东西） | 用 `is_superuser` 做权限判断 = 安全漏洞 |
| 5 | **`/client-updates/*`（electron-updater 拉取）需要 Authorization 头** | 自动更新请求不带 token 会 401/403 |
| 6 | **登录凭据错误返回 403（非 401）**；无 `/refresh` 端点（refresh_token 返回但未用，access_token 8 天有效） | 客户端鉴权错误处理要兼容 403 |
| 7 | **`SVN_CREDENTIAL_MASTER_KEY` 不可变**（Fernet，SHA256 派生密钥） | 换 key → 所有已存 SVN 密码无法解密 |
| 8 | **feedback 同时支持 `screenshot`(旧) 和 `screenshots[]`(新)**，旧列在 `sort_order==0` 时镜像新表 | 两个接口都要保持同步，别删旧路径 |
| 9 | **报告/PDF 文件按 `{task_id}.md/.pdf` 存于 `REPORT_STORAGE_DIR`，无用户子目录；`*_path` 列存绝对路径** | 改 `*_STORAGE_DIR` → 旧记录的路径全部失效（读 404） |

## 4. 各端速查

### 4.1 Backend（FastAPI + SQLModel + PostgreSQL）

- **栈**：FastAPI + SQLModel + PostgreSQL + Alembic + Pydantic-Settings；Python ≥3.10，包管理 `uv`。
- **关键约定**：
  - 模型/DTO/枚举**全部在 `app/models.py` 一个文件**（无 schemas/ 目录）；加表加 DTO 都改这里。
  - 路由在 `app/api/routes/`，**手动在 `app/api/main.py` 聚合**（非自动发现）；加路由文件要改聚合处。
  - 迁移在 `app/alembic/versions/`（`alembic.ini: script_location = app/alembic`）。
  - 依赖注入用 `Annotated` 别名：`SessionDep`/`TokenDep`/`CurrentUser`；管理员路由用 `Depends(get_current_active_admin)`。
  - lint：ruff（**禁 `print` = T201**、禁未用参数 ARG001）、mypy **strict**、ty `error-on-warning`；允许不带 `from e` 的 raise（忽略 B904）。
- **命令**（在 `code_review_server/`）：
  ```bash
  cd backend && fastapi dev app/main.py        # 开发，:8000
  cd backend && bash scripts/tests-start.sh    # 迁移+初始数据+测试+覆盖率
  cd backend && uv run prek run --all-files    # 全量 pre-commit（ruff/mypy/ty）
  cd backend && alembic revision --autogenerate -m "..." && alembic upgrade head
  ```

### 4.2 Web Frontend（React 管理后台）

- **栈**：React 19 + TS 5.9 + Vite 7 + Tailwind 4 + Radix/shadcn + **TanStack Router（文件路由）+ TanStack Query** + react-hook-form/zod；包管理 **Bun**；格式化用 **Biome**（非 Prettier）。
- **关键约定**：
  - **`src/client/` 全自动生成（openapi-ts），禁止手改**；Biome/EOF/whitespace 全部排除它。
  - **`src/routeTree.gen.ts` 由 TanStack Router 插件自动生成，禁改**。
  - `components/ui/*`（shadcn 基础组件）被 Biome 排除，保持官方原样。
  - 认证：JWT 存 `localStorage["access_token"]`，由生成的 SDK 注入；401/403 → 清 token 跳 `/login`。
  - 文件上传/报告下载等流式场景用原生 `fetch` + `OpenAPI.BASE/TOKEN`（生成 SDK 不覆盖）。
- **命令**（在 `code_review_server/`）：
  ```bash
  bun run dev                   # = --filter frontend dev，:5174
  cd frontend && bun run build  # tsc + vite build
  cd frontend && bun run test   # Playwright E2E
  bun run lint                  # biome check --write
  bash scripts/generate-client.sh   # 改后端 API 后重生 client（pre-commit 也会自动跑）
  ```

### 4.3 Electron 客户端（独立 npm 工程）

- **栈**：Electron 39 + electron-vite 4 + React 19 + TS 5.9（strict）+ Vitest + Testing Library；打包 electron-builder（**仅 Windows x64 NSIS**）；electron-updater 自动更新。
- **四层进程**：`src/main`（业务+IPC）/ `src/preload`（`contextBridge` 暴露 `window.codeReview`）/ `src/renderer`（React UI）/ `src/shared`（跨进程类型常量）。
- **关键约定**（详见 `code_review_electron/README.md`）：
  - **IPC 是三层镜像契约**：`main/ipc.ts` 的 `ipcMain.handle(channel)` ↔ `preload/index.ts` 的 `window.codeReview.<method>` ↔ `renderer/code-review-api.ts` 的类型，**三处必须同步**；`__tests__/ipc.test.ts` 断言 channel 注册顺序。
  - **依赖注入是可测试性基石**：`registerIpcHandlers(deps)` / `executeReviewTask(input, deps)` 接受可注入依赖；新外部依赖走 deps 参数，别在函数体直接 new/import。
  - **安全红线**：`contextIsolation: true`（勿关）、外部协议白名单 http/https/mailto、报告资源路径穿越防护、错误信息上报前脱敏（`sanitizeErrorSummary`）。
  - 运行时路径走 `getRuntimePaths()`（开发 `.runtime-data/`，打包 `code-review-electron-data/`），勿手拼。
- **命令**（在 `code_review_electron/`）：
  ```bash
  npm run dev          # electron-vite dev
  npm run typecheck    # tsc --noEmit   ← 改完必跑
  npm test             # vitest run     ← 改完必跑
  npm run build        # typecheck + electron-vite build → out/
  npm run dist:win     # build + electron-builder → release/
  ```

## 5. 环境变量与部署

**生产必设**（以 `backend/app/core/config.py` 与 `code_review_server/README.md` 为准；设计文档 v1.0.0 变量表不全）：
- `SECRET_KEY`（JWT 签名，`changethis` 在非 local 会报错）
- `CCH_DATABASE_URL`（Claude Code Hub Postgres 连接串，None 时 cch-sync 返回 503）
- `SVN_CREDENTIAL_MASTER_KEY`（**不可变**，见 §3.4-#7）
- `POSTGRES_PASSWORD`
- `REPORT_STORAGE_DIR` / `SKILL_STORAGE_DIR` / `CLIENT_RELEASE_STORAGE_DIR` / `FEEDBACK_STORAGE_DIR`（建议挂持久化卷；**改路径会让旧记录失效**）
- `DOMAIN` / `STACK_NAME` / `DOCKER_IMAGE_*`（compose 生产编排用）

**部署**：`docker compose -f compose.yml -f compose.traefik.yml ...`（见 `code_review_server/deployment.md`）；staging/production 各有 GH Actions workflow。Electron 客户端发布：管理员在 Web 后台「客户端版本管理」上传安装包 → electron-updater 从 `/client-updates/win32/x64/` 拉取。

## 6. 测试策略与质量门

| 端 | 框架 | 关键约束 |
|---|---|---|
| Backend | pytest（真 Postgres） | `conftest.py` 强制库名以 `_test` 结尾、会话级自动跑迁移；CI **覆盖率门槛 90%**（`--fail-under=90`） |
| Web Frontend | Playwright E2E | `auth.setup.ts` 复用登录态；CI 分 4 shard 并行 |
| Electron | Vitest + Testing Library | main 测 `vi.mock('electron')` + 依赖注入；renderer 组件 co-located |

> **⚠️ Electron 端缺质量门**：无 CI、无 pre-commit hook。每次改 Electron 代码后必须手动 `npm run typecheck && npm test`。建议后续补 husky + lint-staged + GitHub Actions，把测试变成"不可绕过的门"。

> **⚠️ CI workflow 触发分支是 `master` 而非 `main`**（fastapi 模板残留，如 `test-backend.yml`、`playwright.yml`）——当前默认分支是 `main`，这些 CI 可能**不会在 main 上自动触发**，需排查。

## 7. 开发工作流约定

- **AI 全流程开发产物在 `docs/superpowers/`**：每个功能先写 `specs/<date>-<feature>-design.md`（设计稿），再写 `plans/<date>-<feature>.md`（实现计划），再编码。加新功能请延续这个流程。
- **提交信息**：中文，动宾结构（如"修复客户端任务时间显示缺失""新增任务提交趋势统计"）。
- **改后端 API**：改完跑 `bash scripts/generate-client.sh`（或让 pre-commit 自动跑），并**手动同步 Electron `api-client.ts`**。
- **数据库结构变更**：写 Alembic 迁移（`alembic revision --autogenerate`），不要只改模型不留迁移。
- **改任何端**：改完跑该端的 typecheck + 测试（命令见 §4）。

## 8. 易碎区与陷阱清单（改动前请警告）

> 源自 git 修复历史 + 代码隐性契约，按"最易回归"排序。

**Electron 端（历史 bug 集中区，无质量门兜底）**：
1. **PDF 报告打开/下载流程**（`report:open-pdf` / `report:download-current`）：多级 fallback（本地 PDF→工作区→服务端下载）、文件名解析、路径回退——git log 里密集修复过多次。
2. **异步任务状态切换**（`hooks/useTaskQueue.ts` / `TaskPage.tsx`）：并发、取消、切换历史报告时的状态污染（"修复历史报告异步切换状态污染"）。
3. **审查完成提醒**：任务完成后不要自动切换右侧报告；前台用应用内右下角提醒，后台/最小化/失焦才走系统通知。前台判断固定为 `document.visibilityState === "visible" && document.hasFocus()`。
4. **系统通知链路**：Windows 必须 `app.setAppUserModelId("com.peicheng.code-review")`；通知 payload 不带 `reportMarkdown`；主进程点击通知后恢复/显示/聚焦窗口，并发送 `notification:task-completed-clicked`。Electron 39.2.6 类型里没有 `Notification.handleActivation`，当前靠实例 `click` 事件 + `activeNotifications` 保留实例；`failed` 事件必须返回 failed 以触发应用内兜底。
5. **历史任务排序**：`historyTasks` 按 `finished_at -> started_at -> createdAtMs` 倒序，别使用不存在的 `updated_at`。
6. **任务时间显示**（`started_at`/`finished_at`）：注意这是后端派生字段（§3.4-#2）。
7. **错误码映射**（`task-agent.ts` 的 `codexErrorMessages`）必须与 `codex-runner.ts` 的 `CodexErrorCodes` 一一对应。
8. **IPC 三层契约**（§4.3）：改一处忘同步另两处 = 运行时炸。

**跨端契约（§3.4 全表，尤其 #1/#2/#4）**。

**后端**：
9. **用户删除是手动级联**（`ReviewTask.user_id` 无 `ON DELETE CASCADE`）：`users.py` 的 `_delete_user_with_related_data` 显式置 NULL 再删，改用户模型/删除逻辑时要同步维护。
10. **Skill 激活互斥**（按 name）：激活一个会停用同名其它；下载要求恰好一个 active，否则 409。
11. **反馈双接口镜像**（§3.4-#8）。

## 9. 不要做的事

- 不要让后端执行 Codex / SVN diff / 生成报告——那是客户端职责。
- 不要手改 `frontend/src/client/`（自动生成）和 `frontend/src/routeTree.gen.ts`（自动生成）。
- 不要用 `is_superuser` 做权限判断——用 `role == "admin"`。
- 不要改 `SVN_CREDENTIAL_MASTER_KEY` 而不处理历史凭据。
- 不要在 Electron 渲染层直接访问 Node API——只能通过 `window.codeReview`；不要关 `contextIsolation` 或放宽外部协议白名单。
- 不要改后端 API 而不重新生成前端 client / 不同步 Electron `api-client.ts`。
- 不要为了让测试过而弱化 `ipc.test.ts` 的 channel 顺序契约或降低后端覆盖率门槛。
- 不要提交 `out/`、`release/`、`.runtime-data/`、`openapi.json`、`__pycache__/`、`.venv/`、`htmlcov/`。
