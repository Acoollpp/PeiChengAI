# checkList25

- 状态: 已添加
- 对应项: 25
- 意图: 修复 `Lcd_Comm.c` 中 `PACK SN` 发送与 `g_sensor_enable` 判断范围错误的问题
- 精确目标文件: `User/Lcd_Comm.c`

## 精确索引

- 文件: `User/Lcd_Comm.c`
- 位置特征:
  - `if (userCfg.g_sensor_enable){`
  - `for (i = 0; i < 20; i++) // PACK SN`
  - `if ((Command == 1) && (Uart_LCD_InfoLen == 2))`

## 用户提供的修改方案

按截图中的“修改后”版本执行，核心不是简单下移代码，而是调整 `if (userCfg.g_sensor_enable)` 的包裹范围。

### 修改前

`if (userCfg.g_sensor_enable)` 包住了 `PACK SN` 发送循环：

```c
if (userCfg.g_sensor_enable){
    for (i = 0; i < 20; i++) // PACK SN
    {
        HextoTwoAscii(Pack_Code[i], Temp);
        Uart_LCD_Buffer[Uart_LCD_TxCount++] = Temp[0];
        Uart_LCD_Buffer[Uart_LCD_TxCount++] = Temp[1];
    }
}

if ((Command == 1) && (Uart_LCD_InfoLen == 2))
{
    gGensorActivate = 1;

    EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
    WriteSysConf_EEPROM();
}
```

### 修改后

`PACK SN` 发送循环必须移到外面，`if (userCfg.g_sensor_enable)` 只包住后面的配置逻辑：

```c
for (i = 0; i < 20; i++) // PACK SN
{
    HextoTwoAscii(Pack_Code[i], Temp);
    Uart_LCD_Buffer[Uart_LCD_TxCount++] = Temp[0];
    Uart_LCD_Buffer[Uart_LCD_TxCount++] = Temp[1];
}

if (userCfg.g_sensor_enable)
{
    if ((Command == 1) && (Uart_LCD_InfoLen == 2))
    {
        gGensorActivate = 1;

        EEPROM_ErasePage(EEPROM_SYSCONF_ADDR);
        WriteSysConf_EEPROM();
    }
}
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 必须按这里记录的“包裹范围变化”执行，不能只理解成“把判断块往下挪一点”。
- `PACK SN` 发送循环必须无条件执行。
- `if (userCfg.g_sensor_enable)` 只控制 `gGensorActivate` 和 EEPROM 保存逻辑。
- 不额外改动 `Lcd_Comm.c` 其他发送逻辑。
- 如果现场代码与截图上下文不一致，先保留本方案并提示用户确认差异。

## 备注

- 本项方案来源于用户提供截图。
- 当前截图标注文件为 `User/Lcd_Comm.c`。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
