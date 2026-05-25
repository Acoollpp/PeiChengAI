# Codex 代码审查 Web 服务

## 本地启动

如果尚未安装 `uv`，请先使用 Astral 的 uv 安装器，或按组织批准的方式安装。
当前依赖固定版本暂不支持 Python 3.14，请使用 Python 3.11-3.13。
在普通用户终端中，如果 `uv` 已配置到 `PATH`，可以直接使用下面的 `uv` 命令；在当前 Codex shell 中，直接调用 `uv` 可能不可用，可改用 `python -m uv`，例如 `python -m uv run pytest -v`。

真实 Codex 运行依赖服务工作目录下存在 `skills/通用-代码变更审查`。部署或手动启动服务前，请确认该目录随运行环境一起准备好。

```powershell
uv sync
uv run uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

启动后打开：

```text
http://127.0.0.1:8000
```

## 页面功能

- 提交任务：在首页填写 SVN URL、旧修订号、新修订号和请求人，页面会调用 `POST /api/tasks` 创建审查任务。
- 轮询状态：任务提交后，页面会约每 2.5 秒调用 `GET /api/tasks/{task_id}` 刷新 pending/running 任务状态。
- 预览报告：任务成功且报告可用时，页面会调用 `GET /api/tasks/{task_id}/report` 并在 Markdown 预览区展示内容。
- 下载报告：报告可用后，页面提供 `GET /api/tasks/{task_id}/download` 下载入口。
- 最近任务：页面启动和提交后会调用 `GET /api/tasks` 展示最近任务列表，点击条目可查看对应任务。

## 测试

```powershell
uv run pytest
```

如遇到当前 shell 找不到 `uv`，可使用：

```powershell
python -m uv run pytest -v
```

## 本地假 Codex 冒烟验证

不连接真实 Codex 或 SVN 时，可以用 `tools/fake_codex.py` 验证报告输出链路。该脚本会解析 prompt 中的 `- 报告输出路径：...`，创建父目录，并写入一份 Markdown 报告。

```powershell
$report = Join-Path $env:TEMP "codex-fake-report.md"
python -m uv run python tools/fake_codex.py "- 报告输出路径：$report"
Test-Path $report
Get-Content $report -Encoding UTF8
```

如果要让 Web 服务 worker 走假 Codex，可在启动服务前设置：

```powershell
$fakeCodex = (Resolve-Path .\tools\fake_codex.py).Path
$env:CODEX_COMMAND = "python"
$env:CODEX_ARGS = "`"$fakeCodex`""
python -m uv run uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

这里必须使用 `fake_codex.py` 的绝对路径，因为 Worker 会在每个任务自己的 `data/workspaces/<task_id>/` 目录下执行命令。

## 手动验证清单

1. 运行自动化测试：`python -m uv run pytest -v`。
2. 启动服务：`python -m uv run uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000`。
3. 打开 `http://127.0.0.1:8000`，确认页面能加载。
4. 提交一个不符合 `SVN_ALLOWED_PREFIX` 的非法 SVN URL，确认页面展示校验失败。
5. 使用上面的假 Codex 配置启动服务，提交一条合法任务，确认任务成功并能预览或下载假 Markdown 报告。

## 关键环境配置

- `APP_BASE_DIR`：应用基础目录，默认当前工作目录。
- `DATABASE_PATH`：SQLite 数据库路径，默认 `data/app.db`。
- `SVN_ALLOWED_PREFIX`：允许审查的 SVN 地址前缀。
- `CODEX_COMMAND`：Codex 命令，默认 `codex`。
- `CODEX_ARGS`：Codex 参数，默认 `exec --dangerously-bypass-approvals-and-sandbox`。
- `CODEX_TIMEOUT_SECONDS`：Codex 执行超时时间，默认 1800 秒。
- `WORKER_POLL_SECONDS`：Worker 轮询间隔，默认 2 秒。

SVN 凭据必须已在服务器运行账号下提前配置完成。
