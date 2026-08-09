# 代码审查报告

**项目路径：** svn://127.0.0.1:3691/trunk
**所属部门：** 户用
**旧版本：** r1
**新版本：** r2
**审查日期：** 2026-08-09

**审查范围：**

| 审查项 ID | 审查项名称 | SVN 证据模式 |
|-----------|------------|---------------|
| DS-01 | 变更点审查 | dual_revision |
| DS-03 | 状态机审核 | new_revision_full |

---

## 一、提交历史

| 版本号 | 提交者 | 日期 | 说明 |
|--------|--------|------|------|
| r1 | chenghao | 2026-08-09 11:40:46 +0800 | 建立 Issue 44 本地验收基线 |
| r2 | chenghao | 2026-08-09 11:41:09 +0800 | 增加休眠状态并调整故障复位逻辑 |

---

## 二、变更文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `bms_state.c` | M | 状态机处理逻辑变更 |
| `bms_state.h` | M | 状态与事件枚举变更 |

状态说明：

- `A`：新增文件
- `M`：修改文件
- `D`：删除文件
- `R`：重命名文件

---

## 三、审查问题

### PC-BMS-001 [高] FAULT 分支将 RESET 判断写成赋值表达式，非 RESET 事件会隐式清除故障态

**所属审查项：** DS-01 · 变更点审查；DS-03 · 状态机审核
**规则章节：** DS-01 / 核对要求 / 参数与配置一致性；DS-03 / 用户额外规则：故障复位与超时状态转换

**涉及文件及行号：**

| 文件 | 行号 | 位置说明 |
|------|------|----------|
| `bms_state.c` | 36 | `BMS_STATE_FAULT` 分支入口 |
| `bms_state.c` | 37 | 将复位判断写为 `event = BMS_EVENT_RESET` |
| `bms_state.c` | 38 | 条件成立后将 `current_state` 设置为 `BMS_STATE_IDLE` |
| `bms_state.h` | 18 | `BMS_EVENT_TIMEOUT` 为有效事件，故障态收到该事件也会被赋值表达式误复位 |

**问题描述：** 产品开发需求表 `软件需求!第5行 SW-02` 要求故障态只能在收到 `BMS_EVENT_RESET` 时回到空闲态，`NONE`、`START`、`STOP` 和 `OVERVOLTAGE` 均不得清除故障态。产品规格书第 5.1 节“故障复位事件”和第 5.2 节“故障复位保护”要求仅 `RESET` 允许从 `FAULT` 返回 `IDLE`，且必须使用比较运算，禁止赋值表达式隐式复位。新版 `BmsState_Handle` 在 `BMS_STATE_FAULT` 分支使用 `if (event = BMS_EVENT_RESET)`，会把传入事件赋值为 `BMS_EVENT_RESET`，该枚举值非 0 时条件恒为真，随后执行 `current_state = BMS_STATE_IDLE`。diff 证据显示 r1 中该处为 `event == BMS_EVENT_RESET`，r2 改为赋值表达式。
**影响风险：** 当前状态为 `BMS_STATE_FAULT` 时，任意事件进入 `BmsState_Handle` 都可能解除故障态并回到 `IDLE`，包括 `BMS_EVENT_NONE`、`START`、`STOP`、`OVERVOLTAGE` 和 `TIMEOUT`，导致故障复位保护失效。
**整改建议：** 将条件恢复为 `event == BMS_EVENT_RESET`，并补充故障态下 `NONE`、`START`、`STOP`、`OVERVOLTAGE`、`TIMEOUT` 不清除故障，以及 `RESET` 清除故障的测试。

---

### PC-BMS-002 [高] 充电超时保护只新增事件枚举，CHARGING 状态未在 1800 秒或 TIMEOUT 事件进入 FAULT

**所属审查项：** DS-01 · 变更点审查；DS-03 · 状态机审核
**规则章节：** DS-01 / 核对要求 / 需求实现完整性；DS-03 / 用户额外规则：超时状态转换

**涉及文件及行号：**

| 文件 | 行号 | 位置说明 |
|------|------|----------|
| `bms_state.h` | 18 | 新版接口声明 `BMS_EVENT_TIMEOUT` |
| `bms_state.h` | 23 | `BmsState_Handle` 入参只有事件和包电压，没有充电累计时间 |
| `bms_state.c` | 23 | `BMS_STATE_CHARGING` 分支入口 |
| `bms_state.c` | 24 | 充电态仅在 `BMS_EVENT_OVERVOLTAGE` 时进入 `BMS_STATE_FAULT` |
| `bms_state.c` | 26 | 充电态仅额外处理 `BMS_EVENT_STOP` 回到 `BMS_STATE_IDLE` |

**问题描述：** 产品开发需求表 `软件需求!第6行 SW-03` 要求充电状态累计 30 分钟后进入故障态，1799 秒保持充电，1800 秒进入故障。产品规格书第 5.1 节“充电超时”和第 5.2 节“充电超时保护”要求 `CHARGING` 达到 1800 s 转入 `FAULT`，超时事件为 `BMS_EVENT_TIMEOUT`。r2 只在 `bms_state.h` 中新增了 `BMS_EVENT_TIMEOUT` 枚举，`BMS_STATE_CHARGING` 分支仍只处理 `OVERVOLTAGE` 和 `STOP`，没有处理 `TIMEOUT`，接口也没有充电累计时间参数，无法区分 1799 s 与 1800 s 边界。变更文件仅包含 `bms_state.c` 和 `bms_state.h`，未见其他文件实现充电累计时间或超时处理。
**影响风险：** 当充电累计达到 1800 秒，或上层按内部 C 接口传入 `BMS_EVENT_TIMEOUT` 时，状态机不会进入 `BMS_STATE_FAULT`，充电超时安全边界失效。
**整改建议：** 在 `BMS_STATE_CHARGING` 分支明确处理 `BMS_EVENT_TIMEOUT` 并转入 `BMS_STATE_FAULT`，或扩展状态机接口/调用链引入充电累计时间并按 1800 s 阈值判断；补充 1799 秒保持 `CHARGING`、1800 秒进入 `FAULT` 的边界测试。

---

## 四、审查覆盖

| 审查项 | 枚举目标 | 检索命令 | 命中总数 | 待判定条目 | 已判定 | 未覆盖 | 判定结果 |
|--------|----------|----------|----------|------------|--------|--------|----------|
| DS-03 | 限流 MOS 开启输出写入点 | `rg -n "PBSC|PBC|BSRR|BRR|ODR|WritePin|SetBits|ResetBits|GPIO|MOS|FET|CHG|DSG|charge|discharge" <新版源码根> -g '*.[ch]'` | 0 | 0 | 0 | 0 | 清单内无待判定开启点 |
| DS-03 | 主充电 MOS 开启输出写入点 | `rg -n "PBSC|PBC|BSRR|BRR|ODR|WritePin|SetBits|ResetBits|GPIO|MOS|FET|CHG|DSG|charge|discharge" <新版源码根> -g '*.[ch]'` | 0 | 0 | 0 | 0 | 清单内无待判定开启点 |
| DS-03 | 主放电 MOS 开启输出写入点 | `rg -n "PBSC|PBC|BSRR|BRR|ODR|WritePin|SetBits|ResetBits|GPIO|MOS|FET|CHG|DSG|charge|discharge" <新版源码根> -g '*.[ch]'` | 0 | 0 | 0 | 0 | 清单内无待判定开启点 |

本节之外未列出的位置不在本次覆盖范围内。否定性结论仅在上表已判定范围内成立；本次无未覆盖条目。

---
