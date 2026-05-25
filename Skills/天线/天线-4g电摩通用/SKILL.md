---
name: 天线-4g电摩通用
description: 用于当前 4G 电摩固件工程的通用协作、问题排查与代码骨架生成。适用于用户希望在该项目中新增功能、定位功能入口、分析调用链、区分应修改哪一层代码、快速排查功能异常、梳理模块职责，或要求“按当前工程风格直接生成新增功能代码骨架/补 request-response-parse 挂接骨架/先把结构搭出来”之类任务时使用。尤其适合围绕 `ql-application/threadx/project_general/User` 下业务代码进行结构理解、协议扩展、路由挂接检查、问题回溯和最小可落地骨架生成。
---

# 天线-4g电摩通用

## 概览

围绕当前 4G 电摩工程建立稳定的“先定位、再判断、后修改”工作方式。先确认模块职责和调用链，再决定改动点，避免只凭文件名猜测导致漏改。

这个 skill 同时服务三类任务：

1. 新增或扩展现有功能
2. 已有功能异常时快速查入口、查路由、查数据流
3. 按当前工程真实风格生成新增功能代码骨架

## 快速入口

优先从用户提供的问题、报错点、协议名、文件名入手，再缩小到具体目录。

高频入口目录：

- `ql-application/threadx/project_general/User`
- `ql-application/threadx/project_general/User/bms_protocol_V109`

当任务涉及 V109 协议时，先读取：

- `ql-application/threadx/project_general/User/bms_protocol_V109/V109协议代码架构说明.md`

如需理解 V109 的分层职责，再结合：

- `ql-application/threadx/project_general/User/bms_protocol_V109/bms_data_conver_v109.c`
- `ql-application/threadx/project_general/User/bms_protocol_V109/bms_data_handle_v109.c`

需要更快进入状态时，再按需读取：

- `references/项目排查入口.md`
- `references/新增功能代码骨架规范.md`

## 工作流程

### 1. 先判断任务类型

先把用户诉求归到下面一种，再继续：

- 新增命令或新增功能
- 修改现有逻辑
- 某功能不生效
- 某字段解析异常
- 不知道该改哪个文件
- 需要解释某段代码职责
- 需要先生成代码骨架再细化

### 2. 先定层，再定点

不要一上来就改代码。先判断问题更像属于哪一层：

- 协议流程层：命令号、发包、收包、路由、状态机、验包、请求响应匹配
- 数据解析层：字段偏移、长度判断、字节序、单位换算、结构体落点
- 管理层或业务层：解析结果写入位置、全局管理对象、上层读取链路

若是 V109 协议相关，优先按下面理解：

- `conver` 层负责收发、验包、分发
- `handle` 层负责把字节流转成业务数据

### 3. 新增功能时固定检查

当用户要求“加一个功能”“加一个命令”“补一个协议点”时，优先按这个顺序检查：

1. 是否已有相近功能可复用
2. 命令号或功能枚举是否需要新增
3. 请求函数和响应函数是否都需要补
4. 路由表或映射表是否已经挂接
5. 响应后是否进入了正确解析函数
6. 解析结果是否真正写入了管理结构
7. 上层读取链路是否已经接通

如果只补了函数没挂接路由，通常会出现“能编译但功能不生效”。

### 4. 排查异常时固定检查

当用户反馈“代码看起来写了但不工作”时，优先排查：

1. 入口函数有没有被真正调用
2. 条件编译、状态位、模式判断是否拦住了流程
3. 路由表、回调表、协议表是否漏挂
4. 长度判断是否过严或过松
5. 取数起始偏移是否正确
6. 解析结果是否落到了正确的管理对象
7. 最终展示或上层读取是否读的是另一份数据

### 5. 需要生成代码骨架时的默认动作

当用户明确说“生成骨架”“先把结构搭出来”“按当前风格补一套框架”时，不要只给抽象建议，要按工程真实结构直接生成。

默认动作：

1. 先识别是读命令、写命令、控制命令还是复用型命令
2. 先找同类现有函数作为参考样板
3. 先决定是复用统一解析入口还是新建 parse
4. 再生成最小可落地骨架，而不是生成脱离工程的伪代码

生成的骨架必须优先贴近当前工程现状：

- 保持现有命名风格
- 保持当前 request/response 对称写法
- 保持路由表挂接方式
- 保持 `conver` 层与 `handle` 层分层
- 允许保留少量 `TODO[待补协议细节]`

### 6. 回答“该改哪里”时的要求

给结论时不要只报文件名，要同时说明：

- 为什么是这个文件
- 它在调用链里的位置
- 还可能连带检查哪些文件
- 哪一步最容易漏

## 代码骨架生成规则

### 先生成最小闭环，不要只生成单个函数

如果任务是新增 V109 功能，默认至少考虑这些位置是否要一起产出：

- `group_id` 枚举项
- `conver` 层函数声明
- 路由表挂接项
- request 函数
- response 函数
- `handle` 层解析声明
- `handle` 层解析实现
- 管理结构落点或 `TODO[待确认落点]`

不要只给一个 `parse()` 空壳或一个 request 函数就结束。

### 优先复用项目内固定模式

读命令优先参照类似的 `get_xxx_request()` / `get_xxx_response()` 配对。

写命令优先参照类似的 `set_xxx_request(data, len)` / `set_xxx_response()` 配对。

若已有统一解析入口，优先扩展：

- `bms_protection_para_cmd_parse(...)`
- `get_bms_info_parse(...)`
- `bms_data_para_set_parse(...)`

只有在数据格式明显不同的时候，才新增专用解析函数。

### 骨架内容必须带上“还缺什么”

当协议细节不完整时，可以生成骨架，但要明确标出：

- 哪个字段长度待确认
- 哪个字节序待确认
- 数据应写入哪个管理结构待确认
- 哪些长度判断需要按协议补齐

如果不能确认，就写：

- `TODO[待补协议细节]`
- `TODO[待确认落点]`

不要假装细节已经确定。

### 输出骨架时的表达要求

如果只是给方案，不要用纯口述，优先给接近工程可落地的片段。

如果要直接改代码，优先做最小闭环改动，并在说明里补：

1. 已新增的挂接点
2. 仍待补充的协议细节
3. 还未验证的风险点

## V109 协议专项规则

当问题明确落在 `bms_protocol_V109` 目录时，默认按下面规则行动：

### 先读架构说明

优先读：

- `V109协议代码架构说明.md`

只在需要代码证据时再打开具体 `.c/.h` 文件，不要先把整个目录全部读完。

### 用二层结构组织分析

说明问题时，优先用“收发层 / 解析层”来组织答案：

- 收发层：`bms_data_conver_v109.*`
- 解析层：`bms_data_handle_v109.*`

### 新增 V109 命令时默认检查点

- `group_id` 是否已定义
- request/response 声明是否完整
- 路由表是否已挂接
- request 是否调用正确的统一发送接口
- response 是否正确截出 `data` 区
- 是否复用现有解析函数或需要新增解析函数
- 解析结果是否写回合适的管理结构

### 生成 V109 骨架时的优先模板

读命令优先生成这种结构：

1. `BMS_V109_GROUP_ID_GET_XXX`
2. `void bms_data_get_xxx_request(void);`
3. `void bms_data_get_xxx_response(uint8_t *data, uint16_t length);`
4. 路由表 `{group_id, NULL, request, response}`
5. `request` 内调用统一读请求接口
6. `response` 内取 `data_len`、取 `&data[IPC_DATA_HEAD_LEN]`、做最小长度判断、再调用 parse
7. `handle` 层提供 `bms_xxx_parse(...)`

写命令优先生成这种结构：

1. `BMS_V109_GROUP_ID_SET_XXX`
2. `void bms_data_set_xxx_request(uint8_t *data, uint16_t length);`
3. `void bms_data_set_xxx_response(uint8_t *data, uint16_t length);`
4. 路由表 `{group_id, request, NULL, response}`
5. `request` 内调用统一写请求接口
6. `response` 内优先复用 `bms_data_para_set_parse(rtn, data_len)`

### 优先参考真实样板

如果需要选参考函数，优先在当前文件里寻找最近似功能，而不是凭空命名。

例如：

- 查看路由表已有项如何挂接
- 查看同类 `get_xxx_request/get_xxx_response` 如何成对声明
- 查看现有 `response` 是否统一从 `IPC_DATA_HEAD_LEN` 取业务数据

### 内置 V109 新增读命令模板

当用户要求“先补一个新的读取命令骨架”时，优先按下面风格生成，必要时只替换命令名、命令号和解析函数名：

```c
/* bms_data_conver_v109.h */
typedef enum
{
    BMS_V109_GROUP_ID_GET_XXX = 0xXXXX,
} bms_v109_data_group_id_e;

/* bms_data_conver_v109.c */
void bms_data_get_xxx_request(void);
void bms_data_get_xxx_response(uint8_t *data, uint16_t length);

static const bms_v109_data_conver_t bms_v109_data_handle_list[] = {
    {BMS_V109_GROUP_ID_GET_XXX, NULL, bms_data_get_xxx_request, bms_data_get_xxx_response},
};

/**
 * @brief 获取XXX（0xXXXX）
 */
void bms_data_get_xxx_request(void)
{
    bms_data_get_request(BMS_V109_GROUP_ID_GET_XXX);
}

/**
 * @brief 协议接收函数，获取XXX（0xXXXX）
 *
 * @param data 接收缓冲区
 * @param length 接收长度
 */
void bms_data_get_xxx_response(uint8_t *data, uint16_t length)
{
    uint8_t *p = NULL;
    uint16_t data_len = data[5] << 8 | data[6];

    if (data_len == 0)
    {
        return;
    }

    p = &data[IPC_DATA_HEAD_LEN];
    bms_xxx_parse(p, data_len);
}
```

```c
/* bms_data_handle_v109.h */
void bms_xxx_parse(uint8_t *reg, uint16_t len);

/* bms_data_handle_v109.c */
/**
 * @brief XXX数据解析（0xXXXX）
 *
 * @param reg 响应数据
 * @param len 数据长度
 */
void bms_xxx_parse(uint8_t *reg, uint16_t len)
{
    if (len < 最小合法长度)
    {
        return;
    }

    /* TODO[待补协议细节] 解析字段 */
    /* TODO[待确认落点] 写入对应管理结构 */
}
```

如果当前协议格式和 `bms_data_get_mos_mode_state_request()` / `bms_data_get_mos_mode_state_response()` / `bms_mos_mode_state_parse()` 接近，优先向这组真实函数风格靠拢。

### 内置 V109 新增写命令模板

当用户要求“先补一个新的写入命令骨架”时，优先按下面风格生成，必要时只替换命令名、命令号和数据长度细节：

```c
/* bms_data_conver_v109.h */
typedef enum
{
    BMS_V109_GROUP_ID_SET_XXX = 0xXXXX,
} bms_v109_data_group_id_e;

/* bms_data_conver_v109.c */
void bms_data_set_xxx_request(uint8_t *data, uint16_t length);
void bms_data_set_xxx_response(uint8_t *data, uint16_t length);

static const bms_v109_data_conver_t bms_v109_data_handle_list[] = {
    {BMS_V109_GROUP_ID_SET_XXX, bms_data_set_xxx_request, NULL, bms_data_set_xxx_response},
};

/**
 * @brief 修改XXX（0xXXXX）
 */
void bms_data_set_xxx_request(uint8_t *data, uint16_t length)
{
    bms_data_set_request(BMS_V109_GROUP_ID_SET_XXX, data, length);
}

/**
 * @brief 协议接收函数，修改XXX（0xXXXX）
 *
 * @param data 接收缓冲区
 * @param length 接收长度
 */
void bms_data_set_xxx_response(uint8_t *data, uint16_t length)
{
    uint16_t data_len = data[5] << 8 | data[6];
    uint8_t rtn = data[4];

    bms_data_para_set_parse(rtn, data_len);
}
```

如果用户没有给出额外返回字段定义，不要擅自补复杂解析，优先复用 `bms_data_para_set_parse(rtn, data_len)`。

### 模板使用要求

使用上面两套模板时，必须同步做下面判断：

1. 路由表表项里的 `write_block` 和 `request` 哪个应为 `NULL`
2. 解析函数是否应新建，还是并入统一解析入口
3. `len < 最小合法长度` 应该是多少
4. 解析后最终应写到哪个管理结构

如果用户只给了命令号，没有给字段表，也可以先按模板出骨架，但必须显式保留：

- `TODO[待补协议细节]`
- `TODO[待确认落点]`

## 输出要求

在回答这类项目问题时，优先输出：

1. 当前判断属于哪一层问题
2. 建议先看的文件
3. 建议核对的调用链或数据流
4. 可能漏改的点
5. 如果要改代码，建议最小改动面

在生成骨架时，再额外输出：

1. 这次骨架涉及哪些文件
2. 哪些位置已经形成闭环
3. 哪些位置仍是 `TODO[待补协议细节]`
4. 是否还需要用户补协议表、字段表或落点说明

如果已经有代码证据，尽量给出明确函数名、表项名、结构落点，不写泛泛建议。

## 参考资料

按需读取：

- `references/项目排查入口.md`
- `references/新增功能代码骨架规范.md`

当用户提供新的协议说明、截图、报文表或设计说明时，先把新资料和现有架构对齐，再决定是复用旧模式还是开新分支。

## 编码与乱码防护

当任务涉及 `bms_protocol_V109` 或同类历史固件文件时，必须先把“乱码”视为编码风险，而不是默认视为文本内容已经损坏。

### 先判断是“显示乱码”还是“文件真损坏”

优先按下面顺序判断：

1. 先确认文件原始编码是否是 `UTF-8`、`GBK/ANSI` 或其他本地编码
2. 再确认文件换行是否是 `CRLF`
3. 先用字节方式读取，分别尝试 `UTF-8` 和 `GBK` 解码，确认哪一种能正常显示中文
4. 如果终端显示乱码，但按正确编码重新读取后中文正常，判定为“显示问题”
5. 如果文件字节内容已经变成 `?`、`锟�`、`�` 或明显不可逆内容，才判定为“文件内容被覆盖”

不要只因为终端里看到乱码，就立刻重写文件。

### 修改前必须做的事

如果目标文件不是明确的 `UTF-8`，先做下面几步：

1. 记录目标文件真实编码
2. 记录目标文件换行风格
3. 优先做同目录或外部备份
4. 只对最小代码块做改动，不要整文件重写

如果不能确认编码和换行是否能被完整保留，先停止并提醒用户。

### 修改时的强制规则

- 修改函数逻辑时，不要顺手改原有中文注释、中文字符串
- 不要用会隐式转码的整文件读写方式覆盖历史固件文件
- 不要用错误编码去“修复乱码”，否则很容易把原中文真正覆盖掉
- 对非 `UTF-8` 文件，优先使用“按原编码读取、按原编码写回”的脚本化编辑方式
- 对只新增的代码，优先使用 ASCII 内容；如果必须补中文注释，写回前后都要按目标编码复核

### Windows 中文路径的额外要求

在 Windows 环境里，中文路径本身也可能导致脚本失败或误判。遇到这类情况时：

1. 先通过 PowerShell 或系统 API 获取真实绝对路径
2. 优先使用 PowerShell 的字节读写或 .NET 文件接口
3. 不要因为 Python 在中文路径下报错，就推断文件本身损坏

### 验证要求

完成修改后，至少做下面一种验证：

- 重新按原编码读取文件，确认新增中文注释显示正常
- 抽查原有中文注释，确认没有被改成 `?`
- 如有原始副本，可对照关键中文行或哈希

如果本次任务已经出现过编码事故，后续同轮修改必须把“备份 + 原编码写回 + 修改后复读确认”视为必做步骤，不能省略。
