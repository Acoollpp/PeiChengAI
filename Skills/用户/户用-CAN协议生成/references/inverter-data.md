# InverterData 字段参
> 来源：`Inverter_Data.h`  
> 生成代码时，所有数据源字段必须从此文件中查找，**不得使用未在此列出的字段*
---

## 结构体类
```c
extern INVERTER_DataTypeDef InverterData;
```

---

## 字段速查
### 电池包基本信息
| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `PackNum` | uint8_t | | 电池包总数 |
| `NormalPackNum` | uint8_t | | 正常工作的电池包数量 |
| `NotPmtDischargeNum` | uint8_t | | 不允许放电的电池包数量|
| `NotPmtChargeNum` | uint8_t | | 不允许充电的电池包数量|
| `FaultID` | uint8_t | | 故障ID标识 |

### 保护状态寄存器

| 字段名 | 类型 | 说明 |
|-------|------|------|
| `Status1` | uint8_t | 保护状态|
| `Status2` | uint8_t | 保护状态|
| `Status3` | uint8_t | 指示状态|
| `Status4` | uint8_t | 功能控制 |
| `Status5` | uint8_t | 故障状态|
| `Status6` | uint8_t | 功能控制 |
| `Status7` | uint8_t | 功能控制 |
| `Status8` | uint8_t | 故障状态|
| `Status10` | uint8_t | 其他保护状态|

> ⚠️ `Status9`，跳过直接到 `Status10`

### 警告状态寄存器

| 字段名 | 类型 | 说明 |
|-------|------|------|
| `Warning1` | uint8_t | 电压、电流警|
| `Warning2` | uint8_t | 温度、SOC警告 |

> ⚠️ 只有 `Warning1` `Warning2`*不存`Warning3`**

### SOC / SOH

| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `Soc` | uint8_t | % | 荷电状态|
| `Soh` | uint8_t | % | 健康状态|
| `SysMaxSoc` | uint8_t | % | 系统最大SOC |
| `SysMinSoc` | uint8_t | % | 系统最小SOC |
| `SocAvg` | uint16_t | | 系统平均SOC |

### 电流电压

| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `Current` | int32_t | 10mA | 系统总电|
| `Current2` | int32_t | 10mA | 独立电流 |
| `Vsum` | uint16_t | 1mV | 系统总电|
| `VsumMax` | uint16_t | 1mV | 系统最大电|
| `VsumAvg` | uint16_t | mV | 系统平均总电|
| `Vpack` | uint16_t | 1mV | 独立总压 |

### 容量信息

| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `DesignCap` | uint16_t | 10mAh | 设计容量 |
| `Fcc` | uint16_t | 10mAh | 满充容量 |
| `Rm` | uint16_t | 10mAh | 剩余容量 |
| `FccAll` | uint32_t | 10mAh | 系统总满充容量|
| `RmAll` | uint32_t | 10mAh | 系统总剩余容量|
| `Cycle` | uint16_t | | 充放电循环次|

### 充放电控
| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `ForceCHG_Cmd` | uint16_t | | 强制充放电控制命|
| `ChargeV` | uint16_t | 0.1V | 充电电压设定|
| `ChargeI` | uint16_t | 0.1A | 充电电流设定|
| `DisChargeI` | uint16_t | 0.1A | 放电电流设定|
| `DisChargeV` | uint16_t | 0.1V | 放电电压设定|

### 单体电池

| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `Gmax` | uint16_t | 1mV | 单体最大电|
| `Gmin` | uint16_t | 1mV | 单体最小电|
| `GmaxAddr` | uint8_t | | 最高电压单体地址 |
| `GminAddr` | uint8_t | | 最低电压单体地址 |
| `DeltaV` | uint16_t | 1mV | 压差 |

### 温度

| 字段名 | 类型 | 单位 | 说明 |
|-------|------|------|------|
| `BatteryTemp` | uint16_t | 0.1K | 电池平均温度 |
| `Tmax` | uint16_t | 0.1K | 最高温度|
| `Tmin` | uint16_t | 0.1K | 最低温度|
| `TmaxAddr` | uint8_t | | 最高温度传感器地址 |
| `TminAddr` | uint8_t | | 最低温度传感器地址 |
| `MosT` | uint32_t | 0.1K | MOS平均温度 |
| `EnvT` | uint32_t | 0.1K | 环境平均温度 |
| `MosTmax` | uint16_t | 0.1K | MOS管最高温度|
| `MosTmin` | uint16_t | 0.1K | MOS管最低温度|
| `EnvTmax` | uint16_t | 0.1K | 环境最高温度|
| `EnvTmin` | uint16_t | 0.1K | 环境最低温度|

### 报警 / 错误

| 字段名 | 类型 | 说明 |
|-------|------|------|
| `Alarms` | uint32_t | 报警状态寄存器2位） |
| `Warn` | uint32_t | 警告状态寄存器2位） |
| `Error` | uint16_t | 错误代码 |
| `SlaveOffLineError` | uint8_t | 从机离线错误 |

---

## 使用规则

1. 生成代码时，数据源字*只能从上表中选取**，不得使用表中不存在的字段名
2. 协议文档需要某个数据但上表中找不到对应字段时，留空并标注：
   ```c
   /* TODO[未实现]: xxx
    * 原因: InverterData 中无对应字段，待确认数据源    */
   ```
3. 注意单位换算，各字段内部单位与协议发送单位可能不同：
   - `Current`：内10mA，发送前按协议要求换   - `BatteryTemp`：内0.1K，转 0.1°C 直接 `-2730`（单位相同，仅做零点偏移   - `VsumAvg`：内mV，发送0.01V，换`/10`（如 500mV 50 表示 0.50V

