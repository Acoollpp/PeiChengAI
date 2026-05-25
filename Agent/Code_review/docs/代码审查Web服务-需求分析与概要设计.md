# 代码审查 Web 服务 — 需求分析与概要设计

| 项目名称 | Codex 代码审查 Web 服务 |
|---|---|
| 文档版本 | v1.0 |
| 编写日期 | 2026-05-22 |
| 阶段 | MVP（最小可行产品） |

---

## 1 引言

### 1.1 编写目的

本文档对「Codex 代码审查 Web 服务」进行软件需求分析与概要设计，明确 MVP 阶段的功能范围、技术方案和模块边界，为后续编码实现、测试验证和部署上线提供依据。

### 1.2 项目背景

公司嵌入式固件开发团队使用 SVN 进行版本管理，代码审查目前依赖人工逐文件比对 diff，存在以下痛点：

- **效率低**：工程师需手动执行 SVN diff 命令、逐文件排查变更风险，单次审查耗时 30 分钟以上。
- **标准不一**：不同审查人的关注点不同，容易遗漏边界条件、协议字段对齐等关键风险。
- **记录缺失**：审查结论多为口头沟通或零散文档，难以追溯和复用。

团队已有一套基于 Codex CLI 的「通用-代码变更审查」Skill，可以按产品规则、AI 规则和架构规则自动生成 Markdown 审查报告。但目前只能通过命令行手动触发，使用门槛较高。

本项目的目标是将该 Skill 能力封装为 Web 服务，让工程师通过浏览器即可提交审查任务、查看报告。

### 1.3 术语定义

| 术语 | 含义 |
|---|---|
| Codex CLI | Anthropic 提供的命令行 AI 编码工具，支持加载自定义 Skill 执行任务 |
| Skill | Codex CLI 的技能包，由 SKILL.md 和 references/ 目录中的规则文件组成 |
| SVN | Subversion 版本控制系统，公司当前使用的代码版本管理工具 |
| Revision | SVN 的版本号，格式为 `r` + 数字，如 `r25576` |
| Prompt 模板 | 发送给 Codex CLI 的指令文本模板，包含占位符由服务端填充 |

---

## 2 需求分析

### 2.1 功能需求

#### FR-01 提交代码审查任务

用户通过 Web 表单填写以下信息提交审查任务：

| 字段 | 是否必填 | 说明 | 示例 |
|---|---|---|---|
| SVN 项目路径 | 是 | 需符合公司 SVN 地址白名单前缀 | `https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T` |
| 旧版本号 | 是 | 支持 `r数字` 或 `数字` 格式，自动规范化 | `r25576` 或 `25576` |
| 新版本号 | 是 | 同上，且不能与旧版本号相同 | `r29303` |
| 提交人 | 否 | 用于后续统计，为空时默认 `anonymous` | `张三` |

系统校验输入合法性后创建任务，返回任务 ID。

#### FR-02 后台执行审查

系统在后台自动处理已提交的任务：

1. 从任务队列中领取待处理任务。
2. 拼接 Prompt 模板，调用 Codex CLI 执行「通用-代码变更审查」Skill。
3. Codex 自动完成 SVN diff 获取、规则审查、报告生成。
4. 任务执行有超时限制，超时或执行失败时记录错误摘要。

#### FR-03 查看审查报告

任务执行成功后：

- 在浏览器中预览 Markdown 格式的审查报告。
- 下载原始 `.md` 报告文件。

#### FR-04 任务状态跟踪

任务状态及含义：

| 状态 | 含义 |
|---|---|
| `pending` | 任务已创建，等待后台 Worker 处理 |
| `running` | Worker 已领取任务，正在调用 Codex 执行审查 |
| `success` | 审查完成，Markdown 报告已生成 |
| `failed` | 执行失败、超时或未生成有效报告 |

前端在任务处于 `pending` 或 `running` 状态时自动轮询，状态变为终态后停止轮询。

#### FR-05 历史任务查看

展示仍在保留期内的历史任务列表，支持点击查看已完成的审查报告。

#### FR-06 过期数据自动清理

系统自动清理超过 90 天的任务记录、报告文件和临时工作目录，释放存储空间。

### 2.2 非功能需求

| 编号 | 类别 | 要求 |
|---|---|---|
| NFR-01 | 性能 | MVP 阶段 Codex 并发数固定为 1，单任务超时上限 30 分钟 |
| NFR-02 | 安全 | SVN 路径必须匹配白名单前缀；版本号需校验规范化；报告路径由服务端生成；不暴露 Codex 执行日志 |
| NFR-03 | 可靠性 | 服务重启时自动清理过期数据和 stale 任务；任务失败时保存脱敏错误摘要 |
| NFR-04 | 可维护性 | 所有配置通过环境变量管理；API 和前端只依赖任务状态，不依赖具体队列实现 |
| NFR-05 | 兼容性 | 在 Windows Server 环境下运行，路径支持空格 |

### 2.3 约束条件

- 部署环境为公司内网，面向可信员工，MVP 阶段不含登录和权限系统。
- 不引入 Redis、RQ、Celery 等外部队列中间件。
- SVN 认证依赖服务器系统账号已配置的凭据，Web 服务不收集 SVN 用户名和密码。
- 不支持用户自定义报告输出路径或传入额外命令参数。

---

## 3 总体设计

### 3.1 技术选型

| 层级 | 技术方案 | 选择理由 |
|---|---|---|
| Web 框架 | FastAPI | 轻量、自带 OpenAPI 文档、原生支持异步 |
| ASGI 服务器 | Uvicorn | FastAPI 官方推荐，生产可用 |
| 数据库 | SQLite | 零配置、单文件、满足 MVP 任务量 |
| 任务队列 | SQLite 轮询 | 避免引入外部中间件，后续可升级 |
| AI 执行 | Codex CLI + Skill | 复用已有的代码审查规则体系 |
| 前端 | 原生 HTML/CSS/JavaScript | 无需构建工具，部署简单 |
| 测试 | pytest + httpx | Python 生态标准选择 |
| 依赖管理 | uv | 快速、可靠的 Python 包管理工具 |

### 3.2 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器（前端）                      │
│  表单提交 │ 状态轮询 │ 报告预览 │ 报告下载 │ 历史任务   │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│                 FastAPI（API 层）                      │
│  输入校验 │ 任务创建 │ 状态查询 │ 报告读取 │ 文件下载   │
└───────┬──────────────────────────────────┬──────────┘
        │                                  │
┌───────▼────────┐              ┌──────────▼──────────┐
│ SQLite 任务表   │              │  Markdown 报告文件   │
│ (任务元数据)    │              │  data/reports/       │
└───────┬────────┘              └─────────────────────┘
        │
┌───────▼─────────────────────────────────────────────┐
│              后台 Worker 线程                         │
│  轮询 pending → 拼接 Prompt → 调用 Codex CLI         │
│  → 更新状态 → 保存报告                                │
└───────┬─────────────────────────────────────────────┘
        │ subprocess
┌───────▼─────────────────────────────────────────────┐
│              Codex CLI 进程                           │
│  加载 Skill → SVN diff → 执行规则审查 → 生成报告      │
└─────────────────────────────────────────────────────┘
```

### 3.3 模块划分

```
project/
├── app/
│   ├── main.py           # FastAPI 应用入口、API 路由、生命周期管理
│   ├── config.py         # 环境变量配置加载
│   ├── validation.py     # 输入校验（SVN 路径、版本号）
│   ├── models.py         # Pydantic 数据模型、任务状态枚举
│   ├── database.py       # SQLite 任务存储、CRUD 操作
│   ├── worker.py         # 后台 Worker 线程、任务处理逻辑
│   ├── codex_runner.py   # Codex CLI 子进程调用封装
│   └── cleanup.py        # 过期任务清理
├── static/
│   ├── index.html        # 单页面前端
│   ├── styles.css        # 样式
│   └── app.js            # 交互逻辑（表单、轮询、渲染）
├── config/
│   └── prompt_template.md  # Codex Prompt 模板
├── tests/                # 测试用例
├── skills/               # 代码审查 Skill 规则库
└── data/                 # 运行时数据（自动生成）
    ├── app.db            # SQLite 数据库
    ├── reports/          # 审查报告
    └── workspaces/       # 临时工作目录
```

---

## 4 详细设计

### 4.1 输入校验模块（app/validation.py）

#### 4.1.1 SVN 路径校验

- 校验规则：SVN 项目路径必须以配置的白名单前缀开头（默认 `https://192.168.0.233/svn/src_home/`）。
- 不匹配时抛出 `ValueError`，API 层转换为 HTTP 400 响应。
- 防止用户传入任意路径导致的路径遍历或命令注入风险。

#### 4.1.2 版本号规范化

- 接受格式：`r数字`（如 `r25576`）或 `纯数字`（如 `25576`）。
- 统一输出：`r数字`。
- 非法格式（如 `r25x`、`abc`）直接拒绝。

#### 4.1.3 业务规则

- 旧版本号和新版本号不能相同。
- 提交人为空或纯空格时，默认填充 `anonymous`。

### 4.2 数据存储模块（app/database.py）

#### 4.2.1 任务表结构

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | UUID，由服务端生成 |
| `svn_url` | TEXT NOT NULL | SVN 项目路径（已校验） |
| `old_revision` | TEXT NOT NULL | 旧版本号（已规范化为 `r数字`） |
| `new_revision` | TEXT NOT NULL | 新版本号（已规范化为 `r数字`） |
| `requester` | TEXT | 提交人，默认 `anonymous` |
| `status` | TEXT NOT NULL | 任务状态：pending / running / success / failed |
| `report_path` | TEXT | 报告文件的绝对路径（服务端生成） |
| `error_message` | TEXT | 脱敏后的错误摘要，最长 2000 字符 |
| `created_at` | TEXT NOT NULL | 创建时间（UTC ISO 8601） |
| `started_at` | TEXT | Worker 开始处理时间 |
| `finished_at` | TEXT | 任务完成时间 |
| `updated_at` | TEXT NOT NULL | 最后更新时间 |

索引：

- `idx_tasks_status`：按状态查询，用于 Worker 领取任务。
- `idx_tasks_created_at`：按创建时间排序，用于任务列表和清理。

#### 4.2.2 关键操作

| 操作 | 说明 |
|---|---|
| `create_task` | 插入新任务，状态为 pending |
| `claim_next_task` | 原子操作：查询最早的 pending 任务并更新为 running |
| `mark_success` | 将任务标记为 success，记录完成时间 |
| `mark_failed` | 将任务标记为 failed，记录脱敏错误摘要 |
| `fail_stale_running_tasks` | 将服务重启前仍在 running 的任务标记为 failed |
| `delete_older_than` | 删除指定时间之前的任务记录 |

### 4.3 后台 Worker 模块（app/worker.py + app/codex_runner.py）

#### 4.3.1 任务处理流程

```
Worker 线程循环
  │
  ├── claim_next_task()
  │     └── 无任务 → 等待 poll_interval → 重新查询
  │
  ├── 创建工作目录 data/workspaces/<task_id>/
  │
  ├── 渲染 Prompt 模板（填充 svn_url, old_revision, new_revision, report_path）
  │
  ├── 调用 Codex CLI（subprocess）
  │     ├── 成功（returncode=0）→ 检查报告文件是否存在且非空
  │     │     ├── 报告有效 → mark_success()
  │     │     └── 报告无效 → mark_failed("未生成有效报告")
  │     ├── 超时 → mark_failed("执行超时")
  │     └── 其他异常 → mark_failed(脱敏错误信息)
  │
  └── 回到循环
```

#### 4.3.2 Codex CLI 调用方式

```
命令格式：<codex_command> <codex_args> <prompt>
示例：codex exec --dangerously-bypass-approvals-and-sandbox "请使用当前工作区中的 skill..."
```

- 使用 `subprocess.run` 的参数数组形式调用，不拼接 shell 命令字符串，防止命令注入。
- 报告路径使用绝对路径，兼容工作目录含空格的情况。
- 超时时间可配置，默认 1800 秒（30 分钟）。

#### 4.3.3 Worker 线程管理

- Worker 运行在独立守护线程中，随 FastAPI 应用启动和停止。
- 应用关闭时通过 `stop_event` 通知 Worker 退出，等待最多 5 秒。

### 4.4 API 层设计（app/main.py）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/tasks` | 创建审查任务 |
| GET | `/api/tasks` | 查询任务列表（最近 50 条） |
| GET | `/api/tasks/{task_id}` | 查询任务详情 |
| GET | `/api/tasks/{task_id}/report` | 获取 Markdown 报告文本（预览） |
| GET | `/api/tasks/{task_id}/download` | 下载 Markdown 报告文件 |
| GET | `/` | 前端页面 |

#### 4.4.1 创建任务 API

请求：

```json
POST /api/tasks
Content-Type: application/json

{
  "svn_url": "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T",
  "old_revision": "r25576",
  "new_revision": "r29303",
  "requester": "张三"
}
```

响应（成功）：

```json
{
  "task_id": "a1b2c3d4-...",
  "status": "pending"
}
```

响应（校验失败）：

```json
HTTP 400
{
  "detail": "SVN 项目路径必须以 https://192.168.0.233/svn/src_home/ 开头"
}
```

#### 4.4.2 查询任务详情 API

响应：

```json
{
  "task_id": "a1b2c3d4-...",
  "svn_url": "https://192.168.0.233/svn/src_home/PCB_1447V320/SST22-1404-T",
  "old_revision": "r25576",
  "new_revision": "r29303",
  "requester": "张三",
  "status": "success",
  "created_at": "2026-05-22T09:00:00+08:00",
  "started_at": "2026-05-22T09:00:05+08:00",
  "finished_at": "2026-05-22T09:18:30+08:00",
  "error_message": null,
  "report_available": true
}
```

#### 4.4.3 报告预览与下载

- 预览接口返回 Markdown 纯文本（`text/markdown`），前端负责渲染。
- 下载接口返回文件附件（`Content-Disposition: attachment`），文件名格式 `code-review-<task_id>.md`。
- 只有 `status` 为 `success` 且报告文件存在时才能访问，否则返回 HTTP 409。

### 4.5 前端设计（static/）

#### 4.5.1 页面布局

```
┌──────────────────────────────────────────────────────┐
│ Codex 代码审查                              [就绪]    │
├────────────────────────┬─────────────────────────────┤
│  任务提交表单           │                              │
│  ┌──────────────────┐  │                              │
│  │ SVN 项目路径      │  │       报告预览区             │
│  │ 旧版本号 │ 新版本号│  │                              │
│  │ 提交人            │  │   （Markdown 渲染）           │
│  │ [提交审查]        │  │                              │
│  └──────────────────┘  │                              │
├────────────────────────┤                              │
│  当前任务状态           │                              │
│  任务ID / 状态 / 时间  │                              │
│  [下载 Markdown]       ├─────────────────────────────┤
├────────────────────────┤                             │
│  最近任务列表           │                              │
│  ┌──────────────────┐  │                              │
│  │ success r1→r2    │  │                              │
│  │ failed  r3→r4    │  │                              │
│  └──────────────────┘  │                              │
└────────────────────────┴─────────────────────────────┘
```

#### 4.5.2 交互流程

1. 用户填写表单，点击「提交审查」。
2. 前端发送 `POST /api/tasks`，获得 `task_id`。
3. 每 2.5 秒轮询 `GET /api/tasks/{task_id}`，更新状态显示。
4. 状态变为 `success` 后，调用 `GET /api/tasks/{task_id}/report` 加载 Markdown 并渲染。
5. 显示下载按钮，用户可下载原始 `.md` 文件。
6. 状态变为 `failed` 时，停止轮询并显示错误摘要。

### 4.6 清理模块（app/cleanup.py）

- 保留周期：90 天（可配置）。
- 触发时机：服务启动时执行一次。
- 清理内容：超过 90 天的任务数据库记录、对应报告文件、临时工作目录。
- 容错：清理失败仅记录日志，不影响 API 正常运行。

### 4.7 Prompt 模板设计（config/prompt_template.md）

```
请使用当前工作区中的 skill：skills/通用-代码变更审查

用这个更新后的代码审查：
- 项目路径：{svn_url}
- 旧版本号：{old_revision}
- 新版本号：{new_revision}
- 报告输出路径：{report_path}

要求：
1. 按该 skill 的输入模块、SVN 获取策略、规则模块和输出模块执行。
2. 最终必须生成 Markdown 报告文件到指定报告输出路径。
3. 只需要输出最终完成状态和报告路径，不需要在终端输出完整报告正文。
```

占位符在 Worker 处理任务时由服务端动态填充。

### 4.8 配置管理（app/config.py）

所有配置项通过环境变量管理，支持 `.env` 文件：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `APP_BASE_DIR` | 当前工作目录 | 应用根目录 |
| `DATABASE_PATH` | `data/app.db` | SQLite 数据库路径 |
| `REPORTS_DIR` | `data/reports` | 报告文件存储目录 |
| `WORKSPACES_DIR` | `data/workspaces` | 临时工作目录 |
| `PROMPT_TEMPLATE_PATH` | `config/prompt_template.md` | Prompt 模板路径 |
| `SVN_ALLOWED_PREFIX` | `https://192.168.0.233/svn/src_home/` | SVN 路径白名单前缀 |
| `CODEX_COMMAND` | `codex` | Codex CLI 命令 |
| `CODEX_ARGS` | `exec --dangerously-bypass-approvals-and-sandbox` | Codex CLI 参数 |
| `CODEX_TIMEOUT_SECONDS` | `1800` | Codex 执行超时（秒） |
| `WORKER_POLL_SECONDS` | `2` | Worker 轮询间隔（秒） |
| `RETENTION_DAYS` | `90` | 任务保留天数 |

---

## 5 安全设计

虽然 MVP 面向内网可信员工，仍保留基础安全措施：

| 安全措施 | 说明 |
|---|---|
| SVN 路径白名单 | 项目路径必须匹配配置的前缀，防止路径遍历 |
| 版本号校验 | 严格正则匹配，只接受 `r数字` 或 `数字` 格式 |
| 报告路径服务端生成 | 用户不能指定报告输出路径，防止任意文件写入 |
| 禁止额外参数 | 不接受用户传入的命令行参数，防止命令注入 |
| 日志脱敏 | 不将完整 Codex stdout/stderr 暴露给浏览器 |
| 执行超时 | Codex 执行必须有超时限制（默认 30 分钟） |
| 并发限制 | 默认一次只执行一个 Codex 任务 |
| 路径安全校验 | 下载报告时验证路径在 reports 目录内，防止目录穿越 |

---

## 6 测试策略

### 6.1 单元测试

| 测试模块 | 覆盖内容 |
|---|---|
| test_validation | 版本号规范化（加前缀/保持前缀/拒绝非法值）、SVN 路径校验 |
| test_database | 任务创建与查询、Worker 领取任务、状态标记、过期删除、stale 任务处理 |
| test_worker | 报告生成成功、报告缺失失败、Codex 执行超时、非零返回码 |
| test_cleanup | 90 天清理时间计算、文件和目录删除、清理失败容错 |
| test_config | 环境变量加载、路径解析、Codex 参数解析 |

### 6.2 API 集成测试

- 成功创建任务，返回 pending 状态。
- 拒绝非法 SVN URL（返回 HTTP 400）。
- 拒绝非法版本号（返回 HTTP 400）。
- 拒绝相同版本号（返回 HTTP 400）。
- 查询任务列表和详情。
- 任务成功后返回 Markdown 报告文本。
- 任务成功后下载 Markdown 文件。

### 6.3 联调测试

使用 `tools/fake_codex.py` 模拟 Codex CLI 命令，验证从前端提交到报告预览的完整链路。真实 Codex 环境就绪后进行端到端联调。

---

## 7 部署方案

### 7.1 MVP 部署（本地开发验证）

```bash
# 安装依赖
uv sync

# 启动服务
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 7.2 生产部署（内网服务器）

```bash
# 使用 fake_codex 验证流程
set CODEX_COMMAND=python
set CODEX_ARGS=tools/fake_codex.py
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 真实 Codex 环境
set CODEX_COMMAND=codex
set CODEX_ARGS=exec --dangerously-bypass-approvals-and-sandbox
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

前置条件：

- 服务器已安装 Python 3.11+ 和 Codex CLI。
- 服务器系统账号已配置 SVN 凭据。
- 服务以守护进程方式运行（推荐使用 NSSM 或 Windows Service 注册）。

---

## 8 后续演进

### 8.1 队列升级

当任务量增大或需要多 Worker 并发时，将 SQLite 轮询替换为 Redis/RQ 或 Celery。API 接口和前端轮询行为保持不变，仅替换任务派发和领取机制。

### 8.2 登录与统计

增加用户登录系统后，从登录态获取提交人信息（不再信任表单提交人），并按用户、项目、时间维度统计使用次数。

### 8.3 实时日志

如需查看执行进度，可增加脱敏后的日志流推送（WebSocket 或 SSE），但需注意防止内部路径和凭据信息泄露。

### 8.4 多 Worker 并发

迁移到正式队列后支持可配置并发数，启用前需增加服务器资源限制和项目级限流。
