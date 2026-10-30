param(
    [string]$RunnerDir = ".\.local-storage\gpio-tasks\_svn-runner",
    [int]$PollSeconds = 1,
    [int]$SvnTimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Split-Path -Parent $ScriptDir
$RunnerScript = Join-Path $ScriptDir "gpio_svn_runner.ps1"
$ResolvedRunnerDir = [System.IO.Path]::GetFullPath((Join-Path $BackendDir $RunnerDir))
$PidFile = Join-Path $ResolvedRunnerDir "runner.pid"

New-Item -ItemType Directory -Force -Path $ResolvedRunnerDir | Out-Null

if (Test-Path $PidFile) {
    $ExistingPid = Get-Content -Raw -Encoding UTF8 $PidFile
    $ExistingPid = $ExistingPid.Trim()
    if ($ExistingPid -and (Get-Process -Id ([int]$ExistingPid) -ErrorAction SilentlyContinue)) {
        Write-Host "GPIO SVN runner already running. PID: $ExistingPid"
        Write-Host "Runner dir: $ResolvedRunnerDir"
        exit 0
    }
}

$process = Start-Process `
    -FilePath "powershell" `
    -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $RunnerScript,
        "-RunnerDir",
        $ResolvedRunnerDir,
        "-PollSeconds",
        [string]$PollSeconds,
        "-SvnTimeoutSeconds",
        [string]$SvnTimeoutSeconds
    ) `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $PidFile -Value ([string]$process.Id) -Encoding UTF8
Write-Host "GPIO SVN runner started. PID: $($process.Id)"
Write-Host "Runner dir: $ResolvedRunnerDir"
