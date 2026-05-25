# checkList44

- 状态: 已添加
- 对应项: 44
- 意图: 修复修改上拉电阻阻值后，弱电开关引脚异常波形误唤醒 BMS，导致弱电开关休眠失败的问题
- 精确目标文件: `User/Device_Init.c`

## 规则目标

按用户提供的截图和当前 checklist 规则执行，最终行为应满足：

1. 在 `User/Device_Init.c` 的 `GPIO_Config(void)` 中，把弱电开关引脚对应配置改成输入模式
2. 最终需要命中 `GPIOE->PL_CFG = 0x33333444;`
3. 本项目标是避免异常波形临时唤醒 BMS，不是去修改休眠流程或其他弱电控制逻辑
4. 当前 checklist 44 的唯一判定点就是 `GPIO_Config` 中这条寄存器配置语句

## 精确索引

- 文件: `User/Device_Init.c`
- 目标函数: `void GPIO_Config(void)`
- 位置特征:
  - 位于 `//PORT E GROUP` 配置段
  - 紧邻 `GPIOE->POD    = 0x1000;`
  - 后面紧邻 `GPIOE->PH_CFG = 0x34311114;`

## 用户提供的修改方案

后续若执行此项修复，只按下面这组精确规则处理：

### 1. 将弱电开关引脚初始化配置改为输入模式

按用户截图，在 `User/Device_Init.c` 的 `GPIO_Config(void)` 中，将：

```c
GPIOE->PL_CFG = 0x33333344;
```

修改为：

```c
GPIOE->PL_CFG = 0x33333444;
```

### 2. 修改范围只限这一条寄存器配置

本项的用户方案没有要求改动：

- `GPIOE->POD`
- `GPIOE->PH_CFG`
- 其他端口组的 `Px_CFG`
- 休眠、唤醒、中断或弱电控制函数

因此后续执行本项时，只处理 `GPIOE->PL_CFG` 这一行，不顺手扩展到别的逻辑。

### 3. 方案语义

用户给出的说明是：

- 将弱电开关引脚初始化配置改为输入模式
- 避免出现异常波形临时唤醒 BMS

因此本项是 GPIO 初始模式修正，不是时序问题修正，也不是软件去抖或唤醒条件修改。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改
- 只修改 `User/Device_Init.c`
- 只改 `GPIO_Config(void)` 中 `GPIOE->PL_CFG` 的这一个常量值
- 如果现场代码已经是 `GPIOE->PL_CFG = 0x33333444;`，则视为本项已按方案落地，不再重复改动
- 如果现场代码函数名、文件名或寄存器落点与当前方案不一致，先提示用户确认差异，不要迁移到相似配置点盲改

## 验证要求

- 检查 `User/Device_Init.c` 时，必须同时确认：
  - 存在 `void GPIO_Config(void)` 函数
  - `//PORT E GROUP` 段内存在 `GPIOE->PL_CFG = 0x33333444;`
- 不能只根据“注释提到弱电开关”判断完成，必须看到这条精确配置语句
- 如果仍是 `0x33333344`，则不能算完成

## 本次审查结论

- 当前工程 `User/Device_Init.c` 中，`GPIO_Config(void)` 已存在 `GPIOE->PL_CFG = 0x33333444;`
- 因此从当前代码看，这部分修改已经按用户方案落地，满足 `checkList44` 的规则要求

## 备注

- 本项方案来源于用户提供的截图
- 当前 `checkList_item_cfg.yml` 中，`checkList44` 的规则只检查 `Device_Init.c` 的 `GPIO_Config` 中是否存在 `GPIOE->PL_CFG = 0x33333444;`
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件
