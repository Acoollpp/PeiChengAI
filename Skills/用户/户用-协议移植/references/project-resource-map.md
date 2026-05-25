# 项目资源入口

本 skill 只面向当前工程的真实移植结构。

## 1. CAN 正式目录

### `InverterCANProtocol/`

这是 CAN 协议正式接入目录。

新 CAN 协议默认检查这些位置：
- `InverterCANProtocol/Can_Xxx.c`
- `InverterCANProtocol/CAN_Comm.h`
- `InverterCANProtocol/can_Comm.c`

其中：
- `CAN_Comm.h` 负责公共结构、全局资源和协议接口声明
- `can_Comm.c` 负责 `protocol_call[]` 协议表和切换入口

## 2. 485 正式目录

### `Inverter485Protocol/`

这是 485 协议正式接入目录。

新 485 协议默认检查这些位置：
- `Inverter485Protocol/Rs485_Xxx.c`
- `Inverter485Protocol/Uart_User485.h`
- `Inverter485Protocol/Uart_User485.c`

其中：
- `Uart_User485.h` 负责统一框架变量和协议接口声明
- `Uart_User485.c` 负责 `uart_protocol_call[]` 协议表、波特率和协议切换

## 2.5 `modbus_protocol/` 独立 485/Modbus 分支

### `modbus_protocol/`

这是当前工程中一条独立的 485/Modbus 协议实现分支。

这条分支的协议文件通常会直接包含：
- `modbus_protocol/Rs485_Xxx.c`
- `modbus_protocol/Rs485_Xxx.h`
- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_ctrl.h`

其中：
- `modbus_common.h/.c` 提供 `Modbus_protocol_info_s`、`Modbus_comm_ctrl_s`、`MODBUS_frame_receive()`、`MODBUS_frame_handle()` 等公共层
- `modbus_ctrl.h/.c` 提供 `g_485Modbus_ctrl` 这类公共控制对象
- 具体协议 `.c` 只负责寄存器区定义、回调函数、协议私有 `Modbus_protocol_info_s` 实例，以及 `Init / ReceiveIQR / DataRespond`

补充说明：
- 这条分支虽然协议本体放在 `modbus_protocol/`，但仍会通过 `Inverter485Protocol/Uart_User485.h/.c` 的声明和 `uart_protocol_call[]` 接入外部 485 协议切换
- 因此它不是完全脱离 `Inverter485Protocol/`，而是“协议本体在 `modbus_protocol/`，调度入口仍复用统一 485 切换”
- 若新协议要求新增当前工程中不存在的公共 Modbus 控制结构、通用收发入口或新的公共调度器，不应继续机械移植，必须先反馈结构缺口

## 3. 协议枚举与默认配置

### `User/Bms_Config.h`

这里同时定义：
- `en_CAN_Protocol_t`
- `en_485_Protocol_t`
- `PROROCOL_CAN_DEFAULT`
- `PROROCOL_485_DEFAULT`

规则：
- 新增协议时优先追加枚举，不改已有值顺序
- `TOTAL_CAN` 与 `TOTAL_485` 要保持尾项意义正确

补充说明：
- 当前工程的真实枚举名和值，统一收录在 `references/protocol-enum-index.md`
- 真正落地修改前，仍要回查最新的 `User/Bms_Config.h`
- 若用户给的新协议在当前工程里没有对应正式 `.c` 文件，也找不到可参考的同族已挂接实现，就必须提醒用户提供目标枚举值

## 4. 当前运行协议与配置源

### `User/Data_Init.h`
### `User/Data_Init.c`
### `User/Bms_config.c`

这些文件负责：
- `Inverter_CanProtocol`
- `Inverter_485Protocol`
- `userCfg.can`
- `userCfg.pro_485`

如果协议新增后切换异常，要回查这里的真实取值路径。

## 5. 外部协议切换与显示影响面

这些文件常引用当前协议号：
- `User/UartRS485.c`
- `User/UartRS232.c`
- `User/Lcd_Comm.c`
- `User/4G/UartGPRS.c`
- `User/hlk/src/hlk_link_data.c`

通常新增协议不一定要改这些文件，但如果用户要求：
- 上位机可切换
- 串口命令可读写
- 4G 上报协议号
- 屏幕显示协议号

就必须检查这些影响面。

## 6. 数据源与共用状态

优先回查：
- `User/Inverter_Data.h`
- `User/Status_Create.h`
- `User/Data_Init.h`

用途：
- 核对字段是否已有真实来源
- 判断是否需要补协议私有状态结构
- 判断是否已有全局控制位、寄存器、索引或心跳变量
