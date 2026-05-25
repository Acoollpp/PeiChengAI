# checkList3

- 状态: 已添加
- 对应项: 3
- 意图: 修复 `can_SMA.c` 中 SMA 容量上送公式的字节拆分写法
- 精确目标文件: `InverterCANProtocol/can_SMA.c`

## 精确索引

- 文件: `InverterCANProtocol/can_SMA.c`
- 函数: `static void SMA_SendCycleMsg(void)`
- 位置特征:
  - `case 5:`
  - `Can_msg_Tx.StdId = 0x35F;`
  - `Can_msg_Tx.Data[4]`
  - `Can_msg_Tx.Data[5]`

## 用户提供的修改方案

按截图中的“修改后”版本执行，在 `static void SMA_SendCycleMsg(void)` 的 `case 5` 中，将以下两行:

```c
Can_msg_Tx.Data[4] = DesignCapacity/100;
Can_msg_Tx.Data[5] = DesignCapacity/100>>8;
```

替换为:

```c
Can_msg_Tx.Data[4] = (uint8_t)((DesignCapacity/100) & 0x00FF);
Can_msg_Tx.Data[5] = (uint8_t)(((DesignCapacity/100) >> 8) & 0x00FF);
```

## 关键约束

- 仅修改 `case 5` 中容量拆分对应的这两行，不额外改动 `case 5` 里的其他字段。
- 必须保留低字节写入 `Data[4]`、高字节写入 `Data[5]` 的顺序。
- 必须在 `SMA_SendCycleMsg()` 中修改，不要把相同表达式在其他文件中的命中误判为本项。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文档方案直接修改，不再重新推导。
- 如果现场代码与截图上下文不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 不能只搜索 `DesignCapacity/100` 关键字判断是否完成。
- 必须同时核对:
  - 命中函数是 `SMA_SendCycleMsg()`
  - 命中分支是 `case 5`
  - `Data[4]` 使用 `(uint8_t)((DesignCapacity/100) & 0x00FF)`
  - `Data[5]` 使用 `(uint8_t)(((DesignCapacity/100) >> 8) & 0x00FF)`

## 备注

- 本项方案来源于用户提供截图。
- 如果后续用户补充更完整方案，以最新的用户方案覆盖本文件。
