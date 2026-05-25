# 协议总目录（Protocol Registry）

> 每新增一个协议必须在此追加一行。
> 这是 skill 查找“是否有同类协议”的唯一入口，不得从记忆中推断。
> 本表只负责协议名、方向、参考级别摘要，不负责维护白灰黑名单细节。

---

## 已收录协议

| 协议英文名 | 品牌中文名 | 通信方向 | 报文数 | 参考级别 | 特殊处理 | 定义文件 | 代码范例 |
|-----------|----------|---------|-------|---------|---------|---------|---------|
| PYLON（EMS版） | 派能 | BMS→逆变器(Tx) | 8 | 白名单 | 基础轮询骨架稳定、开尔文温度换算、极值帧与总容量帧清晰 | `references/protocols/Can_Pylon.md` | `assets/examples/Can_Pylon.c` |
| PYLON LV V1.3 | 派能_V130 | BMS→逆变器(Tx)+Rx | 6+Rx | 灰名单 | 电流/电压有符号、品牌帧缩短、可选 `0x1001` 心跳、版本差异明显 | `references/protocols/Can_Pylon_V130.md` | `assets/examples/Can_Pylon_V130.c` |
| GROWATT LV V1.09 | 古瑞瓦特_V109 | BMS→逆变器(Tx)+Rx | 8 基础帧 + 4 单体帧 + Rx | 白名单 | `DeltaV` / 极值地址 / 温度地址直取、`0x315~0x318` 单体电压分帧、`0x324` 产品码分包响应 | `references/protocols/Can_Growatt_V109.md` | `assets/examples/Can_Growatt_V109.c` |
| AISWEI HV V1.0 | 爱士惟_HV100 | BMS→逆变器(Tx) | 6 基础帧 + 扩展补充帧 | 白名单 | 基础轮询骨架清晰、字段直取、数值地址型扩展 | `references/protocols/Can_Aiswei_V100.md` | `assets/examples/Can_Aiswei_V100.c` |
| CANADIANSOLAR V1.0.1 | 阿特斯阳光电力_V101 | BMS→逆变器(Tx) | 基础帧 + 系统级帧 | 灰名单 | 基础轮询与系统级扩展分层、ASCII 地址编码、多状态分层 | `references/protocols/Can_CanadianSolar_V101.md` | `assets/examples/Can_CanadianSolar_V101.c` |
| VICTRON 2023.04.18 | 维克托_V230418 | BMS→逆变器(Tx) | 基础帧 + 地址扩展帧 | 白名单 | `0x35A` 字节级状态输出、`0x374~0x377` ASCII 地址扩展 | `references/protocols/Can_Victron_230418.md` | `assets/examples/Can_Victron_230418.c` |
| VOLTRONIC 2021.08.16 | 日月元_210816 | BMS↔逆变器(Rx/Tx) | 命令触发多组扩展帧 | 黑名单（对非 C 类） | 扩展帧命令分发、按 pack 回帧、非轮询骨架 | `references/protocols/Can_Voltronic_210816.md` | `assets/examples/Can_Voltronic_210816.c` |

---

## 查找规则

生成新协议代码时：

1. 先用本表判断是否存在同类协议。
2. 再读取对应的 `references/protocols/Can_Xxx.md`。
3. 如需借项目现有代码，再去 `references/project-positive-examples.md` 确认是否允许作为骨架模板。

重点参照：
- `参考级别`：快速判断是骨架候选，还是只能局部参考。
- `定义文件`：读取对应协议级说明。
- `代码范例`：查看真实代码样本。

---

## 参考级别说明

- 白名单：可作为同类型协议的默认骨架候选，但仍需以协议文档为准。
- 灰名单：只能参考明确标注的局部实现，不能整体套用发送架构。
- 黑名单：默认禁止外推为模板；只有目标协议完全同类时，才可重新评估。

注意：
- 具体适用点、限制条件以 `references/project-positive-examples.md` 为准。
- 若两处描述不一致，以 `references/project-positive-examples.md` 为准。

---

## 新增协议操作步骤

1. 使用 `references/protocol-doc-template.md` 创建 `references/protocols/Can_Xxx.md`。
2. 清理代码后保存 `assets/examples/Can_Xxx.c`。
3. 在上方表格追加一行，写清楚协议类型、参考级别和特殊处理。
4. 若该协议具有通用参考价值，再同步补充到 `references/project-positive-examples.md`。
