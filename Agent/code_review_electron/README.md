# Code Review Electron

Code Review Electron 是代码审查平台的本地客户端。它登录 Code Review Server、领取或创建审查任务、检查本机环境、调起 Codex 执行审查，并在报告生成后上传到服务端。

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

环境检查通过后，客户端会把任务信息交给 Codex。客户端本身不直接运行 `svn diff`，也不在主进程里拼接 SVN 差异；SVN 收集、变更分析和 Markdown 报告生成由 Codex Skill 执行。客户端只负责调度 Codex、校验报告文件存在且非空、将报告上传给服务端，并更新任务状态。

## 开发命令

```bash
npm test
npm run typecheck
npm run build
```

构建产物输出到 `out/`，不要提交该目录。
