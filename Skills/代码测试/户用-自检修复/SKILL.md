---
name: 户用-自检修复
description: 当 Codex 需要定位固件自检失败项、按官方 exe 兼容逻辑解释失败原因，并根据用户为单个检查项提供的修复方案去实施修改时，使用此技能。适用于嵌入式 C 固件自检清单项目，且每个检查项的修复方案单独存放在 markdown 文件中。
---

# 户用-自检修复

当需要逐项处理固件自检失败时，使用此技能。

本技能以“单项 markdown 文件”为中心。每个检查项都应在 `references/items/` 下拥有独立文件。用户如果为某个失败项提供了修复方案，只更新该项对应文件，并在后续同项修复时把它作为唯一实现依据。

## 工作流程

1. 先确认项目根目录、checklist 路径，以及失败项 id 或报告文件。
2. 运行 `scripts/find-failed-rule.ps1`，把失败项 id 规范化并映射回 checklist 规则。
3. 对每个目标规则运行 `scripts/collect-rule-evidence.ps1`，收集 exe 兼容证据。
4. 打开 `references/items/<check-id>.md`。
5. 根据单项文件状态处理：
   - 如果写的是 `状态：暂未添加`，就明确告知用户：该项修复方案还没有沉淀。
   - 如果其中已经包含用户确认过的修复方案，就严格按该方案执行。
   - 只按单项文件中已经确认的修复方案修改代码；如果现场又发现其他问题，只能单独指出并提示用户，不能顺手继续修改。
   - 如果执行单项方案时发现还需要改动方案里没有明确写出的声明、定义、调用点、类型或其他配套代码，必须先征求用户意见，不能自行补改。
6. `scripts/suggest-fix.ps1` 只能作为报告结构辅助或兜底参考；如果单项文件里已经有用户确认方案，不能让它覆盖该方案。

## 单项文件规则

每个 checklist 检查项都应该在 `references/items/` 下有独立 markdown 文件。

- 文件命名规则：直接使用 checklist id，例如 `references/items/checkList57.md`。
- 先读取 `references/check-item-catalog.md` 中的索引。
- 再读取对应的单项文件本身。
- 如果单项文件还不存在，就创建它，并写入 `状态：暂未添加`。
- 当用户提供新的修复方案时，只填写对应这一项的文件。

## 判定规则

- 诊断时，把官方自检 exe 的行为视为最高优先级真值来源。
- 使用 YAML 作为规则目录和适用性过滤来源。
- 一旦用户已经为某项提供修复方案，则对应的单项 markdown 文件就是最高优先级实现依据。
- 如果单项文件仍是 `状态：暂未添加`，就不要猜测修复方案。
- 即使现场发现了其他可疑问题，也不能超出单项文件已确认的修复范围直接改代码。
- 即使为了让代码编译或看起来更完整，只要改动不在用户确认的方案文本内，也必须先征求用户意见。
- 证据要尽量收窄，能精确到文件、函数、行号时就精确到那里。

## 何时读取参考资料

- 读取 `references/check-item-catalog.md`，定位对应单项文件。
- 读取 `references/items/` 下对应文件，确认实际修复状态和修复方案。
- 当 YAML 判断结果与官方 exe 结果不一致时，读取 `references/exe-compat-notes.md`。
- 只有在单项文件尚未填写、又需要输出兜底报告时，才读取 `references/fix-patterns.md`。

## 脚本说明

- `scripts/parse-checklist.ps1`
  - 解析 checklist 的 YAML 风格文件，输出规范化规则对象。
- `scripts/find-failed-rule.ps1`
  - 从报告或参数列表中提取失败 id，并映射回 checklist 规则。
- `scripts/collect-rule-evidence.ps1`
  - 推断作用范围、收集证据、按 exe 兼容逻辑解释规则，并输出单项最终判断结果。
- `scripts/suggest-fix.ps1`
  - 当没有单项专属修复方案时，提供兜底分类和报告结构。

## 如何扩展此技能

当出现新的 checklist 检查项时：

1. 先在 `references/check-item-catalog.md` 中补充该项索引。
2. 创建 `references/items/<check-id>.md`。
3. 如果还没有修复方案，就写入 `状态：暂未添加`。
4. 当用户给出修复方案后，只更新该项对应文件。
5. 只有当新项暴露出可复用的 exe 兼容规则或通用修复模式时，才更新共享参考资料。




