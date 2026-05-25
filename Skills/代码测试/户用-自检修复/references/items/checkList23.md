# checkList23

- 状态: 已添加
- 对应项: 23
- 意图: 修复 `failureDetection.c` 中压差故障与恢复计数逻辑
- 精确目标文件: `User/failureDetection.c`

## 精确索引

- 文件: `User/failureDetection.c`
- 函数: `static void VsumVpackDiffErr(void)`
- 位置特征:
  - `if(DiffValue >= 5000)`
  - `else if(DiffValue < 3000)`

## 用户提供的修改方案

按截图中的“修改后”版本执行，在 `static void VsumVpackDiffErr(void)` 中做以下调整：

1. 在
   `if(DiffValue >= 5000)`
   这一分支结束后，新增：

```c
DiffErrorRecoverCnt = 0;
```

2. 在
   `else if(DiffValue < 3000)`
   这一分支结束后，新增：

```c
DiffErrorCnt = 0;
```

## 执行要求

- 后续如果用户要求修复这条自检项，按本文件方案直接修改，不再重新推导。
- 仅按这里记录的两处新增执行，不额外改动 `VsumVpackDiffErr` 其他逻辑。
- 如果现场代码与截图上下文不一致，先保留本方案并提示用户确认差异。

## 备注

- 本项方案来源于用户提供截图。
- 当前截图精确命中源码文件为 `User/failureDetection.c`。
- 若后续用户补充更完整方案，以最新用户方案覆盖本文件。
