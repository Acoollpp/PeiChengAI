# WPS COM / PowerShell 使用说明

本目录用于配合 `company-ppt-from-doc` 和 `pptx-generator` 处理公司加密 PPT。

## 什么时候用

- PPTX 不能被 `python-pptx` 或普通 OpenXML 工具读取。
- 文件在 WPS 中可以打开，但程序直接读取失败。
- 需要读取 PPT 中每个对象的真实位置、大小、字体、字号、颜色、填充、线条。

## 基本原则

- 以当前 PPTX 为唯一真源。
- 不要用截图估算尺寸。
- 不要覆盖原文件，先复制成新版本再处理。
- WPS COM 读取出来的对象参数优先于截图、历史生成记录和 agent-slides 输出。
- 避免并行调用 WPS COM。若出现 `RPC_E_CALL_REJECTED`，先等待或复用已打开的 WPS 实例。

## 脚本

- `export-wps-ppt-inventory.ps1`
  - 读取 PPT 对象清单。
  - 输出 `wps_shape_inventory.csv`、`wps_text_inventory.csv`、`wps_table_inventory.csv`、`wps_deck_summary.json`。

- `export-wps-ppt-previews.ps1`
  - 通过 WPS 导出每页 PNG 预览。
  - 用于最终视觉检查，不用于估算对象尺寸。

## 示例

```powershell
.\export-wps-ppt-inventory.ps1 `
  -PptPath "C:\Users\admin\Desktop\模板.pptx" `
  -OutputDir "C:\temp\ppt-inventory"

.\export-wps-ppt-previews.ps1 `
  -PptPath "C:\Users\admin\Desktop\输出.pptx" `
  -OutputDir "C:\temp\ppt-previews"
```

## 迁移到其他电脑

把 `skills` 目录下的 skill 复制到目标电脑的：

```text
C:\Users\<用户名>\.codex\skills\
```

如果目标电脑的 Codex 使用其他技能目录，请按实际目录放置。

`pptx-generator` 文件显示乱码时，不一定是损坏，可能是公司加密导致。只要目标电脑具备对应解密环境，按原样迁移即可。
