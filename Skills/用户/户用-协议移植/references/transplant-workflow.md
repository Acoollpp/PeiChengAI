# 协议移植工作流

## 第一步：把“移植”拆成两半

任何协议移植都至少包含两部分：

1. 协议实现本体
2. 当前工程正式挂接

不要把“已经有了一个新 `.c` 文件”误判为“移植完成”。

## 第二步：先识别它属于 CAN 还是 485

### 如果是 CAN

优先检查：
- 文件名是否应落在 `InverterCANProtocol/`
- 是否具备 `Init / MainCall / ReceiveIRQ`
- 是否要补 `CAN_Comm.h`
- 是否要补 `can_Comm.c` 的 `protocol_call[]`

并立即记录：
- `Init/MainCall/ReceiveIRQ` 的真实函数名
- 是否已有同品牌、同命名风格的正式协议可直接对照
- `ReceiveIRQ` 是空壳、轻解析还是核心应答入口

### 如果是 485

优先检查：
- 文件名是否应落在 `Inverter485Protocol/`
- 是否具备 `Init / ReceiveIQR / DataRespond`
- 是否要补 `Uart_User485.h`
- 是否要补 `Uart_User485.c` 的 `uart_protocol_call[]`

并立即记录：
- 是否直接使用 `User485_RxBuffer`、`User485_TxBuffer`、`User485_Reg_Buffer`
- 是否存在寄存器初始化函数
- 是否有从机索引、地址切换、CRC 失败分支、寄存器分段响应

## 第三步：先判断有没有附加逻辑

以下任一命中，都按“带附加逻辑协议”处理：
- 文件里引用了项目没有现成声明的全局变量
- 文件里依赖协议私有结构体、联合体、控制位
- 文件里需要专属心跳、通讯中断、超时或从机索引
- 文件里要求额外定时器、寄存器区间、寄存器缓存初始化
- 文件里不只一个标准入口函数，还依赖额外辅助接口

这一步必须先做，否则低级模型最容易漏掉头文件和公共状态。

### 这一步的输出格式必须固定

对每一个命中的附加逻辑，必须写成：
- 触发证据：新 `.c` 文件中看到的函数名、变量名或行为
- 影响文件：因此必须补改的正式挂接点
- 参考协议：当前工程里优先对照的已挂接实现
- 处理结论：已确认需要补，或仍待用户确认

不要只写“可能有特殊逻辑”。

## 第四步：完成正式挂接

### CAN 挂接最少项

- 新 `.c` 进入 `InverterCANProtocol/`
- `User/Bms_Config.h` 追加新 CAN 枚举
- `InverterCANProtocol/CAN_Comm.h` 追加函数声明
- 如果需要协议私有全局结构，也在 `CAN_Comm.h` 声明
- `InverterCANProtocol/can_Comm.c` 追加 `protocol_call[]`
- `EWARM/*.ewp`、`EWARM/*.ewt` 加入源文件

### CAN 具体怎么改

#### 1. `User/Bms_Config.h`

- 只允许在对应 CAN 枚举组尾部追加，不要改已有枚举值顺序
- 追加后必须复核 `TOTAL_CAN` 仍然作为尾项存在
- 除非用户明确要求调整默认协议，否则不要改 `PROROCOL_CAN_DEFAULT`

#### 2. `InverterCANProtocol/CAN_Comm.h`

- 至少补 3 组声明：`Init`、`MainCall`、`ReceiveIRQ`
- 若新协议没有接收逻辑，`ReceiveIRQ` 可以不声明为表项回调，但要先确认该 `.c` 是否真的没有公开接收入口
- 若新协议文件尾部定义了协议公共实例或共享结构，必须把对应 `typedef` / `extern` 同步补到这里
- 参考顺序：
  - 普通骨架优先对照 Pylon 或已挂接的同品牌协议
  - 带心跳/断连状态优先对照 Growatt
  - 带控制联合体/反馈数据优先对照 Kstar

#### 3. `InverterCANProtocol/can_Comm.c`

- 必须进入 `protocol_call[]`
- 表项至少补全：协议枚举、英文名、中文名、波特率、`init`、`recv`、`func`
- 波特率优先参考同品牌已挂接协议；没有同品牌时才看用户新文件中的显式设置
- 如果新协议属于“只发送不接收”，`recv` 可为 `NULL`，但必须先有代码证据
- 不要把被注释的历史表项当成已启用事实，只能当作结构参考

#### 4. `EWARM/*.ewp`、`EWARM/*.ewt`

- 新文件进入正式目录后，要同步检查工程文件是否已收录
- 若 skill 处于分析模式且暂未改工程文件，也要明确写出“还缺工程文件挂接”

### 485 挂接最少项

- 新 `.c` 进入 `Inverter485Protocol/`
- `User/Bms_Config.h` 追加新 485 枚举
- `Inverter485Protocol/Uart_User485.h` 追加函数声明
- 若依赖额外框架变量，也在这里补声明
- `Inverter485Protocol/Uart_User485.c` 追加 `uart_protocol_call[]`
- `EWARM/*.ewp`、`EWARM/*.ewt` 加入源文件

### 485 具体怎么改

#### 1. `User/Bms_Config.h`

- 只允许在 485 枚举组尾部追加，不要重排已有值
- 追加后复核 `TOTAL_485` 仍为尾项
- 除非用户明确要求切默认协议，否则不要改 `PROROCOL_485_DEFAULT`

#### 2. `Inverter485Protocol/Uart_User485.h`

- 必须分三段补声明：`Init`、`DataRespond`、`ReceiveIQR`
- 若新协议依赖公共索引或共享框架变量，`extern` 必须一并补齐
- 如果看到新协议依赖 `g_efore_slave_index` 这类专属索引模式，就要先确认是否需要新增统一框架变量，而不是把变量留在 `.c` 内自说自话

#### 3. `Inverter485Protocol/Uart_User485.c`

- 必须进入 `uart_protocol_call[]`
- 表项至少补全：协议枚举、英文名、中文名、波特率、`init`、`receive`、`respond`
- 表项挂进去后，还要复核协议切换是否经过 `Ext485_SwitchToProtocol()`，运行发送是否经过 `User485_DataRespond()`
- 若文件用了统一 `User485_*` 缓冲区，就不要额外新增一套串口状态机

#### 4. `EWARM/*.ewp`、`EWARM/*.ewt`

- 与 CAN 相同，正式移植必须补工程文件收录
- 不能因为 `.c` 已存在于仓库，就默认工程已启用

## 第五步：检查配置链路

协议号最终会经过：
- `userCfg.can` / `userCfg.pro_485`
- `Inverter_CanProtocol` / `Inverter_485Protocol`
- `Can_SwitchToProtocol()` / `Ext485_SwitchToProtocol()`

如果协议能编译但切换不到，优先检查这里，而不是怀疑业务逻辑。

### 配置链路怎么判定

- 如果协议表已挂入，但运行时仍走旧协议，先查 `userCfg.can` / `userCfg.pro_485`
- 如果配置值正确，但切换函数回落到表首项，优先怀疑枚举值与协议表不匹配
- 如果新协议只在文件里存在、协议表里不存在，那么切换链路问题不是业务逻辑，而是挂接未完成

## 第六步：检查外部可见性

若用户需要协议可被查询、切换、上报或显示，再检查：
- `User/UartRS485.c`
- `User/UartRS232.c`
- `User/Lcd_Comm.c`
- `User/4G/UartGPRS.c`
- `User/hlk/src/hlk_link_data.c`

只有用户明确要求“可被串口/LCD/4G/上位机切换、显示、上报”时，才把这些文件列为必改项；否则只作为影响面检查，不要无依据扩写。

## 第七步：交付前强制复核

必须明确回答：
- 这个协议是 CAN 还是 485
- 是否只改了 `.c` 文件
- 是否还补了枚举、协议表、头文件声明
- 是否存在附加参数或特殊逻辑
- 是否存在未补齐的公共变量或控制位

并追加一张“参考来源表”：
- `User/Bms_Config.h` 参考谁
- 协议头文件声明参考谁
- 协议表项参考谁
- 特殊公共结构或共享变量参考谁

如果答不出这张表，说明仍然停留在泛化判断。
