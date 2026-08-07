# 问题跟踪器：GitHub

本仓库的问题和 PRD 统一记录在 GitHub Issues 中。所有操作使用 `gh` CLI 完成。

目标仓库：`Acoollpp/PeiChengAI`。

## 操作约定

- **创建问题**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取问题**：`gh issue view <编号> --comments`，同时获取标签并按需使用 `jq` 过滤评论。
- **列出问题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并按需要添加 `--label` 和 `--state` 过滤条件。
- **添加评论**：`gh issue comment <编号> --body "..."`
- **添加或移除标签**：`gh issue edit <编号> --add-label "..."` 或 `--remove-label "..."`
- **关闭问题**：`gh issue close <编号> --comment "..."`

在 Git 仓库内运行时，由 `git remote -v` 推断目标仓库，`gh` 会自动完成该过程。

## 将 Pull Request 作为分类入口

**PRs as a request surface: no.**

如果以后改为 `yes`，外部 Pull Request 将与 Issue 使用相同的标签和状态，并通过对应的 `gh pr` 命令操作：

- **读取 PR**：`gh pr view <编号> --comments`，使用 `gh pr diff <编号>` 查看差异。
- **列出待分类的外部 PR**：使用 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的项目。
- **评论、添加标签或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`、`gh pr edit --remove-label` 和 `gh pr close`。

GitHub 的 Issue 和 PR 共用编号空间，因此 `#42` 可能指向任意一种对象。先运行 `gh pr view 42`，失败后再运行 `gh issue view 42`。

## 当技能要求“发布到问题跟踪器”

创建一条 GitHub Issue。

## 当技能要求“获取相关工单”

运行 `gh issue view <编号> --comments`。

## Wayfinder 操作

`/wayfinder` 使用一条总览 Issue 作为地图，并将子 Issue 作为具体工单。

- **地图**：一条带有 `wayfinder:map` 标签的 Issue，正文记录 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map` 创建。
- **子工单**：通过 GitHub 子 Issue 关联到地图，并使用 `wayfinder:<类型>` 标签，其中类型为 `research`、`prototype`、`grilling` 或 `task`。如果仓库不支持子 Issue，则在地图正文中使用任务列表，并在子工单开头写入 `Part of #<地图编号>`。
- **阻塞关系**：优先使用 GitHub 原生 Issue 依赖关系。若不可用，则在子工单正文开头记录 `Blocked by: #<编号>`。
- **可执行队列**：从地图的未关闭子工单中排除存在未关闭阻塞项或已有负责人的工单，按地图中的顺序选择第一项。
- **认领**：运行 `gh issue edit <编号> --add-assignee @me`。这是会话中的第一次写操作。
- **完成**：添加结果评论、关闭子工单，并在地图的 Decisions-so-far 中补充上下文链接。
