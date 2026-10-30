# BOM电子档修改 Design

## Goal

Add a `BOM电子档修改` task module to the existing React/FastAPI platform. Users upload one archive package. The package contains one engineering change notice, one material master workbook, and a `变更BOM` folder that contains one or more BOM workbooks. The platform applies the same change notice to every BOM workbook in `变更BOM`, produces modified BOM workbooks, and appends a report sheet that lists actual changes and exceptions in each output workbook.

## Inputs

- Archive package: `.zip`, `.rar`, or `.7z`.
- Engineering change notice Excel: exactly one workbook in the package; read the first sheet that contains the `变更前描述` and `变更后描述` detail layout.
- BOM Excel: one or more workbooks under the `变更BOM` folder; process every sheet that contains the required columns in each workbook.
- Material master Excel: exactly one workbook in the package; used to enrich replacement materials.

Required BOM columns:

- `物料编码`
- `规格型号`
- `规格描述`
- `用量`
- `位号`

Material master mapping:

- D column `物料代码` maps to BOM `物料编码`.
- F column `型号` maps to BOM `规格型号`.
- I column `BMS规则描述` maps to BOM `规格描述`.

## Business Rules

The change notice defines before and after material groups. Rows are grouped by locator:

- If `位号` is not `/`, group and locate BOM rows by `位号`.
- If `位号` is `/`, group and locate BOM rows by the before-side `物料编码`.

For normal locator groups, all BOM rows for the locator must match the change notice before-side group. If the current BOM content differs from the change notice before values, the group is marked abnormal and is not modified.

For `/` locator groups, the before-side material codes locate rows to remove. The same full-group consistency check applies before any modification.

After-side rows whose material code or quantity is `/` are ignored as new materials. Valid after-side material codes are looked up in the material master. If a material code is missing or matches multiple rows in the material master, the whole group is marked abnormal and is not modified.

When a group passes validation, remove the old group and insert the new valid material rows at the first old row position. For a many-to-one change such as two `Q77` old materials replaced by one new material, the new row is inserted at the first `Q77` old material row.

Write fields into the BOM as follows:

- `物料编码`: material master D column `物料代码`
- `规格型号`: material master F column `型号`
- `规格描述`: material master I column `BMS规则描述`
- `用量`: change notice after-side `用量`
- `位号`: change notice after-side `位号`

Quantity formatting:

- Fraction quantities such as `1/120` are converted to decimals.
- Exact terminating decimals keep their natural decimal form, for example `1/20` becomes `0.05`.
- Non-terminating decimals are rounded to four decimal places, for example `1/120` becomes `0.0083`.
- Integer and decimal quantities are preserved as numbers.
- `替代料` is preserved.

Changed or inserted BOM rows are marked blue.

The appended 变更记录 row records a 版本 that matches the BOM file name. A `REV` prefix wins (case-insensitive, for example `REV2.0` -> `2.0`); otherwise the last dotted version number in the file name is used (for example `BOM-SST23-1399-1.0-003` -> `1.0`).

## Report Sheet

Append a new sheet to each modified BOM workbook. The report records only:

- Modified rows.
- Abnormal rows that were not modified.

It does not record ordinary sheet-level misses where a locator is absent from a sheet.

Report rows include:

- Sheet name
- Locator type
- Locator value
- Action: delete, add, replace, abnormal
- Before material code, model, description, quantity, locator
- After material code, model, description, quantity, locator
- Result
- Reason

Rows for the same locator must be adjacent.

## Platform Shape

Execution mode is mixed local mode:

- The platform creates and tracks tasks.
- A deterministic Python Excel processor performs parsing, validation, workbook modification, blue marking, and report sheet generation.
- Codex remains available for future rule expansion and abnormal-result explanation, but the first implementation does not rely on Codex to directly edit Excel.

Backend:

- Add SQLModel task table and public schemas.
- Add FastAPI routes for create/list/stats/detail/download/delete.
- Store inputs, logs, and output workbooks in task-scoped storage.
- Download a zip bundle containing every modified BOM workbook.
- Output workbooks keep the input file name, but never a date: a trailing three-digit sequence is incremented (`-003` -> `-004`, letter tags like `A001` -> `A002`, trailing text preserved); otherwise a trailing eight-digit date is replaced with `-001`; names without a sequence or date get `-001` appended.

Frontend:

- Add route `/tasks/bom-electronic-edit`.
- Add management route `/tasks/bom-electronic-edit-manage`.
- Add sidebar entries.
- Provide a task form with one archive upload, task list, status, duration, result download, and concise error display.

## Verification

- Unit-test the Excel processor with a synthetic workbook covering normal locator replacement, `/` locator material-code replacement, fraction quantity formatting, material-master misses, and before-side mismatch.
- API-test create/list/detail/delete/download permission behavior.
- Run frontend production build.
