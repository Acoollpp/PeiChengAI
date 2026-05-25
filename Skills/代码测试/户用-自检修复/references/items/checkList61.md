# checkList61

- 状态: 已添加
- 对应项: 61
- 意图: 修复 `User_Alarm_Rtc` 缺少告警关闭接口、声明及休眠复位调用点的问题
- 精确目标文件:
  - `User/User_Alarm_Rtc.c`
  - `User/User_Alarm_Rtc.h`
  - `User/System_Ctrl.c`

## 精确索引

- 源文件1: `User/User_Alarm_Rtc.c`
- 源文件2: `User/User_Alarm_Rtc.h`
- 源文件3: `User/System_Ctrl.c`
- 函数: `void Alarm_DeInit(void)`
- 调用位置: `void Reset_SleepDet(void)`
- 第一处位置特征:
  - `Alarm_DeInit(void)` 必须写在 `User/User_Alarm_Rtc.c` 中
  - 必须紧跟在 `void Alarm_Set_Init(uint8_t hours_add,uint8_t minute_add,uint8_t second_add)` 的完整函数定义之后
  - 不允许插在 `Alarm_Set_Init()` 前面，也不允许挪到其他辅助函数附近
- 第三处位置特征:
  - 位于 `Reset_SleepDet(void)` 函数尾部收尾段，不是前面的自动唤醒分支
  - 前置语句为 `SystemInit();`
  - 紧随其后已有 `RTC_EnableWakeUp(DISABLE);`
  - 再往后是一组连续的关中断语句，如 `DIS_RS232_INT;`、`DIS_CHG_INT;`、`DIS_SWITCH_INT;`、`DIS_SW_INT;`、`DIS_CHG_2_INT;`、`DIS_WAKE1_INT;`
  - 该段后续紧接 `BKP_WriteData(BKP_DAT1, 2);`
  - 识别时必须按“`SystemInit();` → `RTC_EnableWakeUp(DISABLE);` → `DIS_*_INT` 连续段 → `BKP_WriteData(BKP_DAT1, 2);`”的顺序逐级确认
  - 若命中区域后续没有 `BKP_WriteData(BKP_DAT1, 2);`，则该命中无效

## 用户提供的修改方案

按截图中的“修改后”版本执行，包含以下三处修改：

### 1. 在 `User/User_Alarm_Rtc.c` 中新增函数

新增：

```c
void Alarm_DeInit(void)
{
    RTC_EnableAlarm(RTC_B_ALARM, DISABLE);
    EXTI17_RTCAlarm_Configuration(DISABLE);
}
```

该函数在 `.c` 文件中的放置位置也固定要求如下：

```c
void Alarm_Set_Init(uint8_t hours_add,uint8_t minute_add,uint8_t second_add)
{
    ...
}

void Alarm_DeInit(void)
{
    RTC_EnableAlarm(RTC_B_ALARM, DISABLE);
    EXTI17_RTCAlarm_Configuration(DISABLE);
}
```

即：
- 先保留完整的 `Alarm_Set_Init()` 定义
- 再紧跟新增 `Alarm_DeInit()`
- 不要把 `Alarm_DeInit()` 提前插到 `Alarm_Set_Init()` 前面

### 2. 在 `User/User_Alarm_Rtc.h` 中新增函数声明

新增：

```c
void Alarm_DeInit(void);
```

### 3. 在 `User/System_Ctrl.c` 的 `Reset_SleepDet(void)` 中调用

在休眠检测复位流程里，按截图中的调用位置新增：

```c
Alarm_DeInit();
```

应放在以下语句之后：

```c
RTC_EnableWakeUp(DISABLE);
```

并放在各类中断关闭语句之前，例如：

```c
DIS_RS232_INT;
DIS_CHG_INT;
```

第三处只按下面这段上下文识别，不可只搜索单条 `RTC_EnableWakeUp(DISABLE);`：

```c
SystemInit();
RTC_EnableWakeUp(DISABLE);
Alarm_DeInit();
DIS_RS232_INT;
...
BKP_WriteData(BKP_DAT1, 2);
```

如果命中的是 `Reset_SleepDet()` 前半段自动唤醒处理分支中的 `RTC_EnableWakeUp(DISABLE);`，则不属于本项第三处改动点。

第三处建议按以下顺序定位：

1. 先定位 `Reset_SleepDet(void)` 函数尾部的 `BKP_WriteData(BKP_DAT1, 2);`
2. 再向前确认同一收尾段内存在一组连续的 `DIS_*_INT` 语句
3. 再向前确认其前一段存在 `RTC_EnableWakeUp(DISABLE);`
4. 再向前确认该段起点附近存在 `SystemInit();`
5. 只有以上锚点属于同一连续收尾段时，才在 `RTC_EnableWakeUp(DISABLE);` 与第一条 `DIS_*_INT` 之间处理 `Alarm_DeInit();`

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 仅按这里记录的 `.c` 实现、`.h` 声明和 `Reset_SleepDet()` 中的调用点执行，不额外改动 RTC 其他逻辑。
- `.c` 中的 `Alarm_DeInit()` 必须紧跟 `Alarm_Set_Init()` 完整函数之后，不能只要文件里有这个函数就算完成。
- `Alarm_DeInit()` 的调用应保持在 `RTC_EnableWakeUp(DISABLE);` 之后、各类 `DIS_*_INT` 语句之前。
- 第三处必须同时满足“位于 `SystemInit();` 之后”和“位于 `BKP_WriteData(BKP_DAT1, 2);` 之前”这两个上下文特征，不能因为函数内存在其他 `RTC_EnableWakeUp(DISABLE);` 就误判。
- 第三处的识别优先级应以尾部 `BKP_WriteData(BKP_DAT1, 2);` 收尾段为起点反向确认，不能以全局搜索 `RTC_EnableWakeUp(DISABLE);` 作为第一入口。
- 如果现场代码文件名、函数位置、调用顺序或头文件结构与截图上下文不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 检查第一处时，除了确认 `Alarm_DeInit()` 函数体内容正确，还必须确认它位于 `Alarm_Set_Init()` 完整定义之后。
- 如果 `Alarm_DeInit()` 出现在 `Alarm_Set_Init()` 前面，或出现在 `.c` 文件其他位置，不能判定第一处已完成。
- 检查第三处时，必须优先定位 `Reset_SleepDet(void)` 尾部这段收尾路径：
  - `SystemInit();`
  - `RTC_EnableWakeUp(DISABLE);`
  - 若已修复则应存在 `Alarm_DeInit();`
  - 随后是连续的 `DIS_*_INT` 语句
  - 之后应出现 `BKP_WriteData(BKP_DAT1, 2);`
- 若 `RTC_EnableWakeUp(DISABLE);` 后面直接进入其他业务逻辑，而不是上述尾部关中断收尾段，则不属于第三处。
- 如果只在前面自动唤醒分支里找到 `RTC_EnableWakeUp(DISABLE);`，不能判定第三处已完成。
- 只有 `.c` 实现、`.h` 声明、以及上述尾部调用点三处都命中，才能判定自检 61 已完成。

## 备注

- 本项方案来源于用户提供截图。
- 若当前工程中不存在 `User_Alarm_Rtc.c/.h` 或 `Reset_SleepDet()`，先报告“文件缺失/调用点缺失”，不要擅自迁移到其他模块。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
