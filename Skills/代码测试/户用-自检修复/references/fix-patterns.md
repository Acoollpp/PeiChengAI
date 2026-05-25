# Fix Patterns

Use this file before proposing a repair. Keep automatic fixes narrow.

## Class A: Safe Auto-Fix Candidates

Apply only when the change is local, string-stable, and does not require a business decision.

### Missing Required Line In A Known Function

- Typical rule shape: `code`, `flag: true`, one exact missing statement.
- Good candidates:
  - add `ForwardInfo.State = FORWARD_IDLE;` inside `Updata_Host_Process`
  - add one missing state-reset line
- Requirements:
  - target function is unique,
  - insertion point is obvious from neighboring logic,
  - the new line does not change constants or thresholds.

### ewp Output Name Alignment

- Typical rule shape: `ewp_version`.
- Good candidate when the required output file naming format is obvious and already encoded in the version macro.
- Change only the `IlinkOutputFile` string.

## Class B: Semi-Automatic Fixes

Prepare a patch candidate, but ask the user before applying.

### Commented Legacy Logic Still Matching

- Typical rule shape: `flag: false` but the forbidden text only survives in comments.
- Suggest removing or rewriting the stale comment.

### Protocol Bit Mapping Or Address Field Repair

- Typical rules:
  - warning/protection bit mapping,
  - inverter protocol payload fields,
  - address-field replacements such as Tmin/Tmax pack address issues.

### Single-Function Replacement

- Replace one call with another where the checklist clearly expects a different helper.
- Confirm first if it changes measurement semantics or timing.

## Class C: Locate Only

Do not auto-edit by default.

### Threshold Or Calibration Range Changes

- Examples:
  - MP2797 zero-current range checks,
  - current sampling thresholds,
  - sleep timing,
  - hardware-dependent delays.

### Macro Policy Or Version Strategy

- If the fix changes product naming, version conventions, or feature policy, treat it as manual unless the user explicitly requests the patch.

## Repair Output Template

For each failed item, provide:

1. `fix_class`
2. `why_failed`
3. `recommended_change`
4. `risk_note`
5. `safe_to_auto_apply`
