# 代码风格规范

> 来源：团队协议代码规范文档 + `assets/examples/Can_Pylon.c`
> 适用范围：所有 CAN / RS485 协议模块
> 本文件只讲风格、结构、命名和落地写法；生成规则见 `codegen-rules.md`

---

## 0. 项目固定偏好

以下规则为当前项目在实际生成和人工修订中反复确认过的固定偏好，生成代码时默认遵守。

- 报文轮询索引变量统一命名为 `SendMsgIndex`，不使用 `send_index`
- 临时变量只使用 `tmp`、`wtmp`、`lwtmp` 等既有风格命名，不使用 `flags`、`word`、`signed_word`、`dword`
- 临时变量声明时补简短用途注释；默认不要为了中间结果额外声明临时变量。若单个表达式可直接得到结果，则直接写入 `Data[x]`；即使同一表达式重复 2~4 次，也优先保持内联写法。只有当同一结果被复用超过 4 次，或明显影响可读性时，才允许声明 `tmp / wtmp / lwtmp`
- `switch(SendMsgIndex)` 的每个 `case` 中，`Can_msg_Tx.StdId = 0xXXX;` 放在 `case` 最上面，先写 ID，再写数据填充
- 常规轮询发送骨架下，`default` 分支默认写成 `SendMsgIndex = 0; break;`
- 常规轮询发送骨架下，`Can_TransmitData(&Can_msg_Tx);` 默认统一放在整个 `switch(SendMsgIndex)` 之后，不要在 `case` 内或辅助函数内部直接发送
- 常规轮询发送骨架下，`Init(CanRate_t baudrate)` 默认写成 `Current_Can_Rate = baudrate;`、`CAN_Config(Current_Can_Rate);`、`Set_Timer(CANCOMPNTIMER, 1);`
- 常规轮询发送骨架下，`MainCall(void)` 默认写成检测 `Timer[CANCOMPNTIMER].Flag` 后执行 `Set_Timer(CANCOMPNTIMER, 8);`
- 强制类型转换统一写成 `(uint8_t)(expr)` 形式，不写成 `(uint8_t)expr`
- 不要为了“类型安全”在 `BIT` 宏、按位取反 `~BITx`、或 `BIT0 | BIT1` 这类项目既有位运算前额外添加 `(uint8_t)`、`(uint16_t)` 等强转；若项目现有手写代码没有该强转，则生成代码也不要添加
- ASCII / 字符串字段直接写字符字面量，如 `Can_msg_Tx.Data[0] = 'P';`，不写 `(uint8_t)'P'`
- 地址 / ASCII 数字转换优先复用项目现有写法，直接用 `tmp` 配合 `'0' + value` 组装；不要新建 `ToAsciiTens()`、`ToAsciiUnits()` 这类同功能辅助函数
- 字符串补位优先使用空格 `' '`；纯保留字节逐个显式写 `0`
- 只要 `InverterData` / 逆变器参数参考中已有对应字段，就优先直接使用现成字段，不用推导值替代
- 字段映射到协议 2 字节槽位时，若源字段本身是 `uint8_t`，则低字节写字段值，高字节直接写 `0`，不写 `value >> 8`
- 需要复用、拆高低字节、或承接函数返回值时，才使用 `tmp / wtmp / lwtmp`
- 对于普通算术表达式，即使要拆高低字节，只要复用次数不超过 4 次，也优先直接内联到 `Data[x]`
- 数字常量默认沿用项目现有写法，不额外添加 `u` / `U` / `ul` / `UL` 等无符号后缀；除非协议或现有项目代码明确要求
- `Can_msg_Tx.Data[x]` 的填充默认直接在 `switch(SendMsgIndex)` 的 `case` 内展开写，不要再额外封装只服务单个报文的 `FillData()` / `FillFrame()` / `FillManufacturerName()` 之类辅助函数

### 0.1 优先沉淀的项目共性规则

1. 轮询发送函数中的索引变量默认命名为 `SendMsgIndex`
2. 每个 `case` 内先写 `Can_msg_Tx.StdId = 0xXXX;`，再写 `Data[]`
3. `Can_TransmitData(&Can_msg_Tx);` 默认统一放在整个 `switch(SendMsgIndex)` 之后
4. `default` 默认写成 `SendMsgIndex = 0; break;`
5. `Init(CanRate_t baudrate)` 默认写成 `Current_Can_Rate = baudrate;`、`CAN_Config(Current_Can_Rate);`、`Set_Timer(CANCOMPNTIMER, 1);`
6. `MainCall(void)` 默认在定时标志置位后调用 `Set_Timer(CANCOMPNTIMER, 8);`
7. ASCII / 字符串字段直接写字符字面量
8. `uint8_t` 字段映射到协议 2 字节槽位时，高字节直接写 `0`
9. `InverterData` 中已有现成字段时优先直接使用该字段
10. 地址 ASCII 数字转换优先复用项目现有写法

### 0.2 需要谨慎吸收的限制规则

1. 若用户或现有正例已明确要求 `default:` 使用 `break;` 并在 `switch` 后统一发送，则不要再外推成 `default return;`。
2. 总容量字段不能因为已有两种写法就随意混用。
3. 地址字段编码方式不能从单个协议外推成全局规则。
4. 分隔符、补位字符、保留字节写法不能跨协议复用。
5. 单个协议中的工程化兼容逻辑不能直接沉淀成通用模板。

---

## 1. 文件与命名规范

### 1.1 `.c` 文件命名格式

```text
Can_协议名_Vxx.c
Can_协议名_日期.c
Rs485_协议名_Vxx.c
```

规则：
- 前缀固定使用 `Can` 或 `Rs485`。
- `.c` 文件名、规格书命名、枚举值命名三者尽量保持一致。
- 文件名后缀统一带版本号；PDF 无版本号或版本号冲突时，改用日期。
- 版本号去掉小数点，例如 `V1.30` 写成 `V130`。

### 1.2 函数命名格式

统一前缀：`CanCom + 协议 + 版本号`

```c
CanComPylon_Init()
CanComPylon_MainCall()
CanComPylon_ReceiveIRQ()

CanComPylon_V130_Init()
CanComPylon_V130_MainCall()
CanComPylon_V130_ReceiveIRQ()
```

### 1.3 枚举值命名

```c
typedef enum en_CAN_Protocol
{
    Can_Pace       = 0,
    Can_Pylon      = 1,
    Can_Pylon_V130 = 2,
} en_CAN_Protocol;
```

---

## 2. 文件头注释

```c
/************************************************************
协议名：协议文档 PDF / Word 完整文件名（含扩展名）
源文件名：Can_协议名_Vxx.c

英文名：协议英文名_版本
中文名：协议中文名_版本
枚举值：Can_Xxx = N

变更记录：
YYYY.MM.DD  作者  初版发送
************************************************************/
```

---

## 3. 函数头注释

```c
/*************************************************
Function:    CanComXxx_FuncName()
Description: 一句话说明功能
Parameters:  参数说明（无参可省略）
Return:      返回值说明（void 可省略）
Note:        重要约束或前提（可选）
*************************************************/
```

---

## 4. 模块结构

推荐顺序：

```c
/* ===== 内部辅助函数（static） ===== */
static uint16_t CanComXxx_CheckProtectFlag(void);
static uint16_t CanComXxx_CheckWarningFlag(void);
static uint8_t  CanComXxx_ForceCHG_Flag(void);
static void     CanComXxx_SendCycleMsg(void);

/* ===== 对外接口 ===== */
void CanComXxx_Init(CanRate_t baudrate);
void CanComXxx_MainCall(void);
void CanComXxx_ReceiveIRQ(const CanRxMessage *msg);
```

无保告警 / 控制逻辑时，对应 `static` 函数可省略，但 `Init / MainCall / ReceiveIRQ` 三个对外接口应保留。

---

## 5. 报文轮询发送模板

```c
static void CanComXxx_SendCycleMsg(void)
{
    static uint8_t SendMsgIndex = 0;
    uint16_t wtmp = 0;

    Can_msg_Tx.DLC = 8;
    Can_msg_Tx.IDE = CAN_ID_STD;
    Can_msg_Tx.RTR = CAN_RTRQ_Data;

    switch(SendMsgIndex)
    {
        case 0:
        {
            Can_msg_Tx.StdId = 0xXXX;
            Can_msg_Tx.Data[0] = 0;
            SendMsgIndex++;
            break;
        }
        case N:
        {
            Can_msg_Tx.StdId = 0xXXX;
            Can_msg_Tx.Data[0] = 0;
            SendMsgIndex = 0;
            break;
        }
        default:
        {
            SendMsgIndex = 0;
            break;
        }
    }

    Can_TransmitData(&Can_msg_Tx);
}
```

规则：
- 报文轮询索引变量名称统一使用 `SendMsgIndex`
- `switch(SendMsgIndex)` 的每个 `case` 中，`Can_msg_Tx.StdId = 0xXXX;` 放在最上面
- `default` 分支默认写成 `SendMsgIndex = 0; break;`
- `Can_TransmitData(&Can_msg_Tx);` 默认统一放在整个 `switch(SendMsgIndex)` 之后
- `Can_msg_Tx.Data[x]` 默认在 `case` 中直接展开填写

## 5.1 初始化模板

```c
void CanComXxx_Init(CanRate_t baudrate)
{
    Current_Can_Rate = baudrate;
    CAN_Config(Current_Can_Rate);
    Set_Timer(CANCOMPNTIMER, 1);
}
```

---

## 6. 定时器驱动模板

```c
void CanComXxx_MainCall(void)
{
    if(Timer[CANCOMPNTIMER].Flag)
    {
        Set_Timer(CANCOMPNTIMER, 8);
        CanComXxx_SendCycleMsg();
    }
}
```

---

## 7. 数据填充规范

```c
Data[0] = (uint8_t)(value);
Data[1] = (uint8_t)(value >> 8);

Can_msg_Tx.Data[0] = (uint8_t)(InverterData.VsumAvg / 10);

lwtmp = SocData.gTotal_ChgAH / 100 * PackData[0].Vpack / 1000 / 100;
Can_msg_Tx.Data[0] = (uint8_t)(lwtmp);
Can_msg_Tx.Data[1] = (uint8_t)(lwtmp >> 8);
Can_msg_Tx.Data[2] = (uint8_t)(lwtmp >> 16);
Can_msg_Tx.Data[3] = (uint8_t)(lwtmp >> 24);

Can_msg_Tx.Data[5] = 0;
Can_msg_Tx.Data[6] = 0;
Can_msg_Tx.Data[7] = 0;
```

---

## 8. 字段类型到写法映射

### 8.1 `uint8_t` 字段，对应协议 1 字节

```c
Can_msg_Tx.Data[0] = InverterData.PackNum;
```

### 8.2 `uint8_t` 字段，对应协议 2 字节槽位

```c
Can_msg_Tx.Data[0] = InverterData.NormalPackNum;
Can_msg_Tx.Data[1] = 0;
```

### 8.3 `uint16_t` 字段，对应协议 2 字节槽位

```c
Can_msg_Tx.Data[0] = (uint8_t)(InverterData.ChargeV);
Can_msg_Tx.Data[1] = (uint8_t)(InverterData.ChargeV >> 8);
```

### 8.4 `int16_t` 或按有符号 16 位发送的字段，对应协议 2 字节槽位

```c
Can_msg_Tx.Data[0] = (uint8_t)((int16_t)(InverterData.Current / 10));
Can_msg_Tx.Data[1] = (uint8_t)(((int16_t)(InverterData.Current / 10)) >> 8);
```

### 8.5 `uint32_t` 字段，对应协议 4 字节槽位

```c
Can_msg_Tx.Data[0] = (uint8_t)(InverterData.FccAll);
Can_msg_Tx.Data[1] = (uint8_t)(InverterData.FccAll >> 8);
Can_msg_Tx.Data[2] = (uint8_t)(InverterData.FccAll >> 16);
Can_msg_Tx.Data[3] = (uint8_t)(InverterData.FccAll >> 24);
```

### 8.6 ASCII / 字符串字段

```c
Can_msg_Tx.Data[0] = 'P';
Can_msg_Tx.Data[1] = 'Y';
Can_msg_Tx.Data[2] = 'L';
Can_msg_Tx.Data[3] = 'O';
Can_msg_Tx.Data[4] = 'N';
Can_msg_Tx.Data[5] = ' ';
Can_msg_Tx.Data[6] = ' ';
Can_msg_Tx.Data[7] = ' ';
```

---

## 9. 标志位：统一使用 BIT 宏，禁止魔法数

```c
if(InverterData.Status1 & 0x05)  wtmp |= BIT1;
if(InverterData.Status1 & (BIT0 | BIT2))  wtmp |= BIT1;
if(InverterData.Status1 & (BIT1 | BIT3))  wtmp |= BIT2;
```

原则：除协议帧 ID 和特殊 `0x` 常量外，位运算统一使用 `BIT` 宏，以协议文档为准。

---

## 10. 标志位函数模板

```c
static uint16_t CanComXxx_CheckProtectFlag(void)
{
    uint16_t wtmp = 0;

    if(InverterData.Status1 & (BIT0 | BIT2))
    {
        wtmp |= BIT1;
    }
    if(InverterData.Status1 & (BIT1 | BIT3))
    {
        wtmp |= BIT2;
    }

    return wtmp;
}
```

---

## 11. 接收中断框架

```c
void CanComXxx_ReceiveIRQ(const CanRxMessage *msg)
{
    if(msg->IDE == CAN_ID_EXT)
    {
        if((msg->ExtId >= 0xXXXXXXX) && (msg->ExtId <= 0xXXXXXXX))
        {
            /* TODO[未实现]: 扩展帧处理 */
        }
    }
    else if(msg->IDE == CAN_ID_STD)
    {
        switch(msg->StdId)
        {
            case 0xXXX:
            {
                break;
            }
            default:
            {
                break;
            }
        }
    }
}
```

---

## 12. 未实现功能标注规范

核心原则：
- 协议文档有定义且条件充分时，按文档实现。
- 协议文档有定义但数据源缺失时，留空并标 `TODO[未实现]`。
- 协议文档没有定义时，不写、不猜、不借鉴其他协议补全。

典型格式：

```c
/* TODO[未实现]: 功能描述
 * 协议来源: 报文 ID + 字段名（或文档章节 / 页码）
 * 原因: 数据源缺失 / 上层接口未提供 / 待确认 / 低优先级
 */
```

---

## 13. 消除编译告警

```c
void CanComXxx_ReceiveIRQ(const CanRxMessage *msg)
{
    (void)msg;
}
```
