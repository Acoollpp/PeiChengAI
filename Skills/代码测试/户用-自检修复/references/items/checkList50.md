# checkList50

- 状态: 已添加
- 对应项: 50
- 意图: 修复 `SRD_Status_Update(void)` 中保护位与告警位映射来源写反的问题，并按用户给出的“修改后”版本精确调整 `Status` / `Warning` 对应关系
- 精确目标文件: `InverterCANProtocol/can_SuoRuiDe.c`

## 规则目标

按用户提供的“修改前 / 修改后”代码与差异截图执行，最终行为应满足：

1. `Alarms_Byte0~2` 必须由 `InverterData.Status1/Status2` 驱动，不再使用 `InverterData.Warning1/Warning2`。
2. `Warnings_Byte4~6` 必须由 `InverterData.Warning1/Warning2` 驱动，不再使用 `InverterData.Status1/Status2`。
3. `Alarms_Byte2` 需要补齐短路位映射：`(InverterData.Status1 & BIT6)` 对应 `Alarms_Byte2 |= BIT4`。
4. `Warnings_Byte6` 末尾只保留充电过流映射：`(InverterData.Warning1 & BIT4)` 对应 `Warnings_Byte6 |= BIT0`，不再保留短路位 `BIT4` 的 warning 映射。

## 精确索引

- 文件: `InverterCANProtocol/can_SuoRuiDe.c`
- 函数: `static void SRD_Status_Update(void)`
- 位置特征:
  - 函数开头已有：
    - `Alarms_Byte0 = 0;`
    - `Alarms_Byte1 = 0;`
    - `Alarms_Byte2 = 0;`
    - `Warnings_Byte4 = 0;`
    - `Warnings_Byte5 = 0;`
    - `Warnings_Byte6 = 0;`
  - 中间存在一组给 `Alarms_Byte0~2` 赋位的三元表达式
  - 后面存在一组给 `Warnings_Byte4~6` 赋位的三元表达式

## 用户提供的修改方案

后续若执行此项修复，只按下面这组精确替换规则处理 `SRD_Status_Update(void)`：

### 1. 保护位区域统一改用 `Status1 / Status2`

以下原先写入 `Alarms_Byte0~2` 的来源，如果还在使用 `Warning1 / Warning2`，都要改成对应的 `Status1 / Status2`：

- `Alarms_Byte0 BIT2`：`(InverterData.Status1 & (BIT0 | BIT2))`
- `Alarms_Byte0 BIT4`：`(InverterData.Status1 & (BIT1 | BIT3))`
- `Alarms_Byte0 BIT6`：`(InverterData.Status2 & BIT1)`
- `Alarms_Byte1 BIT0`：`(InverterData.Status2 & BIT3)`
- `Alarms_Byte1 BIT2`：`(InverterData.Status2 & BIT0)`
- `Alarms_Byte1 BIT4`：`(InverterData.Status2 & BIT2)`
- `Alarms_Byte1 BIT6`：`(InverterData.Status1 & BIT5)`
- `Alarms_Byte2 BIT0`：`(InverterData.Status1 & BIT4)`

### 2. 给 `Alarms_Byte2` 补上短路保护位

在 `Alarms_Byte2 BIT0` 之后，按用户“修改后”版本新增：

```c
(InverterData.Status1 & (BIT6)) ?   (Alarms_Byte2 |= BIT4) : (Alarms_Byte2 &= ~BIT4);  //short circuit
```

该语句属于保护位区域，位置应紧跟在 `charge hige current` 那条 `Alarms_Byte2 |= BIT0` 映射之后。

### 3. 告警位区域统一改用 `Warning1 / Warning2`

以下原先写入 `Warnings_Byte4~6` 的来源，如果还在使用 `Status1 / Status2`，都要改成对应的 `Warning1 / Warning2`：

- `Warnings_Byte4 BIT2`：`(InverterData.Warning1 & (BIT0 | BIT2))`
- `Warnings_Byte4 BIT4`：`(InverterData.Warning1 & (BIT1 | BIT3))`
- `Warnings_Byte4 BIT6`：`(InverterData.Warning2 & BIT1)`
- `Warnings_Byte5 BIT0`：`(InverterData.Warning2 & BIT3)`
- `Warnings_Byte5 BIT2`：`(InverterData.Warning2 & BIT0)`
- `Warnings_Byte5 BIT4`：`(InverterData.Warning2 & BIT2)`
- `Warnings_Byte5 BIT6`：`(InverterData.Warning1 & BIT5)`
- `Warnings_Byte6 BIT0`：`(InverterData.Warning1 & BIT4)`

### 4. 删除 `Warnings_Byte6` 的短路告警位映射

用户给出的“修改后”版本中，`Warnings_Byte6` 只保留：

```c
(InverterData.Warning1 & (BIT4)) ?          (Warnings_Byte6 |= BIT0) : (Warnings_Byte6 &= ~BIT0);  //charge high current
```

因此如果现场代码仍存在：

```c
(InverterData.Status1 & (BIT6)) ?   (Warnings_Byte6 |= BIT4) : (Warnings_Byte6 &= ~BIT4);  //short circuit
```

则应删除这条 warning 短路映射，不要把它保留在 `Warnings_Byte6` 中。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导 `Status` 和 `Warning` 的归属。
- 只能修改 `static void SRD_Status_Update(void)` 这一处函数逻辑，不扩展到同文件其他函数。
- 不能仅做批量字符串替换，必须区分“保护位区域”和“告警位区域”的上下文后再改。
- `Alarms_Byte2 BIT4` 的短路位必须新增在 alarm 区域；不能只是把 warning 区域中的短路位保留不动。
- 如果现场代码注释大小写、拼写存在差异，例如 `charge hige current` / `charge high current`，以功能位映射为准，不要求为了对齐截图去额外改注释。

## 验证要求

- 检查 `SRD_Status_Update(void)` 时，必须同时确认：
  - `Alarms_Byte0~2` 的来源全部是 `Status1/Status2`
  - `Warnings_Byte4~6` 的来源全部是 `Warning1/Warning2`
  - `Alarms_Byte2` 中已存在 `(InverterData.Status1 & BIT6)` 到 `BIT4` 的短路保护位映射
  - `Warnings_Byte6` 中不再存在短路位 `BIT4` 的映射
- 不能只靠搜索 `BIT6` 判断完成，必须结合变量名 `Alarms_Byte2` / `Warnings_Byte6` 和来源字段 `Status1` / `Warning1` 一起核对。
- 如果只是把前半段 alarm 来源改对，但 warning 区域仍然使用 `Status1/Status2`，不能算完成。

## 备注

- 本项方案来源于用户提供的“修改前 / 修改后”代码和差异截图。
- 用户要求是补充 skill 的单项修复方案；后续真正执行代码修复时，应以本文件为唯一实现依据。
- 若后续用户补充更完整版本，以最新用户方案覆盖本文件。
