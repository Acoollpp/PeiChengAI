# checkList49

- 状态: 已添加
- 对应项: 49
- 意图: 修复 `Volt_Register_Data_Updata(void)` 中 485 寄存器扩展信息缺失的问题，按用户给出的“修改前/修改后”代码补齐单体告警、温度告警与 `Pack_Cells_Num` 映射
- 精确目标文件: `Inverter485Protocol/rs485_Voltronic.c`

## 规则目标

按用户提供的“修改前 / 修改后”代码执行，最终行为应满足：

1. `Volt_Register_Data_Updata(void)` 开头在 `uint8_t i=0;` 后新增两个局部变量：`uint16_t Ttemp = 0;`、`uint16_t Vtemp = 0;`
2. `User485_Reg_Buffer[63]` 的来源从 `InverterData.PackNum` 改为 `Pack_Cells_Num`
3. 在 `#endif` 之后补充单体电压告警打包逻辑，写入 `User485_Reg_Buffer[64]` 到 `User485_Reg_Buffer[73]`
4. 补充温度数量与温度告警打包逻辑，写入 `User485_Reg_Buffer[79]` 以及 `User485_Reg_Buffer[80]` 到 `User485_Reg_Buffer[84]`
5. 末尾原有 `User485_Reg_Buffer[95]` 的总压过压判断逻辑保持不变，不要因为新增中段逻辑而顺手改动

## 精确索引

- 文件: `Inverter485Protocol/rs485_Voltronic.c`
- 函数: `static void Volt_Register_Data_Updata(void)`
- 位置特征:
  - 函数开头已有 `uint8_t i=0;`
  - 中段已有：
    - `User485_Reg_Buffer[51]`
    - `User485_Reg_Buffer[52]`
    - `#if 1`
    - `User485_Reg_Buffer[53]` 到 `User485_Reg_Buffer[63]`
    - `#endif`
  - 函数后段已有以 `if((InverterData.Warning1&BIT2) || (InverterData.Status1&BIT2) )` 开头的 `User485_Reg_Buffer[95]` 判断

## 用户提供的修改方案

后续若执行此项修复，只按下面这组精确规则处理 `Volt_Register_Data_Updata(void)`：

### 1. 在函数开头新增临时变量

在：

```c
uint8_t i=0;
```

之后新增：

```c
uint16_t Ttemp = 0;
uint16_t Vtemp = 0;
```

这两个变量用于后续电压、温度状态打包，不要改成其他类型，也不要挪到循环内部。

### 2. 保留容量相关寄存器逻辑，仅去掉旧注释差异

以下两行仍保留现有计算语义：

```c
User485_Reg_Buffer[51] = (uint16_t)((uint32_t)InverterData.FccAll*10>>16 &0xFFFF);
User485_Reg_Buffer[52] = (uint16_t)(InverterData.FccAll*10 &0xFFFF);
```

用户给出的“修改后”里只是去掉了 `//满充容量` 注释，不要求为了此项额外清理其他注释。

### 3. 将 `User485_Reg_Buffer[63]` 改为 `Pack_Cells_Num`

在 `#if 1` 代码段内，把：

```c
User485_Reg_Buffer[63] = InverterData.PackNum;
```

改为：

```c
User485_Reg_Buffer[63] = Pack_Cells_Num;
```

只改这一条寄存器来源，不扩展修改 `User485_Reg_Buffer[53]`。

### 4. 在 `#endif` 后新增单体电压状态打包逻辑

按用户“修改后”版本，在 `#endif` 之后新增以下结构：

```c
for(i = 0; i < 10; i++ )
{
    Vtemp = 0;
    
    if(2*i < Pack_Cells_Num)
    {
        if( PackData[0].Vol[2*i] <= WarningPara.LowBatVol )
        {
            Vtemp = 0x0100;
        }
        else if( PackData[0].Vol[2*i] >= WarningPara.HighBatVol )
        {
            Vtemp = 0x0200;
        }
        else
        {
            Vtemp = 0x0000;
        }
    }
    else
    {
        Vtemp = 0x00;
    }

    if((2*i + 1) < Pack_Cells_Num )
    {
        if( PackData[0].Vol[2*i + 1] <= WarningPara.LowBatVol )
        {
            Vtemp |= 0x01;
        }
        else if( PackData[0].Vol[2*i + 1] >= WarningPara.HighBatVol )
        {
            Vtemp |= 0x02;
        }
        else
        {
            Vtemp |= 0x00;
        }
    }
    else
    {
        Vtemp |= 0x00;
    }
                 
    User485_Reg_Buffer[64 + i] = Vtemp;
}
```

这段逻辑必须按“两个单体电压合并到一个寄存器”的方式写入 `64 + i`，不能改成其他起始地址。

### 5. 新增温度数量和温度状态打包逻辑

紧接在电压打包逻辑之后新增：

```c
User485_Reg_Buffer[79] = Pack_Temps_Num;
```

然后新增 5 组温度状态打包循环，把结果写入 `User485_Reg_Buffer[80 + i]`。其语义必须与用户给出的“修改后”一致：

- 当 `Im_Avg < 0` 时，前面的电芯温度按放电阈值：
  - `WarningPara.LowDischargeBatTemp`
  - `WarningPara.HighDischargeBatTemp`
- 否则前面的电芯温度按充电阈值：
  - `WarningPara.LowChargeBatTemp`
  - `WarningPara.HighChargeBatTemp`
- 末尾两个特殊温度位按用户给出的索引规则处理：
  - `2*i == Pack_Temps_Num - 2` 时：
    - 高字节按 `WarningPara.HighFetTemp` 判断 mos 高温
    - 低字节按 `WarningPara.LowEnvTemp` / `WarningPara.HighEnvTemp` 判断环境温度
  - `2*i - 1 == Pack_Temps_Num - 2` 时：
    - 先回写前一个寄存器的低字节作为 mos 高温状态
    - 当前寄存器高字节写环境温度状态

### 6. 新增温度逻辑时要保留用户给出的细节写法

以下写法属于本项方案的一部分，后续执行时不要擅自“优化”成别的结构：

- `if(Im_Avg < 0 && (2*i < Pack_Temps_Num - 2))`
- `else if(2*i < Pack_Temps_Num - 2)`
- `if(2*i == Pack_Temps_Num - 2)`
- `else if(2*i - 1 == Pack_Temps_Num - 2)`
- `User485_Reg_Buffer[80 + i - 1] &= 0xFF00;`
- `User485_Reg_Buffer[80 + i - 1] |= Ttemp;`

也就是说，本项要按用户给出的“修改后”代码形态执行，而不是重新抽象算法。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再自行推导寄存器布局。
- 只修改 `static void Volt_Register_Data_Updata(void)`，不要顺手调整同文件其他寄存器更新函数。
- 实际代码区分必须以用户给出的“修改前 / 修改后”正文为准；截图只作为文件路径和大体位置辅助，不要单独依赖截图高亮去猜改法。
- `User485_Reg_Buffer[95]` 前后的原有判断链必须保留；新增逻辑插入在 `#endif` 与这段判断之间。
- `User485_Reg_Buffer[95]` 这一段“总压过压”判断在本项里只是用于区分插入位置上下文，不代表这段判断本身需要按图片另做新增或改写。
- 如果现场文件中函数名、寄存器编号或变量名与方案不一致，先提示用户确认差异，不要迁移到相似函数盲改。

## 验证要求

- 检查 `Volt_Register_Data_Updata(void)` 时，必须同时确认：
  - `uint16_t Ttemp = 0;` 和 `uint16_t Vtemp = 0;` 已新增在函数开头
  - `User485_Reg_Buffer[63]` 已改为 `Pack_Cells_Num`
  - 存在给 `User485_Reg_Buffer[64 + i]` 赋值的 10 次电压状态打包循环
  - `User485_Reg_Buffer[79] = Pack_Temps_Num;` 已新增
  - 存在给 `User485_Reg_Buffer[80 + i]` 赋值的温度状态打包循环
  - 原有 `User485_Reg_Buffer[95]` 总压过压判断仍保留，且其作用是作为新增逻辑后方的上下文锚点
- 不能只搜索 `Pack_Cells_Num` 判断完成，必须连同 `64 + i`、`79`、`80 + i` 这些寄存器落点一起核对。
- 如果只改了 `User485_Reg_Buffer[63]`，但没有补上 64~84 区间的新增逻辑，不能算完成。

## 备注

- 本项方案来源于用户提供的“修改前 / 修改后”完整代码文本；图片中的文件路径和 `User485_Reg_Buffer[95]` 附近上下文仅作为定位辅助。
- 后续真正执行本项修复时，应以本文件内容为唯一实现依据。
- 若后续用户补充更完整版本，以最新用户方案覆盖本文件。
