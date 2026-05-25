# checkList54

- 状态: 已添加
- 对应项: 54
- 意图: 将 WIFI 复位解绑逻辑改为 13~30 秒触发，并按用户截图对 `Buzzer_Ctrl()` 内指定位置的旧代码做精确增删。
- 精确目标文件: `User/System_Ctrl.c`、`User/Led_Buzzer_Ctrl.c`

## 规则目标

按用户最终确认的截图语义，最终行为应满足：

1. 复位按键按下持续时间到达 13 秒时，进行一次蜂鸣提示。
2. 复位按键在按下 13~30 秒之间弹起时，触发 WIFI 解绑。
3. 复位按键在按下超过 30 秒后弹起时，不触发 WIFI 解绑。
4. `Buzzer_Ctrl()` 中与截图 3.1、3.2 对应的处理，必须按“所在分支位置”精确判断，不能只因为出现了相同语句就删除。

## 精确索引

- 文件1: `User/System_Ctrl.c`
- 函数: `void SW_Key_Scan(void)`
- 位置特征:
  - `else if(!SWS && Key_Down_Status == 5)`
  - `else if(!SWS && Key_Down_Status == 6)`
  - `else if(Key_Down_Status == 5)`
  - `else if(Key_Down_Status == 6)`

- 文件2: `User/Led_Buzzer_Ctrl.c`
- 函数: `void Buzzer_Ctrl(void)`
- 位置特征:
  - 顶层分支 `if(!(Status4 & BIT0) && !gTheftActivate)` 之前
  - 分支 `if(!(Status1 & 0xFA) && !(Status2 & 0x7F) && !Status5 && !(Warning1 & 0xFA) && !Warning2 && !gTheftActivate)` 内部

## 用户确认后的修改原则

### 1. 修改 `User/System_Ctrl.c` 中的按键状态流转

在 `SW_Key_Scan()` 中，按用户截图语义处理：

- `Key_Down_Status == 5` 表示按键已经按下 13 秒前的等待状态。
- 到达 13 秒时：
  - 进入 `Key_Down_Status = 6;`
  - 执行 `Set_Timer(KEYDOWNTIMER, 680);`
  - 执行 `Set_Timer(BELLTIMER, 20);`
  - 执行 `BELL;`
- 当 `Key_Down_Status == 6` 且 `Timer[BELLTIMER].Flag` 置位后：
  - 执行 `_BELL;`
  - 执行 `Set_Timer(BELLTIMER, 10);`
- 当 `Key_Down_Status == 6` 且 `Timer[KEYDOWNTIMER].Flag` 置位后：
  - 进入 `Key_Down_Status = 7;`
  - 用于表示按键已经按下超过 30 秒。

### 2. 将解绑函数移动到 `Key_Down_Status == 6`

在 `SW_Key_Scan()` 的弹起处理分支中：

- `Key_Down_Status == 5` 弹起时，不执行解绑。
- `Key_Down_Status == 6` 弹起时，执行解绑函数，例如 `N32g45xHlkLinkRebind();`。
- `Key_Down_Status == 7` 或更长按压后弹起时，不触发解绑。

如果项目使用的是其他蓝牙/WIFI 模块，则调用对应模块的解绑函数，但触发时机仍必须是 `Key_Down_Status == 6`。

### 3. 修改 `User/Led_Buzzer_Ctrl.c` 中的蜂鸣处理

用户已明确：3.1 和 3.2 的修改范围都只在 `Buzzer_Ctrl()` 函数内部，并且必须结合截图中标注的代码位置来判断。

#### 3.1 关于截图中“3.1”的说明

- 3.1 指的是 `Buzzer_Ctrl()` 中一整段旧的间歇鸣响代码。
- 识别方式不是搜索单条语句，而是看是否存在整段如下结构：
  - `if(Key_Down_Status >= 6)`
  - 内部带有 `Status4 |= BIT0;`
  - 内部带有 `WifiBell_flag = 1;`
  - 内部带有 `Timer[BELLTIMER].Flag` 和 `Led_Buzzer_Flicker(9);`
  - 后面还有与之配套的 `else` / `if(WifiBell_flag == 1)` 清理逻辑
- 只有当这整段旧逻辑实际出现在 `Buzzer_Ctrl()` 中时，才删除。
- 如果项目中本来没有这整段代码，则不做任何多余操作。

#### 3.2 关于截图中“3.2”的说明

- 3.2 不是“看到 `if (Key_Down_Status == 6) { return; }` 就删除”。
- 3.2 只针对下面这个特定分支内部的红框代码：
  `if(!(Status1 & 0xFA) && !(Status2 & 0x7F) && !Status5 && !(Warning1 & 0xFA) && !Warning2 && !gTheftActivate)`
- 只有当 `if (Key_Down_Status == 6) { return; }` 这几行写在上述分支内部时，才按截图要求删除。
- 如果同样的语句出现在 `Buzzer_Ctrl()` 的其他位置，例如顶层、或者 `if(!(Status4 & BIT0) && !gTheftActivate)` 之前，则不能按 3.2 规则误删。
- 如果项目中该分支内部本来就没有这几行，则不做任何多余操作。

## 关键约束

- 不能只改解绑函数的调用位置，必须同时改按键状态时间窗定义。
- 解绑触发窗口必须是“13~30 秒弹起”，不是“到达 13 秒立即解绑”。
- 超过 30 秒后的弹起必须不解绑。
- 处理 3.1 和 3.2 时，必须同时看“代码内容”和“代码所在分支位置”，不能靠关键词做全局删除。
- 如果项目实际使用的解绑函数名不是 `N32g45xHlkLinkRebind()`，只替换函数名，不改变 `Key_Down_Status == 6` 触发这一规则。

## 执行要求

- 后续如果用户要求修复这条自检项，应优先遵循用户截图的最终语义。
- 对 `Buzzer_Ctrl()` 的删除类修改，必须先确认代码是否真的位于截图指定的分支位置。
- 如果现场代码与截图上下文不一致，先提示用户确认差异，不要凭相似语句直接改动。
- 如果项目中本来就没有截图对应代码，则不做多余操作。

## 验证要求

- 不能只搜索 `N32g45xHlkLinkRebind` 判断是否完成。
- 必须同时核对：
  - `SW_Key_Scan()` 中 `Key_Down_Status == 5/6/7` 的时间语义已经改成 13 秒、13~30 秒、30 秒以上。
  - 解绑函数只在弹起分支的 `Key_Down_Status == 6` 中调用。
  - 超过 30 秒对应状态不会触发解绑。
  - 若删除 3.1，删除的是 `Buzzer_Ctrl()` 中整段旧的 `Key_Down_Status >= 6` / `WifiBell_flag` 逻辑，而不是局部相似语句。
  - 若删除 3.2，删除的是特定 `if(!(Status1 & 0xFA) ... )` 分支内部的红框代码，而不是其他位置的同名语句。

## 备注

- 本项方案来源于用户提供截图，并已根据用户后续澄清修正。
- 如果后续用户再次补充更完整方案，以最新的用户方案覆盖本文件。
