# CAN 协议移植规则

## 1. CAN 不等于只加一个 `.c`

当前项目中，新增 CAN 协议最少要检查：
- `InverterCANProtocol/Can_Xxx.c`
- `User/Bms_Config.h`
- `InverterCANProtocol/CAN_Comm.h`
- `InverterCANProtocol/can_Comm.c`
- `EWARM/*.ewp`
- `EWARM/*.ewt`

少一项都可能出现“代码在，但工程不可用”。

## 2. 识别标准 CAN 骨架

普通 CAN 协议通常至少有：
- `Init`
- `MainCall`
- `ReceiveIRQ`

其中：
- 纯发送协议的 `ReceiveIRQ` 可以很轻
- 带交互协议的 `ReceiveIRQ` 可能是核心逻辑

## 3. `CAN_Comm.h` 不只是声明函数

低级模型最容易漏这一点。

某些 CAN 协议移植时，不仅要在 `CAN_Comm.h` 里补：
- `CanComXxx_Init()`
- `CanComXxx_MainCall()`
- `CanComXxx_ReceiveIRQ()`

还可能要补协议私有公共结构。

### 当前项目已存在的典型特殊项

#### Growatt 系列

`CAN_Comm.h` 已定义公共结构：
- `Can_Growatt_v109_s`

并导出多个协议实例：
- `Can_Growatt_v109`
- `Can_Growatt_C_v104`
- `Can_Growatt_A_v104`
- `Can_Growatt_v102`
- `Can_Growatt_A_v102`
- `Can_Growatt_B_v103`

说明：
- Growatt 类协议不是单纯 `.c` 内部自闭环
- 它依赖公共结构里的 `CommBreak`、`Heat_0x301`、`RecvIRQ`、`HeartValue`、`IsCommBreakFlag`
- 若用户给的新协议属于 Growatt 族或同模式协议，必须先判断是否也需要这类公共状态结构

#### Kstar V1.18

`CAN_Comm.h` 已定义：
- `KstarInvCtrl_UnionDef`
- `KstarInvData_DataDef`

并导出：
- `KstarInvData`
- `KstarInvCtrl`

说明：
- Kstar 类协议带逆变器控制位和附加交互数据
- 若新协议文件里依赖类似联合体控制位、逆变器反馈功率、电流、关机控制等，不要只改协议表

## 4. `can_Comm.c` 里的协议表是正式入口

必须挂入：
- `protocol_call[]`

表项至少包含：
- 协议枚举
- 英文名
- 中文名
- 波特率
- `init`
- `recv`
- `func`

注意：
- 某些历史协议在表里是注释状态
- “目录中有文件”不等于“当前工程启用”

## 5. CAN 特殊逻辑检查清单

遇到新 CAN 协议时，逐项确认是否存在：
- 专属心跳值
- 通讯中断标志
- 超时断联处理
- 请求响应回调
- Pack 级扩展帧
- 产品码/版本码分包发送
- 额外控制位联合体
- 逆变器到 BMS 的附加反馈变量

只要命中一项，就不要按“普通轮询发送协议”处理。

## 6. 典型误区

- 只在 `Bms_Config.h` 加了枚举，没进 `protocol_call[]`
- 只复制了 `.c`，没加 `CAN_Comm.h` 声明
- 看到新文件能编译，就以为协议可切换
- 忽略了 Growatt / Kstar 这类协议的公共状态结构
