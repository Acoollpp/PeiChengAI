# checkList58

- 状态: 已添加
- 对应项: 58
- 意图: 修复 `Data_Init.c` 中 `SOC_DelDataBuf(void)` 的已烧录判断基准，要求与 `WriteBatPara_EEPROM(uint8_t TypeMode)` 保持一致
- 精确目标文件:
  - `User/Data_Init.c`

## 精确索引

- 源文件: `User/Data_Init.c`
- 关联函数1: `void SOC_DelDataBuf(void)`
- 关联函数2: `void WriteBatPara_EEPROM(uint8_t TypeMode)`
- 位置特征:
  - `SOC_DelDataBuf(void)` 中当前错误锚点：
    `if(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 4) == 0x5678)return;//判断MCU是否烧录`
  - `WriteBatPara_EEPROM(uint8_t TypeMode)` 中对齐基准锚点：
    `if(EEPROM_ReadWord(FlashAddr + PARA_OFFSETADDR_DATAFLAG) == 0x3456)return;`
  - 处理本项时，必须同时核对这两个函数，不能只单看 `SOC_DelDataBuf(void)`

## 用户提供的修改方案

按用户本次补充的截图和说明执行，本项不是简单套用某个固定地址案例，而是要求：

- `SOC_DelDataBuf(void)` 中这一行的判断逻辑，必须与 `WriteBatPara_EEPROM(uint8_t TypeMode)` 的判断基准保持一致；
- 以 `WriteBatPara_EEPROM(uint8_t TypeMode)` 为准，不再以其他项目或旧版本里的单独案例作为唯一依据。

### 1. 先确认对齐基准

先看 `WriteBatPara_EEPROM(uint8_t TypeMode)` 中用于判定参数区是否已烧录的那一行。

用户给出的目标基准是：

```c
if(EEPROM_ReadWord(FlashAddr + PARA_OFFSETADDR_DATAFLAG) == 0x3456)return;
```

### 2. 再修改 `SOC_DelDataBuf(void)` 中对应判断

将现场错误写法：

```c
if(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 4) == 0x5678)return;//判断MCU是否烧录
```

改为与 `WriteBatPara_EEPROM(uint8_t TypeMode)` 保持一致的参数区数据标志判断。

本项验收标准不是死盯某个固定宏名或字面量，而是看 `SOC_DelDataBuf(void)` 是否已经改成“跟 `WriteBatPara_EEPROM(uint8_t TypeMode)` 同一套判断基准”。

如果当前工程中的 `WriteBatPara_EEPROM(uint8_t TypeMode)` 已按用户目标方案写成：

```c
if(EEPROM_ReadWord(FlashAddr + PARA_OFFSETADDR_DATAFLAG) == 0x3456)return;
```

则 `SOC_DelDataBuf(void)` 也应改为对应这套参数区数据标志语义，不能继续使用：

```c
EEPROM_SYSCONF_ADDR + 4
0x5678
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 处理本项时，先核对 `WriteBatPara_EEPROM(uint8_t TypeMode)` 的现场写法，再修改 `SOC_DelDataBuf(void)`，不能跳过基准核对。
- `SOC_DelDataBuf(void)` 中这条判断必须与 `WriteBatPara_EEPROM(uint8_t TypeMode)` 保持一致，不能一个看系统配置区、另一个看电池参数区。
- 本项核心是“与 `WriteBatPara_EEPROM()` 对齐”，不是机械替换某个固定字面值；若现场 `WriteBatPara_EEPROM()` 的基准再次调整，则本项也应随之对齐。
- 必须保持原有中文注释 `//判断MCU是否烧录` 不变。
- 修改点只认 `SOC_DelDataBuf(void)` 中开头这条 `EEPROM_ReadWord(...)` 判断语句，不扩展到其他 EEPROM 读取位置。
- 不要顺手改动 `SOC_DelDataBuf(void)` 里的擦除流程、看门狗喂狗逻辑或其他 SOC 读写函数。

## 验证要求

- 先检查 `WriteBatPara_EEPROM(uint8_t TypeMode)` 中用于判定参数区已烧录的判断语句当前是什么。
- 再检查 `SOC_DelDataBuf(void)` 开头的判断语句是否已与前者保持一致。
- 如果 `SOC_DelDataBuf(void)` 仍在使用系统配置区签名判断，例如：

```c
if(EEPROM_ReadWord(EEPROM_SYSCONF_ADDR + 4) == 0x5678)return;//判断MCU是否烧录
```

- 则不能判定该项已完成。
- 如果只改了 `WriteBatPara_EEPROM(uint8_t TypeMode)`，但 `SOC_DelDataBuf(void)` 没有同步对齐，也不能判定该项已完成。
- 如果改动发生在 `SOC_DelDataBuf(void)` 之外，也不能判定该项已完成。

## 备注

- 本项方案以用户本次补充说明为准，覆盖之前“参考案例式”的不完整描述。
- 用户明确要求：`SOC_DelDataBuf` 中这一行要跟 `WriteBatPara_EEPROM` 一致，之前给出的案例图仅作参考，不是完整方案。
- 若当前工程中不存在 `User/Data_Init.c` 或 `SOC_DelDataBuf(void)`，先报告“文件缺失/函数缺失”，不要擅自迁移到其他模块。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
