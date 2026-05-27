# Codex 代码审查 Web 服务

## 本地启动

如果尚未安装 `uv`，请先使用 Astral 的 uv 安装器，或按组织批准的方式安装。
当前依赖固定版本暂不支持 Python 3.14，请使用 Python 3.11-3.13。
在普通用户终端中，如果 `uv` 已配置到 `PATH`，可以直接使用下面的 `uv` 命令；在当前 Codex shell 中，直接调用 `uv` 可能不可用，可改用 `python -m uv`，例如 `python -m uv run pytest -v`。

真实 Codex 运行依赖服务工作目录下存在 `skills/通用-代码变更审查`。部署或手动启动服务前，请确认该目录随运行环境一起准备好。

### 1. 安装依赖

```powershell
uv sync
```

如当前终端找不到 `uv`，可使用：

```powershell
python -m uv sync
```

### 2. 准备 PostgreSQL 和 Redis

本版本使用 PostgreSQL 保存用户和任务状态，使用 Redis 保存用户队列、运行锁和 SSE 通知。

默认连接信息：

```text
PostgreSQL: postgresql://postgres:postgres@127.0.0.1:5432/code_review
Redis:      redis://127.0.0.1:6379/0
```

Windows 本地开发建议把数据库组件放在 `D:\SQL`，避免安装到 C 盘。目录约定如下：

```text
D:\SQL\PostgreSQL\pgsql        PostgreSQL 二进制文件
D:\SQL\PostgreSQL\data         PostgreSQL 数据目录
D:\SQL\Redis                   Redis 二进制文件
D:\SQL\Redis\data              Redis 数据目录
D:\SQL\downloads               安装包缓存
```

首次准备 PostgreSQL 和 Redis：

```powershell
New-Item -ItemType Directory -Force -Path "D:\SQL\downloads","D:\SQL\PostgreSQL","D:\SQL\Redis","D:\SQL\Redis\data" | Out-Null

Invoke-WebRequest `
  -Uri "https://get.enterprisedb.com/postgresql/postgresql-17.10-1-windows-x64-binaries.zip" `
  -OutFile "D:\SQL\downloads\postgresql-17.10-1-windows-x64-binaries.zip" `
  -UseBasicParsing

Invoke-WebRequest `
  -Uri "https://github.com/redis-windows/redis-windows/releases/download/8.6.3/Redis-8.6.3-Windows-x64-msys2.zip" `
  -OutFile "D:\SQL\downloads\Redis-8.6.3-Windows-x64-msys2.zip" `
  -UseBasicParsing

Expand-Archive "D:\SQL\downloads\postgresql-17.10-1-windows-x64-binaries.zip" -DestinationPath "D:\SQL\PostgreSQL" -Force

$redisTmp = "D:\SQL\Redis_extract_tmp"
Remove-Item $redisTmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $redisTmp | Out-Null
Expand-Archive "D:\SQL\downloads\Redis-8.6.3-Windows-x64-msys2.zip" -DestinationPath $redisTmp -Force
Copy-Item "$redisTmp\Redis-8.6.3-Windows-x64-msys2\*" "D:\SQL\Redis" -Recurse -Force
Remove-Item $redisTmp -Recurse -Force
```

初始化并启动 PostgreSQL：

```powershell
$pgBin = "D:\SQL\PostgreSQL\pgsql\bin"
$pgData = "D:\SQL\PostgreSQL\data"

if (-not (Test-Path "$pgData\PG_VERSION")) {
  New-Item -ItemType Directory -Force -Path $pgData | Out-Null
  Set-Content "D:\SQL\PostgreSQL\pgpass_init.txt" "postgres" -Encoding ASCII
  & "$pgBin\initdb.exe" -D $pgData -U postgres -A scram-sha-256 --pwfile="D:\SQL\PostgreSQL\pgpass_init.txt" -E UTF8 --no-locale --locale-provider=builtin
  Remove-Item "D:\SQL\PostgreSQL\pgpass_init.txt" -Force
}

& "$pgBin\pg_ctl.exe" start -D $pgData -l "D:\SQL\PostgreSQL\postgres.log" -o '"-p 5432"'

$env:PGPASSWORD = "postgres"
& "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "SELECT 'CREATE DATABASE code_review' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'code_review')\gexec"
```

启动 Redis：

```powershell
Start-Process `
  -FilePath "D:\SQL\Redis\redis-server.exe" `
  -ArgumentList @("--dir","D:\SQL\Redis\data","--port","6379") `
  -WorkingDirectory "D:\SQL\Redis" `
  -WindowStyle Hidden
```

日常只需要启动已初始化好的服务进程：

```powershell
& "D:\SQL\PostgreSQL\pgsql\bin\pg_ctl.exe" start -D "D:\SQL\PostgreSQL\data" -l "D:\SQL\PostgreSQL\postgres.log" -o '"-p 5432"'
Start-Process -FilePath "D:\SQL\Redis\redis-server.exe" -ArgumentList @("--dir","D:\SQL\Redis\data","--port","6379") -WorkingDirectory "D:\SQL\Redis" -WindowStyle Hidden
```

验证数据库可用：

```powershell
$env:PGPASSWORD = "postgres"
& "D:\SQL\PostgreSQL\pgsql\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d code_review -c "SELECT version();"
& "D:\SQL\Redis\redis-cli.exe" -h 127.0.0.1 -p 6379 ping
```

Redis 验证成功会输出 `PONG`。如果 PostgreSQL 初始化时报 `postgresql.conf` 语法错误，且当前用户对该文件已有完全控制但仍然 `Access is denied`，通常不是项目配置问题，而是公司终端管控、文件系统过滤驱动或安全策略拦截了 PostgreSQL 子进程读写数据目录。请向 IT 申请放行 `D:\SQL\PostgreSQL\pgsql\bin\initdb.exe`、`postgres.exe`、`pg_ctl.exe`、`psql.exe` 对 `D:\SQL\PostgreSQL\data` 的读写执行权限，或申请允许以管理员权限把 PostgreSQL 安装到 `D:\SQL\PostgreSQL\17`。

请先确认 PostgreSQL 中已存在 `code_review` 数据库。表结构会在应用启动时自动创建。

PowerShell 环境变量示例：

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
$env:REDIS_URL = "redis://127.0.0.1:6379/0"
$env:SESSION_SECRET_KEY = "local-dev-session-secret"
```

生产环境必须显式设置 `SESSION_SECRET_KEY`，不要使用上面的本地示例值。

### 3. 云服务器启动示例

如果本机受公司终端管控影响，建议直接在云服务器上运行 PostgreSQL、Redis 和 Web 服务。以下示例按 Ubuntu/Debian 编写：

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv postgresql redis-server
sudo systemctl enable --now postgresql redis-server
```

创建数据库和用户：

```bash
sudo -u postgres psql <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'code_review') THEN
    CREATE ROLE code_review LOGIN PASSWORD 'change-me';
  END IF;
END
$$;

SELECT 'CREATE DATABASE code_review OWNER code_review'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'code_review')\gexec
SQL
```

进入项目目录后安装依赖并启动：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install uv
uv sync

export DATABASE_URL="postgresql://code_review:change-me@127.0.0.1:5432/code_review"
export REDIS_URL="redis://127.0.0.1:6379/0"
export SESSION_SECRET_KEY="replace-with-a-long-random-secret"

uv run uvicorn app.asgi:app --host 0.0.0.0 --port 8000
```

云服务器安全组或防火墙需要放行 Web 端口，例如 `8000`。PostgreSQL 和 Redis 如果只给本机应用使用，保持监听 `127.0.0.1` 即可，不要暴露到公网。

### 4. 启动服务

```powershell
uv run uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

如当前终端找不到 `uv`，可使用：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

启动后打开登录页：

```text
http://127.0.0.1:8000/login
```

登录后会跳转到任务台首页。首页本身也会在未登录时自动跳转到 `/login`。

## 页面功能

- 登录：打开首页前先在 `/login` 使用姓名和手机号创建 session。
- 提交任务：在首页填写 SVN URL、旧修订号和新修订号，页面会调用 `POST /api/tasks` 创建当前用户的审查任务。
- 动态刷新：任务提交后，页面通过 `GET /api/events` 建立 SSE 连接，并在任务创建或更新时刷新列表和当前报告。
- 预览报告：任务成功且报告可用时，页面会调用 `GET /api/tasks/{task_id}/report` 并在 Markdown 预览区展示内容。
- 下载报告：报告可用后，页面提供 `GET /api/tasks/{task_id}/download` 下载入口。
- 最近任务：页面启动、提交和 SSE 事件到达后会调用 `GET /api/tasks` 展示当前用户任务列表，点击条目可查看对应任务。

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
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
$env:REDIS_URL = "redis://127.0.0.1:6379/0"
$env:SESSION_SECRET_KEY = "local-dev-session-secret"
uv run uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

这里必须使用 `fake_codex.py` 的绝对路径，因为 Worker 会在每个任务自己的 `data/workspaces/<task_id>/` 目录下执行命令。

## 手动验证清单

1. 运行自动化测试：`python -m uv run pytest -v`。
2. 准备 PostgreSQL 和 Redis，并设置：

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/code_review"
$env:REDIS_URL = "redis://127.0.0.1:6379/0"
$env:SESSION_SECRET_KEY = "local-dev-session-secret"
.\.venv\Scripts\python.exe -m uvicorn app.asgi:app --reload --host 127.0.0.1 --port 8000
```

3. 打开 `http://127.0.0.1:8000/login`，使用姓名和手机号登录。
4. 提交一个不符合 `SVN_ALLOWED_PREFIX` 的非法 SVN URL，确认页面展示校验失败。
5. 使用上面的假 Codex 配置启动服务，提交一条合法任务，确认任务成功并能通过 SSE 自动刷新、预览或下载假 Markdown 报告。

### 手动提交任务时的注意点

- SVN URL 必须以 `SVN_ALLOWED_PREFIX` 开头，默认是 `https://192.168.0.233/svn/src_home/`。
- 修订号可以填 `100` 或 `r100`，服务会统一规范成小写 `r100`。
- 每个用户同一时间只会运行一个任务；同一用户后续任务会留在 Redis 队列中等待。
- PostgreSQL 是事实源；Redis 仅保存队列、锁和事件通知，必要时可按 pending 任务重建队列。

## 关键环境配置

- `APP_BASE_DIR`：应用基础目录，默认当前工作目录。
- `DATABASE_URL`：PostgreSQL 连接串，默认 `postgresql://postgres:postgres@127.0.0.1:5432/code_review`。
- `REDIS_URL`：Redis 连接串，默认 `redis://127.0.0.1:6379/0`。
- `SVN_EXPORTS_DIR`：任务 SVN 导出根目录，默认 `data/svn_exports`；每个任务使用 `<task_id>/` 子目录，任务结束后会自动清理该子目录。
- `SESSION_SECRET_KEY`：session cookie 签名密钥，生产环境必须显式设置。
- `WORKER_ID`：worker 标识，用于任务 claim 诊断。
- `REDIS_LOCK_TTL_SECONDS`：用户运行锁 TTL，默认 3600 秒。
- `HEARTBEAT_SECONDS`：worker 心跳间隔配置，默认 30 秒。
- `SVN_ALLOWED_PREFIX`：允许审查的 SVN 地址前缀。
- `CODEX_COMMAND`：Codex 命令，默认 `codex`。
- `CODEX_ARGS`：Codex 参数，默认 `exec --dangerously-bypass-approvals-and-sandbox`。
- `CODEX_TIMEOUT_SECONDS`：Codex 执行超时时间，默认 1800 秒。
- `WORKER_POLL_SECONDS`：Worker 轮询间隔，默认 2 秒。

SVN 凭据必须已在服务器运行账号下提前配置完成。
