# Electron 本地 PDF 报告生成按钮设计

## 背景

审查报告当前由 Electron 客户端生成 Markdown 文件，并将报告图片保存到同一任务工作区的 `images/` 目录。客户端右侧预览区使用 Markdown 展示报告，本地完成的任务可以通过 `reportPath` 读取相对图片。

当报告需要上传到钉钉 TB 项目或在平台外流转时，单独上传 Markdown 会丢失本地图片引用。直接把图片改成平台内鉴权 URL 也不适合外部分发，因为其他审查人可能没有平台登录态或无法访问内部接口。PDF 更适合作为外部审查、归档和上传附件的格式。

本次设计先提供一个手动触发入口：在右侧“查看报告位置”旁边增加“生成PDF报告”按钮，对当前本地 Markdown 报告生成同目录 PDF 文件。

## 目标

1. 在 Electron 客户端右侧报告工具栏增加“生成PDF报告”按钮。
2. 用户可对当前选中的本地 Markdown 报告手动生成 PDF。
3. 生成的 PDF 与 Markdown 放在同一目录，文件名仅替换扩展名。
4. PDF 生成成功后打开系统文件管理器定位到 PDF。
5. 本次先不改变现有 Markdown 预览逻辑。
6. 本次先不修改服务端报告上传协议。

## 非目标

1. 不在任务完成时自动生成 PDF。
2. 不把 PDF 上传到服务端。
3. 不生成 Word 文档。
4. 不支持服务端历史报告在缺少本地图片时强行生成 PDF。
5. 不新增钉钉 TB 上传能力。
6. 不引入 Pandoc、LaTeX 或外部浏览器依赖。

## 方案选择

采用 Electron 主进程本地生成 PDF 的方案。

渲染进程只负责展示按钮、维护按钮状态和触发 IPC。主进程读取本地 Markdown 文件，将其渲染为可打印 HTML，再通过 Electron/Chromium 的 PDF 打印能力生成 PDF。生成成功后使用 `shell.showItemInFolder(pdfPath)` 定位文件。

没有选择服务端生成 PDF，因为服务端当前只保存 Markdown，不保存报告图片。若服务端直接生成 PDF，报告里的 `images/...` 相对路径无法稳定解析，会产生缺图 PDF。没有选择 base64 内嵌 Markdown，因为平台兼容性不可控，且会显著增大 Markdown 文件。

## UI 设计

右侧报告工具栏从单按钮改为操作组：

```text
Markdown          [生成PDF报告] [查看报告位置]
审查报告
```

按钮规则：

1. “生成PDF报告”只在存在 `currentReportPath` 时可点击。
2. 未选中已完成报告，或当前只是模板预览时，按钮禁用。
3. 生成过程中按钮文案变为“生成中...”，并禁用重复点击。
4. “查看报告位置”保持现有行为。
5. 成功后在左侧提示区展示 `PDF报告已生成：<pdfPath>`。
6. 失败后在错误提示区展示具体错误信息。

对于服务端历史报告，现有逻辑在点击“查看报告位置”时会把 Markdown 下载到本地工作区。第一版要求用户先点击“查看报告位置”拿到本地路径，再点击“生成PDF报告”。如果历史报告中的图片没有随 Markdown 一起存在于本地目录，PDF 生成会失败并提示图片缺失。

## IPC 设计

新增 IPC：

```ts
report:generate-pdf
```

渲染进程调用：

```ts
window.codeReview.generatePdfReport(reportPath)
```

返回：

```ts
{
  status: 'ready',
  reportPath: string,
  pdfPath: string
}
```

错误通过 IPC reject 返回给渲染进程，由页面展示错误文案。

## PDF 生成设计

新增主进程服务模块负责 PDF 生成，输入为本地 Markdown 文件路径：

```ts
generatePdfReport(reportPath: string): Promise<{ reportPath: string; pdfPath: string }>
```

处理步骤：

1. 校验 `reportPath` 存在、是文件、扩展名为 `.md`。
2. 读取 Markdown 内容。
3. 扫描 Markdown 中的相对图片引用。
4. 将相对图片路径解析到 Markdown 所在目录。
5. 校验图片路径未逃逸报告目录，且文件存在。
6. 将 Markdown 渲染成 HTML。
7. 将本地图片转为可打印 HTML 能访问的资源。
8. 创建隐藏 `BrowserWindow` 加载 HTML。
9. 等待页面和图片资源加载完成。
10. 调用 `webContents.printToPDF()` 生成 PDF Buffer。
11. 写入同目录同名 `.pdf` 文件。
12. 关闭隐藏窗口并返回 PDF 路径。

第一版 PDF 文件名规则：

```text
<Markdown 文件名去掉 .md>.pdf
```

示例：

```text
r123_r456审查报告_20260611_153000.md
r123_r456审查报告_20260611_153000.pdf
```

## Markdown 支持范围

第一版支持当前报告模板常用内容：

1. 标题
2. 段落
3. 有序列表和无序列表
4. GFM 表格
5. 行内代码和代码块
6. 本地相对图片
7. 普通 HTTP/HTTPS 链接

不保证任意 Markdown 扩展都能完整渲染。对于不支持或不稳定的内容，后续通过规范报告模板来收敛。

## 错误处理

以下情况直接失败，不静默生成残缺 PDF：

1. 未提供报告路径。
2. 报告文件不存在。
3. 报告文件为空。
4. 报告路径不是 Markdown 文件。
5. Markdown 引用的相对图片不存在。
6. 图片路径尝试逃逸报告目录。
7. Chromium 打印 PDF 失败。
8. PDF 写入失败。

错误文案以中文展示，例如：

```text
PDF生成失败：报告图片不存在：images/diagram.png
```

## 安全设计

PDF 生成窗口加载本地构造的 HTML，不启用 Node 能力。图片读取在主进程中完成路径校验，禁止绝对路径和 `../` 逃逸访问报告目录外文件。

链接只保留 `http`、`https` 和 `mailto`。不执行 Markdown 中的脚本，不信任任意内嵌 HTML。后续如需要支持更复杂 HTML，需要单独评估安全边界。

## 测试设计

### 主进程

新增 PDF 生成服务测试：

1. 给定本地 Markdown，生成同名 PDF 路径。
2. Markdown 引用存在的本地图片时允许生成。
3. Markdown 引用缺失图片时抛出中文错误。
4. Markdown 图片路径逃逸报告目录时抛错。
5. 非 `.md` 路径拒绝生成。

新增 IPC 测试：

1. `report:generate-pdf` 调用 PDF 服务并返回 `pdfPath`。
2. 生成成功后调用 `shell.showItemInFolder(pdfPath)`。

### 渲染进程

补充 `TaskPage` 测试：

1. 没有本地报告路径时，“生成PDF报告”按钮禁用。
2. 有本地报告路径时，点击按钮调用 `window.codeReview.generatePdfReport(reportPath)`。
3. 生成过程中按钮显示“生成中...”并禁用。
4. 生成成功后展示 PDF 路径提示。
5. 生成失败后展示错误信息。

## 验收标准

1. 右侧工具栏出现“生成PDF报告”按钮。
2. 模板预览或未选中报告时按钮不可点击。
3. 本地完成任务后可点击按钮生成 PDF。
4. PDF 与 Markdown 位于同一任务目录。
5. 生成成功后系统文件管理器定位到 PDF。
6. 缺失图片时页面提示失败，不生成误导性的缺图 PDF。
7. 现有 Markdown 预览和“查看报告位置”行为保持正常。
