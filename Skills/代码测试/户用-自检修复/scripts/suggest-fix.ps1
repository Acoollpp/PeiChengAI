param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$ChecklistPath,
    [string]$RuleId = '',
    [string[]]$FailedIds = @(),
    [string]$ReportPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-FixTemplate {
    param([string]$Id)
    switch ($Id) {
        'checkList57' {
            [pscustomobject]@{
                fix_class = 'A'
                safe_to_auto_apply = $true
                recommended_change = 'Update the .ewp IlinkOutputFile value so the output file name includes the PACESOFTWARE_VERSOIN version body.'
                risk_note = 'Low risk if only the output file naming string changes.'
            }
        }
        'checkList_Updata_Forward_Idle' {
            [pscustomobject]@{
                fix_class = 'A'
                safe_to_auto_apply = $true
                recommended_change = 'Insert ForwardInfo.State = FORWARD_IDLE; inside Updata_Host_Process() at the state transition point required by the checklist.'
                risk_note = 'Low risk if inserted at the same stage where the forward process is initialized.'
            }
        }
        'checkList30' {
            [pscustomobject]@{
                fix_class = 'A'
                safe_to_auto_apply = $true
                recommended_change = 'Restore UartRS485_TxCount = 0; in the target transmit IRQ function.'
                risk_note = 'Low risk if only the counter reset line is restored.'
            }
        }
        'checkList9' {
            [pscustomobject]@{
                fix_class = 'B'
                safe_to_auto_apply = $false
                recommended_change = 'Remove or rewrite forbidden warning-bit assignments in can_Victron.c, including commented legacy text if the exe still matches it.'
                risk_note = 'Protocol semantics should be rechecked before patching.'
            }
        }
        'checkList60' {
            [pscustomobject]@{
                fix_class = 'B'
                safe_to_auto_apply = $false
                recommended_change = 'Add or replace the Tmin pack address assignment so Victron_SendCycleMsg uses InverterData.TminPackAddr in the required branch.'
                risk_note = 'Confirm the target payload layout before editing.'
            }
        }
        'checkList3' {
            [pscustomobject]@{
                fix_class = 'B'
                safe_to_auto_apply = $false
                recommended_change = 'Update the SMA capacity upload expression to the cast-and-mask form required by the checklist.'
                risk_note = 'Protocol payload math should be revalidated after the patch.'
            }
        }
        default {
            if ($Id -match 'checkList4[02]') {
                [pscustomobject]@{
                    fix_class = 'C'
                    safe_to_auto_apply = $false
                    recommended_change = 'Review MP2797/MPS current-sample initialization, zero calibration, and voltage-sample sequencing against the checklist.'
                    risk_note = 'Calibration and sampling behavior are hardware dependent.'
                }
            } else {
                [pscustomobject]@{
                    fix_class = 'C'
                    safe_to_auto_apply = $false
                    recommended_change = 'Use the collected evidence to patch the target file manually or after user confirmation.'
                    risk_note = 'No rule-specific automatic template is registered yet.'
                }
            }
        }
    }
}

function Get-TargetRuleIds {
    param([string]$ChecklistPathArg, [string]$ProjectRootArg, [string]$RuleIdArg, [string[]]$FailedIdsArg, [string]$ReportPathArg)
    if (-not [string]::IsNullOrWhiteSpace($RuleIdArg)) { return @($RuleIdArg) }
    $json = & (Join-Path $scriptDir 'find-failed-rule.ps1') -ChecklistPath $ChecklistPathArg -ProjectRoot $ProjectRootArg -FailedIds $FailedIdsArg -ReportPath $ReportPathArg | ConvertFrom-Json
    @($json.items | Where-Object { $_.found } | ForEach-Object { $_.id })
}

$ruleIds = Get-TargetRuleIds -ChecklistPathArg $ChecklistPath -ProjectRootArg $ProjectRoot -RuleIdArg $RuleId -FailedIdsArg $FailedIds -ReportPathArg $ReportPath

$items = foreach ($id in $ruleIds) {
    $evidence = & (Join-Path $scriptDir 'collect-rule-evidence.ps1') -ProjectRoot $ProjectRoot -ChecklistPath $ChecklistPath -RuleId $id | ConvertFrom-Json
    $template = Get-FixTemplate -Id $id
    [pscustomobject]@{
        id = $id
        description = $evidence.rule.description
        final_result = $evidence.final_result
        applicable = $evidence.applicable
        fix_class = $template.fix_class
        safe_to_auto_apply = $template.safe_to_auto_apply
        recommended_change = $template.recommended_change
        risk_note = $template.risk_note
        scope = $evidence.scope
        conditions = $evidence.conditions
    }
}

[pscustomobject]@{
    project_root = (Resolve-Path $ProjectRoot).Path
    checklist_path = (Resolve-Path $ChecklistPath).Path
    items = @($items)
} | ConvertTo-Json -Depth 10
