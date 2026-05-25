# 当前项目 CAN 架构

本参考只记录当前动力工程已经确认的真实结构。

## 1. 真实入口

- 主循环调用 `Can_MainCall()`
- CAN 中断调用 `Can_ReceiveIQR()`

对应文件：
- `SST24-50638-V120/User/Main.c`
- `SST24-50638-V120/User/Bms_Interrupt_Process.c`

## 2. 当前 CAN 的核心角色

当前项目 CAN 不是多协议切换框架，而是单 CAN 通道的管理层。

核心文件：
- `SST24-50638-V120/User/Can_Manage.h`
- `SST24-50638-V120/User/Can_Manage.c`

这里已提供：
- CAN 接收队列
- `Can_DataSend()`
- `Can_DataRespond()`
- `Can_EM_DataSend()`
- `Can_EM_Protocol_ReceiveIQR()`
- `Can_MainCall()`

## 3. 与 EM 协议的关系

CAN 数据最终会映射到 EM 协议缓冲区。

核心文件：
- `SST24-50638-V120/User/Protocol/EM_Uart_Protocol.h`
- `SST24-50638-V120/User/Protocol/EM_Uart_Protocol.c`

已确认的关键点：
- `EM_INDEX_CAN` 已存在
- `EM_Uart_Buf[EM_INDEX_CAN]` 使用 `Can_ParseBuffer` / `Can_TxBuffer`
- 协议编码读取处当前对 CAN 信息返回的是占位值 `0`

## 4. 对代码生成的直接影响

如果用户要求“根据协议文档生成当前项目的 CAN 代码”，默认优先级是：
1. 改现有 `Can_Manage.c/.h`
2. 改现有 `EM_Uart_Protocol.c/.h`
3. 只有在证据充分时才新增独立 `.c/.h`

禁止默认走：
- `Bms_Config.h` 新增 CAN 协议枚举
- `protocol_call[]` 协议表
- 多个逆变器协议文件并列挂接

因为这些结构在当前项目中尚未看到正式实现证据。
