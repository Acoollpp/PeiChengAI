# 项目结构图

这份参考文档以当前仓库里的 40032 SNMP 实现为主要参照，但目标是服务公司动力组所有同结构项目。

## 核心文件

- 协议定义：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/pace_bms_snmp_protocol.h`
- 协议实现：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/pace_bms_snmp_protocol.c`
- SNMP 分发表：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/snmp_proto.c`
- SNMP 任务入口：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/snmp_task.c`
- 网络层接入：
  `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/Net_Task.c`

## 新增一个 SNMP 项时，通常要改哪些地方

### 1. 头文件

在 `pace_bms_snmp_protocol.h` 里：

- 增加 `#define SNMP_XXX <编号>`
- 更新 `SNMP_BMS_CMD_END`
- 如果是复合参数，增加结构体类型
- 在 `Snmp_Bms_Para_Type` 里增加字段
- 补函数声明

### 2. 协议实现

在 `pace_bms_snmp_protocol.c` 里：

- 实现 `Get_XXX`
- 实现 `String_XXX`
- 可写项实现 `Cut_XXX`
- 可写项实现 `Set_XXX`
- 如果真实变量在其他模块，补对应头文件引用

### 3. 分发表

在 `snmp_proto.c` 里：

- 往 `g_DataProcessMethod[]` 里加一行

典型格式：

```c
{SNMP_XXX, Get_XXX, String_XXX, Cut_XXX, Set_XXX},
```

哪个方向不支持，就填 `NULL`。

## 适合优先复用的现成模式

### 静态只读数据

- `Get_Basic_Data`
- `String_Pack_Vol`

### 复合字符串配置

- `String_Native_IP`
- `Cut_Native_IP`
- `Set_Native_IP`

### 带运行态和持久化的配置项

- `Get_DHCP_Config`
- `String_DHCP_Config`
- `Cut_DHCP_Config`
- `Set_DHCP_Config`

### 保存到电池参数区

- `Set_Open_Limit_Current`

### 保存到系统配置区

- `Set_Native_IP`
- `Set_Trap_Config`

## 持久化怎么找

在写 `Set_XXX` 之前，先搜索同名变量在这些文件里的用法：

- `User/Data_Init.c`
- `User/UartRS232.c`
- `User/UartRS485.c`

通常能从这里看出来：

- 变量平时存在哪里
- 现有代码怎么校验它
- 修改后要不要重启、复位或者触发别的动作

## Trap 相关文件

只有处理通知、告警上送时才看：

- `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/trap/snmp_trap.h`
- `@SST24-0032/SST22-0324-V3.30/SST22-0324-V3.30/NetWork/snmp/trap/snmp_trap.c`

## 最小模板

```c
/* 头文件 */
#define SNMP_XXX 75

typedef struct _Snmp_XXX_Type
{
    uint8_t value;
} Snmp_XXX_Type;

Snmp_Err_Type Get_XXX(Snmp_Bms_Para_Type* pBmsPara);
Snmp_Err_Type String_XXX(uint8_t *buf, uint8_t *pDataType, uint8_t *pDataLen, Snmp_Bms_Para_Type* pBmsPara);
Snmp_Err_Type Cut_XXX(uint8_t *buf, uint8_t dataSize, Snmp_Bms_Para_Type* pBmsPara);
Snmp_Err_Type Set_XXX(Snmp_Bms_Para_Type *pBmsPara);
```

```c
/* 分发表 */
{SNMP_XXX, Get_XXX, String_XXX, Cut_XXX, Set_XXX},
```

```c
/* String 示例 */
dataSize = snprintf((char *)ptr, SNMP_MAX_DATA_SIZE, "%d", pBmsPara->xxx.value);
```

如果对象是复合参数，就把格式改成项目里常用的 `a-b-c` 形式。

## 骨架脚本

如果只是想快速生成可粘贴的 SNMP 代码片段，直接用：

`@snmp-protocol-porting-skill/scripts/generate_snmp_skeleton.py`

它会生成：

- 头文件宏
- 结构体定义
- `Snmp_Bms_Para_Type` 成员
- 函数声明
- `Get/String/Cut/Set` 骨架
- 分发表注册项
- 可选 MIB 对象片段

建议在这些场景优先使用脚本：

- 一次新增多个 SNMP 项
- 还没确定真实运行态变量，但要先搭结构
- 想先产出统一风格的模板，再人工接真实逻辑
