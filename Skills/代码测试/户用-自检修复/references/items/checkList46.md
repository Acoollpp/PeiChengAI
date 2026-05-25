# checkList46

- 状态: 已添加
- 对应项: 46
- 意图: 修复 `Reset_SleepDet(void)` 进入 STOP 休眠后无法正常唤醒的问题，按用户截图在休眠前切换系统时钟到 HSI
- 精确目标文件: `User/System_Ctrl.c`

## 规则目标

按用户提供的截图执行，最终行为应满足：

1. 在 `User/System_Ctrl.c` 中新增一个 `void SetSysClockToHSI(void)` 函数，用于把系统时钟切到 HSI
2. 在 `Reset_SleepDet(void)` 的 `while(Sleep_Active_Flag)` 休眠进入路径中，于 `PWR_EnterStopState(...)` 之前调用 `SetSysClockToHSI();`
3. 该新增调用的语义是“进入休眠前需要切换时钟源，避免关闭时钟后无法唤醒”
4. 退出休眠后需要执行 `SystemInit();`，用于重新初始化时钟并恢复 PLL 及原时钟配置

## 精确索引

- 文件: `User/System_Ctrl.c`
- 目标函数1: `void SetSysClockToHSI(void)`
- 位置特征1:
  - 新函数位于系统时钟初始化相关代码区域之后
  - 从用户截图看，该函数放在一段 `else { /* If HSE fails to start-up ... */ }` 代码后、`Reset_SleepInit()` 之前

- 目标函数2: `void Reset_SleepDet(void)`
- 位置特征2:
  - 命中 `while(Sleep_Active_Flag)` 大循环
  - 循环内紧邻 `#ifdef DEBUG`
  - 原有代码中存在：
    - `PWR_EnterStopState(PWR_REGULATOR_LOWPOWER, PWR_STOPENTRY_WFI);`
    - 后面存在退出休眠后的 `SystemInit();` 恢复点

## 用户提供的修改方案

后续若执行此项修复，只按下面这组精确规则处理：

### 1. 在 `User/System_Ctrl.c` 中新增 `SetSysClockToHSI(void)`

按用户截图新增一个独立函数：

```c
void SetSysClockToHSI(void)
{
    RCC_DeInit();

    RCC_EnableHsi(ENABLE);

    /* Enable Prefetch Buffer */
    FLASH_PrefetchBufSet(FLASH_PrefetchBuf_EN);

    /* Flash 0 wait state */
    FLASH_SetLatency(FLASH_LATENCY_0);

    /* HCLK = SYSCLK */
    RCC_ConfigHclk(RCC_SYSCLK_DIV1);

    /* PCLK2 = HCLK */
    RCC_ConfigPclk2(RCC_HCLK_DIV1);

    /* PCLK1 = HCLK */
    RCC_ConfigPclk1(RCC_HCLK_DIV1);

    /* Select HSE as system clock source */
    RCC_ConfigSysclk(RCC_SYSCLK_SRC_HSI);

    /* Wait till PLL is used as system clock source */
    while (RCC_GetSysclkSrc() != 0x00)
    {
    }
}
```

后续执行时应按截图中的函数名、调用顺序和寄存器配置语句落地，不要自行改成别的辅助函数名。

### 2. 在 `Reset_SleepDet(void)` 的 STOP 进入前调用该函数

在 `while(Sleep_Active_Flag)` 这段休眠流程里，按截图把：

```c
PWR_EnterStopState(PWR_REGULATOR_LOWPOWER, PWR_STOPENTRY_WFI);
```

前面新增：

```c
SetSysClockToHSI();   //进入休眠前需要切换时钟源，避免关闭时钟后无法唤醒
```

也就是说，本项关键不是任意位置调用 `SetSysClockToHSI();`，而是必须放在进入 STOP 的这一步之前。

### 3. 退出休眠后需要补加或保留 `SystemInit();`

用户提供的第三张图明确说明“在退出休眠后：需重新初始化时钟（恢复PLL及原时钟配置），添加 `SystemInit();` 函数”，并标出了唤醒路径中的：

```c
SystemInit();
```

这说明后续执行本项时，应把它作为“STOP 返回后的时钟恢复动作”来处理：

- 如果现场代码已经在该唤醒恢复路径中有 `SystemInit();`，就保留它
- 如果现场代码在这条退出休眠路径中缺少 `SystemInit();`，则应按用户方案补加
- 其作用是恢复 PLL 和原时钟配置，不是普通的上下文注释点

因此，本项包含两部分配套修改：

- 休眠前调用 `SetSysClockToHSI();`
- 退出休眠后在指定恢复路径中执行 `SystemInit();`

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再自行推导其他唤醒修复措施。
- 只修改 `User/System_Ctrl.c`，不要顺手扩展到其他时钟、休眠或中断文件。
- `SetSysClockToHSI();` 的调用位置必须是 `PWR_EnterStopState(...)` 前；不能挪到 `while(Sleep_Active_Flag)` 外，也不能放到唤醒后。
- `SystemInit();` 在本项里是退出休眠后的有效恢复动作；如果现场缺少它，应按用户方案补到指定唤醒路径中。
- 如果现场代码与截图中的函数名或 STOP 进入点不一致，先提示用户确认差异，不要迁移到相似的低功耗入口盲改。

## 验证要求

- 检查 `User/System_Ctrl.c` 时，必须同时确认：
  - 已新增 `void SetSysClockToHSI(void)` 函数
  - `Reset_SleepDet(void)` 的 `while(Sleep_Active_Flag)` 流程里，`PWR_EnterStopState(...)` 前已有 `SetSysClockToHSI();`
  - 退出休眠后的指定恢复路径中存在 `SystemInit();`
- 不能只搜索 `SetSysClockToHSI` 判断完成，必须结合它与 `PWR_EnterStopState(...)` 的前后关系一起核对。
- 如果只是新增了函数定义但没有在 STOP 前调用，不能算完成。
- 如果只做了休眠前切时钟，但退出休眠后没有 `SystemInit();` 恢复时钟，同样不能算按方案落地。

## 备注

- 本项方案来源于用户提供的三张截图。
- 第一张图给出新增 `SetSysClockToHSI(void)` 的函数体及其大致放置区域。
- 第二张图给出 `SetSysClockToHSI();` 在 `PWR_EnterStopState(...)` 前的精确调用位置和中文语义说明。
- 第三张图说明 `SystemInit();` 在退出休眠后是有用且需要的，用于恢复 PLL 及原时钟配置。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
