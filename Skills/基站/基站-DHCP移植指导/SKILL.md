---
name: 基站-DHCP移植指导
description: 用于在基于 W5500 的嵌入式网络工程中移植 DHCP 功能，指导 Codex 按文件和函数完成 DHCP 任务接入、定时驱动、开关存储、测试命令和异常限制逻辑。适用于用户提供 DHCP 移植文档、差异截图、目标工程源码，或提出“移植 DHCP”“接入 DHCP 开关”“补齐 EEPROM 存储”“加入串口测试命令”“排查 DHCP 不生效”等需求时。
---

# W5500 DHCP 移植

## 概述

按“先识别工程骨架，再对照移植点补代码，最后核对行为”的方式执行。
优先把用户提供的截图、文档、差异说明整理成明确的文件级任务，再进入代码修改。
需要详细移植位点时，读取 `references/dhcp-porting-checklist.md`。

## 快速判断

第一优先级先检查项目里是否存在 `dhcp` 文件夹，或等价的 DHCP 模块目录。
如果没有，先明确提醒用户“当前工程缺少 DHCP 基础模块，请先补充 `dhcp` 文件夹及相关源码，再继续做移植接入”，不要直接假设只改 1 到 2 个业务文件就能完成。

再确认目标工程是否已经具备 DHCP 基础模块。如下列文件或符号已明显存在，优先按“接入现有 DHCP 模块”处理，而不是重写协议：

- `dhcp.h`
- `dhcp_task.h`
- `dhcp_get_ip()`
- `DHCP_time_handler()`
- `DHCP_Config`
- `NETINFO_DHCP`
- `NETINFO_STATIC`

如果这些对象大多缺失，要向用户说明当前工作更接近“补齐 DHCP 模块 + 做移植接入”。

## 工作流

### 1. 先提取用户给出的固定写法

从用户提供的截图、补丁、逐行改法、左/右对比图中提取：

- 文件名
- 函数名
- 新增头文件
- 新增宏条件
- 新增全局变量或结构字段
- EEPROM 存储地址或写入顺序
- 调试命令或测试入口

如果用户给的是截图级差异，就先整理成“文件 -> 函数 -> 固定写法”的列表，再开始改代码。

如果用户给出了明确截图、补丁或控制流要求，必须严格按用户提供的结构落地，不要自行改写判断顺序、提前 `return`、合并分支，或改成“功能类似但控制流不同”的写法。

严禁自行补入用户未提供、当前工程未出现、或现有上下文无法证明存在的新代码、新字段、新状态位、新控制流。若找不到明确修改点、无法确认花括号范围、缺少截图锚点，或现有代码与截图对不上，必须先向用户反馈缺口，点名说明缺少哪个文件、函数、插入位置或上下文，不能凭经验猜测后直接改。
对本 skill 的本次明确补充如下：
- 只允许修改本 skill 已明确列出、或用户在本次任务中明确指定需要修改的文件；对其他未在本 skill 中列出且未获用户明确授权的文件，只能提出需要如何修改的建议，不允许自行补充修改。
- 用户已明确纠正过的固定写法必须作为后续同类修改的最高优先级约束，后续同文件或同模式修改必须优先复用，不得再次改回“逻辑等价”写法。
- 在 `Net_Task.c` 这类 `#ifdef ... else ... #endif` 结构中，如果用户明确保留 `#endif` 后面的独立 `{}`，严禁擅自删除、合并或改写这一对花括号。
- 在 `w5500_Check_Error(void)` 这类截图级修改里，必须严格按用户最后确认的花括号范围包裹原逻辑；如果用户明确要求 `#endif` 后面的整块 `{}` 都属于条件控制范围，就必须把 `reset/count/return`、`close socket`、`w5500_Para_Set()`、`w5500_Socket_Buf_Init()` 全部包在这一块里。
- 如果已经根据截图改过一次，后续修正时必须先对照用户最近一次确认的正确版本，不能根据自己的理解重新组织控制流。

### 2. 扫描工程实际落点

优先搜索并打开这些文件：

- `Net_Task.c`
- `w5500_api.c`
- `w5500_api.h`
- `Data_Init.c`
- `n32g45x_it.c`
- `UartRS232.c`
- `UartRS485.c`

同时搜索这些关键点：

- `Net_Task`
- `w5500_Check_Error`
- `WriteSysConf_EEPROM`
- `ReadSysConf_EEPROM`
- `TIM2_IRQHandler`
- `GOTO_TEST_MODE`

如果文件名不完全一致，按“功能等价”原则找对应实现文件，不要被命名差异卡住。用具体文件名（如 `UartRS232.c`、`UartRS485.c`）代替“232 或 485 协议处理文件”，避免识别错位。

### 3. 输出时必须细化到“文件 - 函数 - 位置”

默认不要只写“改 Net_Task.c”或“改 EEPROM 逻辑”这种模块级描述。
只要进入落地说明，就要尽量细化成下面这种粒度：

1. 文件：例如 `Net_Task.c`
2. 函数：例如 `Net_Task(void)`
3. 位置：例如“函数头部 include 区”“定时检查 `w5500_Check_Error()` 后面”“`trapInfo.destIP` 写入完成后”“`case GOTO_TEST_MODE:` 分支内”
4. 固定改法：能给代码块就给代码块，不能给完整代码时也要给到插入点前后锚点
5. 信息缺口：如果这里还缺用户截图、差异图、地址表、命令格式，就明确写“这一处需要用户补什么”

### 4. 按模块顺序移植

使用下列顺序，避免先加局部逻辑、后补底层依赖，导致编译或运行行为混乱：

1. 头文件与全局声明
2. DHCP 任务接入
3. 错误恢复条件限制
4. EEPROM 存储与读取
5. 定时器驱动
6. 测试命令接入
7. 编译开关与状态联动

详细改动项见 `references/dhcp-porting-checklist.md`。

### 5. Net_Task.c 必须按截图级固定写法处理

当用户提供的截图明确要求在 `Net_Task(void)` 中加入 DHCP 分支时，默认按下面这类固定结构执行，而不是只写“原则描述”：

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

这里的关注点：

- `#include "dhcp_task.h"` 要明确写出
- `dhcp_get_ip()` 放在链路检查前
- `else` 后如果用户截图保留了独立 `{}`，就必须原样保留这对花括号
- 保持 DHCP 分支和原网络任务分支的互斥控制流
- 不要把 `dhcp_get_ip()` 插进去后又继续无条件执行原 TCP、UDP、后台任务
- 不要为了“整理结构”额外改用户原来的花括号写法；如果截图和现有工程保留了 `#endif` 后的独立 `{}`，就按原样落地

### 6. 对信息不足的地方，必须主动向用户点名索要

如果某一处没有足够信息支撑“截图级固定写法”，不要泛泛地说“请补充更多资料”，而要直接点名缺口属于哪一类：

- 缺函数内插入位置：请补该函数前后对比截图，或给出插入点上下 20 到 40 行代码
- 缺 EEPROM 地址：请补当前版本地址表，或 `WriteSysConf_EEPROM()` / `ReadSysConf_EEPROM()` 对应字段顺序
- 缺串口命令结构：请补 `case GOTO_TEST_MODE:` 当前分支截图，尤其是 `InfoLen`、回包格式、写 EEPROM 位置
- 缺宏包裹方式：请补项目里相邻功能的 `#ifdef` 用法截图
- 缺 dhcp 基础模块：请先补 `dhcp` 文件夹、`dhcp.h`、`dhcp_task.h` 及相关源码

如果用户已经给了某个文件的明确截图，例如 `UartRS485.c` 的 DHCP 命令分支，就直接把该文件写成固定代码，不再重复向用户索要同一处信息。

### 7. 保持宏包裹一致

如果工程已有网络特性开关，优先沿用现有风格，例如：

```c
#ifdef FUN_NET_DHCP
/* DHCP 相关逻辑 */
#endif
```

不要把 DHCP 逻辑裸露地插入所有路径。优先保证：

- 关闭宏时可编译
- 关闭 DHCP 开关时行为回退到静态 IP
- 上电读取配置后状态一致

### 8. 修改后立刻做三类校验

至少完成以下检查：

- 编译层：头文件、外部变量、函数声明是否一致
- 状态层：`dhcp_enable`、`dhcp_state`、链路状态、复位状态是否互相兼容
- 存储层：写入顺序和读取顺序是否严格对应

如果用户没有要求你真的编译，也要在回复里明确说明“已做静态检查，未实际编译验证”。

## 输出要求

给用户的结果尽量按以下结构组织：

1. 已识别的工程改动位
2. 实际修改的文件和目的
3. 需要用户确认的风险点
4. 已完成的验证
5. 未验证项

如果遇到移植资料不完整，优先说明“缺少什么信息会影响哪一步”，不要停在泛泛而谈。

给用户列“待补充信息”时，优先按文件分组，例如：

1. `Data_Init.c`
   需要补 `trapInfo.destIP` 后面的实际字段顺序，确认 `dhcp_enable` 偏移
2. `UartRS232.c`
   如果要同步 232 口逻辑，仍需要补 `case GOTO_TEST_MODE:` 的当前命令分支截图

## 常见风险

- `WriteSysConf_EEPROM()` 与 `ReadSysConf_EEPROM()` 字段顺序不一致
- `dhcp_enable` 即使放在 `ReadSysConf_EEPROM()` 最后读取，地址也必须按实际写入顺序推导，不能凭感觉改偏移
- DHCP 开启后仍被错误恢复逻辑强制复位回静态网络
- 定时器中断频率与 `DHCP_time_handler()` 期望周期不匹配
- 测试命令只改了开关，没有同步 `dhcp_state`
- `dhcp_enable` 新增后未做默认值兜底，导致旧 EEPROM 数据异常

## 参考资料

需要文件级修改说明时，读取：

- `references/dhcp-porting-checklist.md`




