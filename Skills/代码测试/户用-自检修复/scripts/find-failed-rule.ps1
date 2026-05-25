param(
    [string]$ChecklistPath = '',
    [string[]]$FailedIds = @(),
    [string]$ReportPath = '',
    [string]$ProjectRoot = '.'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DefaultChecklistPath {
    param([string]$Root)
    $hits = @(Get-ChildItem -Path $Root -Recurse -File -Include '*checkList*.yml', '*checkList*.yaml' -ErrorAction SilentlyContinue)
    if ($hits.Count -eq 0) { return $null }
    $hits[0].FullName
}

function Get-FailedIdsFromReport {
    param([string]$Path)
    $ids = @()
    foreach ($line in ((Get-Content -Path $Path -Raw) -split "`r?`n")) {
        $m = [regex]::Match($line, '^\s*\d+\.\s*([A-Za-z0-9_\- ]+)\s*:')
        if ($m.Success) { $ids += $m.Groups[1].Value.Trim() }
    }
    @($ids | Select-Object -Unique)
}

function Normalize-FailedIds {
    param([string[]]$Values)
    $out = @()
    foreach ($value in @($Values)) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        foreach ($part in ($value -split '\s*,\s*')) {
            if (-not [string]::IsNullOrWhiteSpace($part)) {
                $out += $part.Trim()
            }
        }
    }
    @($out | Select-Object -Unique)
}

if ([string]::IsNullOrWhiteSpace($ChecklistPath)) {
    $ChecklistPath = Get-DefaultChecklistPath -Root (Resolve-Path $ProjectRoot).Path
}
if ([string]::IsNullOrWhiteSpace($ChecklistPath)) {
    throw 'Checklist file not found.'
}

if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
    $FailedIds += Get-FailedIdsFromReport -Path $ReportPath
}
$FailedIds = Normalize-FailedIds -Values $FailedIds

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$checks = & (Join-Path $scriptDir 'parse-checklist.ps1') -ChecklistPath $ChecklistPath | ConvertFrom-Json

$items = foreach ($id in $FailedIds) {
    $rule = $checks | Where-Object { $_.id -eq $id } | Select-Object -First 1
    if ($null -eq $rule) {
        [pscustomobject]@{ id = $id; found = $false; description = $null }
        continue
    }
    [pscustomobject]@{
        id = $rule.id
        found = $true
        description = $rule.description
        pcb_type = @($rule.pcb_type)
        afe_type = @($rule.afe_type)
        version_include = @($rule.version_include)
        if_logic = $rule.if_logic
    }
}

[pscustomobject]@{
    checklist_path = (Resolve-Path $ChecklistPath).Path
    requested_ids = $FailedIds
    items = @($items)
} | ConvertTo-Json -Depth 8
