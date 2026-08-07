# Issue #33 生产选择器视觉验收

## 验收入口

`npm run capture:workbench` 会额外打开 `production-harness.html`。该入口直接渲染真实 `ProductionReviewWorkbench`，间接使用正式 `REVIEW_ITEM_CATALOG`，仅在 preload 边界注入内存 API；不引用 fixture adapter，不访问服务端、数据库、SVN 或 Skill。

## 自动检查

- [x] 1440×900、1280×800、1024×768 皆渲染正式 DS-01、DS-02、DS-03 及三个正式分类
- [x] DS-02 显示正式详情和“无需材料”，不生成 DS-01 材料字段
- [x] 默认验收入口使用正式目录；独立压力模式仅替换 DS-03 显示名称，不改变生产入口
- [x] 超长审查项名称在目录行、详情标题和主表单摘要中不重叠、不水平溢出
- [x] 长用户名、长部门名不与顶部导航重叠，不超出视口
- [x] DS-01 两个长文件名与文件大小、移除按钮不重叠
- [x] DS-01、DS-02 分别使用内容不同的 1190 字符额外规则，切换往返后精确保持且在 textarea 内独立滚动
- [x] 目录与详情为不同的纵向滚动容器，长详情可滚动
- [x] 选择器和页面均无水平溢出，弹窗始终位于视口内
- [x] 打开后搜索框自动获得焦点且焦点样式可见
- [x] Shift+Tab 不离开弹窗，Escape 关闭后焦点返回“选择”按钮
- [x] 浏览器控制台无错误

正式目录截图为 `screenshots/production-selector-<视口>.png`；长名称压力截图为 `screenshots/production-long-name-selector-<视口>.png` 和 `screenshots/production-long-name-summary-<视口>.png`。
