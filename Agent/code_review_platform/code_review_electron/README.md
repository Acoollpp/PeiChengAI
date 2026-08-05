# Code Review Electron

Code Review Electron 是代码审查平台的本地客户端。它登录 Code Review Server、领取或创建审查任务、检查本机环境、调起 Codex 执行审查，并在报告生成后上传到服务端。

## 登录与用户同步

管理员在 Web 管理后台点击“同步 CCH 用户”，服务端会从 Claude Code Hub PostgreSQL 同步 CCH 用户名、角色和 Key 到本地库；服务端部署时必须配置 `CCH_DATABASE_URL` 为 Claude Code Hub PostgreSQL 连接串。

Web 管理后台和 Electron 客户端支持 Key 登录和 SVN 账号密码登录。邮箱注册、邮箱登录、找回密码和修改密码已移除；Electron 不再提供注册或邮箱找回密码入口。

## 本地执行流程

客户端要求审查在用户本机执行，避免服务端直接访问本地工作副本或保存明文运行环境。启动客户端前请确认：

```bash
codex --version
svn --version --quiet
```

还需要确认通用审查 Skill 已安装到客户端读取的位置：

```text
skills/通用-代码变更审查/SKILL.md
```

环境检查通过后，客户端会把任务信息交给 Codex。客户端本身不直接运行 `svn diff`，也不在主进程里拼接 SVN 差异；SVN 收集、变更分析和 Markdown 报告生成由 Codex Skill 执行。客户端负责调度 Codex、校验报告、提取新协议报告的问题快照和相对图片资产、将报告上传给服务端，并更新任务状态。客户端先校验图片的路径、大小、容器结构和明显主动内容，服务端再对图片实际解码和安全性执行权威校验。

## 开发命令

```bash
npm test
npm run typecheck
npm run build
```

2.0 工作台视觉基线使用独立的本地 fixture 入口，不注入生产 preload，也不会请求服务端、SVN、Codex 或本地材料：

```bash
npm run dev:workbench
```

验证构建产物中的预览入口时使用：

```bash
npm run build
npm run preview:workbench
```

默认的 `npm run dev` 和 `npm run preview` 仍进入现有生产任务页。

构建产物输出到 `out/`，不要提交该目录。
