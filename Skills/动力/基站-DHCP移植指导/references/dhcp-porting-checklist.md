# DHCP 移植检查清单

## 使用方式

把本清单当作“落地顺序表”，不要一上来同时改所有文件。
给用户输出时，默认细化到“文件 - 函数 - 位置”，不要停留在模块名级别。

首要判断：

- 先检查项目里是否存在 `dhcp` 文件夹，或等价的 DHCP 模块目录
- 如果没有，先提醒用户“当前工程缺少 DHCP 基础模块，请先补充 `dhcp` 文件夹及相关源码，再继续移植处理”

推荐顺序：

1. 公共头文件和外部变量
2. 网络任务入口
3. W5500 错误恢复限制
4. EEPROM 读写
5. 定时器中断
6. 测试命令入口
7. 联调验证

## 1. Net_Task.c

### 目的

把 DHCP 周期任务接到主网络任务里，在链路有效时执行获取 IP 逻辑。

### 文件 - 函数 - 位置

- 文件：`Net_Task.c`
- 函数：`Net_Task(void)`
- 位置 1：文件头部 include 区，补 `#include "dhcp_task.h"`
- 位置 2：`w5500_Check_Error();` 调用之后、原“未连接网络，不处理网络任务”判断之前
- 位置 3：保留原 `for(sn = 0; sn < SN_NUM; sn++)` 和 `Net_Backend_Task(NULL);` 的原始顺序，不要挪动

### 固定写法

- 添加 `#include "dhcp_task.h"`
- 在 `Net_Task(void)` 中按截图级结构插入 DHCP 分支，不要只写原则描述

```c
#include "dhcp_task.h"

void Net_Task(void)
{
    uint8_t sn = 0;

    /* 定时检查w5500工作状态 */
    if(Timer[NETWORK_TIMEOUT].flag)
    {
        Set_Timer(NETWORK_TIMEOUT, 200);
        w5500_Check_Error();
    }

#ifdef FUN_NET_DHCP
    if(w5500_Config.state.bit.reset == 1 && DHCP_Config.dhcp_enable == 1)
    {
        dhcp_get_ip();
    }
    else
#endif
    {
        /* 未连接网络，不处理网络任务 */
        if(Get_W5500_Link_State() != 1) return;

        for(sn = 0; sn < SN_NUM; sn++)
        {
            switch (Get_W5500_Socket_Protocol(sn))
            {
                case Sn_MR_CLOSE:
                    break;

                case Sn_MR_TCP:
                    TCP_Task(sn, &g_NetBuf);
                    break;

                case Sn_MR_UDP:
                    Udp_Task(sn, &g_NetBuf);
                    break;

                default:
                    break;
            }
        }

        /* 运行后台任务 */
        Net_Backend_Task(NULL);
    }
}
```

### 关注点

- `dhcp_get_ip()` 放在链路检查前
- 如果截图在 `#endif` 后保留独立 `{}`，必须原样保留
- 保持 DHCP 分支和原网络任务分支的互斥控制流
- 不要把 `dhcp_get_ip()` 插进去后又继续无条件执行原 TCP、UDP、后台任务
- 不要为了“整理格式”额外改用户原来的花括号结构，截图怎么写就怎么落

### 需要用户补充的地方

- 如果原工程的 `Net_Task(void)` 控制流和截图差异很大，需要你补这段函数前后对比图，至少包含 `w5500_Check_Error();` 到 `Net_Backend_Task(NULL);` 这一段
- 如果项目不是用 `FUN_NET_DHCP` 作为宏名，需要你补项目里的实际宏开关名称

### 建议检查

- DHCP 未开启时，原网络任务行为不变
- DHCP 开启且链路正常时，能够持续驱动 DHCP 获取流程

## 2. w5500_api.c

### 目的

避免 DHCP 工作期间被通用错误恢复逻辑错误打断。

### 文件 - 函数 - 位置

- 文件：`w5500_api.c`
- 函数：`w5500_Check_Error(void)`
- 位置 1：文件头部 include 区，补 `#include "Net_Task.h"` 和 `#include "dhcp_task.h"`
- 位置 2：保留 `w5500_Check_Chip();` 和 `w5500_Check_Phy();` 后，在原 reset / count / close socket / `w5500_Para_Set()` 逻辑外层包 DHCP 条件

### 步骤

1. 文件/函数 `w5500_api.c` / `w5500_Check_Error(void)`
2. 位置 1：include 区加入 `#include "Net_Task.h"` 和 `#include "dhcp_task.h"`
3. 位置 2：在 `w5500_Check_Chip();` 与 `w5500_Check_Phy();` 之后按截图插入：
   ```c
   #ifdef FUN_NET_DHCP
       if(DHCP_Config.dhcp_enable != 1)
   #endif
       {
           if(w5500_Config.state.bit.reset != 1) return;

           if(reset)
           {
               reset = w5500_RunTime_Reset();
               if(reset == 0) count = 0;
               return;
           }

           if ((count >= 2) && (count < 120))
           {
               count++;
               return;
           }

           for (uint8_t i = 0; i < 8; i++)
           {
               close(i);
           }

           if (w5500_Para_Set() == W5500_OK)
           {
               count = 0;
               w5500_Config.state.bit.reset = 0;
               w5500_Socket_Buf_Init(tx_size, rx_size);
           }
           else if(count++ > 2)
           {
               reset = 1;
           }
       }
   ```
4. 用户已明确要求时，`#endif` 后面的整块 `{}` 必须完整保留，且整块都属于 DHCP 条件控制范围
5. 用户已给截图时，必须按截图原样花括号范围落地，不要改成“逻辑等价”的提前 `return` 写法

### 关注点

- 这里包的是 `#endif` 后面的整块 `{}`
- 不要只包 `reset/count/return` 这一段
- 不要自行增加 `dhcp_state` 限制，除非新需求明确要求
- 保持 reset/count/close/w5500_Para_Set 顺序不变

## 3. w5500_api.h

### 目的

补齐 DHCP 相关外部缓存声明，避免跨文件访问报错。

### 文件 - 函数 - 位置

- 文件：`w5500_api.h`
- 函数：无，属于头文件声明区
- 位置：与现有 `extern` 声明同一区域，放在 `MAX_SOCK_NUM` 可见且风格一致的位置

### 步骤

1. 文件/函数 `w5500_api.h` / 头文件内
2. 位置：`extern` 声明区，按现有风格声名 `tx_size` 和 `rx_size`
3. 仅在 DHCP 模块需要这两个缓冲区时添加声明，避免重复定义，命名和对齐保持与其他声明一致
4. 提示：若项目已有相同名称声明，可用 `#ifdef FUN_NET_DHCP` 保护或引用已存在 symbol

### 关注点

- 只有在 DHCP 模块实际依赖这些缓冲区参数时才补
- 若原工程已在别处声明，避免重复定义

### 需要用户补充的地方

- 如果你手里那份 DHCP 模块还依赖别的外部缓存或结构体，需要补 `dhcp` 模块编译报错信息，避免这里只补 `tx_size/rx_size` 不够

## 4. Data_Init.c

### 目的

把 DHCP 开关存入 EEPROM，并按实际写入顺序读取。

### 文件 - 函数 - 位置

- 文件：`Data_Init.c`
- 函数 1：`WriteSysConf_EEPROM(void)`
- 位置：`trapInfo.destIP` 写入完成后，下一项写入之前
- 函数 2：`ReadSysConf_EEPROM(void)`
- 位置：`trapInfo.destIP` 读取完成后，后续字段读取之前

### WriteSysConf_EEPROM(void)

- 在 `trapInfo.destIP` 写入完成后，追加：`gBuffer[gIndex++] = DHCP_Config.dhcp_enable;`

### ReadSysConf_EEPROM(void)

- 在 `trapInfo.destIP` 读取完成后，追加：`DHCP_Config.dhcp_enable = (uint8_t)EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 156);`
- 若 `DHCP_Config.dhcp_enable != 1`，则强制：`DHCP_Config.dhcp_enable = 0;`

### 关注点

- `Data_Init.c` 这里只按当前工程实际写入顺序处理，不强制套用其他项目的 `+160` 偏移
- 不要在这里额外补 `dhcp_state` 的读写联动说明，除非用户另行提供明确修改图

### 需要用户补充的地方

- 如果你希望把偏移写死成截图值，需要你补当前版本 `WriteSysConf_EEPROM()` 和 `ReadSysConf_EEPROM()` 的字段顺序
- 如果旧版本 EEPROM 兼容性很重要，需要你补地址表或旧版本写入顺序说明

## 5. n32g45x_it.c

### 目的

给 DHCP 状态机提供固定节拍。

### 文件 - 函数 - 位置

- 文件：`n32g45x_it.c`
- 函数：`TIM2_IRQHandler(void)`
- 位置 1：文件头部 include 区，补 `#include "dhcp.h"`
- 位置 2：函数内静态变量声明区，补 `static uint32_t dhcp_timer_5ms_count = 0;`
- 位置 3：`TIM2` 更新中断分支里，`Timer_IQR();` 之前插入 DHCP 节拍逻辑

### 常见动作

- 添加 `#include "dhcp.h"`
- 在 `TIM2_IRQHandler(void)` 中增加：`static uint32_t dhcp_timer_5ms_count = 0;`
- 按用户截图的先后顺序写：先 `dhcp_timer_5ms_count++`，达到 `200` 后调用 `DHCP_time_handler()` 并清零计数器，然后再执行 `TIM2->STS = (uint32_t)~TIM_STS_UDITF;` 和 `Timer_IQR();`

### 常见示意

```c
static uint32_t dhcp_timer_5ms_count = 0;

if((TIM2->STS & TIM_STS_UDITF) != RESET && (TIM2->DINTEN & TIM_DINTEN_UIEN) != RESET)
{
    dhcp_timer_5ms_count++;
    if (dhcp_timer_5ms_count >= 200)
    {
        DHCP_time_handler();
        dhcp_timer_5ms_count = 0;
    }

    TIM2->STS = (uint32_t)~TIM_STS_UDITF;
    Timer_IQR();
}
```

### 关注点

- 这里按用户截图执行，不要自行把 DHCP 计数逻辑挪到 `Timer_IQR()` 之后
- 不要自行额外包 `#ifdef FUN_NET_DHCP`，除非用户明确提供这种写法

### 需要用户补充的地方

- 如果项目定时中断不是 5ms，需要你补当前 `TIM2_IRQHandler(void)` 实际节拍，避免 `200` 这个计数值不成立
- 如果 DHCP 节拍不是挂在 `TIM2`，需要你补实际使用的定时器函数

## 6. 232/485 协议文件

### 目的

给测试模式增加 DHCP 开关和读取命令，方便产测或现场调试。

### 文件 - 函数 - 位置

- 文件：`UartRS485.c`
- 函数：`UartRS485_SendData(uint8_t UartRS485_TxType)`
- 位置：紧跟你提供的 `Backup_Data(); Delay_ms(10); NVIC_SystemReset();` 这段 `else` 逻辑之后、原 `else { Rtn_Code = 0x09; }` 之前
- 说明：详见后续步骤

- 文件：`UartRS232.c` 或项目里的等价 232 文件
- 函数：包含 `case GOTO_TEST_MODE:` 或等价测试命令分支的报文处理函数
- 位置：同样在 `Backup_Data()`/`Delay_ms()`/`NVIC_SystemReset()` 逻辑后插入 DHCP 命令判断，务必与 485 并列而不是替代

### UartRS485.c 固定写法

- 文件头部 include 区补：`#include "dhcp_task.h"`
- 在 `UartRS485_SendData(uint8_t UartRS485_TxType)` 的对应 `else if` 链中，按截图插入下面这段，不要自行改写为 `switch(Command)` 或其他结构

```c
#ifdef FUN_NET_DHCP
else if((Command == 0xD0) && (UartRS485_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
    DHCP_Config.dhcp_enable = 1;
    DHCP_Config.dhcp_state = NETINFO_DHCP;

    EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
    WriteSysConf_EEPROM();
    w5500_Config.state.bit.reset = 1;
}
else if((Command == 0xD1) && (UartRS485_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
    DHCP_Config.dhcp_enable = 0;
    DHCP_Config.dhcp_state = NETINFO_STATIC;

    EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
    WriteSysConf_EEPROM();
    w5500_Config.state.bit.reset = 1;
}
else if((Command == 0xD2) && (UartRS485_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_enable, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_enable, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_state, Temp);
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[0];
    UartRS485_TxBuffer[UartRS485_TxCount++] = Temp[1];
}
#endif
```

### 步骤

1. 文件头 include 区加入 `#include "dhcp_task.h"`（避免重复）
2. 在 `UartRS485_SendData(uint8_t UartRS485_TxType)` 的 `else if` 链中插入三条命令判断：
   - `0xD0`：编码命令、写 `DHCP_Config.dhcp_enable = 1`、`DHCP_Config.dhcp_state = NETINFO_DHCP`，再调用 `EEPROM_ErasePage` + `WriteSysConf_EEPROM()` 并置 `w5500_Config.state.bit.reset = 1`
   - `0xD1`：编码命令、写 `DHCP_Config.dhcp_enable = 0`、`DHCP_Config.dhcp_state = NETINFO_STATIC`，同样刷新 EEPROM 并复位
   - `0xD2`：编码命令后连续向 `UartRS485_TxBuffer` 传三组 `DHCP_Config` 字段（两次 `dhcp_enable`、一次 `dhcp_state`）
3. 所有 `HextoTwoAscii` 调用按现有写缓冲区顺序填充 `UartRS485_TxBuffer`
4. 全部包在 `#ifdef FUN_NET_DHCP` 内，宏关闭时跳过

### 关注点

- 这里固定使用 `0xD0 / 0xD1 / 0xD2`，不要自行改成别的命令码
- 既然当前用户已经明确给了 485 截图，`0xD2` 的返回格式就按图落地，不要自作主张简化
- 不要自行增加“手动设置静态 IP 时顺手关闭 DHCP”这类联动逻辑，除非用户明确要求
- 不要把这一段改成别的花括号风格、`switch(Command)` 风格，或抽函数重构，按截图插入即可

### 需要用户补充的地方

- `UartRS485.c` 这一段当前已有截图，按图执行即可，不再需要补这部分
- 如果 RS232 也要改成截图级固定代码，需要你另补 RS232 对应分支截图，不要默认它与 485 完全同构

### UartRS232.c 固定写法

1. 文件头 include 区补：确保存在 `#include "dhcp_task.h"`
2. 在 `case GOTO_TEST_MODE:` 所在的 `else if/else` 链中插入三条判断，结构与 RS485 保持一致，但变量替换为 `UartRS232_Buffer/UartRS232_TxCount` 和 `UartRS232_InfoLen`
3. 位置：文本给出的 `Backup_Data(); Delay_ms(10); NVIC_SystemReset();` 代码之后、原 `default`/`else` 结束前的命令判断区域，插入 `0xD0/0xD1/0xD2` 分支
4. 包含 `0xD0/0xD1/0xD2` 命令分别处理 `dhcp_enable` 与 `dhcp_state`，执行 EEPROM 写、复位，`0xD2` 输出 `dhcp_enable`、`dhcp_enable`、`dhcp_state`
5. 整段包在 `#ifdef FUN_NET_DHCP` 内，宏关闭时跨过

- 文件头部 include 区补：`#include "dhcp_task.h"`
- 在 `case GOTO_TEST_MODE:` 对应分支内，插入下面这段 DHCP 命令流程，保持 `else if` 链结构，不要改成其他控制流

```c
#ifdef FUN_NET_DHCP
else if((Command == 0xD0) && (UartRS232_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
    DHCP_Config.dhcp_enable = 1;
    DHCP_Config.dhcp_state = NETINFO_DHCP;

    EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
    WriteSysConf_EEPROM();
    w5500_Config.state.bit.reset = 1;
}
else if((Command == 0xD1) && (UartRS232_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
    DHCP_Config.dhcp_enable = 0;
    DHCP_Config.dhcp_state = NETINFO_STATIC;

    EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
    WriteSysConf_EEPROM();
    w5500_Config.state.bit.reset = 1;
}
else if((Command == 0xD2) && (UartRS232_InfoLen == 2))
{
    HextoTwoAscii(Command, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_enable, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_enable, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
    HextoTwoAscii(DHCP_Config.dhcp_state, Temp);
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[0];
    UartRS232_Buffer[UartRS232_TxCount++] = Temp[1];
}
#endif
```

- `UartRS232.c` 的当前 `case GOTO_TEST_MODE:` 代码截图足以，除了 485 之外只要这一段更改就可按图完成

## 7. 联调核查项

完成移植后，至少逐项核对：

- 编译是否通过
- DHCP 关闭时是否仍走静态 IP
- DHCP 开启后是否能进入 DHCP 获取流程
- 拔网线、插网线后状态机是否异常
- 复位后是否保留上次 DHCP 开关配置
- 串口测试命令是否能正确读回状态

## 8. 回复用户时的建议模板

可以按下面格式给出结果：

1. 已在 `Net_Task.c` 接入 DHCP 周期任务。
2. 已在 `w5500_api.c` 增加 DHCP 条件限制，避免错误恢复误触发。
3. 已在 `Data_Init.c` 增加 `dhcp_enable` 的 EEPROM 存取与非法值兜底。
4. 已在定时器中断中接入 `DHCP_time_handler()`。
5. 已在测试命令路径增加 DHCP 开关/读取命令。
6. 当前剩余风险是 EEPROM 地址偏移是否与旧版本兼容，需要结合实际地址表复核。


