# Exe Compatibility Notes

Use this file when the checklist YAML and the official self-check exe do not appear to agree.

## Core Rules

1. Treat the official exe result as the final behavioral source of truth.
2. Use the YAML to discover:
   - rule ids,
   - descriptions,
   - scope filters,
   - condition structure,
   - boolean logic.
3. Apply the exe-compat interpretations below before deciding whether a failure is real.

## Current Compatibility Rules

### Code Matching

- When `func_name` exists, match inside that function body by default.
- Do not silently widen to whole-file matching unless the rule clearly has no function target.
- Match raw text conservatively. If the official tool appears to count commented text, preserve that behavior.

### Comment Hits

- For legacy cleanup rules, commented-out text may still count as a match.
- This matters most for `flag: false` checks. A comment that still contains the forbidden line can keep the item failing.
- Example: `checkList9` on `can_Victron.c` warning bits.

### ewp Version Checks

- Do not reduce `ewp_version` to "does the .ewp contain the version body somewhere".
- For output-name rules such as `checkList57`, inspect the `IlinkOutputFile` option and compare it against the version body extracted from `PACESOFTWARE_VERSOIN`.

### flag: false

- Interpret `flag: false` as "the target content must not match under exe-compatible search behavior".
- Do not pass an item simply because the surrounding logic appears disabled at runtime.
- If the forbidden string exists in comments and the official tool would still hit it, keep the item failed.

### File + Code Short-Circuit

- Preserve logic such as `(1 || 2)` where:
  - condition 1 means the file must not exist,
  - condition 2 means the required fix must exist if the file does exist.
- If the file is absent and the logic short-circuits to pass, do not report a false failure.

### Scope Filters

- Preserve these semantics:
  - `"all"` means always applicable.
  - `"!31390V120"` means excluded board.
  - `version_filter.include` is an allow-list.
- If scope cannot be inferred reliably, mark the result as assumption-based instead of pretending certainty.

## Known Item-Specific Notes

### checkList57

- Compare `PACESOFTWARE_VERSOIN` version body with `.ewp` `IlinkOutputFile`.
- This is stricter than a generic "version string exists somewhere in the .ewp" check.

### checkList_Updata_Forward_Idle

- Search specifically inside `Updata_Host_Process()`.
- The same line existing elsewhere does not satisfy the rule.

### checkList60

- Search specifically inside `static void Victron_SendCycleMsg`.
- Missing `tmp = InverterData.TminPackAddr;` is a real failure even if nearby temperature fields are otherwise present.
