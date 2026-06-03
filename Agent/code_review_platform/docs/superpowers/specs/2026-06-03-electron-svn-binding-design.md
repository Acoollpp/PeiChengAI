# Electron 端 Key 登录后 SVN 凭据绑定设计

## 背景

当前项目有两种登录方式：Key 登录（CCH 系统）和 SVN 登录。CCH 同步用户时只同步了 Key 和 `cch_user_id`，不会同步 SVN 账号信息。因此通过 Key 登录的用户，其 `User.svn_username` 字段为 `None`，数据库中没有对应的 `user_svn_credential` 记录。

SVN 凭据是执行代码审查任务的必要条件（用于检出代码），但目前的流程中，Key 登录用户必须主动去 Web 前端的「用户设置 → SVN 凭据」页面手动填写，没有引导，很多用户不知道要这样做。

## 目标

在 Electron 客户端中，Key 登录成功后自动检测用户是否已绑定 SVN 凭据。如果未绑定，弹出 Dialog 引导用户填写 SVN 账号和密码，完成绑定后直接进入任务工作台。

## 约束

- **后端零改动**：完全复用现有 `GET /api/v1/me/svn-credential` 和 `PUT /api/v1/me/svn-credential` 接口
- **只改 Electron 端**：不涉及 Web 前端或后端
- **SVN 登录用户不需要此流程**：他们本身已用 SVN 凭据登录，服务端有记录

## 整体架构

### 状态流转

```
App 启动
  │
  ├─ 未登录 → 显示 LoginPage
  │
  ├─ Key 登录成功
  │    │
  │    ├─ needSvnBinding = true
  │    │    → 显示 TaskPage + SvnBindingDialog 弹窗
  │    │         ├─ 用户填写并提交 → 绑定成功 → 关闭 Dialog
  │    │         └─ 用户点击跳过 → 关闭 Dialog
  │    │
  │    └─ needSvnBinding = false
  │         → 直接进入 TaskPage
  │
  └─ SVN 登录成功 → 直接进入 TaskPage
```

### 页面层级

`SvnBindingDialog` 以模态弹窗形式覆盖在 `TaskPage` 之上。用户看到的是一个已经登录的系统 + 一个可关闭的引导弹窗。

### 关键决策

- **可跳过**：用户可以跳过绑定步骤直接使用系统，但下次 Key 登录时仍会检查并提示
- **每次登录检查**：每次 Key 登录都检查 SVN 凭据状态，不记忆"已跳过"状态
- **容错策略**：检查 SVN 凭据接口出错时，默认 `needSvnBinding = true`，宁可多提示

## 数据流

### 时序图

```
[Renderer]                [Main Process]              [Server API]
    |                          |                          |
    |-- auth:key-login ------->|                          |
    |                          |-- POST /auth/key-login ->|
    |                          |<-- tokens ---------------|
    |                          |                          |
    |                          |-- GET /me/svn-credential->|
    |                          |<-- 200 or 404 ------------|
    |<-- { needSvnBinding } ---|                          |
    |                          |                          |
    |  (如果 needSvnBinding)    |                          |
    |-- svn:bind-credential -->|                          |
    |                          |-- PUT /me/svn-credential->|
    |                          |<-- 200 -------------------|
    |<-- true -----------------|                          |
```

### IPC 改动

#### 1. 修改 `auth:key-login` 返回值

**当前**：返回 `true`

**改为**：返回 `{ needSvnBinding: boolean }`

主进程在 Key 登录成功后，立即用获取到的 token 调用 `GET /api/v1/me/svn-credential`：
- 200 → `needSvnBinding = false`
- 404 → `needSvnBinding = true`
- 其他错误 → `needSvnBinding = true`（容错）

#### 2. 新增 `svn:bind-credential` handler

接收 `{ svn_username: string, svn_password: string }`，用已存储的 access token 调用 `PUT /api/v1/me/svn-credential`。

## UI 设计

### 新增组件：SvnBindingDialog

模态 Dialog，居中显示在 TaskPage 之上，背景有半透明遮罩。

```
┌─────────────────────────────────────────┐
│  ┌───────────────────────────────────┐  │
│  │  ✕                                │  │  ← 右上角关闭按钮 = 跳过
│  │                                   │  │
│  │  绑定 SVN 账号                     │  │  ← 标题
│  │  使用 Key 登录需要绑定 SVN 账号     │  │  ← 副标题
│  │  才能执行代码审查任务               │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ SVN 账号                     │  │  │  ← 文本输入框
│  │  └─────────────────────────────┘  │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ SVN 密码                     │  │  │  ← 密码输入框
│  │  └─────────────────────────────┘  │  │
│  │                                   │  │
│  │  [跳过]              [绑定并继续]   │  │  ← 底部双按钮
│  └───────────────────────────────────┘  │
│                                         │
│  (下方是 TaskPage，半透明遮罩)           │
└─────────────────────────────────────────┘
```

### 组件接口

```typescript
interface SvnBindingDialogProps {
  onSubmit: (credentials: { svn_username: string; svn_password: string }) => Promise<void>
  onSkip: () => void
  isSubmitting: boolean
  error: string
}
```

### 交互细节

- 右上角 `✕` 关闭按钮和底部「跳过」按钮效果相同，都触发 `onSkip`
- 提交时按钮显示"绑定中..."并禁用所有输入和按钮
- 绑定失败时在表单下方显示后端返回的错误信息（如"SVN 账号已被其他用户绑定"、"SVN 凭据验证失败"等）
- 两个字段都必填，浏览器原生校验

### 样式

复用现有 Electron 端的 CSS 类名风格（`auth-card`、`form-stack`、`primary-button`、`secondary-button`），保持与登录页面视觉一致。

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `renderer/src/components/SvnBindingDialog.tsx` | 新增 | SVN 绑定弹窗组件 |
| `renderer/src/App.tsx` | 修改 | 新增 `needSvnBinding` 状态和绑定逻辑 |
| `renderer/src/code-review-api.ts` | 修改 | 新增类型定义，`CodeReviewApi` 接口加 `bindSvnCredential` |
| `main/api-client.ts` | 修改 | 新增 `updateSvnCredential()` 方法 |
| `main/ipc.ts` | 修改 | 修改 `auth:key-login` 返回值，新增 `svn:bind-credential` handler |
| `preload/index.ts` | 修改 | 暴露 `bindSvnCredential` 方法 |

### 不改动的文件

- 后端代码（所有路由、服务、模型）
- Web 前端代码
- `LoginPage.tsx`
- `TaskPage.tsx`

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| 检查 SVN 凭据接口网络错误 | `needSvnBinding = true`，弹 Dialog |
| 检查 SVN 凭据接口返回 404 | `needSvnBinding = true`，弹 Dialog |
| 绑定时 SVN 用户名已被其他用户占用（409） | Dialog 内显示错误信息，用户可修改 |
| 绑定时 SVN 密码验证失败（403） | Dialog 内显示错误信息，用户可重试 |
| 绑定时网络错误 | Dialog 内显示"网络错误，请重试" |
| 绑定时 token 过期 | Dialog 内显示"登录已过期，请重新登录" |

## 实现前置条件

由于另一个对话正在并行修改 `renderer/src/App.tsx`、`main/ipc.ts`、`preload/index.ts` 三个文件（Codex CLI 自动安装功能），本功能的实现需要等待该功能合并到 main 分支后再开始，以避免 merge 冲突。
