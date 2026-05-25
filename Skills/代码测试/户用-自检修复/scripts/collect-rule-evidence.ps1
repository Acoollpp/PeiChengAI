param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$ChecklistPath,
    [Parameter(Mandatory = $true)]
    [string]$RuleId,
    [string]$BoardType = '',
    [string]$AfeType = '',
    [string]$SoftwareVersion = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helperPath = 'C:\Users\AOC\.codex\skills\firmware-self-checker\scripts\get-selfcheck-evidence.ps1'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-MacroValue {
    param([string]$HeaderPath, [string]$MacroName)
    if (-not (Test-Path $HeaderPath)) { return $null }
    foreach ($line in (Get-Content -Path $HeaderPath)) {
        $m = [regex]::Match($line, '^\s*#\s*define\s+' + [regex]::Escape($MacroName) + '\b(.*)$')
        if ($m.Success) { return $m.Groups[1].Value.Trim() }
    }
    $null
}

function Get-VersionBody {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $m = [regex]::Match($Text, '\d+(?:\.\d+)+')
    if ($m.Success) { return $m.Value }
    $null
}

function Infer-Scope {
    param([string]$Root)
    $header = Get-ChildItem -Path $Root -Recurse -File -Filter 'Bms_Config.h' -ErrorAction SilentlyContinue | Select-Object -First 1
    $board = $null
    $version = $null
    if ($null -ne $header) {
        $board = Get-MacroValue -HeaderPath $header.FullName -MacroName 'HARDWARE_VERSOIN'
        $version = Get-VersionBody -Text (Get-MacroValue -HeaderPath $header.FullName -MacroName 'PACESOFTWARE_VERSOIN')
        if (-not $version) {
            $version = Get-VersionBody -Text (Get-MacroValue -HeaderPath $header.FullName -MacroName 'SOFTWARE_VERSOIN')
        }
    }
    [ordered]@{
        board_type = if ($board) { ($board.Trim().Split()[0]).Trim('"') } else { $null }
        afe_type = if (@(Get-ChildItem -Path $Root -Recurse -File -Filter 'MP2797.c' -ErrorAction SilentlyContinue).Count -gt 0) { 'MPS2797' } else { 'all' }
        software_version = $version
        config_header = if ($null -ne $header) { $header.FullName } else { $null }
    }
}

function Test-ScopeMatch {
    param($Rule, [string]$Board, [string]$Afe, [string]$Version)
    $pcbList = @($Rule.pcb_type)
    $afeList = @($Rule.afe_type)
    $verList = @($Rule.version_include)

    $pcbOk = $true
    if ($pcbList.Count -gt 0) {
        $positive = @($pcbList | Where-Object { $_ -ne 'all' -and -not $_.StartsWith('!') })
        $excluded = @($pcbList | Where-Object { $_.StartsWith('!') -and $_.Substring(1) -eq $Board }).Count -gt 0
        if ($excluded) { $pcbOk = $false }
        elseif ($pcbList -contains 'all') { $pcbOk = $true }
        elseif ($positive.Count -gt 0) { $pcbOk = $pcbList -contains $Board }
    }

    $afeOk = $true
    if ($afeList.Count -gt 0) {
        $positive = @($afeList | Where-Object { $_ -ne 'all' -and -not $_.StartsWith('!') })
        $excluded = @($afeList | Where-Object { $_.StartsWith('!') -and $_.Substring(1) -eq $Afe }).Count -gt 0
        if ($excluded) { $afeOk = $false }
        elseif ($afeList -contains 'all') { $afeOk = $true }
        elseif ($positive.Count -gt 0) { $afeOk = $afeList -contains $Afe }
    }

    $verOk = $true
    if ($verList.Count -gt 0) {
        $verOk = $verList -contains $Version
    }

    ($Rule.enabled -and $pcbOk -and $afeOk -and $verOk)
}

function Invoke-HelperJson {
    param([string[]]$ToolArgs)
    (& powershell -ExecutionPolicy Bypass -File $helperPath @ToolArgs) | ConvertFrom-Json
}

function Apply-Flag {
    param([bool]$Flag, [bool]$Base)
    if ($Flag) { return $Base }
    (-not $Base)
}

function Get-EwpCompatResult {
    param([string]$Root, $Cfg)
    $macroFile = Get-ChildItem -Path $Root -Recurse -File -Filter $Cfg.src_file_name -ErrorAction SilentlyContinue | Select-Object -First 1
    $macroValue = if ($null -ne $macroFile) { Get-MacroValue -HeaderPath $macroFile.FullName -MacroName $Cfg.macro_name } else { $null }
    $macroVersion = Get-VersionBody -Text $macroValue
    $ewpFiles = @(Get-ChildItem -Path $Root -Recurse -File -Filter '*.ewp' -ErrorAction SilentlyContinue)

    $matches = foreach ($ewpFile in $ewpFiles) {
        $content = Get-Content -Path $ewpFile.FullName -Raw
        $outputStates = @([regex]::Matches($content, '<name>IlinkOutputFile</name>\s*<state>([^<]*)</state>', 'Singleline') | ForEach-Object { $_.Groups[1].Value })
        [pscustomobject]@{
            ewp_path = $ewpFile.FullName
            macro_path = if ($null -ne $macroFile) { $macroFile.FullName } else { $null }
            macro_name = $Cfg.macro_name
            macro_value = $macroValue
            macro_version = $macroVersion
            ilink_output_files = $outputStates
            output_matches_version = @($outputStates | Where-Object { $_ -match [regex]::Escape($macroVersion) }).Count -gt 0
        }
    }

    [pscustomobject]@{
        type = 'ewp_version'
        compat_mode = 'exe'
        passed = @($matches | Where-Object { $_.output_matches_version }).Count -gt 0
        matches = @($matches)
    }
}

function Eval-Logic {
    param([string]$Logic, [bool[]]$Values)
    $expr = $Logic
    for ($i = $Values.Count; $i -ge 1; $i--) {
        $rep = if ($Values[$i - 1]) { '$true' } else { '$false' }
        $expr = [regex]::Replace($expr, "(?<!\d)$i(?!\d)", $rep)
    }
    $expr = $expr.Replace('&&', ' -and ').Replace('||', ' -or ')
    $expr = [regex]::Replace($expr, '!\s*\(', ' -not (')
    $expr = [regex]::Replace($expr, '!\s*\$true', ' -not $true')
    $expr = [regex]::Replace($expr, '!\s*\$false', ' -not $false')
    [bool](Invoke-Expression $expr)
}

$root = (Resolve-Path $ProjectRoot).Path
$checklist = (Resolve-Path $ChecklistPath).Path
$rule = (& (Join-Path $scriptDir 'parse-checklist.ps1') -ChecklistPath $checklist | ConvertFrom-Json) | Where-Object { $_.id -eq $RuleId } | Select-Object -First 1
if ($null -eq $rule) { throw "Rule not found: $RuleId" }

$scope = Infer-Scope -Root $root
if (-not [string]::IsNullOrWhiteSpace($BoardType)) { $scope.board_type = $BoardType }
if (-not [string]::IsNullOrWhiteSpace($AfeType)) { $scope.afe_type = $AfeType }
if (-not [string]::IsNullOrWhiteSpace($SoftwareVersion)) { $scope.software_version = $SoftwareVersion }

$applicable = Test-ScopeMatch -Rule $rule -Board $scope.board_type -Afe $scope.afe_type -Version $scope.software_version

$conditions = @()
$values = @()

foreach ($cond in @($rule.if_list)) {
    switch ($cond.if_type) {
        'file' {
            $raw = Invoke-HelperJson @('-ProjectRoot', $root, '-Type', 'file', '-FileName', $cond.file_name)
            $value = Apply-Flag -Flag ([bool]$cond.flag) -Base ([bool]$raw.passed)
            $conditions += [pscustomobject]@{ if_type = 'file'; value = $value; flag = [bool]$cond.flag; evidence = $raw }
            $values += $value
        }
        'code' {
            $detail = @()
            $allOk = $true
            foreach ($cfg in @($cond.code_cfg)) {
                $args = @('-ProjectRoot', $root, '-Type', 'code', '-FileName', $cfg.file_name, '-FuncName', $cfg.func_name)
                foreach ($key in @($cfg.key_list)) { $args += @('-KeyList', $key) }
                $raw = Invoke-HelperJson $args
                $value = Apply-Flag -Flag ([bool]$cfg.flag) -Base ([bool]$raw.passed)
                $detail += [pscustomobject]@{
                    file_name = $cfg.file_name
                    func_name = $cfg.func_name
                    key_list = @($cfg.key_list)
                    flag = [bool]$cfg.flag
                    value = $value
                    evidence = $raw
                }
                if (-not $value) { $allOk = $false }
            }
            $conditions += [pscustomobject]@{
                if_type = 'code'
                value = $allOk
                compat_note = 'function-scoped raw-text match'
                evidence = @($detail)
            }
            $values += $allOk
        }
        'line' {
            $detail = @()
            $allOk = $true
            foreach ($cfg in @($cond.line_cfg)) {
                $args = @('-ProjectRoot', $root, '-Type', 'line', '-FileName', $cfg.file_name)
                foreach ($key in @($cfg.key_list)) { $args += @('-KeyList', $key) }
                $raw = Invoke-HelperJson $args
                $value = Apply-Flag -Flag ([bool]$cfg.flag) -Base ([bool]$raw.passed)
                $detail += [pscustomobject]@{ file_name = $cfg.file_name; key_list = @($cfg.key_list); flag = [bool]$cfg.flag; value = $value; evidence = $raw }
                if (-not $value) { $allOk = $false }
            }
            $conditions += [pscustomobject]@{ if_type = 'line'; value = $allOk; evidence = @($detail) }
            $values += $allOk
        }
        'macro' {
            $detail = @()
            $allOk = $true
            foreach ($cfg in @($cond.macro_cfg)) {
                $args = @('-ProjectRoot', $root, '-Type', 'macro', '-SrcFileName', $cfg.src_file_name, '-MacroName', $cfg.macro_name)
                if ($null -ne $cfg.string_max_length) { $args += @('-StringMaxLength', [string]$cfg.string_max_length) }
                elseif ($null -ne $cfg.macro_value) { $args += @('-MacroValue', $cfg.macro_value) }
                $raw = Invoke-HelperJson $args
                $value = Apply-Flag -Flag ([bool]$cfg.flag) -Base ([bool]$raw.passed)
                $detail += [pscustomobject]@{
                    macro_name = $cfg.macro_name
                    src_file_name = $cfg.src_file_name
                    macro_value = $cfg.macro_value
                    string_max_length = $cfg.string_max_length
                    value = $value
                    evidence = $raw
                }
                if (-not $value) { $allOk = $false }
            }
            $conditions += [pscustomobject]@{ if_type = 'macro'; value = $allOk; evidence = @($detail) }
            $values += $allOk
        }
        'struct' {
            $detail = @()
            $allOk = $true
            foreach ($cfg in @($cond.ele_cfg)) {
                $raw = Invoke-HelperJson @('-ProjectRoot', $root, '-Type', 'struct', '-FileName', $cond.file_name, '-StructName', $cond.struct_name, '-ElementName', $cfg.ele_name, '-ElementType', $cfg.ele_type)
                $detail += [pscustomobject]@{ element_name = $cfg.ele_name; element_type = $cfg.ele_type; value = [bool]$raw.passed; evidence = $raw }
                if (-not [bool]$raw.passed) { $allOk = $false }
            }
            $conditions += [pscustomobject]@{ if_type = 'struct'; value = $allOk; evidence = @($detail) }
            $values += $allOk
        }
        'ewp_version' {
            $detail = @()
            $allOk = $true
            foreach ($cfg in @($cond.ewp_cfg)) {
                $raw = Get-EwpCompatResult -Root $root -Cfg $cfg
                $detail += [pscustomobject]@{
                    ewp_pattern = $cfg.ewp_pattern
                    macro_name = $cfg.macro_name
                    src_file_name = $cfg.src_file_name
                    value = [bool]$raw.passed
                    evidence = $raw
                }
                if (-not [bool]$raw.passed) { $allOk = $false }
            }
            $conditions += [pscustomobject]@{
                if_type = 'ewp_version'
                value = $allOk
                compat_note = 'IlinkOutputFile must match version body'
                evidence = @($detail)
            }
            $values += $allOk
        }
        default {
            $conditions += [pscustomobject]@{ if_type = $cond.if_type; value = $false; unsupported = $true; evidence = $null }
            $values += $false
        }
    }
}

$final = if ($applicable) { Eval-Logic -Logic $rule.if_logic -Values $values } else { $null }

[pscustomobject]@{
    project_root = $root
    checklist_path = $checklist
    exe_compatible = $true
    scope = $scope
    rule = [pscustomobject]@{
        id = $rule.id
        description = $rule.description
        if_logic = $rule.if_logic
        pcb_type = @($rule.pcb_type)
        afe_type = @($rule.afe_type)
        version_include = @($rule.version_include)
    }
    applicable = $applicable
    condition_values = $values
    conditions = @($conditions)
    final_result = $final
} | ConvertTo-Json -Depth 10
