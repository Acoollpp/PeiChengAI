# Rs485 Modbus 单协议模板说明

## 用途

本文件用于指导技能把一个新的标准 Modbus 485 协议，快速落成项目内可用的单协议 `.c` 骨架。

默认配合：
- `assets/templates/Rs485_Template.c`
- `modbus_protocol/modbus_common.h`
- `modbus_protocol/modbus_common.c`
- `modbus_protocol/modbus_ctrl.h`

## 何时使用这个模板

满足以下大多数特征时，优先使用：
- 协议主体是标准 Modbus 寄存器读写
- 可以明确拆成一个或多个只读寄存器区
- 写寄存器逻辑有限，或者可以集中在 `set_reg()` 中分发
- 收帧、CRC、越界判断不需要自定义重写

如果协议存在大量 ASCII 转码、CID、私有校验、文本帧，不要硬用这个模板。

## 生成顺序

1. 先根据协议文档列出寄存器区间。
2. 再定义 `ONLY_READ_REG_REGION_X_*` 和 `READ_WRITE_REG_REGION_X_*` 宏。
3. 计算 `ALL_REG_NUM`。
4. 按区间拆分 `updata_onlyRead_region_x()` 与 `updata_readWrite_region_x()`。
5. 如果协议支持写寄存器，再补 `set_reg()` 分发。
6. 配置 `Modbus_protocol_info_s`。
7. 保持 `Init / ReceiveIQR / DataRespond` 入口与公共框架一致。

## 占位项替换清单

从 `assets/templates/Rs485_Template.c` 生成时，至少替换这些占位项：
- `{PROTOCOL_DOC_NAME}`：原始协议文档名
- `{PROTOCOL_FILE_NAME}`：目标源文件名
- `{PROTOCOL_EN}`：英文名
- `{PROTOCOL_CN}`：中文名
- `{ENUM_VAL}`：协议枚举值
- `{DATE}`：日期
- `{AUTHOR}`：作者
- `{PROTOCOL_NAME}`：函数名主干
- `{DEV_ADDR_START}`：协议设备地址起始值
- `{ONLY_READ_REGION_NUM}`：只读区个数
- `{READ_WRITE_REGION_NUM}`：读写区个数

## 寄存器区设计规则

- `OFFSET` 宏只用于本地数组偏移，不直接代表协议地址。
- `START/END` 宏必须对应协议真实寄存器地址。
- `NUM` 固定使用 `END - START + 1`。
- `ALL_REG_NUM` 必须覆盖所有定义区间。
- 没有读写区时，`readWrite_reg_region = {NULL}`，`readWrite_region_num = 0`。

## 数据映射规则

- 优先映射 `InverterData`、`PackData` 里已存在的真实字段。
- 必须把单位换算写在代码里，不要把“工程单位”和“协议单位”混在注释里不实现。
- 没有真实字段时，用 `TODO[未实现]` 明确标出来。
- 预留寄存器可以写 `0`，但不要无声跳过重要寄存器。

## set_reg 规则

- 只有协议真的支持写寄存器时才实现。
- `switch (frame_info->reg_start_addr)` 内只保留有证据的寄存器入口。
- 如果写入后动作依赖上层流程，直接标 `TODO[未实现]`，不要猜测补全。

## 初始化与收发规则

以下结构默认不改：
- `Init()` 内调用 `InverterUart_Init(baudrate)`
- `g_485Modbus_ctrl.protocol = &g_modbus_xxx`
- `MODBUS_comm_init(&g_485Modbus_ctrl)`
- `ReceiveIQR()` 内调用 `MODBUS_frame_receive()`
- `DataRespond()` 内调用 `MODBUS_frame_handle()`

只有在真实工程已有不同公共入口时，才允许偏离。

## 生成后自检

至少检查：
- 寄存器区是否完整覆盖协议文档要求
- `ALL_REG_NUM` 是否足够
- 区间数量与 `Modbus_protocol_info_s` 配置是否一致
- 所有占位项是否已替换
- 真实数据源是否已回查
