# checkList5

- 状态: 已添加
- 对应项: 5
- 意图: 修复 `rs485_Voltronic.c` 中温度单位及满充/剩余容量拆分上送的问题
- 精确目标文件: `Inverter485Protocol/rs485_Voltronic.c`

## 精确索引

- 文件: `Inverter485Protocol/rs485_Voltronic.c`
- 位置特征:
  - `User485_Reg_Buffer[36] = PackData[0].TempNum - 2;`
  - `User485_Reg_Buffer[37 + i] = PackData[0].Temp[i];`
  - `User485_Reg_Buffer[51]`
  - `User485_Reg_Buffer[52]`
  - `User485_Reg_Buffer[117]`
  - `User485_Reg_Buffer[118]`

## 用户提供的修改方案

按截图中的“修改后”版本执行，只在 `Inverter485Protocol/rs485_Voltronic.c` 对应位置做以下调整：

### 1. 温度单位

在温度上送循环中，使用：

```c
User485_Reg_Buffer[37 + i] = PackData[0].Temp[i];
```

### 2. 满充容量

将寄存器 51、52 按以下方式拆分：

```c
User485_Reg_Buffer[51] = (uint16_t)(((uint32_t)InverterData.FccAll*10)>>16 & 0xFFFF);
User485_Reg_Buffer[52] = (uint16_t)(InverterData.FccAll*10 & 0xFFFF);
```

### 3. 剩余容量

将寄存器 117、118 按以下方式拆分：

```c
User485_Reg_Buffer[117] = (uint16_t)(((InverterData.RmAll*10)>>16) & 0xFFFF);
User485_Reg_Buffer[118] = (uint16_t)(InverterData.RmAll*10 & 0xFFFF);
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 只修改截图中明确标出的上述位置，不额外调整 `rs485_Voltronic.c` 里的其他寄存器映射逻辑。
- 如果现场又发现其他问题，只能指出并提示用户，不能直接继续修改。
- 如果现场代码与截图中的目标位置或表达式不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 不能只搜索 `FccAll` 或 `RmAll` 判断是否完成。
- 必须同时核对：
  - 温度上送位置是 `User485_Reg_Buffer[37 + i]`
  - 满充容量拆分位置是 `User485_Reg_Buffer[51]`、`User485_Reg_Buffer[52]`
  - 剩余容量拆分位置是 `User485_Reg_Buffer[117]`、`User485_Reg_Buffer[118]`

## 备注

- 本项方案来源于用户提供截图。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
