# 485 协议项目样例索引

## 用途

本文件用于快速挑选“主参考”“次参考”“反例”。
最终写代码时，必须回到真实源码逐行确认。

## 标准 Modbus 骨架型

主参考候选：
- `modbus_protocol/Rs485_Efore_V110.c`
特点：寄存器分区清晰，展示了 `Modbus_protocol_info_s` 的配置方式。

- `modbus_protocol/Rs485_Enetek_V200.c`
特点：公共 Modbus 骨架接法较完整，适合看更新回调和写寄存器回调。

- `modbus_protocol/Rs485_Kstar_V150.c`
特点：寄存器量较多，适合参考复杂寄存器映射。

公共框架必读：
- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_common.c`
- `modbus_protocol/modbus_ctrl.h`

## 私有 RTU / 寄存器直写型

主参考候选：
- `Inverter485Protocol/Rs485_Afore_210112.c`
特点：典型 `Register_Data_Init / Register_Data_Updata / ReceiveIQR / DataRespond` 结构。

- `Inverter485Protocol/Rs485_Deye_V130.c`
特点：寄存器区更新、状态位拼装、版本区处理比较集中。

- `Inverter485Protocol/Rs485_A08_V100.c`
特点：寄存器地址区间判断和偏移换算清楚。

次参考候选：
- `Inverter485Protocol/Rs485_Darfon_V150.c`
- `Inverter485Protocol/Rs485_Corun_V100.c`

## ASCII / 厂商私有命令帧型

主参考候选：
- `Inverter485Protocol/Rs485_Luxpowertek_180521.c`
特点：命令字多、ASCII 转换多、适合参考非 Modbus 帧组织。

- `Inverter485Protocol/Rs485_Epever_V100.c`
特点：字符串、版本号、ASCII 编码数据处理较多。

次参考候选：
- `Inverter485Protocol/Rs485_Epever_V120.c`
- `Inverter485Protocol/Rs485_Epever_V130.c`
- `Inverter485Protocol/Rs485_Epever_V131.c`

## 特殊校验 / 特殊状态机

参考：
- `Inverter485Protocol/Rs485_Eaton_V100.c`
特点：存在协议专用 CRC 逻辑，提醒不要默认套公共 CRC。

- `Inverter485Protocol/Rs485_ZTT_V100.c`
特点：帧状态机复杂，适合当“不要轻易套模板”的反例。

## 协议列表与挂接入口

必须回查：
- `Inverter485Protocol/Uart_User485.c`
- `Inverter485Protocol/Uart_User485.h`

用途：
- 看协议枚举和调用表
- 看命名风格和初始化入口
- 判断后续如果正式接入，需要补哪些声明和列表项

## 反例使用规则

以下情况不要整份照抄：
- 文件过长，混入大量客户定制逻辑
- 帧格式明显和当前协议不同
- 校验方式、长度编码、字符串编码完全不同

如果只能借鉴局部逻辑，输出里要明确说明“仅局部参考了哪一段能力”。
