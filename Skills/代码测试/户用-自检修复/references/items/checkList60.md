# checkList60

- 状态: 已添加
- 对应项: 60
- 意图: 修复 `can_Victron.c` 中温度地址字段使用错误的问题
- 精确目标文件: `InverterCANProtocol/can_Victron.c`

## 精确索引

- 文件: `InverterCANProtocol/can_Victron.c`
- 函数: `static void Victron_SendCycleMsg(void)`
- 位置特征:
  - `case 10`
  - `case 11`

## 用户提供的修改方案

按截图中的“修改后”版本执行，在 `static void Victron_SendCycleMsg(void)` 内做以下替换：

### case 10

1. 将：
   `tmp = (InverterData.TminAddr-1) / Pack_Temps_Num + 1;`
   改为：
   `tmp = InverterData.TminPackAddr;`

2. 将：
   `tmp = (InverterData.TminAddr-1) % Pack_Temps_Num + 1;`
   改为：
   `tmp = InverterData.TminBatteryAddr;`

### case 11

3. 将：
   `tmp = (InverterData.TmaxAddr-1) / Pack_Temps_Num + 1;`
   改为：
   `tmp = InverterData.TmaxPackAddr;`

4. 将：
   `tmp = (InverterData.TmaxAddr-1) % Pack_Temps_Num + 1;`
   改为：
   `tmp = InverterData.TmaxBatteryAddr;`

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 仅按这里记录的四处替换执行，不额外改动 `Victron_SendCycleMsg` 其他逻辑。
- 如果现场代码与截图上下文不一致，先保留本方案并提示用户确认差异。

## 备注

- 本项方案来源于用户提供截图。
- 当前工程精确命中源码文件为 `InverterCANProtocol/can_Victron.c`。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
