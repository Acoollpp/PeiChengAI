param(
  [string]$FolderUrl,
  [string]$Title,
  [string]$ContentPath,
  [string]$ContentMarkdown,
  [string]$OperatorUnionId,
  [string]$NotifyUserId,
  [string]$NotifyText,
  [string]$SecretPath,
  [switch]$CheckConfigOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $PSCommandPath
$SkillDir = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($SecretPath)) {
  $SecretPath = Join-Path $SkillDir 'secret.txt'
}

function Read-DingTalkSecret($path) {
  $result = @{}
  if (!(Test-Path -LiteralPath $path)) { return $result }
  $lines = Get-Content -LiteralPath $path -Encoding UTF8 |
    Where-Object { $_ -and $_.Trim() -and !$_.Trim().StartsWith('#') }
  foreach ($line in $lines) {
    $normalized = $line.Replace([char]0xFF1A, ':')
    if ($normalized -match '^\s*([^:=]+)\s*[:=]\s*(.*?)\s*$') {
      $result[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $result
}

function Save-OperatorUnionId($path, $operatorUnionId) {
  if ([string]::IsNullOrWhiteSpace($operatorUnionId)) { return $false }
  $parent = Split-Path -Parent $path
  if (!(Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }
  $lines = if (Test-Path -LiteralPath $path) {
    @(Get-Content -LiteralPath $path -Encoding UTF8)
  } else { @() }
  $found = $false
  $updated = $false
  $newLines = foreach ($line in $lines) {
    $normalized = $line.Replace([char]0xFF1A, ':')
    if ($normalized -match '^\s*(operatorUnionId|unionId|operatorId|DINGTALK_OPERATOR_ID)\s*([:=])\s*(.*?)\s*$') {
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

function Pick-Value($map, [string[]]$keys) {
  foreach ($key in $keys) {
    if ($map.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($map[$key])) {
      return $map[$key]
    }
  }
  return $null
}

function Get-ErrorBody($exception) {
  try {
    if ($exception.Response -and $exception.Response.GetResponseStream()) {
      $reader = New-Object IO.StreamReader($exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)
      $text = $reader.ReadToEnd()
      if (![string]::IsNullOrWhiteSpace($text)) { return $text }
    }
  } catch {}
  if ($exception.ErrorDetails -and $exception.ErrorDetails.Message) {
    return $exception.ErrorDetails.Message
  }
  return $exception.Message
}

function Invoke-JsonPost($stage, $uri, $headers, $body) {
  try {
    $json = $body | ConvertTo-Json -Depth 30 -Compress
    return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $json
  } catch {
    $bodyText = Get-ErrorBody $_.Exception
    throw ([Exception]::new("$stage :: $bodyText", $_.Exception))
  }
}

function Require-Value($name, $value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "缺少必要配置：$name"
  }
}

$secret = Read-DingTalkSecret $SecretPath

if ([string]::IsNullOrWhiteSpace($OperatorUnionId)) {
  $OperatorUnionId = Pick-Value $secret @('operatorUnionId','unionId','operatorId','DINGTALK_OPERATOR_ID')
}
if ([string]::IsNullOrWhiteSpace($OperatorUnionId)) {
  $OperatorUnionId = $env:DINGTALK_OPERATOR_ID
}
if (![string]::IsNullOrWhiteSpace($OperatorUnionId)) {
  $null = Save-OperatorUnionId $SecretPath $OperatorUnionId
  $secret = Read-DingTalkSecret $SecretPath
}

$appKey = Pick-Value $secret @('appKey','DINGTALK_APP_KEY')
if ([string]::IsNullOrWhiteSpace($appKey)) { $appKey = $env:DINGTALK_APP_KEY }
if ([string]::IsNullOrWhiteSpace($appKey)) { $appKey = 'dingiolgwed1iim5f3ui' }

$appSecret = Pick-Value $secret @('appSecret','DINGTALK_APP_SECRET')
if ([string]::IsNullOrWhiteSpace($appSecret)) { $appSecret = $env:DINGTALK_APP_SECRET }

$agentId = Pick-Value $secret @('agentId','DINGTALK_AGENT_ID')
if ([string]::IsNullOrWhiteSpace($agentId)) { $agentId = $env:DINGTALK_AGENT_ID }

$config = [ordered]@{
  success = $true
  secretPath = $SecretPath
  hasAppKey = -not [string]::IsNullOrWhiteSpace($appKey)
  hasAppSecret = -not [string]::IsNullOrWhiteSpace($appSecret)
  hasOperatorUnionId = -not [string]::IsNullOrWhiteSpace($OperatorUnionId)
  hasAgentId = -not [string]::IsNullOrWhiteSpace($agentId)
}
if ($CheckConfigOnly) {
  $config | ConvertTo-Json -Compress
  exit 0
}

Require-Value 'FolderUrl' $FolderUrl
Require-Value 'Title' $Title
Require-Value 'appKey' $appKey
Require-Value 'appSecret' $appSecret
Require-Value 'operatorUnionId' $OperatorUnionId

if (![string]::IsNullOrWhiteSpace($ContentPath)) {
  $ContentMarkdown = Get-Content -LiteralPath $ContentPath -Encoding UTF8 -Raw
}
Require-Value 'ContentMarkdown 或 ContentPath' $ContentMarkdown

$tokenResp = Invoke-JsonPost 'get_access_token' 'https://api.dingtalk.com/v1.0/oauth2/accessToken' @{} @{
  appKey = $appKey
  appSecret = $appSecret
}
$accessToken = $tokenResp.accessToken
Require-Value 'accessToken' $accessToken

$headers = @{ 'x-acs-dingtalk-access-token' = $accessToken }
Add-Type -AssemblyName System.Web
$encodedOperator = [System.Web.HttpUtility]::UrlEncode($OperatorUnionId)

$nodeResp = Invoke-JsonPost 'query_folder_by_url' "https://api.dingtalk.com/v2.0/wiki/nodes/queryByUrl?operatorId=$encodedOperator" $headers @{
  url = $FolderUrl
}
$node = if ($nodeResp.result) { $nodeResp.result } elseif ($nodeResp.node) { $nodeResp.node } else { $nodeResp }
$workspaceId = $node.workspaceId
$parentNodeId = $node.nodeId
Require-Value 'workspaceId' $workspaceId
Require-Value 'parentNodeId' $parentNodeId

$createResp = Invoke-JsonPost 'create_doc' "https://api.dingtalk.com/v1.0/doc/workspaces/$workspaceId/docs" $headers @{
  operatorId = $OperatorUnionId
  docType = 'DOC'
  name = $Title
  parentNodeId = $parentNodeId
}
$created = if ($createResp.result) { $createResp.result } else { $createResp }
$docKey = $created.docKey
if ([string]::IsNullOrWhiteSpace($docKey)) { $docKey = $created.dentryUuid }
if ([string]::IsNullOrWhiteSpace($docKey)) { $docKey = $created.documentId }
Require-Value 'docKey/dentryUuid/documentId' $docKey

$writeResp = Invoke-JsonPost 'overwrite_content' "https://api.dingtalk.com/v1.0/doc/suites/documents/$([System.Web.HttpUtility]::UrlEncode($docKey))/overwriteContent?operatorId=$encodedOperator" $headers @{
  operatorId = $OperatorUnionId
  content = $ContentMarkdown
  contentType = 'markdown'
}

$docUrl = $created.url
if ([string]::IsNullOrWhiteSpace($docUrl) -and $created.nodeId) {
  $docUrl = "https://alidocs.dingtalk.com/i/nodes/$($created.nodeId)"
}
if ([string]::IsNullOrWhiteSpace($docUrl) -and $created.dentryUuid) {
  $docUrl = "https://alidocs.dingtalk.com/i/nodes/$($created.dentryUuid)"
}

$notifyTaskId = $null
if (![string]::IsNullOrWhiteSpace($NotifyUserId)) {
  Require-Value 'agentId/DINGTALK_AGENT_ID' $agentId
  if ([string]::IsNullOrWhiteSpace($NotifyText)) {
    $NotifyText = "钉钉文档已创建完成：$Title`n$docUrl"
  }
  $notifyResp = Invoke-JsonPost 'send_work_notification' "https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=$([System.Web.HttpUtility]::UrlEncode($accessToken))" @{} @{
    agent_id = $agentId
    userid_list = $NotifyUserId
    msg = @{
      msgtype = 'text'
      text = @{ content = $NotifyText }
    }
  }
  if ($notifyResp.task_id) { $notifyTaskId = $notifyResp.task_id }
  elseif ($notifyResp.result -and $notifyResp.result.task_id) { $notifyTaskId = $notifyResp.result.task_id }
}

[pscustomobject]@{
  success = $true
  title = $Title
  url = $docUrl
  writeResponseSuccess = $writeResp.success
  notifiedUserId = if ($NotifyUserId) { $NotifyUserId } else { $null }
  notifyTaskId = $notifyTaskId
} | ConvertTo-Json -Depth 10 -Compress
