param(
    [Parameter(Mandatory = $true)]
    [string]$RunnerDir,

    [int]$PollSeconds = 1,

    [int]$SvnTimeoutSeconds = 240
)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = "Continue"
$JobsDir = Join-Path $RunnerDir "jobs"
New-Item -ItemType Directory -Force -Path $JobsDir | Out-Null

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-SvnWithTimeout {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$SvnArgs,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $job = Start-Job -ScriptBlock {
        param([string[]]$InnerSvnArgs)

        $output = & svn @InnerSvnArgs 2>&1 | Out-String
        [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = $output
        }
    } -ArgumentList (, $SvnArgs)

    try {
        $completed = Wait-Job -Job $job -Timeout $TimeoutSeconds
        if ($null -eq $completed) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            return [pscustomobject]@{
                ExitCode = 124
                Output = "SVN command timed out after $TimeoutSeconds seconds."
            }
        }

        return Receive-Job -Job $job
    }
    finally {
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}

while ($true) {
    Get-ChildItem -Path $JobsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $JobDir = $_.FullName
        $JobPath = Join-Path $JobDir "job.json"
        $ResultPath = Join-Path $JobDir "result.json"
        $RunningPath = Join-Path $JobDir "running.lock"

        if (!(Test-Path $JobPath) -or (Test-Path $ResultPath) -or (Test-Path $RunningPath)) {
            return
        }

        New-Item -ItemType File -Path $RunningPath -Force | Out-Null
        try {
            $job = Get-Content -Raw -Encoding UTF8 $JobPath | ConvertFrom-Json
            $svnArgs = @(
                "export",
                "--force",
                "--non-interactive",
                "--no-auth-cache",
                "--trust-server-cert",
                "--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other",
                "-r",
                [string]$job.revision,
                "--username",
                [string]$job.svn_username,
                "--password",
                [string]$job.svn_password,
                [string]$job.svn_url,
                [string]$job.destination
            )
            $result = Invoke-SvnWithTimeout -SvnArgs $svnArgs -TimeoutSeconds $SvnTimeoutSeconds
            $output = [string]$result.Output
            $exitCode = [int]$result.ExitCode
            if ($exitCode -eq 0) {
                Write-JsonFile -Path $ResultPath -Value @{
                    ok = $true
                    output = $output
                }
            }
            else {
                Write-JsonFile -Path $ResultPath -Value @{
                    ok = $false
                    exit_code = $exitCode
                    error = $output
                }
            }
        }
        catch {
            Write-JsonFile -Path $ResultPath -Value @{
                ok = $false
                error = $_.Exception.Message
            }
        }
        finally {
            Remove-Item -Force $RunningPath -ErrorAction SilentlyContinue
        }
    }

    Start-Sleep -Seconds $PollSeconds
}
