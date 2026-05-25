# checkList45

- 状态: 已添加
- 对应项: 45
- 意图: 修复升级后零点校准参数被恢复为默认流程重新标定，导致已保存零点参数未从 EEPROM 正常读回的问题
- 精确目标文件: `User/Data_Init.c`

## 规则目标

按用户提供的截图和当前 checklist 规则执行，最终行为应满足：

1. 在 `User/Data_Init.c` 的 `ReadSysConf_EEPROM(void)` 中补充从 `EEPROM_SYSCONF_ADDR + 30` 和 `EEPROM_SYSCONF_ADDR + 32` 读取零点相关参数
2. 读取语句必须直接写成 `ZeroStatus = EEPROM_ReadWord(...)` 和 `V_Im_Zero = EEPROM_ReadWord(...)` 这一类形式，不能再套 `uint8_t` 强转
3. 这两行应放在 `Im_Gain_Chg_Low` 读取之后、`NTC_DisStatus` 读取之前，和用户截图一致
4. 本项的判断目标是“升级后系统配置恢复流程会不会把零点参数重新读回内存”，不是单独依赖 `Current_Sample_Init()` 中的兜底读取

## 精确索引

- 文件: `User/Data_Init.c`
- 目标函数: `void ReadSysConf_EEPROM(void)`
- 位置特征:
  - 前面紧邻 `Im_Gain_Chg_Low = ((float)EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 28) / 10000);`
  - 后面紧邻 `NTC_DisStatus = (uint8_t)(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 34));`

## 用户提供的修改方案

后续若执行此项修复，只按下面这组精确规则处理：

### 1. 在 `ReadSysConf_EEPROM(void)` 中补加两行 EEPROM 读回

按用户截图，在 `Im_Gain_Chg_Low` 处理完成后补加：

```c
    ZeroStatus = EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 30);
    V_Im_Zero = EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 32);
```

### 2. 不要保留 `uint8_t` 强转写法

如果现场代码写成下面这种形式，不能视为按方案正确落地：

```c
    ZeroStatus = (uint8_t)(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 30));
    V_Im_Zero = (uint8_t)(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 32));
```

原因有两点：

- `checkList45` 在 YAML 中匹配的是 `ZeroStatus = EEPROM_ReadWord` 和 `V_Im_Zero = EEPROM_ReadWord` 这类关键字，带 `uint8_t` 强转可能导致自检仍判失败
- 从变量类型看，`ZeroStatus` 是 `uint16_t`，`V_Im_Zero` 是 `int16_t`，强转成 `uint8_t` 会截断数据，尤其 `ZeroStatus` 的有效标志值 `0x3456` 会被截成 `0x56`

### 3. 本项不要求改到其他函数

虽然现场工程里的 `User/Analog_Sample.c` 的 `Current_Sample_Init(void)` 已经存在：

```c
    if(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 30) == 0x3456)
    {
        ZeroStatus = 0x3456;
        V_Im_Zero = (int16_t)EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 32);
        return 1;
    }
```

但这不能替代本项要求，因为：

- checklist 45 只检查 `ReadSysConf_EEPROM` 或 `ReadBatPara_EEPROM`
- 用户截图明确给出的落点也是 `ReadSysConf_EEPROM`

因此后续执行本项时，只改 `User/Data_Init.c` 的目标函数，不要把修复迁移成“只在别的初始化函数里读取”。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再自行推导其他零点恢复方式
- 只修改 `User/Data_Init.c`
- 只补充这两行读回逻辑，不顺手改零点校准流程、写入流程或其他自检项
- 如果现场代码已经有这两行，但仍带有 `uint8_t` 强转，应改为无强转版本
- 如果用户后续明确要求改到 `ReadBatPara_EEPROM`，需要先让用户确认，因为当前截图方案落点是 `ReadSysConf_EEPROM`

## 验证要求

- 检查 `User/Data_Init.c` 时，必须同时确认：
  - `WriteSysConf_EEPROM()` 中已经把 `ZeroStatus` 和 `V_Im_Zero` 写入 EEPROM
  - `ReadSysConf_EEPROM(void)` 中也已经把这两个值从 `EEPROM_SYSCONF_ADDR + 30/+32` 读回
  - 读回语句不带 `uint8_t` 强转
- 不能只看到 `Current_Sample_Init()` 里读过 EEPROM 就判定完成
- 如果仅有写入没有读回，不能算完成
- 如果读回存在但使用了 `uint8_t` 强转，同样不能算按方案正确落地

## 本次审查结论

- 当前工程 `User/Data_Init.c` 中，`WriteSysConf_EEPROM()` 已写入 `ZeroStatus` 和 `V_Im_Zero`
- 当前工程 `ReadSysConf_EEPROM(void)` 尚未补加对应读回语句
- 因此“这部分代码是否正确添加”的结论是：未正确添加，当前实现不足以通过 `checkList45`

## 备注

- 本项方案来源于用户提供的差异截图
- 当前 `checkList_item_cfg.yml` 中，`checkList45` 的规则目标已明确指向 `Data_Init.c` 的 `ReadSysConf_EEPROM` / `ReadBatPara_EEPROM`
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件
