# 485 协议真实数据源索引

## 用途

本文件用于告诉技能“先去哪里找真实字段”，避免只盯着旧协议文件抄值。

## 业务数据主入口

- `User/Inverter_Data.h`
- `User/Inverter_Data.c`

优先查看内容：
- `InverterData`
- `PackData`
- 充电电压、放电电压
- 充电限流、放电限流
- SOC、SOH、剩余容量、额定容量
- 总压、电流、温度、循环次数

## 协议配置入口

- `User/Bms_Config.h`
- `User/Bms_config.c`

优先查看内容：
- 485 协议选择
- 协议编号、配置保存
- 是否已经有对应协议枚举

## 485 驱动与收发入口

- `Inverter485Protocol/Uart_User485.c`
- `Inverter485Protocol/Uart_User485.h`
- `User/UartRS485.c`
- `User/UartRS485.h`

优先查看内容：
- 全局缓冲区
- 发送入口
- 中断接收入口
- 协议调用表

## 公共 Modbus 框架入口

- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_common.c`
- `modbus_protocol/modbus_ctrl.h`
- `modbus_protocol/modbus_ctrl.c`

优先查看内容：
- `Modbus_frame_info_s`
- `Modbus_protocol_info_s`
- 公共收帧
- 公共发送
- 只读/读写寄存器分区

## 使用规则

- 旧协议文件里出现字段时，先回查它到底来自哪个真实结构体。
- 如果真实字段不存在，不要发明新字段，直接标 `TODO[未实现]`。
- 如果只是单位不一致，要在代码里显式做倍率换算，不要把“看起来像”的值直接塞进去。
