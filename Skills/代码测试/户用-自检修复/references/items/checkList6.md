# checkList6

- 状态: 已添加
- 对应项: 6
- 意图: 修复 `Safety_Ctrl.c` 中充电相关状态判断对 `Status2` 的掩码使用错误问题
- 精确目标文件: `User/Safety_Ctrl.c`

## 精确索引

- 文件: `User/Safety_Ctrl.c`
- 函数1: `void Chg_Mos_Open_Ctrl(void)`
- 函数2: `void Chg_CC_Mos_Ctrl(void)`
- 函数3: `void Safety_Ctrl(void)`
- 位置特征:
  - `if((Status1 & 0x95) || (Status2 & 0xF5)`
  - `if((CFETS || CC_ON_OFF_S) &&`
  - `else if(!CFETS && !CC_ON_OFF_S`

## 用户提供的修改方案

按截图中的“修改后”版本执行，只在 `User/Safety_Ctrl.c` 中将以下判断里的 `Status2` 掩码从 `0xF5` 改为 `0x75`：

### 1. 在 `void Chg_Mos_Open_Ctrl(void)` 中

将：

```c
if((Status1 & 0x95) || (Status2 & 0xF5) || ...)
```

改为：

```c
if((Status1 & 0x95) || (Status2 & 0x75) || ...)
```

### 2. 在 `void Chg_CC_Mos_Ctrl(void)` 中

将：

```c
if((Status1 & 0x95) || (Status2 & 0xF5) || ...)
```

改为：

```c
if((Status1 & 0x95) || (Status2 & 0x75) || ...)
```

### 3. 在 `void Safety_Ctrl(void)` 中的充电关闭条件

将：

```c
if((CFETS || CC_ON_OFF_S) && (... || (Status2 & 0xF5) || ...))
```

改为：

```c
if((CFETS || CC_ON_OFF_S) && (... || (Status2 & 0x75) || ...))
```

### 4. 在 `void Safety_Ctrl(void)` 中的充电恢复条件

将：

```c
else if(!CFETS && !CC_ON_OFF_S && ... && !(Status2 & 0xF5) && ...)
```

改为：

```c
else if(!CFETS && !CC_ON_OFF_S && ... && !(Status2 & 0x75) && ...)
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 只修改截图中明确标出的这 4 处 `Status2` 掩码，不额外调整 `Safety_Ctrl.c` 中的其他判断逻辑。
- 如果现场又发现其他问题，只能指出并提示用户，不能直接继续修改。
- 如果现场代码与截图中的目标函数或表达式不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 不能只搜索 `0x75` 判断是否完成。
- 必须同时核对：
  - `Chg_Mos_Open_Ctrl()` 中对应判断使用 `Status2 & 0x75`
  - `Chg_CC_Mos_Ctrl()` 中对应判断使用 `Status2 & 0x75`
  - `Safety_Ctrl()` 中充电关闭条件使用 `Status2 & 0x75`
  - `Safety_Ctrl()` 中充电恢复条件使用 `!(Status2 & 0x75)`

## 备注

- 本项方案来源于用户提供截图。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
