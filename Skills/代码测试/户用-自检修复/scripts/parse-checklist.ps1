param(
    [Parameter(Mandatory = $true)]
    [string]$ChecklistPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-CheckObject {
    param([string]$Id)
    [ordered]@{
        id = $Id
        description = ''
        pcb_type = @()
        afe_type = @()
        enabled = $false
        version_include = @()
        if_logic = ''
        if_list = @()
    }
}

function New-ConditionObject {
    param([string]$IfType)
    [ordered]@{
        if_type = $IfType
        flag = $true
        file_name = $null
        struct_name = $null
        code_cfg = @()
        line_cfg = @()
        macro_cfg = @()
        ele_cfg = @()
        ewp_cfg = @()
        raw_lines = @()
    }
}

function Ensure-CodeCfgEntry {
    param($Condition)
    if ($Condition.code_cfg.Count -eq 0) {
        $Condition.code_cfg += [pscustomobject]([ordered]@{ file_name = $null; func_name = $null; key_list = @(); flag = $true })
    }
}

function Ensure-LineCfgEntry {
    param($Condition)
    if ($Condition.line_cfg.Count -eq 0) {
        $Condition.line_cfg += [pscustomobject]([ordered]@{ file_name = $null; key_list = @(); flag = $true })
    }
}

function Ensure-MacroCfgEntry {
    param($Condition)
    if ($Condition.macro_cfg.Count -eq 0) {
        $Condition.macro_cfg += [pscustomobject]([ordered]@{
            macro_name = $null
            src_file_name = $null
            macro_value = $null
            string_max_length = $null
            flag = $true
        })
    }
}

function Ensure-EwpCfgEntry {
    param($Condition)
    if ($Condition.ewp_cfg.Count -eq 0) {
        $Condition.ewp_cfg += [pscustomobject]([ordered]@{ ewp_pattern = '*.ewp'; macro_name = $null; src_file_name = $null })
    }
}

function Ensure-EleCfgEntry {
    param($Condition)
    if ($Condition.ele_cfg.Count -eq 0) {
        $Condition.ele_cfg += [pscustomobject]([ordered]@{ ele_name = $null; ele_type = $null })
    }
}

$path = Resolve-Path $ChecklistPath
$lines = @([string[]](Get-Content -Path $path))

$checks = @()
$current = $null
$currentCond = $null
$section = ''
$subSection = ''

foreach ($line in $lines) {
    if ($line -match '^\s*-\s+id:\s*(.+?)\s*$') {
        if ($null -ne $current) {
            if ($null -ne $currentCond) {
                $current.if_list += [pscustomobject]$currentCond
                $currentCond = $null
            }
            $checks += [pscustomobject]$current
        }
        $current = New-CheckObject ($matches[1].Trim('"'))
        $section = ''
        $subSection = ''
        continue
    }

    if ($null -eq $current) { continue }

    if ($line -match '^\s{4}description:\s*(.+?)\s*$') {
        $current.description = $matches[1].Trim('"')
        continue
    }
    if ($line -match '^\s{4}enabled:\s*(true|false)\s*$') {
        $current.enabled = [bool]::Parse($matches[1])
        continue
    }
    if ($line -match '^\s{4}if_logic:\s*(.+?)\s*$') {
        if ($null -ne $currentCond) {
            $current.if_list += [pscustomobject]$currentCond
            $currentCond = $null
        }
        $current.if_logic = $matches[1].Trim('"')
        $section = ''
        $subSection = ''
        continue
    }
    if ($line -match '^\s{4}pcb_type:\s*$') { $section = 'pcb'; continue }
    if ($line -match '^\s{4}afe_type:\s*$') { $section = 'afe'; continue }
    if ($line -match '^\s{4}version_filter:\s*$') { $section = 'version'; continue }
    if ($line -match '^\s{4}if_list:\s*$') { $section = 'if_list'; continue }

    if ($section -eq 'pcb' -and $line -match '^\s{6}-\s*"?([^"#]+)"?') {
        $current.pcb_type += $matches[1].Trim()
        continue
    }
    if ($section -eq 'afe' -and $line -match '^\s{5,6}-\s*"?([^"#]+)"?') {
        $current.afe_type += $matches[1].Trim()
        continue
    }
    if ($section -eq 'version' -and $line -match '^\s{6,8}-\s*"?([^"#]+)"?') {
        $current.version_include += $matches[1].Trim()
        continue
    }

    if ($section -ne 'if_list') { continue }

    if ($line -match '^\s{4,6}-?\s*if_type:\s*(\w+)\s*$') {
        if ($null -ne $currentCond) {
            $current.if_list += [pscustomobject]$currentCond
        }
        $currentCond = New-ConditionObject $matches[1]
        $subSection = ''
        continue
    }

    if ($null -eq $currentCond) { continue }
    $currentCond.raw_lines += $line

    if ($currentCond.if_type -eq 'file') {
        if ($line -match '^\s{8}file_name:\s*"([^"]+)"') { $currentCond.file_name = $matches[1]; continue }
        if ($line -match '^\s{8}flag:\s*(true|false)\s*$') { $currentCond.flag = [bool]::Parse($matches[1]); continue }
    }
    if ($currentCond.if_type -eq 'struct') {
        if ($line -match '^\s{8}file_name:\s*"([^"]+)"') { $currentCond.file_name = $matches[1]; continue }
        if ($line -match '^\s{8}struct_name:\s*"([^"]+)"') { $currentCond.struct_name = $matches[1]; continue }
        if ($line -match '^\s{8}ele_cfg:\s*$') { $subSection = 'ele_cfg'; continue }
        if ($subSection -eq 'ele_cfg' -and $line -match '^\s{10}-\s*ele_name:\s*"([^"]+)"') {
            $currentCond.ele_cfg += [pscustomobject]([ordered]@{ ele_name = $matches[1]; ele_type = $null })
            continue
        }
        if ($subSection -eq 'ele_cfg' -and $line -match '^\s{12}ele_type:\s*"([^"]+)"') {
            Ensure-EleCfgEntry $currentCond
            $currentCond.ele_cfg[-1].ele_type = $matches[1]
            continue
        }
    }

    if ($line -match '^\s{8}(code_cfg|line_cfg|macro_cfg|ewp_cfg):\s*$') {
        $subSection = $matches[1]
        continue
    }

    if ($subSection -eq 'code_cfg') {
        if ($line -match '^\s{10}-\s*file_name:\s*"([^"]+)"') {
            $currentCond.code_cfg += [pscustomobject]([ordered]@{ file_name = $matches[1]; func_name = $null; key_list = @(); flag = $true })
            continue
        }
        if ($line -match '^\s{12}func_name:\s*"([^"]+)"') { Ensure-CodeCfgEntry $currentCond; $currentCond.code_cfg[-1].func_name = $matches[1]; continue }
        if ($line -match '^\s{14}-\s*"(.*)"\s*$') { Ensure-CodeCfgEntry $currentCond; $currentCond.code_cfg[-1].key_list += $matches[1]; continue }
        if ($line -match '^\s{12}flag:\s*(true|false)\s*$') { Ensure-CodeCfgEntry $currentCond; $currentCond.code_cfg[-1].flag = [bool]::Parse($matches[1]); continue }
    }

    if ($subSection -eq 'line_cfg') {
        if ($line -match '^\s{10}-\s*file_name:\s*"([^"]+)"') {
            $currentCond.line_cfg += [pscustomobject]([ordered]@{ file_name = $matches[1]; key_list = @(); flag = $true })
            continue
        }
        if ($line -match '^\s{14}-\s*"(.*)"\s*$') { Ensure-LineCfgEntry $currentCond; $currentCond.line_cfg[-1].key_list += $matches[1]; continue }
        if ($line -match '^\s{12}flag:\s*(true|false)\s*$') { Ensure-LineCfgEntry $currentCond; $currentCond.line_cfg[-1].flag = [bool]::Parse($matches[1]); continue }
    }

    if ($subSection -eq 'macro_cfg') {
        if ($line -match '^\s{10}-\s*macro_name:\s*"([^"]+)"') {
            $currentCond.macro_cfg += [pscustomobject]([ordered]@{
                macro_name = $matches[1]
                src_file_name = $null
                macro_value = $null
                string_max_length = $null
                flag = $true
            })
            continue
        }
        if ($line -match '^\s{12}src_file_name:\s*"([^"]+)"') { Ensure-MacroCfgEntry $currentCond; $currentCond.macro_cfg[-1].src_file_name = $matches[1]; continue }
        if ($line -match '^\s{12}macro_value:\s*"([^"]*)"') { Ensure-MacroCfgEntry $currentCond; $currentCond.macro_cfg[-1].macro_value = $matches[1]; continue }
        if ($line -match '^\s{12}string_max_length:\s*(\d+)\s*$') { Ensure-MacroCfgEntry $currentCond; $currentCond.macro_cfg[-1].string_max_length = [int]$matches[1]; continue }
        if ($line -match '^\s{12}flag:\s*(true|false)\s*$') { Ensure-MacroCfgEntry $currentCond; $currentCond.macro_cfg[-1].flag = [bool]::Parse($matches[1]); continue }
    }

    if ($subSection -eq 'ewp_cfg') {
        if ($line -match '^\s{10}-\s*ewp_pattern:\s*"([^"]+)"') {
            $currentCond.ewp_cfg += [pscustomobject]([ordered]@{ ewp_pattern = $matches[1]; macro_name = $null; src_file_name = $null })
            continue
        }
        if ($line -match '^\s{12}macro_name:\s*"([^"]+)"') { Ensure-EwpCfgEntry $currentCond; $currentCond.ewp_cfg[-1].macro_name = $matches[1]; continue }
        if ($line -match '^\s{12}src_file_name:\s*"([^"]+)"') { Ensure-EwpCfgEntry $currentCond; $currentCond.ewp_cfg[-1].src_file_name = $matches[1]; continue }
    }
}

if ($null -ne $current) {
    if ($null -ne $currentCond) {
        $current.if_list += [pscustomobject]$currentCond
    }
    $checks += [pscustomobject]$current
}

$checks | ConvertTo-Json -Depth 9
