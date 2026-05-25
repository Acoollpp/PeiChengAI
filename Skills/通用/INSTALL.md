# 公司PPT生成 Skill 迁移包

## 包含内容

```text
skills/
  company-ppt-from-doc/
    SKILL.md
    assets/default-template.pptx
  pptx-generator/
wps-com-powershell/
  README.md
  export-wps-ppt-inventory.ps1
  export-wps-ppt-previews.ps1
```

## 安装方式

把 `skills` 目录下的两个文件夹复制到目标电脑：

```text
C:\Users\<用户名>\.codex\skills\
```

目标结构应包含：

```text
C:\Users\<用户名>\.codex\skills\company-ppt-from-doc\SKILL.md
C:\Users\<用户名>\.codex\skills\company-ppt-from-doc\assets\default-template.pptx
C:\Users\<用户名>\.codex\skills\pptx-generator\SKILL.md
```

## 默认模板规则

- 如果用户没有说明使用哪个模板，也没有发送其他 PPT 模板，`company-ppt-from-doc` 默认使用 `assets/default-template.pptx`。
- 如果用户提供了当前 PPTX、现有版本或新模板，以用户提供的文件为准，覆盖默认模板。
- 默认模板第一页的蓝色标题框必须保留，并作为封面标题/主题的可编辑区域使用；不要删掉蓝框，也不要生成只有背景没有标题框的封面。
- 默认模板文件本身不能直接修改，必须先复制成新的输出 PPTX 再编辑。

## 使用说明

- `company-ppt-from-doc`：公司 PPT 制作流程、模板真源规则、WPS COM 规则、全局 QA 规则。
- `pptx-generator`：PPT 生成底层能力和参考资料。若文件显示乱码，可能是公司加密导致，迁移时保持原样。
- `wps-com-powershell`：用于读取公司加密 PPT 对象参数和导出预览图的 PowerShell 脚本。

## 注意事项

- 目标电脑需要安装 WPS，并能正常打开公司加密 PPT。
- 如果 PPTX 无法被普通脚本读取，以 WPS COM 读取结果为准。
- 不要直接覆盖原 PPT，先复制成新版本再修改。
- 生成后必须导出预览并做全局 QA，尤其检查底部安全区、金额换行、重复文本、边框贴边。
