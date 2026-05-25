---
name: 户用-CAN协议生成
description: CAN协议代码自动生成技能。当用户上传CAN协议文档（Word/.docx、PDF）并提到“生成代码”“CAN代码”“报文解析”“协议转代码”“生成收发函数”“CAN报文结构体”等场景时，必须使用此技能。也适用于用户直接粘贴CAN信号表、报文定义表，或要求“根据这个协议帮我写C代码”的任务。输入是协议文档，输出是符合当前项目风格的单协议 `.c` 文件；成功标准是生成约80%可用骨架，剩余部分允许保留 `TODO[未实现]` 和人工补充。
---

> 固定生成偏好：凡是 `Can_msg_Tx.Data[x]` 的填充，默认直接在 `switch(SendMsgIndex)` 的 `case` 内展开写，不要再封装成仅服务于单个帧或单个 `case` 的辅助函数，例如 `FillData()`、`FillFrame()`、`FillManufacturerName()`。
>
> 固定生成偏好：若协议采用项目常见的轮询发送骨架，则 `SendCycleMsg()` 必须保持项目固定结构：
> - `switch(SendMsgIndex)` 的 `default` 分支默认写成 `SendMsgIndex = 0; break;`
> - `Can_TransmitData(&Can_msg_Tx);` 默认统一放在整个 `switch(SendMsgIndex)` 之后，不要在单个 `case` 内或辅助函数内部直接发送
> - `Init(CanRate_t baudrate)` 默认写成 `Current_Can_Rate = baudrate;`、`CAN_Config(Current_Can_Rate);`、`Set_Timer(CANCOMPNTIMER, 1);`
> - `MainCall(void)` 默认写成 `if(Timer[CANCOMPNTIMER].Flag) { Set_Timer(CANCOMPNTIMER, 8); CanComXxx_SendCycleMsg(); }`
> - 除非用户明确要求或目标协议属于特殊触发/应答结构，否则不要改写成 `default return;`、不要改成 `Can_Init(baudrate);` 风格，也不要拆成“填充函数内部直接发送”的结构

# CAN 协议代码生成技能

## 1. 职责边界

本文件只负责工作流调度与决策顺序，不维护具体协议细节。

必读参考：
- 通用编码规则：`references/codegen-rules.md`
- 项目写法与风格：`references/coding-style.md`
- 反例与禁忌：`references/anti-pattern-library.md`
- 数据字段来源：`references/inverter-data.md`
- 协议总目录：`references/protocol-registry.md`
- 协议级说明：`references/protocols/Can_Xxx.md`
- 协议说明模板：`references/protocol-doc-template.md`
- 项目正例与白灰黑名单：`references/project-positive-examples.md`
- 默认代码骨架：`assets/templates/Can_Template.c`

分工说明：
- `SKILL.md`：定义流程、决策点、引用关系。
- `project-positive-examples.md`：唯一的白名单 / 灰名单 / 黑名单主表。
- `protocol-registry.md`：协议检索入口与参考级别摘要，不单独维护名单细节。
- `references/protocols/Can_Xxx.md`：单协议知识与使用边界。
- `references/protocol-doc-template.md`：新增协议说明时唯一模板。

## 2. 输出目标

输入：
- 协议文档（PDF / Word）
- 用户粘贴的信号表 / 报文定义表

输出：
- 符合当前项目风格的单协议 `.c` 文件

默认应包含：
- 文件头注释
- `Init / MainCall / ReceiveIRQ`
- 轮询发送或触发应答骨架
- 主要报文 `Data[]` 填充
- 明确的 `TODO[未实现]`

成功标准：
- 生成约 80% 可用骨架
- 剩余 20% 允许根据协议细节、客户逻辑和边界情况人工补充

非目标：
- 默认不生成通用 `pack/unpack` 多文件库
- 若用户没有额外要求，不生成 `can_msg_def.h / can_pack.c / can_unpack.c`

## 3. 执行前必须确认的文件

开始生成前，至少确认并阅读：
1. `SKILL.md`
2. `references/codegen-rules.md`
3. `references/coding-style.md`
4. `references/anti-pattern-library.md`
5. `references/protocol-registry.md`
6. 与目标协议最相关的 `references/protocols/Can_Xxx.md`
7. 必要时再读 `references/project-positive-examples.md`
8. 生成后回查项目真实头文件，例如 `Inverter_Data.h`

## 4. 工作流程

### 第一步：判断协议类型

先判断当前协议属于哪一类：
- A. 轮询发送型
- B. 触发应答型
- C. 扩展帧命令型
- D. 混合型

协议类型决定骨架选择，不能先看某个旧文件像不像就直接套用。

### 第二步：查找同类协议

先看 `references/protocol-registry.md`：
- 是否存在同类协议
- 对应协议是什么参考级别
- 是否有明确标注的特殊处理

若命中同类协议，再读取对应 `references/protocols/Can_Xxx.md`。

### 第三步：选择项目参考级别

根据 `references/project-positive-examples.md` 判断：
- 白名单：可作为骨架候选
- 灰名单：只能局部参考
- 黑名单：默认禁止作为模板

不要把灰名单或黑名单整体套成默认骨架。

### 第四步：回查真实数据源

凡是涉及 `InverterData`、`PackData`、宏、结构体、状态位、地址字段，不能只看 skill 参考表。
必须回到项目真实文件确认，例如：
- `User/Inverter_Data.h`
- `User/Bms_Config.h`
- 相关协议源文件和公共头文件

若 skill 参考与真实头文件不一致，以真实工程为准。

### 第五步：生成代码

生成时遵循这些铁则：
- `Can_msg_Tx.Data[x]` 默认直接在 `case` 中展开写
- `StdId` 放在每个 `case` 的最上面
- 轮询索引统一命名为 `SendMsgIndex`
- 常规轮询发送骨架下，`Can_TransmitData(&Can_msg_Tx);` 统一放在 `switch(SendMsgIndex)` 之后
- 常规轮询发送骨架下，`default` 默认写成 `SendMsgIndex = 0; break;`
- 常规轮询发送骨架下，`Init(CanRate_t baudrate)` 默认写成 `Current_Can_Rate = baudrate;`、`CAN_Config(Current_Can_Rate);`、`Set_Timer(CANCOMPNTIMER, 1);`
- 常规轮询发送骨架下，`MainCall(void)` 默认写成 `Set_Timer(CANCOMPNTIMER, 8);`
- 优先直用已有字段，不滥用推导值
- `uint8_t` 映射到 2 字节槽位时，高字节直接写 `0`
- 普通表达式优先内联，不随意拆成辅助函数或过多临时变量

### 第六步：标注未实现项

以下情况必须显式写 `TODO[未实现]`：
- 协议定义了，但项目暂时没有数据源
- 协议定义了，但依赖上层接口或客户逻辑
- 协议定义了，但触发条件 / 状态机不清晰

不要静默省略，也不要猜测补全。

### 第七步：生成后自检

生成后至少做三类检查：
- 协议完整性：报文是否覆盖、顺序是否正确、RX 是否留入口
- 数据源正确性：字段是否来自真实可用数据源
- 风格一致性：是否符合项目既有写法

默认参照：`references/post-generation-self-check.md`
必要时输出对比摘要：`references/post-generation-compare-template.md`

## 5. 决策优先级

当多个来源冲突时，按以下优先级处理：
1. 用户最新明确要求
2. 当前协议原始文档
3. 项目真实工程代码 / 头文件
4. 单协议参考文件 `references/protocols/Can_Xxx.md`
5. 正反例索引与风格参考
6. 通用代码生成规则

## 6. 明确禁止的行为

- 不要因为看见历史实现就默认认为它是正确模板
- 不要把其他协议的地址编码、补位字符、状态机直接外推到当前协议
- 不要遗漏协议里已经明确可实现的功能帧
- 不要为了抽象而抽象，生成一堆项目里没有的辅助层
- 不要在没有证据时猜测字段来源或协议行为

## 7. 推荐输出方式

生成完成后，建议简要说明：
- 参考了哪些协议 / 项目正例
- 已实现哪些报文
- 哪些部分保留了 `TODO[未实现]`
- 是否已回查真实数据源
- 是否还有需要人工确认的点
