# checkList63

- 状态: 已添加
- 对应项: 63
- 意图: 修复 `Soc_Config.h/.c` 中 `SocData` 存储结构、读写校验与写后回读校验逻辑
- 精确目标文件:
  - `User/Soc/Soc_Config.h`
  - `User/Soc/Soc_Config.c`

## 精确索引

- 头文件: `User/Soc/Soc_Config.h`
- 源文件: `User/Soc/Soc_Config.c`
- 位置特征:
  - `struct _SocData //内部变量（需要存储）`
  - `static uint8_t ReadSocPara_EEPROM_Normal(void)`
  - `static uint8_t WriteSocPara_EEPROM_Normal(void)`
  - `Check_SocData_Valid`

## 用户提供的修改方案
按用户本次提供的代码执行，只在 `User/Soc/Soc_Config.h`、`User/Soc/Soc_Config.c` 中做以下调整:

### 1. 在 `User/Soc/Soc_Config.h` 中补齐 `SocData` 类型别名

将:

```c
struct _SocData //内部变量（需要存储）
{
    ...
};
```

改为:

```c
typedef struct _SocData //内部变量（需要存储）
{
    ...
}SocData_T;
```

### 2. 在 `static uint8_t ReadSocPara_EEPROM_Normal(void)` 中改为先读临时结构，再校验后更新全局

按用户提供代码执行，核心包含以下可见修改:

```c
uint16_t slen = sizeof(SocData);
SocData_T pTemp = {0};

SOC_ReadDataBuf((uint8_t*)&pTemp,slen);

if(pTemp.CheckSum != Soc_CheckSum((uint8_t*)&pTemp, slen-2)) return 0;
if(pTemp.Chg_SocLP != 99 || pTemp.Dsg_SocLP != 1) return 0;

memcpy(&SocData,&pTemp,slen);     // 校验通过后才更新全局的SocData
return 1;
```

### 3. 在 `User/Soc/Soc_Config.c` 中新增 `Check_SocData_Valid`

按用户提供代码新增:

```c
static uint8_t Check_SocData_Valid(void)
{
    // 检查关键字段和校验和
    if(SocData.Chg_SocLP != 99 || SocData.Dsg_SocLP != 1) 
    {
        return 0;  // 数据无效
    }
    
    return 1;  // 数据有效
}
```

### 4. 在 `static uint8_t WriteSocPara_EEPROM_Normal(void)` 中增加写前恢复、按实际长度写入、写后回读比对

按用户提供代码执行，核心包含以下可见修改:

```c
uint8_t i = 0;
uint8_t write_datebuff[110] = {0};
uint16_t w_index = sizeof(SocData);
if(w_index > 100) return 0;//地址长度
SocData_T pTemp_Write = {0};

// 检查SocData的有效性，无效则恢复上一次值
if(Check_SocData_Valid() == 0) 
{
    ReadSocPara_EEPROM_Normal();
}
SocData.CheckSum = Soc_CheckSum((uint8_t*)(&SocData),w_index - 2);

memcpy(write_datebuff,&SocData,w_index);    

for(i = 0;i < 3;i++)
{   
    
    SOC_WriteDataBuf(write_datebuff,w_index);
    
    SOC_ReadDataBuf((uint8_t*)&pTemp_Write, w_index);//读写之后的数据
    
    if(memcmp(write_datebuff,(uint8_t*)&pTemp_Write,w_index) == 0) //写之前和写之后数据无问题
    {
      if(ReadSocPara_EEPROM_Normal())
      {
        return 1;
      } 
      
    }

}

return 0;      
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文档方案直接修改，不再重新推导。
- 只修改用户本次明确给出的 `Soc_Config.h/.c` 位置，不额外调整 SOC 算法或 EEPROM 其他流程。
- 如果现场又发现其他问题，只能指出并提示用户，不能直接继续修改。
- 如果现场代码与本方案中的函数名、结构名或局部变量名不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 不能只搜索 `SocData_T` 或 `Check_SocData_Valid` 判断是否完成。
- 必须同时核对:
  - `Soc_Config.h` 中 `struct _SocData` 已改成 `typedef struct _SocData`，并以 `SocData_T` 结束
  - `ReadSocPara_EEPROM_Normal()` 使用临时变量 `pTemp` 读数据并在校验后 `memcpy` 到 `SocData`
  - `Check_SocData_Valid()` 已新增
  - `WriteSocPara_EEPROM_Normal()` 使用 `w_index` 写入、写后回读并用 `memcmp` 比较

## 备注

- 本项方案来源于用户本次直接提供的代码。
- 后续若用户补充更新版本方案，以最新用户方案覆盖本文档。
