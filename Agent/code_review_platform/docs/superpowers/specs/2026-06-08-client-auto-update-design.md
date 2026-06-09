# Windows 客户端自动更新设计

## 背景

当前系统由 Web 服务端和 Electron 客户端组成。客户端已经发给用户使用，且客户端通过登录页填写的服务端地址访问后端 API。现有默认服务端地址是内网 HTTP 地址，代码允许 `http://` 和 `https://`。

Electron 客户端当前使用 `electron-builder` 打包，Windows 目标为 NSIS，构建命令是 `npm run dist:win`。这与 `electron-updater` 的 Windows 自动更新机制匹配：服务端提供更新元数据和安装包，客户端检查版本、下载更新、校验文件并在用户确认后安装。

本功能必须在 `Test` 分支和独立测试服务中开发验证，避免影响已经交付给用户的当前客户端和服务端。

## 已确认决策

- 第一版只支持 Windows x64。
- 发布包存储在当前后端服务器本地磁盘。
- 更新是用户可选更新，不强制阻断旧版本使用。
- 第一版没有 Windows 代码签名证书。
- 第一版不做安装包额外加密。
- 仍保留 hash 完整性校验，用于发现下载损坏、元数据和安装包不匹配等问题。
- 客户端登录成功后自动检查更新。
- 管理员通过 Web 管理后台上传并发布客户端版本。
- 文档、提交信息使用中文。

## 目标

让管理员能在 Web 管理后台发布新的 Windows 客户端版本，让已安装客户端在用户登录成功后发现新版本，提示用户下载并安装。

用户体验目标：

1. 用户正常登录后，如果没有新版本，不打扰用户。
2. 如果有新版本，弹窗提示版本号和更新说明。
3. 用户可以选择“现在更新”或“稍后”。
4. 用户选择更新后，客户端显示下载进度。
5. 下载完成后，提示用户“立即重启安装”或“稍后重启”。
6. 更新失败不影响用户继续使用当前旧版本。

运维目标：

1. 测试环境和现有服务隔离。
2. 发布文件、数据库记录、报告和 Skill 文件都使用测试环境独立资源。
3. 管理员可以看到历史发布版本，并选择当前启用版本。
4. 发布操作有发布人、发布时间、文件大小和 hash 记录，便于追溯。

## 非目标

第一版不做以下能力：

- macOS、Linux 自动更新。
- 强制更新。
- 灰度发布、分部门发布、分用户发布。
- beta/stable 多渠道。
- 对安装包进行额外加密。
- 自动生成 `latest.yml`。
- 购买或接入 Windows 代码签名证书。
- 自研安装器覆盖逻辑。

这些能力可以在后续版本基于当前模型扩展。

## 技术解释

自动更新不是服务端直接把程序“推”到用户电脑。桌面应用通常不能被服务器随意远程写入文件，因为这会带来安全问题，也容易被系统和安全软件拦截。

本设计采用常见的“客户端拉取更新”模型：

```text
客户端登录成功
  │
  ├─ 请求服务端更新元数据
  │
  ├─ 对比当前版本和服务端最新版本
  │
  ├─ 有新版本时提示用户
  │
  ├─ 用户同意后下载安装包
  │
  ├─ 校验安装包 hash
  │
  └─ 用户确认后退出旧程序并启动安装流程
```

`latest.yml` 是 `electron-builder` 给自动更新器使用的元数据文件。它通常包含新版本号、安装包文件名、文件大小、`sha512` 等信息。客户端先读 `latest.yml`，再根据其中的信息下载安装包。

`sha512` 不是加密。它是完整性校验：客户端下载完安装包后计算文件 hash，并和 `latest.yml` 中的值比较。如果不一致，说明文件损坏、下载错了，或者元数据和安装包不是同一次构建产物，客户端应该拒绝安装。

## 推荐方案

采用 `electron-updater` 的 `NsisUpdater` + generic provider：

- Windows 安装包继续使用 `electron-builder` 的 NSIS 目标。
- 服务端提供一个类似静态文件服务器的更新目录。
- 客户端用当前登录服务端地址作为更新源。
- 客户端通过 `Authorization: Bearer <token>` 下载更新元数据和安装包。
- 管理后台上传 `latest.yml`、`.exe` 和可选 `.blockmap`。

官方文档依据：

- `electron-builder` Auto Update 文档说明 Windows 支持 NSIS 自动更新，generic server 是支持的发布源。
- `electron-builder` 文档说明如果需要请求头鉴权，可以直接实例化 updater。
- `NsisUpdater` API 提供请求头和 `addAuthHeader` 能力。

参考链接：

- https://www.electron.build/docs/features/auto-update/
- https://www.electron.build/docs/api/electron-updater.class.nsisupdater/
- https://www.electron.build/publish/

## 整体架构

```text
Web 管理后台
  │
  │ 管理员上传版本文件
  ▼
后端 Client Releases API
  │
  ├─ 写数据库：版本号、说明、文件路径、hash、启用状态
  │
  └─ 写本地磁盘：latest.yml、exe、blockmap
        │
        │ 客户端登录后检查更新
        ▼
Electron 主进程 AppUpdaterService
  │
  ├─ NsisUpdater 读取 latest.yml
  ├─ 判断是否有新版本
  ├─ 下载安装包
  ├─ 校验 sha512
  └─ 下载完成后等待用户确认重启安装
        │
        ▼
Electron Renderer 更新弹窗
```

## 服务端设计

### 新增模型

新增 `ClientRelease` 表：

```text
id
version
platform
arch
release_notes
artifact_name
artifact_path
artifact_size
artifact_sha512
latest_yml_name
latest_yml_path
blockmap_name
blockmap_path
is_active
created_by_user_id
created_at
updated_at
```

字段说明：

- `version`：客户端版本，例如 `1.0.1`。
- `platform`：第一版固定为 `win32`。
- `arch`：第一版固定为 `x64`。
- `artifact_name`：安装包文件名，例如 `代码审查-v1.0.1.exe`。
- `artifact_sha512`：服务端读取 `latest.yml` 或计算安装包得到的 hash。
- `is_active`：同一平台和架构只有一个启用版本。

### 存储目录

新增配置：

```text
CLIENT_RELEASE_STORAGE_DIR=/app/client-releases
```

目录结构：

```text
/app/client-releases/
  <release_id>/
    latest.yml
    代码审查-v1.0.1.exe
    代码审查-v1.0.1.exe.blockmap
```

测试环境使用独立 Docker volume：

```text
code_review_server_test_client-release-data
```

### 管理端 API

```text
GET  /api/v1/client-releases
POST /api/v1/client-releases
POST /api/v1/client-releases/{release_id}/activate
```

权限：

- 只允许管理员访问。
- 复用现有 `get_current_active_admin`。

上传接口字段：

```text
version
release_notes
activate
installer
latest_yml
blockmap
```

第一版要求：

- `installer` 必填，文件扩展名必须是 `.exe`。
- `latest_yml` 必填，文件名必须是 `latest.yml`。
- `blockmap` 可选。
- `version` 必须和 `latest.yml` 中的 `version` 一致。
- `latest.yml` 中引用的安装包文件名必须和上传的 `.exe` 文件名一致。

### 客户端更新下载 API

```text
GET /api/v1/client-updates/win32/x64/latest.yml
GET /api/v1/client-updates/win32/x64/{filename}
```

权限：

- 需要登录用户 Bearer Token。
- 不需要管理员权限。

行为：

- 返回当前启用版本的 `latest.yml`。
- 下载文件时只允许访问当前启用版本目录中的文件。
- 文件路径必须经过安全校验，禁止 `..`、绝对路径、反斜杠路径穿越。
- 没有启用版本时返回 404。

## 管理后台设计

新增后台入口：`客户端版本`。

页面复用现有 `Skill库` 的交互风格，分为上传区和版本列表。

上传区字段：

- 版本号。
- 更新说明。
- 安装包 `.exe`。
- `latest.yml`。
- 可选 `.blockmap`。
- 上传后是否启用。

版本列表字段：

- 版本号。
- 平台和架构。
- 文件大小。
- 当前启用状态。
- 发布人。
- 发布时间。
- 更新说明。
- 激活按钮。

交互：

- 上传成功后刷新列表。
- 激活某个版本后，同一平台架构下其他版本自动取消启用。
- 上传失败时显示后端错误信息，例如版本不一致、文件缺失、文件名不匹配。

## Electron 客户端设计

### 依赖

新增运行依赖：

```text
electron-updater
electron-log
```

`electron-updater` 负责检查、下载和安装更新。

`electron-log` 用于记录更新过程日志，便于排查用户机器上的更新失败问题。

### 主进程服务

新增 `src/main/app-updater.ts`。

职责：

1. 读取当前服务端地址。
2. 读取当前登录 token。
3. 创建 `NsisUpdater`。
4. 设置 generic provider 地址：

```text
<server_url>/api/v1/client-updates/win32/x64
```

5. 添加鉴权头：

```text
Authorization: Bearer <access_token>
```

6. 监听更新事件并通过 IPC 通知 renderer。

事件：

```text
checking-for-update
update-available
update-not-available
download-progress
update-downloaded
error
```

关键配置：

```text
autoDownload = false
autoInstallOnAppQuit = false
```

这样用户看到更新提示后才下载，下载完成后也由用户决定是否立即重启安装。

### IPC 设计

新增 IPC：

```text
app-update:check
app-update:download
app-update:install
app-update:dismiss
```

Renderer 监听事件：

```text
app-update:available
app-update:not-available
app-update:download-progress
app-update:downloaded
app-update:error
```

登录成功后触发：

```text
auth 登录成功
  │
  └─ app-update:check
```

如果用户未登录，更新检查不执行。

### Renderer UI

新增 `UpdateDialog`。

状态：

- `idle`：无更新弹窗。
- `available`：发现新版本。
- `downloading`：正在下载。
- `downloaded`：下载完成，等待重启安装。
- `error`：更新失败，可关闭。

弹窗文案：

```text
发现新版本 1.0.1

当前版本：1.0.0-beta1
更新内容：
- 修复任务列表刷新后状态显示不一致的问题
- 优化本地环境检查提示

[稍后] [现在更新]
```

下载中：

```text
正在下载新版本
43%

[后台下载]
```

下载完成：

```text
新版本已准备好
重启客户端后将完成安装。

[稍后重启] [立即重启]
```

错误：

```text
更新失败
当前版本仍可继续使用。

[知道了]
```

## 构建和发布流程

管理员发布前，开发人员先在 Electron 项目构建：

```bash
npm run dist:win
```

构建产物来自 `code_review_electron/release/`，通常包括：

```text
latest.yml
代码审查-v1.0.1.exe
代码审查-v1.0.1.exe.blockmap
```

发布流程：

```text
开发人员构建 Windows 安装包
  │
  ├─ 确认 package.json version 已升级
  │
  ├─ 保留同一次构建生成的 latest.yml、exe、blockmap
  │
  ▼
管理员登录 Web 后台
  │
  ├─ 进入 客户端版本
  ├─ 填版本号和更新说明
  ├─ 上传 latest.yml、exe、blockmap
  └─ 选择上传后启用
```

注意：`latest.yml` 和安装包必须来自同一次构建，不能手工混用旧的 `latest.yml` 和新的 `.exe`。

## 安全边界

第一版不做额外加密，因为这是内网客户端，安装包内容本身不需要保密。

但第一版仍保留这些安全措施：

- 只有管理员能上传和激活版本。
- 普通用户必须登录后才能下载更新文件。
- 服务端校验上传文件名、扩展名、版本号和 `latest.yml` 内容。
- 客户端使用 `latest.yml` 中的 `sha512` 做完整性校验。
- 服务端保存发布人和发布时间。
- 文件读取使用固定 release 目录，禁止路径穿越。

没有代码签名的影响：

- Windows 可能显示“未知发布者”。
- 企业安全软件可能提示或拦截安装包。
- 如果攻击者能同时篡改服务端文件和元数据，hash 校验无法证明发布者身份。

第一版接受这些限制，后续购买证书后，在构建流程接入代码签名，不需要推翻当前自动更新架构。

## 错误处理

| 场景 | 处理 |
|------|------|
| 用户未登录 | 不检查更新 |
| 服务端没有启用版本 | 静默忽略，不打扰用户 |
| 网络错误 | 记录日志，Renderer 可显示“更新检查失败”，不影响使用 |
| 当前版本已经最新 | 静默结束 |
| 下载中断 | 显示错误，允许用户继续使用旧版本 |
| hash 校验失败 | 拒绝安装，显示“更新包校验失败” |
| 用户点击稍后 | 本次不再提示，下一次登录后再检查 |
| 用户关闭客户端 | 不自动安装，除非已经点击立即重启安装 |

## 测试设计

### 后端测试

新增测试覆盖：

- 管理员能上传客户端版本。
- 普通用户不能上传。
- 上传空文件失败。
- `.exe` 缺失失败。
- `latest.yml` 缺失失败。
- `version` 和 `latest.yml` 不一致失败。
- 上传后启用会取消同平台架构其他启用版本。
- 普通登录用户能下载当前启用版本的 `latest.yml`。
- 未登录用户不能下载更新文件。
- 路径穿越文件名返回 400 或 404。

### 前端测试

新增或调整测试覆盖：

- 管理员能看到客户端版本页面。
- 非管理员不能进入客户端版本页面。
- 上传表单能提交版本号、说明和文件。
- 激活按钮调用正确 API。
- 上传失败显示错误 toast。

### Electron 测试

主进程单元测试：

- 登录后能触发更新检查。
- 未登录时不检查。
- `NsisUpdater` 使用当前服务端地址。
- `NsisUpdater` 携带 Bearer Token。
- 下载进度事件能转发给 Renderer。
- 更新错误不会导致应用崩溃。

Renderer 测试：

- 发现新版本时展示版本号和说明。
- 点击“现在更新”触发下载。
- 下载进度展示百分比。
- 下载完成后点击“立即重启”触发安装 IPC。
- 错误状态可关闭。

### 手工验收

在 `Test` 分支的独立测试服务中验证：

1. 后端健康检查通过。
2. Web 前端能打开。
3. 管理员登录后能上传测试版本。
4. Electron 客户端连接测试后端 `http://127.0.0.1:18000`。
5. 登录成功后弹出更新提示。
6. 点击更新后能下载。
7. 下载完成后能触发安装流程。
8. 更新失败时旧版本仍可继续使用。

## 测试环境

当前已经建立独立测试环境：

```text
分支：Test
worktree：/home/gpt/PeiChengAI/.worktrees/Test
后端：http://127.0.0.1:18000
前端：http://127.0.0.1:15174
Adminer：http://127.0.0.1:18083
PostgreSQL：127.0.0.1:15543
数据库：app_test
```

启动命令：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server
docker compose --env-file .env.test -p code-review-test -f compose.yml -f compose.test.yml up -d --build
```

停止命令：

```bash
cd /home/gpt/PeiChengAI/.worktrees/Test/Agent/code_review_platform/code_review_server
docker compose --env-file .env.test -p code-review-test -f compose.yml -f compose.test.yml down
```

如需删除测试数据库卷：

```bash
docker volume rm code_review_server_test_app-db-data
docker volume rm code_review_server_test_client-release-data
```

## 实现顺序建议

1. 后端新增 `ClientRelease` 模型、迁移、服务和 API。
2. 后端新增客户端更新文件下载 API。
3. 管理后台新增客户端版本页面。
4. Electron 集成 `electron-updater`，先做主进程服务和 IPC。
5. Electron 新增更新提示 UI。
6. 在测试服务中上传一次真实构建产物，做端到端验收。

## 风险和缓解

| 风险 | 缓解 |
|------|------|
| HTTP 内网传输可被中间人篡改 | 第一版接受内网风险，后续升级 HTTPS；保留 hash 校验 |
| 未签名安装包被 Windows 或安全软件提醒 | 内网先接受；后续接入代码签名 |
| `latest.yml` 和安装包不匹配 | 上传时校验文件名和版本；客户端下载时 hash 校验 |
| 更新逻辑影响旧版本用户 | 更新失败不阻断使用；第一版可选更新 |
| 测试污染现有服务 | 使用 `Test` 分支、独立端口、独立数据库和独立 Docker volume |

## 实现与验收备注

- Electron 主进程使用 `electron-updater` 的 `NsisUpdater` 和 generic provider；打包配置中保留 generic `publish`，运行时仍会根据当前登录服务端地址覆盖更新 feed。
- Renderer 将更新流程状态和弹窗可见状态分开处理；用户选择“后台下载”后，后续下载进度不会反复弹出窗口，下载完成或更新失败仍会重新提示。
- 当前开发环境默认 Node 为 `18.19.1`，Electron renderer 测试使用 `jsdom 24.1.3`，避免 `jsdom 29` 依赖链在 Node 18 下触发 ESM/CJS 兼容错误。
- 在 Linux 测试环境执行 `npm run dist:win` 时，已完成 Electron Windows 运行时下载并生成 `release/win-unpacked/代码审查.exe`；进入 NSIS 安装包阶段时因当前环境缺少 `wine` 失败。需要在 Windows 构建机或安装 `wine` 的 Linux 构建机上生成最终 `.exe` 安装包、`.blockmap` 和 `latest.yml` 后上传到测试服务。

## 验收标准

功能完成后必须满足：

- 当前用户使用的原服务不受影响。
- 测试服务使用 `app_test` 数据库。
- 管理员能上传、查看、激活 Windows 客户端版本。
- Electron 客户端登录测试服务后能发现新版本。
- 用户可以选择稍后更新。
- 用户确认后能下载更新并看到进度。
- 下载完成后能选择重启安装。
- 更新失败时客户端仍可继续使用旧版本。
- 后端、Web 前端、Electron 关键路径测试通过。
