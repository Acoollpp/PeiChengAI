# checkList53

- 状态: 已添加
- 对应项: 53
- 意图: 修复 `Reset_SleepDet()` 唤醒跳转顺序错误，并按用户截图补齐唤醒相关中断状态恢复与屏蔽处理
- 精确目标文件:
  - `User/System_Ctrl.c`
  - `User/n32g45x_it.c`
  - `User/Device_Init.c`

## 规则目标

按用户提供的“变更前/变更后”截图执行，最终行为应同时满足：

1. `Reset_SleepDet(void)` 中读取 `ReadRtcBackup9() == 1` 的唤醒分支，必须跳到 `continueflag`，不能继续跳到 `continueflag_0`。
2. `n32g45x_it.c` 的相关中断入口在使用 `Sleep_Active_Flag` 前，必须先从 `BKP_DAT1` 重新取值。
3. `Device_Init.c` 中 EXTI 线路初始化后，必须立即屏蔽对应 `IMASK` 位，避免初始化后直接放开唤醒线。
4. `System_Ctrl.c` 的唤醒后中断恢复逻辑中，除原有 `EN_RS232_INT;` 外，还要补上 `EN_UP_IN_INT;`。

## 精确索引

- 文件1: `User/System_Ctrl.c`
- 函数1: `void Reset_SleepDet(void)`
- 位置特征1:
  - 命中分支 `if(ReadRtcBackup9() == 1)`
  - 分支内部已有：
    - `WriteRtcBackup9(0);`
    - `WakeupContinueflag = 1;`
  - 该分支后面紧邻 `if(Sleep_Active_Flag == 0)` 和标签 `continueflag:` / `continueflag_0:`
- 位置特征2:
  - 命中条件 `if(!(Sleep_Active_Flag & BIT1) && !(Status5 & 0x3F))`
  - 该分支内部已有 `EN_RS232_INT;`

- 文件2: `User/n32g45x_it.c`
- 目标函数:
  - `void EXTI2_IRQHandler(void)`
  - `void RTC_WKUP_IRQHandler(void)`
  - `void RTCAlarm_IRQHandler(void)`
- 位置特征:
  - 三个函数开头都已有 `PeriphReset();`
  - `Sleep_Active_Flag` 的新赋值语句应放在 `PeriphReset();` 之后、原有 `if((Sleep_Active_Flag & BIT5))` 或 `while(DelayTime--)` 之前

- 文件3: `User/Device_Init.c`
- 目标位置:
  - `EXTI_LINE0`
  - `EXTI_LINE1`
  - `EXTI_LINE2`
  - `EXTI_LINE3`
- 位置特征:
  - 每段都先有 `EXTI_InitPeripheral(&EXTI_InitStructure);`
  - 新增屏蔽语句应紧跟在各自的 `EXTI_InitPeripheral(...)` 之后

## 用户提供的修改方案

按截图中的“变更后”版本执行，包含以下五处修改：

### 1. 修改 `User/System_Ctrl.c` 中 `Reset_SleepDet(void)` 的跳转目标

在以下分支中：

```c
if(ReadRtcBackup9() == 1)
{
    WriteRtcBackup9(0);
    WakeupContinueflag = 1;
    ...
}
```

用户确认后的正确改法是：

- 保留 `WriteRtcBackup9(0);`
- 保留 `WakeupContinueflag = 1;`
- 将这一分支中的：

```c
goto continueflag_0;
```

改为：

```c
goto continueflag;
```

该处只改这一条跳转目标，不改同函数其他 `goto continueflag_0;` / `goto continueflag;`。

### 2. 在 `User/System_Ctrl.c` 的唤醒后中断恢复分支补上 `EN_UP_IN_INT;`

在以下条件分支内部：

```c
if(!(Sleep_Active_Flag & BIT1) && !(Status5 & 0x3F))
{
    EN_RS232_INT;
}
```

按截图改为：

```c
if(!(Sleep_Active_Flag & BIT1) && !(Status5 & 0x3F))
{
    EN_RS232_INT;
    EN_UP_IN_INT;
}
```

只在该分支内补这一条使能语句，不扩展到其他中断开关位置。

### 3. 在 `User/n32g45x_it.c` 的三个中断函数里先恢复 `Sleep_Active_Flag`

以下三个函数都按同样方式处理：

- `void EXTI2_IRQHandler(void)`
- `void RTC_WKUP_IRQHandler(void)`
- `void RTCAlarm_IRQHandler(void)`

每个函数中，在：

```c
PeriphReset();
```

之后新增：

```c
Sleep_Active_Flag = (uint8_t)(BKP_ReadData(BKP_DAT1) >> 8);
```

该语句必须位于对应函数开头、并在后续使用 `Sleep_Active_Flag` 的判断之前，不能只补其中一个中断函数。

### 4. 在 `User/Device_Init.c` 中对 EXTI0~3 初始化后立即屏蔽

用户截图明确要求在以下四段初始化后，各补一条 `IMASK` 屏蔽：

- `EXTI_LINE0`
- `EXTI_LINE1`
- `EXTI_LINE2`
- `EXTI_LINE3`

每段都按如下模式处理：

```c
EXTI_InitPeripheral(&EXTI_InitStructure);
EXTI->IMASK &= ~(EXTI_LINEx);
```

其中 `x` 分别对应 `0`、`1`、`2`、`3`。

要求是“逐段紧跟新增”，不能集中挪到函数其他位置统一处理。

### 5. 现场核对 `Reset_SleepDet()` 的标签路径时，按标签语义判断，不要只搜字符串

本项第一处的核心不是简单把任意 `continueflag_0` 改成 `continueflag`，而是必须命中这一条特定路径：

1. 位于 `if(ResetFlag & 0x04)` 的处理大分支内
2. 位于 `if(ReadRtcBackup9() == 1)` 子分支内
3. 前面已有 `WriteRtcBackup9(0);`
4. 同分支内已有 `WakeupContinueflag = 1;`
5. 该子分支后面紧接 `if(Sleep_Active_Flag == 0)` 分支

只有同时满足这组上下文，才按本项方案改跳转目标。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 第一处必须精确命中 `ReadRtcBackup9() == 1` 这个唤醒恢复分支，不能全局替换 `goto continueflag_0;`。
- 第三处必须三个中断函数同时处理；只改一个或两个都不能算完成。
- 第四处必须覆盖 `EXTI_LINE0` 到 `EXTI_LINE3` 四段初始化；不能只处理开关功能相关的个别线路。
- 第二处只在截图指定的 `if(!(Sleep_Active_Flag & BIT1) && !(Status5 & 0x3F))` 分支内部补 `EN_UP_IN_INT;`，不要顺手调整其他 `EN_*_INT` 顺序。
- 如果现场文件名、函数名或上下文与截图不一致，先保留本方案并提示用户确认差异，不要按相似代码盲改。

## 验证要求

- 检查 `Reset_SleepDet(void)` 时，必须确认：
  - `if(ReadRtcBackup9() == 1)` 分支内已存在 `WakeupContinueflag = 1;`
  - 同一分支中的跳转目标已改为 `goto continueflag;`
  - 不是改到了其他 `goto` 语句
- 检查 `n32g45x_it.c` 时，必须确认三个函数：
  - `EXTI2_IRQHandler`
  - `RTC_WKUP_IRQHandler`
  - `RTCAlarm_IRQHandler`
  都在 `PeriphReset();` 后新增了 `Sleep_Active_Flag = (uint8_t)(BKP_ReadData(BKP_DAT1) >> 8);`
- 检查 `Device_Init.c` 时，必须确认 `EXTI_LINE0`、`EXTI_LINE1`、`EXTI_LINE2`、`EXTI_LINE3` 四段初始化后都各自紧跟了一条 `EXTI->IMASK &= ~(...)`。
- 检查 `System_Ctrl.c` 的中断恢复逻辑时，必须确认 `EN_UP_IN_INT;` 是补在 `EN_RS232_INT;` 后面的同一条件分支内部，而不是其他位置。
- 如果只满足 checklist 里的前四个文本条件，但遗漏了 `Device_Init.c` 的 `IMASK` 屏蔽或遗漏了 `EN_UP_IN_INT;`，按本文件方案仍不能算“完全按用户修复方案落地”。

## 备注

- 本项方案来源于用户提供的多张“变更前/变更后”截图。
- checklist 53 的原始检测条件主要覆盖 `Reset_SleepDet()` 与 `n32g45x_it.c` 的三处恢复语句；本文件额外保留了用户截图中同时确认的 `Device_Init.c` 与 `EN_UP_IN_INT;` 配套修改，后续执行时应一并处理。
- 若当前工程中不存在对应文件或函数，先报告“文件缺失/函数缺失”，不要擅自迁移到其他模块。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
