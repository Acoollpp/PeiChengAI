---
name: 基站-snmp协议移植
description: 用于公司动力组同结构固件项目中的 SNMP 协议移植、扩展和接入。适用于新增 SNMP OID、把 MIB 对象接到固件代码、迁移现有 SNMP 协议到新项目、分析 SNMP GET/SET/trap 需要改哪些文件和函数，以及自动生成 Get/String/Cut/Set 骨架等场景。
---

# SNMP 协议移植技能

当用户要做下面这些事时，使用这个技能：

- 在动力组任意同结构项目里新增一个 SNMP 参数
- 把现有 SNMP 协议移植到另一个固件项目
- 把 `.mib` 里的对象接到固件 `Get/String/Cut/Set`
- 分析某个 SNMP 协议项到底要改哪些文件
- 增加或调整 trap 相关逻辑
- 自动生成 `Get/String/Cut/Set`、结构体、分发表骨架

这个技能面向公司动力组里一批目录结构和代码风格相近的项目。当前仓库中的参考实现路径是：
`@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30`

## 这个技能解决什么问题

- 新增一个 SNMP 命令号并接入现有协议栈
- 把 MIB 里的对象补到固件代码里
- 移植整个 SNMP 模块时，快速找到必改点
- 按当前项目已有风格生成 `Get/String/Cut/Set` 骨架
- 判断某个配置项的运行态、持久化和副作用应该接到哪里
- 用脚本快速生成可粘贴的 SNMP 代码片段

## 先看这些文件

开始动手前，先检查目标项目里 SNMP 的主接入点。多数动力组项目都能从这些文件名或近似文件名找到对应位置：

- 协议命令定义、参数容器：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/pace_bms_snmp_protocol.h`
- 协议实现：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/pace_bms_snmp_protocol.c`
- SNMP 分发表、OID 路由：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/snmp_proto.c`
- SNMP 任务入口：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/snmp_task.c`
- 网络任务集成点：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/Net_Task.c`

如果用户还提到了 MIB 或协议文档，再额外看：

- 当前 MIB 示例：
  `@PACE-BATTERY-MIB-V1.13.mib`
- MIB 风格总结：
  `@protocol-doc-to-mib/references/mib-style.md`

如果需要快速确认项目结构、常见改动点、最小移植模板，再读：
`@snmp-protocol-porting-skill/references/project-map.md`

如果用户明确要“生成骨架代码”或“先给模板再填真实变量”，优先使用脚本：
`@snmp-protocol-porting-skill/scripts/generate_snmp_skeleton.py`


## 工作流程

### 1. 先判断任务类型

先把任务归类成下面几种之一：

- 在当前项目里新增一个 SNMP 项
- 把整个 SNMP 协议迁移到另一个项目
- 把新的 MIB 对象接到已有固件变量
- 增加或修改 trap

如果用户只给了协议截图、Word/PDF、MIB 参数，没有明确说范围，默认按“新增一个 SNMP 项”处理。

如果用户只要代码骨架、模板、样板函数，优先直接运行脚本生成，再按项目实际变量微调。

### 2. 顺着一条完整链路往下查

每个 SNMP 项都按下面这条链去找，不能只改一半：

1. `pace_bms_snmp_protocol.h` 里的命令宏
2. `Snmp_Bms_Para_Type` 里的参数字段
3. `pace_bms_snmp_protocol.h` 里的函数声明
4. `pace_bms_snmp_protocol.c` 里的 `Get/String/Cut/Set`
5. `snmp_proto.c` 里的 `g_DataProcessMethod[]`
6. 真实运行态变量、配置变量或存储逻辑
7. 如果用户要求维护 MIB，再同步改 `.mib`

不要只补 MIB，不要只补函数骨架。只要分发表没挂上，就不算接通。

### 3. 根据对象类型选择处理模式

按下面规则处理：

- 只读项：
  做 `Get + String`
- 可写项：
  做 `Get + String + Cut + Set`
- 复合 `OCTET STRING`：
  按项目现有风格，用 `-` 拼接多个字段
- 网络/系统配置项：
  不只要改缓存结构，还要看运行态变量、存储和是否触发重置

优先复用当前项目现有写法，不要自己新造一套格式。

### 3.1 需要快速出骨架时，用脚本生成

脚本位置：
`@snmp-protocol-porting-skill/scripts/generate_snmp_skeleton.py`

适用场景：

- 用户要先看模板
- 新增项较多，需要统一生成骨架
- 还没完全确认真实变量，但已经能确定对象名、命令号、读写属性、字段格式

脚本输出内容包括：

- 头文件宏、结构体、成员、函数声明
- `Get/String/Cut/Set` 函数骨架
- `g_DataProcessMethod[]` 注册项
- 可选的 MIB 对象片段

默认策略：

- `read-only` 生成 `Get + String`
- `read-write` 生成 `Get + String + Cut + Set`
- 复合对象按 `-` 拼接
- 标量对象按单值 `snprintf`

### 4. 优先照着最近的现成实现抄

新增 SNMP 项时，优先找最像的现成对象照着接：

- IP 类配置：
  `Get_Native_IP`、`String_Native_IP`、`Cut_Native_IP`、`Set_Native_IP`
- 存储时间间隔：
  `Get_Storage_Save_Interval`、`Set_Storage_Save_Interval`
- 限流配置：
  `Get_Open_Limit_Current`、`String_Open_Limit_Current`、`Cut_Open_Limit_Current`、`Set_Open_Limit_Current`
- DHCP 配置：
  `Get_DHCP_Config`、`String_DHCP_Config`、`Cut_DHCP_Config`、`Set_DHCP_Config`

如果是“移植到新项目”，先移植一组完整的现成模式，再按新项目变量去替换。

### 5. 一定要找到真实数据源

新增一个 SNMP 项之前，先确认它背后到底接哪类数据：

- 运行态状态量
- 配置结构体
- EEPROM/Flash 持久化数据
- 串口命令或其他模块已经在用的同一变量

如果协议文档里有这个参数，但固件里还没有真实变量，就先把 SNMP 接口骨架补齐，并明确留一个有指向性的 `TODO`，不要伪造最终逻辑。

### 6. trap 单独处理

trap 不是普通 GET/SET 链路的一部分。只有用户明确提到告警、通知、Trap OID 时，才去看：

- `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/trap/snmp_trap.h`
- `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/trap/snmp_trap.c`

不要把 trap 修改混进普通参数移植里。

## 编辑要求

- 遇到老式 ANSI/GBK 编码的 `.h/.c` 文件时，先确认编码，再决定编辑方式；不要把它们当 UTF-8 文件直接做补丁
- 对含大量中文注释的 C 头文件，避免做“局部插一行再补一行”的碎片式修改；优先一次性重写完整局部块（宏区、结构体区、声明区）
- 如果必须用文本替换而不是语法感知补丁，替换后立刻逐行复查换行、`//` 注释边界、重复宏、重复成员、重复 `typedef`
- 头文件里一旦出现“新代码紧跟在注释后面”的情况，要优先怀疑换行丢失导致后半段落入注释，而不是默认认为代码已经生效
- 对网络配置类复合 `OCTET STRING`，`Cut` 和 `Set` 要明确区分“输入字段”和“最终生效字段”；能校验范围就校验，能在 `Set` 中回写归一化结果就回写
- 保持当前项目的命名方式和函数风格
- 默认沿用已有的 `Get/String/Cut/Set` 组织方式
- 新增命令号时保持递增，并同步更新 `SNMP_BMS_CMD_END`
- 需要在协议内中转的参数，必须补进 `Snmp_Bms_Para_Type`
- 遇到网络配置项时，检查是否需要 `w5500_Config.state.bit.reset = 1`
- 遇到持久化配置项时，优先复用已有保存函数，不要新造存储流程

## 最小检查清单

- 新增一个 SNMP 项后，如果改过老式编码头文件，额外逐行检查宏区、结构体区、声明区没有注释吞代码、重复定义、重复成员
新增一个 SNMP 项后，至少确认这些都完成了：

- `SNMP_XXX` 宏已新增
- `SNMP_BMS_CMD_END` 已覆盖
- `Snmp_Bms_Para_Type` 里有对应字段
- 头文件里有函数声明
- `Get/String/Cut/Set` 已按需要实现
- `g_DataProcessMethod[]` 已注册
- 背后运行态变量接通了
- 如果要持久化，已接到原项目的存储路径
- 如果用户要求，MIB 已同步更新

## 输出要求

使用这个技能时，优先输出：

- 实际代码修改，不只做口头分析
- 简短说明这次接通了哪一段链路
- 关键修改点的精确文件引用
- 剩余风险，比如数据源还没落地、持久化行为待确认、trap 未处理

## 什么时候读参考文件

当你需要以下内容时，再去读参考文档：

- 这个项目里 SNMP 的主要文件地图
- 新增一个 SNMP 项时常见改动点
- 用于快速套用的简版代码模板

参考文件：
`@snmp-protocol-porting-skill/references/project-map.md`

## 脚本使用说明

如果要生成骨架，运行：

```powershell
python @snmp-protocol-porting-skill/scripts/generate_snmp_skeleton.py --name DHCPConfig --func-base DHCP_Config --mib-name DHCPConfig --cmd-macro SNMP_DHCP_CONFIG --cmd-id 75 --member DHCPConfig --struct Snmp_DHCP_Config_Type --access read-write --fields "enable:uint8_t,state:uint8_t" --format "%d-%d" --exprs "pBmsPara->DHCPConfig.enable,pBmsPara->DHCPConfig.state" --mib-description "DHCP configuration, format: function-status"
```

字段说明：

- `--name`：对象基名，会生成 `Get_XXX`、`String_XXX`
- `--cmd-macro`：命令宏名
- `--cmd-id`：命令号
- `--member`：`Snmp_Bms_Para_Type` 里的成员名
- `--struct`：结构体类型名
- `--func-base`：函数基名，例如 `DHCP_Config`，会生成 `Get_DHCP_Config`
- `--mib-name`：MIB 对象名，例如 `DHCPConfig`
- `--access`：`read-only` 或 `read-write`
- `--fields`：结构体字段，格式 `name:type,name:type`
- `--format`：`String_XXX` 的 `snprintf` 格式
- `--exprs`：与 `format` 对应的表达式列表
- `--mib-description`：可选，生成 MIB 片段时使用

脚本默认只生成代码片段，不直接改项目文件。除非用户明确要求自动写入，否则保持这种方式。


