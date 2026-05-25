---
name: 户用-485协议生成
description: 485协议代码自动生成技能。当用户上传RS485/Modbus协议文档（Word/.docx、PDF、Excel）并提到“生成代码”“485代码”“Modbus代码”“寄存器映射”“收发函数”“协议转代码”“生成Rs485协议文件”“新增485协议”“根据寄存器表生成协议”“按当前项目接入485协议”“生成ReceiveIQR/DataRespond骨架”等场景时，必须使用此技能。也适用于用户直接粘贴寄存器表、命令表、帧格式表、功能码说明，或要求“根据这个485协议帮我写C代码”“先把485协议骨架搭出来”“参考现有协议生成新协议”的任务。需要的资料优先在当前户用项目内查看，例如 `485_doc`、`Inverter485Protocol`、`modbus_protocol`、`User/UartRS485*`、`User/Inverter_Data*`。输入是协议文档或寄存器定义，输出是符合当前项目风格的单协议 `.c` 文件骨架；成功标准是生成约80%可用骨架，剩余部分允许保留 `TODO[未实现]` 和人工补充。
---

## 0. 固定注释要求

- 生成新的 485 协议 `.c` 文件时，必须把文件头块注释放在文件最顶部，不能放在 `#include` 后面。
- 文件头块注释默认采用当前项目既有 485 协议文件风格，可参考 `modbus_protocol/Rs485_Efore_V110.c`。
- 默认使用中文注释，文件头至少包含：协议名称、源文件名、英文名、中文名、变更记录。
- 如果需要补充函数注释，优先使用当前项目常见的块注释风格，例如 `@brief / @param / @return`。
- 生成时不要把“文件头注释后续再手工挪到顶部”当作默认做法，必须一次生成到正确位置。

> 固定生成偏好：先判断目标协议属于“历史单协议直写型”还是“公共 Modbus 骨架型”，不要只因为看见某个旧文件相似就整份套用。
>
> 固定生成偏好：如果协议本质是标准 Modbus 寄存器读写，应优先考虑复用 `modbus_protocol/modbus_common.*` 与 `modbus_protocol/modbus_ctrl.*`，不要重新手写一套重复的 CRC、收帧、寄存器越界判断。
>
> 固定生成偏好：如果协议是项目中已有的大量历史 485 私有格式、ASCII 帧、半定制 RTU 帧，默认按 `Rs485_Xxx_Init / Rs485_Xxx_ReceiveIQR / Rs485_Xxx_DataRespond` 单文件结构生成，不额外抽象成项目里没有的新中间层。
>
> 固定生成偏好：凡是寄存器映射、发送缓冲区拼帧、CRC/校验、地址偏移、串口超时判定，都必须回查当前工程真实实现，不要只凭协议文档脑补。

# 485 协议代码生成技能

## 1. 职责边界

本文件只负责工作流调度、骨架选择与落点约束，不维护某个具体协议的全部寄存器细节。

必读参考：
- 实现路线索引：`references/protocol-registry.md`
- 项目样例索引：`references/project-examples.md`
- 真实数据源索引：`references/data-source-index.md`
- 单协议模板说明：`references/protocols/Rs485_Modbus_模板.md`
- 默认代码模板：`assets/templates/Rs485_Template.c`

优先回查的工程资料：
- `485_doc/`：协议原始文档目录
- `Inverter485Protocol/`：历史 485 协议实现主目录
- `modbus_protocol/`：公共 Modbus 框架及新式协议实现
- `Inverter485Protocol/Uart_User485.c`
- `Inverter485Protocol/Uart_User485.h`
- `User/UartRS485.c`
- `User/UartRS485.h`
- `User/Inverter_Data.c`
- `User/Inverter_Data.h`
- `User/Bms_Config.h`

分工说明：
- `SKILL.md`：定义流程、判断条件、输出边界。
- `references/protocol-registry.md`：判断协议应该走哪条实现路线。
- `references/project-examples.md`：按协议类型选主参考、次参考和反例。
- `references/data-source-index.md`：回查真实字段、寄存器数据源和挂接入口。
- `references/protocols/Rs485_Modbus_模板.md`：告诉技能如何从协议文档映射到公共 Modbus 骨架。
- `assets/templates/Rs485_Template.c`：生成新协议时优先落地的默认 Modbus 模板。
- 当前项目真实代码：唯一可信的数据源与接线方式来源。
- `485_doc/`：协议原始定义来源。

## 2. 输出目标

输入：
- 协议文档（PDF / Word / Excel）
- 用户粘贴的寄存器表、命令表、帧格式表

输出：
- 符合当前项目风格的单协议 `.c` 文件

默认应包含：
- 文件头注释
- `Init / ReceiveIQR / DataRespond` 或公共 Modbus 回调骨架
- 关键寄存器区或命令字映射
- 发送缓冲区填充或寄存器更新逻辑
- 明确的 `TODO[未实现]`

成功标准：
- 生成约 80% 可用骨架
- 剩余 20% 允许根据协议细节、客户逻辑和边界情况人工补充

非目标：
- 默认不自动修改 `Uart_User485.c/.h`、协议枚举、协议列表或菜单配置
- 若用户没有明确要求，不顺手做正式挂接和联调逻辑
- 不额外生成项目中不存在的通用 485 框架层

## 3. 执行前必须确认的文件

开始生成前，至少确认并阅读：
1. `SKILL.md`
2. `references/protocol-registry.md`
3. `references/project-examples.md`
4. `references/data-source-index.md`
5. 若协议明显是标准 Modbus，再读 `references/protocols/Rs485_Modbus_模板.md`
6. 若协议明显是标准 Modbus，再读 `assets/templates/Rs485_Template.c`
7. 目标协议对应原始文档
8. `Inverter485Protocol/Uart_User485.c`
9. `Inverter485Protocol/Uart_User485.h`
10. 与目标最相似的 1 到 3 个既有 `Rs485_*.c`
11. 若协议明显是标准 Modbus，再补读 `modbus_protocol/modbus_common.h`
12. 若协议明显是标准 Modbus，再补读 `modbus_protocol/modbus_common.c`
13. 若协议明显是标准 Modbus，再补读 `modbus_protocol/modbus_ctrl.h`
14. 回查真实数据源文件，例如 `User/Inverter_Data.h`

## 4. 工作流程

### 第一步：判断协议实现路线

先判断当前协议属于哪一类：
- A. 历史单协议直写型
说明：通常直接维护 `User485_RxBuffer`、`User485_TxBuffer`、`User485_Reg_Buffer`，自己写收帧状态机、地址判断、CRC 校验、发送应答。
- B. 标准 Modbus 寄存器型
说明：寄存器读写规则清晰、功能码集中在 `03/04/06/10` 一类，适合走 `modbus_common` 公共骨架。
- C. ASCII / 厂商私有帧型
说明：例如带 ASCII 编码、长度校验、CID 字段、非标准 RTU 报文，不要硬套通用 Modbus 框架。
- D. 混合型
说明：协议里既有标准寄存器区，也有明显私有扩展帧。先拆清主体，再决定主骨架。

骨架路线一旦选错，后面寄存器表、收发函数、挂接点都会跟着错。

### 第二步：查找同类真实协议

先看 `references/project-examples.md`，按“标准 Modbus / 私有 RTU / ASCII 帧 / 混合型”缩小范围。

优先在 `Inverter485Protocol/` 中找同类文件：
- 先按厂家或协议名称找
- 再按波特率、功能码、地址范围、帧头帧尾特征找
- 至少选 1 个主参考和 1 个反例

查找时重点看：
- 函数命名是否一致
- 收帧状态机是否适配该类协议
- `User485_Reg_Buffer` 的填充方式
- 发送时机是否由 `DataRespond()` 统一触发
- 是否存在特殊地址偏移、ASCII 转换、字节序处理

### 第三步：确定骨架

如果选择历史单协议直写型，默认骨架应保持：
- `Rs485_Xxx_Init(uint32_t BaudRate)`
- `Rs485_Xxx_ReceiveIQR(uint8_t Buffer)`
- `Rs485_Xxx_DataRespond(void)`
- 需要发送时统一走 `User485_SendStart()`

如果选择公共 Modbus 骨架型，默认骨架应保持：
- 寄存器区宏定义
- `updata_onlyRead_region_x()` / `updata_readWrite_region_x()` 这一类更新函数
- `Modbus_protocol_info_s` 协议信息配置
- `MODBUS_frame_receive()` / `MODBUS_frame_handle()` 的复用入口

这一路线默认先从 `assets/templates/Rs485_Template.c` 起步，再按 `references/protocols/Rs485_Modbus_模板.md` 的清单替换占位项。

不要在没有证据时把直写型协议强行改造成 `modbus_common` 风格，也不要把标准 Modbus 再拆回大段重复收帧状态机。

### 第四步：回查真实数据源

凡是涉及以下内容，必须回到工程真实文件确认：
- `InverterData`
- `PackData`
- 宏、结构体、状态位、保护位
- BMS 地址、包数、单包索引
- 充放电限值、SOC、SOH、温度、电压、电流

优先回查：
- `references/data-source-index.md`
- `User/Inverter_Data.h`
- `User/Inverter_Data.c`
- `User/Bms_Config.h`
- 当前最相似协议源文件

若协议文档字段名与工程实际字段不一致，以工程可用字段为准；无法映射时必须标 `TODO[未实现]`。

### 第五步：生成代码

生成时遵循这些铁则：
- 优先复用项目现有全局缓冲区、枚举和接口命名
- 收帧状态机优先沿用同类协议写法，不随意发明新状态枚举
- 发送缓冲区填充优先在发送函数内部直写，不额外拆成只服务单个场景的小函数
- 读寄存器返回时，寄存器值优先直接写入 `User485_Reg_Buffer[]` 或更新回调中的 `reg[]`
- 标准 Modbus 场景下，优先复用公共 CRC、帧解析、越界检查
- 私有 ASCII/自定义帧场景下，优先继承同类协议的校验和长度处理逻辑
- 地址偏移、寄存器起始地址、站号范围必须按协议文档与真实参考双重核对
- 不要在没有依据时改变大小端、单位倍率、符号位编码规则

### 第六步：标注未实现项

以下情况必须显式写 `TODO[未实现]`：
- 协议定义了，但当前工程没有可直接映射的数据源
- 协议定义了写寄存器，但具体写入后动作不清晰
- 协议定义了特殊控制命令，但依赖上层流程或客户定制逻辑
- 协议定义了多包轮询、级联寻址或广播行为，但当前需求没有明确边界

不要静默省略，也不要猜测补全。

### 第七步：生成后自检

生成后至少做三类检查：
- 协议完整性：命令字、寄存器区、应答路径是否覆盖
- 数据源正确性：字段是否来自真实可用结构体或宏
- 风格一致性：函数名、缓冲区、发送入口、校验方式是否与项目一致

另外补查：
- 这个协议更像应该放在 `Inverter485Protocol/` 还是 `modbus_protocol/`
- 如果后续要正式接入，还需要改哪些枚举或协议表

## 5. 决策优先级

当多个来源冲突时，按以下优先级处理：
1. 用户最新明确要求
2. 当前协议原始文档
3. 当前项目真实工程代码 / 头文件
4. 同类既有 485 协议实现
5. 通用 Modbus 常识

## 6. 明确禁止的行为

- 不要因为旧文件能编译就默认它适合作为新模板
- 不要把别的 485 协议地址偏移、寄存器单位、校验方式直接外推到当前协议
- 不要为了“通用化”而额外造出项目里不存在的新公共层
- 不要忽略 `Uart_User485.c/.h`、`modbus_common.*` 这些真实挂接约束
- 不要在没有证据时猜测字段来源、BMS 地址范围或站号策略

## 7. 推荐输出方式

生成完成后，建议简要说明：
- 本次选择的是哪条实现路线
- 参考了哪些真实 485 协议文件
- 已实现哪些寄存器区或命令
- 哪些部分保留了 `TODO[未实现]`
- 是否已回查真实数据源
- 如果用户下一步要正式接入，还需要补哪些文件

## 8. 参考文件使用规则

使用 `references/` 时遵循这些规则：
- 先读索引，不要一上来遍历整个 `Inverter485Protocol/`
- 先用索引缩到 1 到 3 个最相似文件，再进入真实源码
- 索引只负责导航和分类，不替代真实代码与原始协议文档
- 如果索引和工程现状不一致，以真实工程文件为准，并在输出里说明
