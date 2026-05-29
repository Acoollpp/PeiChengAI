# 历史任务报告查看设计

## 背景

客户端已经能在任务看板中恢复当前账号的历史任务，但历史任务卡片没有查看报告入口。右侧 Markdown 预览只会显示本次新建任务执行完成后返回的报告内容，重启后点击历史任务无法加载服务端已保存报告。

服务端已经提供 `GET /api/v1/review-tasks/{task_id}/report` 接口读取 Markdown 报告内容，也提供 `/download` 下载接口。本次优先补齐客户端查看链路，不修改后端。

## 目标

1. 成功的历史任务可以点击“查看报告”。
2. 点击后从服务端读取该任务 Markdown 报告，并显示到右侧预览区域。
3. 加载中、加载失败和无报告状态有明确反馈。
4. 当前选中的任务卡片有选中态，避免用户不知道右侧报告来自哪一个任务。

## 非目标

1. 不新增服务端接口。
2. 不实现本地离线缓存。
3. 不重做报告下载文件保存流程。

## 方案

`ApiClient` 增加 `readTaskReport(token, taskId)`，使用文本响应读取 `/api/v1/review-tasks/{taskId}/report`。主进程新增 `task:report` IPC handler，读取当前 token 后调用该 API。preload 和渲染层类型增加 `readTaskReport(taskId)`。

`TaskBoard` 增加 `selectedTaskId` 和 `onViewReport` props。状态为 `success` 的任务显示“查看报告”按钮；当前选中的任务卡片增加 `is-selected` class。`TaskPage` 维护 `selectedTaskId`、`isLoadingReport` 与报告加载错误。点击“查看报告”时清空旧错误，显示加载状态，读取成功后更新右侧 Markdown。

下载按钮暂时保留当前行为：本地刚生成的报告仍可下载；历史报告查看先保证右侧预览可用。后续如果需要把历史报告下载到本地，可以再接 `/download` 为单独功能。

## 测试与验证

1. `ApiClient` 测试覆盖文本报告读取、鉴权头和 URL 编码。
2. IPC 测试覆盖已登录读取报告、未登录拒绝。
3. 运行 `npm test` 和 `npm run typecheck`。
4. 手动检查历史成功任务卡片有“查看报告”，点击后右侧显示 Markdown。
