# `modbus_protocol/` 移植规则

## 1. 这不是普通 `User485_*` 协议文件复制

当前工程中的 `modbus_protocol/` 分支虽然最终仍走 485 协议切换，但协议本体依赖一层独立公共 Modbus 控制层。

最少要检查：
- `modbus_protocol/Rs485_Xxx.c`
- `modbus_protocol/Rs485_Xxx.h`
- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_common.c`
- `modbus_protocol/modbus_ctrl.h`
- `modbus_protocol/modbus_ctrl.c`
- `Inverter485Protocol/Uart_User485.h`
- `Inverter485Protocol/Uart_User485.c`
- `User/Bms_Config.h`
- `EWARM/*.ewp`
- `EWARM/*.ewt`

## 2. 先做结构检测，再决定能不能移植

只有当新协议 `.c` 明确命中以下结构时，才优先判定为 `modbus_protocol/` 分支：
- 包含 `modbus_common.h`
- 包含 `modbus_ctrl.h`
- 存在 `Modbus_protocol_info_s` 协议实例
- `Init()` 中把 `g_485Modbus_ctrl.protocol` 指向该实例
- `ReceiveIQR()` 中调用 `MODBUS_frame_receive()`
- `DataRespond()` 中调用 `MODBUS_frame_handle()`
- 存在寄存器区定义、寄存器更新回调、寄存器设置回调

如果只命中一半，先不要急着判成 `modbus_protocol/`，继续核对它是不是尚未整理完成的半成品。

## 3. 哪些结构缺失时必须停止移植

若发现新协议依赖以下内容，而当前工程里不存在，就不要继续移植：
- 新的公共协议控制结构
- 新的全局 Modbus 管理器
- 新的公共收发入口函数
- 新的公共驱动回调框架
- 新的跨协议共享状态对象

这类问题说明它不是“补一个协议文件”能完成的，而是要先扩公共层设计。

处理要求：
- 立即停止移植
- 列出缺失项
- 指出缺失项分别出现在用户新文件的哪些证据位置
- 说明当前工程是否已有相同概念的实现

## 4. `modbus_protocol/` 分支的最小移植项

- 新协议 `.c/.h` 进入 `modbus_protocol/`
- `User/Bms_Config.h` 补 485 枚举，且只允许尾插
- `Inverter485Protocol/Uart_User485.h` 补 `Init / ReceiveIQR / DataRespond` 声明
- `Inverter485Protocol/Uart_User485.c` 补 `uart_protocol_call[]` 表项
- `EWARM/*.ewp`、`EWARM/*.ewt` 补源文件

必要时还要检查：
- `modbus_common.c` 是否已有针对该协议枚举的特殊分支判断
- 若有类似 `Rs485_Efore_V110` 的专属从机索引处理，是否需要补到现有公共层，而不是塞回协议局部变量

## 5. 模板优先级

优先参考：
- 同样放在 `modbus_protocol/` 下、已经编进工程且已挂到 `uart_protocol_call[]` 的协议
- 函数骨架最接近的新协议
- 寄存器区数量、回调模式最接近的新协议

当前工程里的典型参考：
- `Rs485_Enetek_V200`
- `Rs485_Kstar_V150`
- `Rs485_Efore_V110`

## 6. 特殊逻辑识别

出现以下情况时，必须额外检查公共层，而不是只改协议私有文件：
- 专属从机索引
- 地址区重映射
- 读取寄存器前的协议特判
- 写寄存器后的专属控制逻辑
- 需要在 `modbus_common.c` 中按枚举分支处理的行为

例如：
- 若新协议也像 Efore 一样需要从寄存器地址推导 pack / slave 索引，就要先判断是否应扩现有公共层
- 若当前公共层没有可复用的挂接点，就应停止移植并反馈

## 7. 禁止事项

- 不要把 `modbus_protocol/` 新协议强行翻译成普通 `User485_Reg_Buffer` 风格后再接入
- 不要在没有结构证据时创建新的公共 Modbus 框架
- 不要只补 `Uart_User485.c` 表项，不补 `modbus_protocol/` 本体
- 不要只复制 `.c/.h` 文件，不核对 `g_485Modbus_ctrl`、回调函数和寄存器区
- 不要在结构检测失败后继续补工程文件

## 8. 输出要求

完成分析或改动后，必须明确写出：
- 是否判定为 `modbus_protocol/` 分支
- 判定依据是什么
- 还需要补哪些正式挂接点
- 是否命中了公共层特殊逻辑
- 如果没法移植，缺的是哪些结构，为什么必须先停
