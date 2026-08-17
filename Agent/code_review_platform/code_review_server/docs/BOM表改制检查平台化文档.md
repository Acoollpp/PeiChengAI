# BOM表改制检查平台化文档

更新时间：2026-07-17

## 目标

将本地 Codex Skill `bom-change-check` 接入现有代码审查平台，形成可在 Web 页面提交、后台执行、下载报告、查看任务状态和统计结果的任务模块。

平台模块名称：`BOM表改制检查`

页面路由：

- 用户提交页：`/tasks/bom-change-check`
- 管理页：`/tasks/bom-change-check-manage`

后端接口前缀：

- `/api/v1/bom-change-check-tasks`

## 平台化原则

本模块复用现有平台框架，不新建独立系统：

- 前端：React/Vite/TanStack Router
- 后端：FastAPI/SQLModel/Alembic
- 鉴权：沿用平台登录态和当前用户权限
- 存储：按任务 ID 创建输入、日志、报告目录
- 执行：后端调用本机 Codex，要求 Codex 使用 `$bom-change-check` skill

后端只负责调度、文件存储、解压、日志、状态和报告归档；BOM 检查业务逻辑由 Codex 按 skill 规则执行。Skill 内脚本可作为确定性辅助工具使用，但平台不能直接绕过 Codex 调脚本完成业务判断。

## 输入结构

用户上传一个压缩包，支持：

- `.zip`
- `.rar`
- `.7z`

压缩包解压后放到：

```text
<task_dir>/input/projects/
```

资料按固定分类文件夹组织：

```text
projects/
  改制前BOM/
    BOM-SST26-1101-1.0-备货-006.xlsx
    ...
  改制后BOM/
    BOM-SST26-1629-1.0-瑞能-001.xlsx
    ...
  改制表/
    改制单-616291001.xlsx
    ...
  公司物料表/
    公司总料表.xlsx
```

允许的同义文件夹名：

- `改制表` 或 `改制单`
- `公司物料表`、`公司总料表` 或 `总料表`

## 匹配规则

每个改制表生成一个项目报告。

改制表中规格型号位置固定：

- 上面那个规格型号是改制前
- 下面那个规格型号是改制后

匹配重点是“项目号 + 版本号”。

示例：

```text
BOM-SST26-1101-1.0-备货-006  -> 匹配键：1101-1.0
P8S150A-61101-1.0             -> 去掉项目号前导业务前缀 6 后：1101-1.0

BOM-SST26-1629-1.0-瑞能-001  -> 匹配键：1629-1.0
P8S150A-61629-1.0             -> 去掉项目号前导业务前缀 6 后：1629-1.0
```

对每个改制表：

1. 从改制表读取上方规格型号，提取改制前匹配键。
2. 从改制表读取下方规格型号，提取改制后匹配键。
3. 在 `改制前BOM` 文件夹中查找唯一匹配的改制前 BOM。
4. 在 `改制后BOM` 文件夹中查找唯一匹配的改制后 BOM。
5. 使用匹配到的两份 BOM、当前改制表、公司物料表执行检查。
6. 如果缺失或匹配到多份，批量汇总记录失败原因，并继续处理其他改制表。

## 执行流程

1. 用户在前端提交任务名称和项目压缩包。
2. 后端创建 `BomChangeCheckTask` 记录，状态为 `preparing`。
3. 后端保存上传文件到：

```text
<task_dir>/input/<原始压缩包名>
```

4. 后端解压到：

```text
<task_dir>/input/projects/
```

5. 后端将任务状态改为 `queued`，启动后台线程。
6. 后台线程将任务状态改为 `running`。
7. 后端生成 Codex prompt，调用：

```text
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C <task_dir> -
```

8. Codex 使用 `$bom-change-check` skill 识别资料、匹配 BOM、生成报告。
9. 后端读取所有项目报告中的 `summary` sheet，汇总异常统计。
10. 后端将输入、报告和日志打包为 zip。
11. 任务状态更新为 `success` 或 `failed`。

## 输出文件

每个改制表输出一个报告：

```text
reports/<改制表文件名或项目名>/BOM表改制检查报告.xlsx
```

整批任务最终下载一个 zip：

```text
BOM表改制检查报告.zip
```

如果上传压缩包名为 `616291001.zip`，下载包名优先使用：

```text
616291001.zip
```

zip 内包含：

```text
input/
  原始压缩包
  projects/
reports/
  <项目>/BOM表改制检查报告.xlsx
logs/
  codex-invocation.json
  codex-stdout.log
  codex-stderr.log
```

## 单项目报告要求

报告工作簿名称：

```text
BOM表改制检查报告.xlsx
```

必须包含 sheet：

- `改制单核对`
- `BOM差异核对`
- `替代料关系核对`
- `客户限制核对`
- `summary`

明细 sheet 固定前置列顺序：

```text
检查类、结论、说明、物料代码、用量、位号、操作、改制前数量、改制前位号、改制后数、改制后位号、改制前状态、改制前、改制单、改制后状态、改制后、规格型号
```

映射关系：

- `检查类` 来自内部 `检查类型`
- `改制后数` 来自内部 `改制后数量`
- `改制前` 是改制前 BOM 行号
- `改制单` 是改制单行号
- `改制后` 是改制后 BOM 行号
- 其他审查证据列可追加在固定列之后

异常行规则：

- `结论=异常`：整行黄色
- `结论=人工复查`：整行黄色
- `结论=正常` 或 `跳过`：不标黄

## 数据库

新增任务表：

```text
bom_change_check_task
```

核心字段：

- `id`
- `user_id`
- `task_name`
- `status`
- `input_files`
- `result_files`
- `change_order_abnormal_count`
- `bom_diff_abnormal_count`
- `replacement_abnormal_count`
- `customer_restriction_abnormal_count`
- `manual_review_count`
- `skipped_count`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

迁移文件：

```text
backend/app/alembic/versions/20260717_add_bom_change_check_tasks.py
```

当前 revision：

```text
20260717_bom_change_check
```

## 后端文件

```text
backend/app/api/routes/bom_change_check_tasks.py
backend/app/services/bom_change_check_task_service.py
backend/app/models.py
backend/app/core/config.py
```

主要接口：

- `POST /api/v1/bom-change-check-tasks`
- `GET /api/v1/bom-change-check-tasks`
- `GET /api/v1/bom-change-check-tasks/stats`
- `GET /api/v1/bom-change-check-tasks/{task_id}`
- `GET /api/v1/bom-change-check-tasks/{task_id}/report`
- `DELETE /api/v1/bom-change-check-tasks/{task_id}`

配置项：

```text
BOM_CHANGE_CHECK_STORAGE_DIR=/app/bom-change-check-tasks
BOM_CHANGE_CHECK_CODEX_COMMAND=codex
BOM_CHANGE_CHECK_CODEX_TIMEOUT_SECONDS=1800
```

## 前端文件

```text
frontend/src/components/BomChangeCheckTasks/BomChangeCheckTasksPage.tsx
frontend/src/routes/_layout/tasks.bom-change-check.tsx
frontend/src/routes/_layout/tasks.bom-change-check-manage.tsx
frontend/src/components/Sidebar/AppSidebar.tsx
```

页面功能：

- 上传项目压缩包
- 提交任务
- 显示任务状态
- 显示异常统计
- 下载 zip 报告
- 删除任务
- 管理员查看全部任务

## 日志与排错

每个任务保存：

```text
logs/codex-invocation.json
logs/codex-stdout.log
logs/codex-stderr.log
```

常见失败原因：

- 压缩包为空
- 压缩包格式不是 `.zip/.rar/.7z`
- 服务器缺少 7-Zip 或 RAR 解压工具
- 分类文件夹缺失
- 改制表无法读取上下规格型号
- BOM 匹配不到
- BOM 匹配到多份
- 公司物料表缺失或多份无法判定
- Codex 命令不存在
- Codex 执行超时
- Codex 未生成任何 `BOM表改制检查报告.xlsx`

## 已知边界

- 平台当前只负责编排，不在后端 Python 中实现完整 BOM 匹配业务逻辑。
- 改制表中“上/下规格型号”的具体单元格由 Codex 按 skill 和文档规则识别。
- 如果实际模板发生变化，需要优先更新 `bom-change-check` skill 规则。
