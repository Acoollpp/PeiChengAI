# Codex CLI 自动安装与环境检查分阶段设计

## 背景

Electron 客户端当前依赖本机可执行的 `codex` 命令完成代码审查与 Skill 安装。现有主流程已经可用，因此本次设计以最小侵入为原则：不改变 `codex exec` 审查方式，不内置 Codex CLI，不自动安装 Node/npm，只在用户本机已存在 npm 时，通过客户端触发 `npm install -g @openai/codex` 安装 Codex CLI。

同时，当前本地环境检查会并行检查 Codex CLI、SVN CLI、运行目录和 Skill。用户希望当 Codex CLI 缺失时，先只展示 Codex 问题，不继续检查或展示 SVN CLI 与 Skill，避免无关依赖干扰用户处理第一步问题。

## 目标

1. Codex CLI 缺失时，客户端提供“安装 Codex”入口。
2. 客户端只通过已有 npm 安装 `@openai/codex`，不负责安装 Node/npm。
3. 本地环境检查改为分阶段：先检查 Codex CLI；Codex 未就绪时不检查 SVN CLI 与 Skill。
4. 安装、检查过程中在界面显示转圈，明确客户端仍在工作。
5. 保持现有代码审查与 Skill 安装的 Codex 调用方式不变。

## 非目标

1. 不内置 Codex CLI 可执行文件。
2. 不通过 winget、Homebrew、apt、yum、Node 官方安装包或其他方式自动安装 Node/npm。
3. 不修改用户系统 PATH。
4. 不改变用户默认 Codex 配置目录。客户端继续复用默认 `~/.codex`，由 Codex CLI 自身读取配置、登录状态和 Skill。
5. 不调整代码审查 Prompt、报告生成流程或 SVN 业务逻辑。

## 当前实现约束

当前 `codex-runner.ts` 通过 `buildCodexCommand()` 获取 Codex 命令，并执行：

```bash
codex exec --dangerously-bypass-approvals-and-sandbox <prompt>
```

`codex-skill-installer.ts` 安装 Skill 时也复用相同的 Codex 命令解析和 `codex exec` 调用。

当前环境检查会额外补充常见 PATH：

```text
%LOCALAPPDATA%/Microsoft/WindowsApps
%APPDATA%/npm
/opt/homebrew/bin
/opt/homebrew/sbin
/usr/local/bin
/usr/bin
/bin
/usr/sbin
/sbin
```

其中 `%APPDATA%/npm` 是 Windows 上 npm 全局命令常见目录，`npm install -g @openai/codex` 后的 `codex.cmd` 通常会出现在这里。

## 设计方案

### 环境检查流程

`checkEnvironment()` 调整为分阶段执行：

1. 获取客户端运行路径。
2. 检查运行目录是否可写。
3. 检查 Codex CLI 版本。
4. 如果运行目录不可写，返回 `failed`。
5. 如果 Codex CLI 缺失，返回 `missing_codex`，并停止后续检查。
6. 如果 Codex CLI 就绪，再检查 SVN CLI 与 Skill 包状态。
7. 按现有优先级返回状态：`missing_codex`、`missing_svn`、`missing_skill`、`ready`。

Codex 缺失时不读取 Skill manifest，不触发 Skill 同步，不检查 SVN CLI，也不向渲染层返回 SVN 与 Skill 的缺失状态。

### Codex CLI 安装

新增主进程模块 `codex-cli-installer.ts`，职责只包含 Codex CLI 安装：

1. 查找 npm 命令，候选包含 `npm`、`npm.cmd`，并使用现有扩展 PATH。
2. npm 不存在时，返回 Codex 安装错误：`未检测到 npm，请先安装 Node.js 后重试或联系管理员。`
3. npm 存在时，执行：

```bash
npm install -g @openai/codex
```

4. 如果通过 npm 安装 Codex CLI 失败，采集 stdout/stderr 的错误摘要，并返回 Codex 安装错误。
5. 如果安装命令成功，立即执行 `codex --version` 验证。
6. 验证成功后，重新运行环境检查并返回最新 `EnvironmentCheckResult`。
7. 验证失败时返回 Codex 安装错误：`Codex CLI 已安装但当前客户端暂未检测到，请重启客户端或检查 npm 全局路径。`

安装模块不修改系统 PATH，不安装 Node/npm，不改变 Codex 配置目录。

### IPC

新增 IPC channel：

```text
codex:install
```

preload 暴露：

```ts
installCodex(): Promise<EnvironmentCheckResult>
```

渲染层通过 `window.codeReview.installCodex()` 触发安装。安装成功和失败都返回 `EnvironmentCheckResult`，便于界面统一更新状态。

现有 `environment:check` 保留，但内部检查流程改为分阶段。现有 `skill:install` 保持不变。

### 类型

`EnvironmentCheckResult` 增加可选字段：

```ts
codexError?: string
```

`codexError` 用于展示 Codex CLI 检测或安装错误。`skillError` 继续只表示 Skill 同步、Skill 包或运行目录相关错误，避免混用。

安装模块内部可以使用结构化状态：

```ts
type CodexInstallStatus =
  | 'installed'
  | 'missing_npm'
  | 'failed'
  | 'not_detected_after_install'
```

该内部状态不必暴露给渲染层，渲染层以 `EnvironmentCheckResult.status` 和 `codexError` 为准。

### 界面交互

Codex 缺失时，环境面板只展示 Codex CLI 卡片：

1. 状态显示“缺少 Codex”。
2. 卡片文案显示 Codex CLI 缺失或 `codexError`。
3. 主按钮显示“安装 Codex”。
4. 不展示 SVN CLI 和代码审查 Skill 卡片。

检查和安装过程显示统一 loading spinner：

1. 环境检查中：显示“检查中...”和转圈，禁用重新检查。
2. Codex 安装中：按钮显示“安装中...”和转圈，禁用安装按钮与重新检查按钮。
3. Skill 安装中：按钮显示“安装中...”和转圈，复用同一 spinner 样式。

spinner 使用 CSS 动画实现，不引入新依赖，并保持固定尺寸，避免按钮或卡片布局跳动。

安装成功并验证通过后，自动刷新环境状态。只有 Codex CLI 就绪后，界面才展示 SVN CLI 和 Skill 状态。

### 错误处理

Codex 安装错误分三类展示：

1. npm 不存在：`未检测到 npm，请先安装 Node.js 后重试或联系管理员。`
2. 通过 npm 安装 Codex CLI 失败：展示 npm 输出的简短错误摘要，优先保留权限、网络、registry、证书或代理相关信息。
3. 安装后未检测到 Codex：`Codex CLI 已安装但当前客户端暂未检测到，请重启客户端或检查 npm 全局路径。`

错误展示必须避免误导用户认为客户端会自动安装 npm 或 Node.js。

## 测试计划

主进程测试覆盖：

1. Codex CLI 缺失时，`checkEnvironment()` 不检查 SVN CLI，不检查 Skill。
2. Codex CLI 存在时，`checkEnvironment()` 继续检查 SVN CLI 和 Skill。
3. npm 不存在时，`codex:install` 返回 `missing_codex` 和明确的 `codexError`。
4. 通过 npm 安装 Codex CLI 失败时，返回 npm 错误摘要。
5. npm 安装命令成功但 `codex --version` 失败时，返回安装后未检测到的提示。
6. npm 安装命令成功且 Codex 验证成功时，返回刷新后的环境状态。
7. Windows 下 npm 查找支持 `npm.cmd`。

渲染层测试覆盖：

1. `missing_codex` 时只渲染 Codex CLI 卡片。
2. Codex CLI 就绪后才渲染 SVN CLI 和 Skill 卡片。
3. 环境检查中显示 spinner，并禁用重新检查。
4. Codex 安装中显示 spinner，并禁用安装与重新检查。
5. Skill 安装中显示 spinner，并禁用 Skill 安装按钮。

## 兼容性

本方案不改变现有审查执行命令，不改变 Skill 安装命令，不改变 Codex 配置目录。已安装 Codex CLI 且现有功能可用的用户不会受到影响。

Codex CLI 缺失用户在安装成功后，会通过当前环境检查已有的扩展 PATH 发现 `codex`。如果 Electron 当前进程仍无法发现新安装命令，界面提示用户重启客户端或检查 npm 全局路径。

## 待确认事项

无。设计已确认：客户端只自动安装 Codex CLI，不自动安装 Node/npm。
