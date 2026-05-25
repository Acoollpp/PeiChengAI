# checkList_Updata_Forward_Idle

- 状态: 已添加
- 对应项: 59
- 意图: 检查 `Updata_Ctrl.c` 中升级转发流程是否按新方案处理
- 精确目标文件: `User/Updata_Ctrl.c`

## 精确索引

- 文件: `User/Updata_Ctrl.c`
- 函数1: `void Forward_StepCtrl(void)`
- 函数2: `void Updata_Host_Process(void)`

## 用户提供的修改方案

按截图中的“修改后”版本执行，包含以下两处修改:

1. 在 `User/Updata_Ctrl.c` 的 `void Forward_StepCtrl(void)` 中:
   - 将 `if (ForwardInfo.TryCnt > 5)`
   - 改为 `if (ForwardInfo.TryCnt > 20)`

2. 在 `User/Updata_Ctrl.c` 的 `void Updata_Host_Process(void)` 中:
   - 必须定位到 `if (ForwardInfo.State == FORWARD_FINISH || ForwardInfo.State == FORWARD_FAIL)` 这个分支内部
   - 必须在这个分支里的 `Updata_Save_AppInfo();` 之后新增:
     `ForwardInfo.State = FORWARD_IDLE;`

## 关键约束

- 不允许因为其他函数里已经存在 `ForwardInfo.State = FORWARD_IDLE;` 就判定本项已修复。
- 特别是 `Updata_StartForward()` 中已有同名赋值时，仍然必须继续检查 `Updata_Host_Process()` 的完成/失败分支。
- 本项的第二处修改，只有当 `ForwardInfo.State = FORWARD_IDLE;` 出现在 `Updata_Host_Process()` 的上述完成/失败分支内，并且紧跟在该分支内的 `Updata_Save_AppInfo();` 之后，才算修复完成。

## 执行要求

- 后续如果用户要求修复这条自检项，按本文档方案直接修改，不再重新推导。
- 仅按这里记录的两处改动执行，不额外改动升级流程其他逻辑。
- 如果现场代码与截图上下文不一致，先保留本方案并提示用户确认差异。

## 验证要求

- 不能只搜索 `FORWARD_IDLE` 关键字来判断是否已修复。
- 必须同时核对:
  - `Forward_StepCtrl()` 中阈值已从 `> 5` 改为 `> 20`
  - `Updata_Host_Process()` 中完成/失败分支内存在 `Updata_Save_AppInfo();`
  - 且其后紧跟 `ForwardInfo.State = FORWARD_IDLE;`

## 备注

- 本项方案来源于用户提供截图。
- 如果后续用户补充更完整方案，以最新的用户方案覆盖本文件。
