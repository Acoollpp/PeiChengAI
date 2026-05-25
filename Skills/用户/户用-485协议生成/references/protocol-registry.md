# 485 协议实现路线索引

## 用途

本文件用于先判断新协议应该走哪条实现路线，再决定参考哪些真实文件。

不要把本文件当成协议真值表。
真正落代码前，仍然要回查原始协议文档和项目源码。

## 路线 A：历史单协议直写型

适用特征：
- 自己维护 `User485_RxBuffer`、`User485_TxBuffer`、`User485_Reg_Buffer`
- 自己写收帧状态机、CRC、长度判断、地址判断
- 主要落点在 `Inverter485Protocol/`
- 函数入口通常是 `Rs485_Xxx_Init / Rs485_Xxx_ReceiveIQR / Rs485_Xxx_DataRespond`

优先参考：
- `Inverter485Protocol/Uart_User485.c`
- `Inverter485Protocol/Uart_User485.h`
- `references/project-examples.md`

典型场景：
- 厂商私有 RTU 帧
- 非标准寄存器访问
- ASCII 编码帧
- 历史项目兼容型协议

## 路线 B：公共 Modbus 骨架型

适用特征：
- 主要是标准 Modbus 读写寄存器
- 功能码清晰，寄存器区可分段定义
- 可以复用公共帧解析、越界检查、CRC 和发送流程
- 主要落点在 `modbus_protocol/`

优先参考：
- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_common.c`
- `modbus_protocol/modbus_ctrl.h`
- `references/project-examples.md`

典型场景：
- 标准 `03/04/06/10` 读写
- 大段寄存器区映射
- 明显适合用 `Modbus_protocol_info_s` 描述的协议

## 路线 C：ASCII / 私有命令帧型

适用特征：
- 帧内容存在 ASCII 转码、CID、校验和文本拼装
- 不适合直接复用标准 Modbus 寄存器骨架
- 仍然大多落在 `Inverter485Protocol/`

优先关注：
- 是否已有相似 ASCII 协议
- 是否存在厂商专用校验或长度编码
- 是否发送阶段要做十六进制字符转换

## 路线 D：混合型

适用特征：
- 主体像 Modbus，但混入私有控制命令或特殊区段
- 一部分适合公共骨架，一部分需要协议内单独处理

处理原则：
- 先决定主体路线
- 再把例外命令单独列出来
- 不要为了追求统一而把整个协议硬塞进错误骨架

## 快速判断顺序

1. 先看原始协议文档是不是标准寄存器读写。
2. 再看是否能用 `Modbus_protocol_info_s` 自然描述。
3. 如果不能，再去 `Inverter485Protocol/` 找同类直写协议。
4. 如果帧里出现 ASCII、CID、版本串、制造商字符串拼装，优先怀疑是私有命令帧型。
