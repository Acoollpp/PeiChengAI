# 485 协议移植规则

## 1. 485 协议走统一框架

当前项目的 485 协议不是各自独立运行，而是挂在统一的：
- `Inverter485Protocol/Uart_User485.h`
- `Inverter485Protocol/Uart_User485.c`

所以 485 移植默认不只是加 `Rs485_Xxx.c`。

## 2. 485 协议标准入口

通常至少包含：
- `Rs485_Xxx_Init(uint32_t BaudRate)`
- `Rs485_Xxx_ReceiveIQR(uint8_t Buffer)`
- `Rs485_Xxx_DataRespond(void)`

如果缺这三类入口，先检查是不是用户给的 `.c` 文件还不是当前项目可直接接入的版本。

## 3. `Uart_User485.h` 必查项

新增 485 协议后，通常要补：
- `Init` 声明
- `ReceiveIQR` 声明
- `DataRespond` 声明

如果协议依赖额外公共变量，还要补对应 `extern`。

### 当前项目已存在的特殊项

#### Efore 协议

`Uart_User485.h` 已存在：
- `g_efore_slave_index`

说明：
- Efore 不是普通无状态 485 协议
- 若新协议文件里出现从机索引、轮询子从机、地址切换之类逻辑，必须先判断是否需要公共索引变量

## 4. `Uart_User485.c` 是 485 协议表入口

必须挂入：
- `uart_protocol_call[]`

每个表项至少包含：
- 协议枚举
- 英文名
- 中文名
- 波特率
- `init`
- `receive`
- `respond`

并通过：
- `Ext485_SwitchToProtocol()`
- `User485_DataRespond()`

完成初始化和运行切换。

## 5. 485 共享框架变量不能忽略

当前项目已有共用变量：
- `User485_RxBuffer`
- `User485_TxBuffer`
- `User485_TxCount`
- `User485_TxIndex`
- `User485_RecOK`
- `User485_CrcOK`
- `User485_RegStart`
- `User485_RegLen`
- `User485_ERROR`
- `User485_Reg_Buffer`

说明：
- 很多 485 协议都会直接依赖这些全局框架变量
- 若用户给的新 `.c` 文件使用了这些变量，通常说明它应接入现有统一框架，而不是单独造一套通信层

## 6. 485 特殊逻辑检查清单

遇到新 485 协议时，逐项确认是否存在：
- 寄存器区间常量
- 寄存器初始化函数
- 地址偏移量
- 多段寄存器区
- 专属错误码
- 专属从机索引
- 专属波特率
- CRC 校验流程
- 发送前使能控制
- 响应前初始化寄存器缓存

只要命中多项，就不要按“普通 Modbus 表项”粗暴迁移。

## 7. 典型误区

- 只在 `Bms_Config.h` 加了 485 枚举
- 只补了 `Uart_User485.c` 表项，没补头文件声明
- 漏掉波特率
- 忽略寄存器初始化函数
- 把用户给的 485 `.c` 文件当成可直接运行，没接入 `User485_*` 公共框架
