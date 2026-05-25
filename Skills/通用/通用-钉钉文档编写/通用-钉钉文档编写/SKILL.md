---
name: 通用-钉钉文档编写
description: 用于把用户提供的 Markdown、报告、SOP、故障分析、测试文档或说明文档写入到指定钉钉文档文件夹。适用于用户给出钉钉 alidocs 文件夹链接并要求“写入这个文件夹”“生成钉钉文档”“创建文档但不通知”“创建后通知某人”等场景。支持使用钉钉应用凭证、操作者 unionId、文件夹 URL 创建文档、覆盖写入正文，并可选发送工作通知。
---

# 通用-钉钉文档编写

## 适用场景

当用户要求把一段正文、Markdown 报告、测试文档、SOP、故障分析或操作说明写入钉钉文档，并提供 `https://alidocs.dingtalk.com/i/nodes/...` 文件夹链接时，使用本技能。

典型请求：
- “把这篇文档写入这个钉钉文件夹”
- “生成一份测试文档到这个文件夹地址下”
- “写入钉钉文档，不需要发送通知”
- “写完后通知某某，说明是谁写的”

## 必要输入

优先从用户请求或上下文中确认：
- 钉钉文件夹链接：必须是文件夹节点链接，不是普通文档链接。
- 文档标题：用户未指定时，根据正文主题生成简洁标题。
- 文档正文：优先保留用户提供的 Markdown 结构。
- 操作者 `unionId`：必须由用户提供，作为文档接口的 `operatorId`；不要通过通讯录接口自动查询。
- 是否通知：用户未要求通知时不要发送通知。
- 通知对象：只有用户明确要求通知时才处理；优先要求用户提供通知对象 `userId`。

## 首次调用自安装

每次使用本技能时，先确认当前技能目录是否已经位于 Codex 全局 skills 目录。全局目录按以下规则解析：

1. 如果存在环境变量 `CODEX_HOME`，使用 `$CODEX_HOME\skills`。
2. 否则使用 `$env:USERPROFILE\.codex\skills`。

如果当前 `SKILL.md` 不在全局目录下，必须在调用钉钉接口前执行一次自安装：

1. 将当前技能目录整体复制到全局目录下的 `通用-钉钉文档编写`。
2. 如果目标目录已存在，保留目标目录中已有的非空 `secret.txt`，只覆盖 `SKILL.md`、`agents` 和其他非敏感资源。
3. 如果目标目录不存在，完整复制当前技能目录，包括已有 `secret.txt`。
4. 在源目录写入 `.codex-installed` 标记文件，记录安装目标路径和时间；后续从同一源目录调用时，如全局目录已存在本技能，可跳过复制。
5. 自安装过程不得打印 `secret.txt` 内容，只能报告是否安装成功、目标路径和是否保留了已有凭证文件。

PowerShell 参考实现：

```powershell
$skillName = '通用-钉钉文档编写'
$sourceDir = Split-Path -Parent $PSCommandPath
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$globalSkills = Join-Path $codexHome 'skills'
$targetDir = Join-Path $globalSkills $skillName

if (!(Test-Path -LiteralPath $globalSkills)) {
  New-Item -ItemType Directory -Path $globalSkills | Out-Null
}

$sourceFull = [IO.Path]::GetFullPath($sourceDir)
$targetFull = [IO.Path]::GetFullPath($targetDir)
if ($sourceFull.TrimEnd('\') -ne $targetFull.TrimEnd('\')) {
  if (!(Test-Path -LiteralPath $targetDir)) {
    Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse -Force
  } else {
    Copy-Item -LiteralPath (Join-Path $sourceDir 'SKILL.md') -Destination (Join-Path $targetDir 'SKILL.md') -Force
    if (Test-Path -LiteralPath (Join-Path $sourceDir 'agents')) {
      Copy-Item -LiteralPath (Join-Path $sourceDir 'agents') -Destination $targetDir -Recurse -Force
    }
    if (!(Test-Path -LiteralPath (Join-Path $targetDir 'secret.txt')) -and
        (Test-Path -LiteralPath (Join-Path $sourceDir 'secret.txt'))) {
      Copy-Item -LiteralPath (Join-Path $sourceDir 'secret.txt') -Destination (Join-Path $targetDir 'secret.txt') -Force
    }
  }
  "installed=$targetDir`ntime=$(Get-Date -Format o)" |
    Set-Content -LiteralPath (Join-Path $sourceDir '.codex-installed') -Encoding UTF8
}
```

## 凭证与配置

不得把 AppSecret、token 或完整敏感凭证写入钉钉文档正文、最终回复或调试输出。

本技能提供统一脚本入口：`scripts/dingtalk-doc.ps1`。工程师调用本技能时优先使用该脚本，不要临时手写一套接口流程；只有脚本缺失或需要排查脚本本身时，才参考后面的手动接口流程。

当前已验证的钉钉文档编写专用应用：
- `DINGTALK_APP_KEY`：`dingiolgwed1iim5f3ui`
- `DINGTALK_APP_SECRET`：默认从本 skill 目录下的 `secret.txt` 读取。
- 操作者 `unionId`：默认从本 skill 目录下的 `secret.txt` 读取。
- `DINGTALK_AGENT_ID`：仅发送工作通知需要；只创建并写入文档时不需要。

运行钉钉接口时按以下顺序读取配置：
1. 本 skill 目录下的 `secret.txt`。
2. 当前进程环境变量。
3. 用户当次输入。

`secret.txt` 是固定键值格式，不要按“三行裸值”解析。固定格式如下：

```text
appKey: <钉钉应用 appKey>
appSecret: <钉钉应用 appSecret>
operatorUnionId: <操作者 unionId>
```

读取 `secret.txt` 时必须按键值格式解析字段名和值，分隔符支持英文冒号 `:`、中文冒号 `：` 或等号 `=`。不要把整行当作凭证值发送给钉钉。

固定字段名：
- `appKey` 或 `DINGTALK_APP_KEY`
- `appSecret` 或 `DINGTALK_APP_SECRET`
- `operatorUnionId`、`unionId`、`operatorId` 或 `DINGTALK_OPERATOR_ID`
- `agentId` 或 `DINGTALK_AGENT_ID`（仅发送工作通知需要）

随技能提供 `secret.example.txt`，工程师第一次使用时复制为 `secret.txt` 并填写。`secret.txt` 已被 `.gitignore` 忽略，不要提交真实凭证。

环境变量名称：
- `DINGTALK_APP_KEY`
- `DINGTALK_APP_SECRET`
- `DINGTALK_OPERATOR_ID` 或用户提供的操作者 
- `DINGTALK_AGENT_ID`（仅发送工作通知需要）

如果从 `secret.txt` 和环境变量都无法获取必要配置，向用户一次性说明缺少哪些信息。只创建并写入文档时，必要配置为 `appKey`、`appSecret`、操作者 `unionId`。

读取 `secret.txt` 时不得打印文件内容，只能报告是否存在、是否缺字段、是否读取成功。

如果 `secret.txt` 中存在 `unionId:`、`operatorUnionId:` 或 `operatorId:` 但值为空，或文件中完全缺少操作者 `unionId` 字段，而用户已经在当前会话提供了操作者 `unionId`，必须把该值写回 `secret.txt`，避免后续重复询问。写回时只补齐 unionId 字段，不改动 appKey、appSecret 或其他已有内容；保持键值格式；写回后只回读确认字段已非空，不输出真实值。

PowerShell 读取函数应使用以下模式，禁止退回到三行裸值解析：

```powershell
function Read-DingTalkSecret($path) {
  $result = @{}
  if (!(Test-Path -LiteralPath $path)) { return $result }
  $lines = Get-Content -LiteralPath $path -Encoding UTF8 |
    Where-Object { $_ -and $_.Trim() -and !$_.Trim().StartsWith('#') }
  foreach ($line in $lines) {
    if ($line -match '^\s*([^:=：]+)\s*[:=：]\s*(.*?)\s*$') {
      $result[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $result
}
```

当用户在当前会话提供了 `operatorUnionId`，且 `secret.txt` 中操作者字段为空或缺失时，必须立即最小写回。示例：

```powershell
function Save-OperatorUnionId($path, $operatorUnionId) {
  if ([string]::IsNullOrWhiteSpace($operatorUnionId)) { return $false }
  $lines = if (Test-Path -LiteralPath $path) {
    @(Get-Content -LiteralPath $path -Encoding UTF8)
  } else { @() }
  $found = $false
  $updated = $false
  $newLines = foreach ($line in $lines) {
    if ($line -match '^\s*(operatorUnionId|unionId|operatorId|DINGTALK_OPERATOR_ID)\s*([:=：])\s*(.*?)\s*$') {
      $found = $true
      if ([string]::IsNullOrWhiteSpace($matches[3])) {
        $updated = $true
        "$($matches[1]): $operatorUnionId"
      } else { $line }
    } else { $line }
  }
  if (!$found) {
    $newLines = @($newLines) + "operatorUnionId: $operatorUnionId"
    $updated = $true
  }
  if ($updated) {
    Set-Content -LiteralPath $path -Value $newLines -Encoding UTF8
  }
  return $updated
}
```

## 已验证权限清单

使用 `dingiolgwed1iim5f3ui` 应用在 2026-05-14 已验证“不通知，只创建并写入钉钉文档”流程可用。

已验证需要的权限：
- `Wiki.Node.Read` 或等价知识库节点读取权限：用于通过文件夹链接解析 `workspaceId` 和 `nodeId`。
- `Document.WorkspaceDocument.Write`：用于在指定知识库文件夹下创建文档。
- 文档正文写入权限：用于 `overwriteContent` 覆盖写入 Markdown 正文。

不发送通知时不需要 `DINGTALK_AGENT_ID`，也不需要工作通知权限。

如果要“创建后通知某人”，还需要：
- 企业内部应用 `AgentId`。
- 工作通知发送能力。
- 通知对象 `userId`，且通知对象在应用可见范围内。

已验证成功样例：
- 操作者：程昊。
- 文件夹链接：`https://alidocs.dingtalk.com/i/nodes/qnYMoO1rWxDKKZZ1Uzn9wz7bW47Z3je9?utm_scene=team_space`。
- 创建文档：`钉钉文档写入权限测试`。
- 成功文档链接：`https://alidocs.dingtalk.com/i/nodes/ydxXB52LJq733jj1SMqjk7geWqjMp697`。

## 标准流程

1. 执行“首次调用自安装”检查，确保本技能已同步到 Codex 全局 skills 目录。
2. 校验输入：确认钉钉文件夹链接、文档标题、正文、操作者 `unionId`、是否需要通知。
3. 运行配置自检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dingtalk-doc.ps1 -CheckConfigOnly
```

4. 如果用户已在当前会话提供 `operatorUnionId`，但 `secret.txt` 中为空，调用脚本时传入 `-OperatorUnionId`，脚本会最小写回 `secret.txt`。
5. 创建并写入文档时优先使用统一脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dingtalk-doc.ps1 `
  -FolderUrl "https://alidocs.dingtalk.com/i/nodes/..." `
  -Title "测试报告_20260514" `
  -ContentPath ".\report.md"
```

也可以直接传 Markdown 字符串：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dingtalk-doc.ps1 `
  -FolderUrl "https://alidocs.dingtalk.com/i/nodes/..." `
  -Title "测试报告_20260514" `
  -ContentMarkdown "## 测试概述`n本轮测试通过。"
```

6. 如果用户要求通知，额外传入 `-NotifyUserId`；此时 `secret.txt` 或环境变量必须提供 `agentId`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dingtalk-doc.ps1 `
  -FolderUrl "https://alidocs.dingtalk.com/i/nodes/..." `
  -Title "测试报告_20260514" `
  -ContentPath ".\report.md" `
  -NotifyUserId "钉钉 userId"
```

7. 脚本成功时返回 JSON，包含 `success`、`title`、`url`、可选 `notifyTaskId`。最终回复用户只输出这些非敏感信息。

## 手动接口流程

仅当统一脚本不可用或排查脚本问题时使用：

1. 优先用键值解析函数从 `secret.txt` 获取操作者 `unionId`。如果缺失或为空，再从当前会话找用户是否已经提供过 `operatorUnionId`；已提供则立即调用 `Save-OperatorUnionId` 最小写回 `secret.txt`，以后直接复用该值；仍缺失才询问用户。将该 `unionId` 作为文档接口 `operatorId`，不要调用通讯录接口自动查询 `unionId`。
2. 获取新版 token：调用 `https://api.dingtalk.com/v1.0/oauth2/accessToken`。
3. 通过文件夹 URL 查询节点：调用 `https://api.dingtalk.com/v2.0/wiki/nodes/queryByUrl?operatorId=...`。
4. 确认节点类型为文件夹，并从返回中提取 `workspaceId` 和文件夹 `nodeId`。
5. 创建文档：调用 `https://api.dingtalk.com/v1.0/doc/workspaces/{workspaceId}/docs`，请求体包含 `operatorId`、`docType: "DOC"`、`name`、`parentNodeId`。
6. 从创建响应中提取 `docKey` 或 `dentryUuid`，用于正文写入；提取 `url` 或用 `nodeId` 兜底拼出文档链接。
7. 覆盖写入正文：调用 `https://api.dingtalk.com/v1.0/doc/suites/documents/{docKey}/overwriteContent?operatorId=...`，请求体包含 `operatorId`、`content`、`contentType: "markdown"`；正文不要重复写一遍与文档名相同的标题。
8. 如果用户要求通知，使用用户提供的通知对象 `userId` 和应用 `AgentId` 调用工作通知接口发送文档链接。

## 常见权限错误与补开项

遇到钉钉返回 `60011` 或 `AccessTokenPermissionDenied` 时，按错误里的 `requiredScopes` 补开权限。

已遇到并确认过的缺失项：
- `Document.WorkspaceDocument.Write`：创建文档失败。

补开权限后直接重跑流程，不需要改正文内容。

## PowerShell 执行要点

当前环境优先按 Windows/PowerShell 思考。

发送 JSON 请求体时，必须声明 UTF-8，避免中文变成问号：

```powershell
$json = $body | ConvertTo-Json -Depth 20 -Compress
Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=utf-8" -Body $json
```

如果接口返回 JSON 解析错误，先检查 `Body` 是否被错误传成 byte array 或对象数组；优先改为 JSON 字符串发送并保留 `charset=utf-8`。

## 文档内容要求

写入文档时：
- 保留用户原始标题、层级、表格、代码块和列表。
- 钉钉文档已经有独立文档名，正文开头不需要再重复写同名一级标题；如果用户正文第一行是 `# 文档名` 或与文档名等价的标题，写入前应移除这一行，正文直接从日期、记录人、摘要或第一个章节开始。
- 不要擅自删减用户给出的技术细节、IP、端口、命令和验证结果。
- 可以修正 Markdown 围栏语言，例如 SQL 用 `sql`，命令用 `bash` 或 `powershell`。
- 用户要求“不要通知”时，只创建和写入文档，不调用工作通知接口。

## 通知要求

仅当用户明确要求通知时执行。

通知内容应包含：
- 文档已经制作完成。
- 文档标题。
- 文档链接。
- 用户要求时说明“由谁编写”。

通知正文同样使用 UTF-8 JSON 发送，避免中文乱码。

## 输出要求

最终回复用户时只给关键信息：
- 是否成功。
- 文档标题。
- 文档链接。
- 如发送通知，说明通知对象和 task_id。
- 如失败，说明失败步骤和钉钉返回的关键错误。

不要输出 access_token、AppSecret 或完整敏感凭证。
