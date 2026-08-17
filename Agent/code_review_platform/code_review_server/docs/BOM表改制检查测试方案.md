# BOM表改制检查测试方案

更新时间：2026-07-17

## 测试目标

验证 `BOM表改制检查` 平台从上传压缩包到生成报告的完整链路可用，重点确认：

- 压缩包上传、解压和存储正确。
- 固定分类文件夹识别正确。
- 改制表通过“项目号 + 版本号”匹配改制前 BOM 和改制后 BOM。
- 后端通过 Codex 调用 `$bom-change-check` skill，而不是直接绕过 Codex 调脚本。
- 输出报告结构、列顺序、异常标黄和 summary 统计符合规则。
- 平台任务状态、统计、下载和权限行为正常。

## 测试范围

覆盖范围：

- 前端页面
- 后端 API
- 后端任务服务
- 文件解压与路径安全
- Codex 调用与日志
- Excel 报告结构
- 批量汇总统计
- 下载报告 zip
- 用户权限

不覆盖范围：

- Codex 模型本身能力稳定性
- Excel/WPS 客户端显示差异
- 公司总料表业务数据真实性
- 网络、浏览器、系统权限等外部环境异常的全量组合

## 测试环境

代码目录：

```text
D:\PeiChengAI\Agent\code_review_platform\code_review_server
```

Skill 目录：

```text
C:\Users\admin\.codex\skills\bom-change-check
```

后端服务：

```text
http://localhost:8003
```

前端服务：

```text
http://localhost:5174
```

数据库：

```text
PostgreSQL app / app_test
```

## 测试数据准备

准备一个压缩包，例如：

```text
616291001.zip
```

压缩包结构：

```text
projects/
  改制前BOM/
    BOM-SST26-1101-1.0-备货-006.xlsx
  改制后BOM/
    BOM-SST26-1629-1.0-瑞能-001.xlsx
  改制表/
    改制单-616291001.xlsx
  公司物料表/
    公司总料表.xlsx
```

改制表中固定规格型号示例：

```text
上方：P8S150A-61101-1.0
下方：P8S150A-61629-1.0
```

预期匹配：

```text
P8S150A-61101-1.0 -> 1101-1.0 -> BOM-SST26-1101-1.0-备货-006.xlsx
P8S150A-61629-1.0 -> 1629-1.0 -> BOM-SST26-1629-1.0-瑞能-001.xlsx
```

## 自动化测试

### 1. Skill 脚本测试

命令：

```powershell
python C:\Users\admin\.codex\skills\bom-change-check\scripts\test_check_bom_change.py
```

通过标准：

```text
all tests passed
```

验证点：

- BOM 差异行按同一物料变化合并。
- `IC-烧录程序` 差异跳过。
- 替代料单向限制可识别。
- 客户限制 K/O 列规则可识别。
- 输出列顺序符合截图要求。

### 2. 后端服务测试

命令：

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server\backend
uv run pytest tests/services/test_bom_change_check_task_service.py -q
```

通过标准：

```text
3 passed
```

验证点：

- Codex prompt 包含固定分类文件夹要求。
- Codex prompt 包含项目号+版本号匹配规则。
- `61101-1.0 -> 1101-1.0`、`61629-1.0 -> 1629-1.0` 示例存在。
- 多项目报告 summary 能被汇总。
- 下载 zip 使用上传压缩包名称。

### 3. 后端 API 测试

命令：

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server\backend
uv run pytest tests/api/routes/test_bom_change_check_tasks.py -q
```

通过标准：

```text
2 passed
```

验证点：

- `POST /api/v1/bom-change-check-tasks` 接收 `project_upload`。
- 上传 zip 后解压到 `input/projects`。
- 任务状态进入 `queued`。
- 未上传文件时返回 `422`。

### 4. 前端构建测试

命令：

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server\frontend
npm run build
```

通过标准：

- TypeScript 编译通过。
- Vite 构建成功。
- 仅允许存在 chunk size warning。

### 5. Python 编译检查

命令：

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server
python -m py_compile `
  backend\app\services\bom_change_check_task_service.py `
  backend\app\api\routes\bom_change_check_tasks.py `
  backend\tests\services\test_bom_change_check_task_service.py `
  backend\tests\api\routes\test_bom_change_check_tasks.py `
  C:\Users\admin\.codex\skills\bom-change-check\scripts\check_bom_change.py `
  C:\Users\admin\.codex\skills\bom-change-check\scripts\test_check_bom_change.py
```

通过标准：

- 命令退出码为 0。

## 手工功能测试

### 用例 1：页面打开

步骤：

1. 启动后端 `8003`。
2. 启动前端。
3. 登录平台。
4. 点击侧边栏 `BOM表改制检查`。

预期：

- 页面正常打开。
- 页面只显示一个上传入口：`项目压缩包`。
- 页面说明包含固定文件夹提交方式。

### 用例 2：提交正常压缩包

步骤：

1. 选择 `616291001.zip`。
2. 输入任务名称。
3. 点击提交。

预期：

- 任务创建成功。
- 状态从 `等待执行` 进入 `执行中`。
- 后端目录生成：

```text
<task_dir>/input/
<task_dir>/input/projects/
<task_dir>/logs/
<task_dir>/reports/
```

### 用例 3：Codex 调用检查

步骤：

1. 打开任务日志目录。
2. 查看 `logs/codex-invocation.json`。
3. 查看 `logs/codex-stdout.log` 和 `logs/codex-stderr.log`。

预期：

- `codex-invocation.json` 中包含 `codex exec` 命令。
- prompt 中包含 `$bom-change-check` skill 路径。
- prompt 中包含固定分类文件夹和匹配规则。
- 没有出现直接用平台后端执行业务脚本代替 Codex 的行为。

### 用例 4：BOM 匹配正确

步骤：

1. 查看 Codex 输出日志或批量汇总。
2. 对照改制表中的上下规格型号。

预期：

- `P8S150A-61101-1.0` 匹配改制前 BOM：`BOM-SST26-1101-1.0-备货-006.xlsx`。
- `P8S150A-61629-1.0` 匹配改制后 BOM：`BOM-SST26-1629-1.0-瑞能-001.xlsx`。
- 批量汇总中记录匹配到的改制前 BOM 和改制后 BOM。

### 用例 5：报告下载

步骤：

1. 等任务完成。
2. 点击下载报告。
3. 解压报告 zip。

预期：

- 下载文件是 zip。
- zip 内包含：

```text
input/
reports/
logs/
```

- 每个成功项目包含：

```text
BOM表改制检查报告.xlsx
```

### 用例 6：Excel 报告结构

步骤：

1. 打开 `BOM表改制检查报告.xlsx`。
2. 检查 sheet 和表头。

预期 sheet：

- `改制单核对`
- `BOM差异核对`
- `替代料关系核对`
- `客户限制核对`
- `summary`

预期明细前置列：

```text
检查类、结论、说明、物料代码、用量、位号、操作、改制前数量、改制前位号、改制后数、改制后位号、改制前状态、改制前、改制单、改制后状态、改制后、规格型号
```

预期格式：

- `异常` 行黄色。
- `人工复查` 行黄色。
- `正常` 和 `跳过` 行不标黄。
- `summary` 中异常、人工复查、跳过数量与明细一致。

### 用例 7：任务统计

步骤：

1. 在任务列表查看结果统计。
2. 对照各项目报告 summary。

预期：

- 改制单异常数量等于所有项目 `改制单核对` 异常数之和。
- BOM差异异常数量等于所有项目 `BOM差异核对` 异常数之和。
- 替代料异常数量等于所有项目 `替代料关系核对` 异常数之和。
- 客户限制异常数量等于所有项目 `客户限制核对` 异常数之和。
- 人工复查和跳过数量为所有项目加总。

## 异常测试

### 用例 8：缺少改制前BOM文件夹

输入：

```text
projects/
  改制后BOM/
  改制表/
  公司物料表/
```

预期：

- 任务不应静默成功。
- 批量汇总或错误信息明确写出缺少 `改制前BOM`。

### 用例 9：改制表匹配不到 BOM

输入：

- 改制表写 `P8S150A-69999-1.0`
- BOM 文件夹没有 `9999-1.0`

预期：

- 该改制表记录为失败。
- 失败原因包含“匹配不到改制前 BOM”或“匹配不到改制后 BOM”。
- 其他改制表继续处理。

### 用例 10：BOM 匹配到多份

输入：

```text
改制前BOM/
  BOM-SST26-1101-1.0-备货-006.xlsx
  BOM-SST26-1101-1.0-备货-007.xlsx
```

预期：

- 该改制表记录为失败。
- 失败原因包含“匹配到多份”或“匹配不唯一”。

### 用例 11：缺少公司物料表

输入：

```text
projects/
  改制前BOM/
  改制后BOM/
  改制表/
```

预期：

- 任务失败或批量汇总记录失败。
- 错误信息明确写出缺少公司物料表。

### 用例 12：上传空文件

步骤：

1. 上传 0 字节压缩包。

预期：

- 后端返回 `400`。
- 错误信息：`项目压缩包不能为空`。

### 用例 13：上传非压缩包

步骤：

1. 上传 `.xlsx` 或 `.txt`。

预期：

- 后端返回 `400`。
- 错误信息：`项目压缩包必须是 .zip、.rar 或 .7z 文件`。

### 用例 14：无权限访问他人任务

步骤：

1. 用户 A 创建任务。
2. 用户 B 访问该任务详情或下载报告。

预期：

- 返回 `403`。

### 用例 15：管理员查看全部任务

步骤：

1. 管理员打开 `/tasks/bom-change-check-manage`。

预期：

- 能查看所有用户任务。
- 普通用户访问 `scope=all` 返回 `403`。

## 回归测试清单

每次修改后至少执行：

```powershell
python C:\Users\admin\.codex\skills\bom-change-check\scripts\test_check_bom_change.py
```

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server\backend
uv run pytest tests/services/test_bom_change_check_task_service.py tests/api/routes/test_bom_change_check_tasks.py -q
```

```powershell
cd D:\PeiChengAI\Agent\code_review_platform\code_review_server\frontend
npm run build
```

## 验收标准

满足以下条件可认为本模块通过验收：

- 页面可提交一个项目压缩包。
- 后端能解压固定分类文件夹。
- Codex prompt 明确使用 `$bom-change-check` skill。
- 改制表能按上下规格型号匹配改制前/后 BOM。
- 每个改制表生成一个 `BOM表改制检查报告.xlsx`。
- 明细列顺序与截图一致。
- 异常行和人工复查行标黄。
- 下载 zip 中包含输入、报告和日志。
- 任务列表统计与报告 summary 一致。
- 失败原因能定位到缺少文件、匹配不到、匹配不唯一、Codex 执行失败等具体问题。
