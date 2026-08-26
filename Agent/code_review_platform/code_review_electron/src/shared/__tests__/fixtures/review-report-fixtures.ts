import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const bmsDs03ReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-ds03-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerPcBmsReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-pc-bms-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerHistoricalPcBmsReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-historical-pc-bms-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerHistoricalDs02ReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-historical-ds02-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerReportWithIssuesFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-report-with-issues.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerReportRealVariantsFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-report-real-variants.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerZeroIssuesFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-report-zero-issues.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerNoSeverityReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-no-severity-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerNoSeverityZeroReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-no-severity-zero-report.md', import.meta.url)),
  'utf8'
)

export const bmsCodeReviewerSearchEvidenceReportFixture = readFileSync(
  fileURLToPath(new URL('./bms-code-reviewer-search-evidence-report.md', import.meta.url)),
  'utf8'
)

export const templateOneReportFixture = `# 代码审查报告-模版一

## 五、代码质量问题

\`\`\`markdown
### 高风险：代码块中的标题不属于审查问题
- **问题描述：** 代码块内容不能被识别。
\`\`\`

### 1. 高风险：空指针解引用

- **涉及文件及行号：** \`src/main.c:42\`
- **问题描述：** 未校验返回值即解引用，错误分支会触发崩溃。
- **对应变更图：** ![空指针路径](images/null-pointer.png)

### 2. 中风险：重复问题标题

- **缺陷描述：** 第一个重复标题对应模块 A 的越界写入。

### 3. 中风险：重复问题标题

- **不合规现象描述：** 第二个重复标题对应模块 B 的越界写入。

---

## 七、结论

本报告包含三个问题。
`

export const templateTwoTableReportFixture = `# 代码审查报告模板二

## 二、流程节点详细审查报告

### 1. 部门自检项结果

| 检查方式 | 涉及文件及行号 | 风险级别 | 触发规则/缺陷描述 | 整改建议 / 闭环方案 | 对应变更图 |
|---|---|---|---|---|---|
| 广用 SVN 远程自检 | 工程级 | 中风险 | 配置项未填写导致软件版本与工程配置不一致。 | 补齐配置。 | 无 |
| 待填写 | 待填写 | 高风险/中风险/低风险/建议 | 填写检查结论。 | 待填写 | 无 |

### 2. 部门专项风险检查

| 涉及文件及行号 | 风险级别 | 专项检查方向 | 缺陷描述 (Root Cause) | 缺陷可能造成的风险 | 整改建议与闭环方案 | 对应变更图 |
|---|---|---|---|---|---|---|
| \`source/Bms_Config.h:18\` | 高风险 | SOH 容量映射 | SOH 字段映射缺失。 | 容量显示异常。 | 增加映射。 | ![映射](images/soh.png) |

## 三、结论

### 1. 高风险项总结

- 表格存在问题时不应使用此兜底项。
`

export const templateTwoConclusionReportFixture = `# 代码审查报告模板二

## 二、流程节点详细审查报告

### 1. 部门专项风险检查

| 涉及文件及行号 | 风险级别 | 专项检查方向 | 缺陷描述 (Root Cause) |
|---|---|---|---|
| 待填写 | 高风险/中风险/低风险/建议 | 填写检查方向 | 填写问题根因。 |

## 三、结论

### 1. 高风险项总结

- 未校验数组下标，可能发生越界访问。

### 2. 中低风险及建议项

- 建议补充协议字段的边界值测试。
`
