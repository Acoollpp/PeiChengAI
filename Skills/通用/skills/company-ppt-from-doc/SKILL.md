---
name: company-ppt-from-doc
description: Use when creating or editing a company PowerPoint from a document, markdown brief, current PPTX, or company template; especially when the user asks to use the current PPT as source of truth, preserve page 1, use WPS COM, keep objects editable, follow company template rules, or make a leadership-report deck for cross-department use.
---

# Company PPT From Doc

## Purpose

Turn a document or markdown brief into a company-style, editable PowerPoint for leadership reporting and cross-department use.

This skill is not a free-form slide generator. It is a controlled workflow for producing PPTX files that preserve the company template, use real object parameters, and avoid common layout defects.

## Required Inputs

Identify these before editing:

- **Content source**: markdown, Word text, meeting notes, report outline, or user-provided text.
- **Visual source**: current PPTX, company template PPTX, or an existing deck to modify.
- **User constraints**: pages that must not change, excluded sections, required screenshots, final filename, and whether the deck is for leaders or internal working review.

If the user provides only a document and no current/template PPTX, use the bundled default company template: `assets/default-template.pptx`. Use `references/ai-results-may-master-config.json` only as supporting style guidance when applicable.

Template priority order:

1. User-provided current PPTX or explicit template in the current request.
2. User-provided existing deck that must be modified.
3. Bundled default template `assets/default-template.pptx`.
4. Bundled master config only for style guidance, never as a replacement for an available PPTX template.

## Expected Outputs

- A new PPTX file. Never overwrite the user's original deck or bundled default template.
- Editable text boxes, cards, lines, tables, placeholders, and diagrams.
- Exported preview images for QA when possible.
- A short final report listing file path, changed scope, verification performed, and any remaining placeholders.

## Non-Negotiable Rules

1. **Current PPTX/template is the visual source of truth.**
   Do not rebuild from memory, screenshots, previous generated records, or old versions if a current PPTX is available.

2. **Use WPS COM for real PPT parameters.**
   Read `Left`, `Top`, `Width`, `Height`, font name, font size, bold, text color, fill color, line color, shape type, z-order, tables, and picture placeholders from WPS COM.

3. **agent-slides is only an assistant.**
   Use `agent-slides` for standard OpenXML extraction, scaffolding, audit, or preview workflows only when it can read the file cleanly. If WPS COM and agent-slides disagree, trust WPS COM/current PPT.

4. **Screenshots are not layout data.**
   Screenshots/previews may be used for final visual inspection, but never to estimate object positions or to flatten editable pages.

5. **Protect the user's work.**
   Save a new version. Preserve user-added text and images unless the user explicitly asks to remove them. Page 1 must not change unless explicitly requested.

6. **Preserve the default template cover blue title box.**
   When using `assets/default-template.pptx`, page 1 contains an editable blue title/theme box. Keep that box visible and editable; place the report title/theme into the existing cover title area instead of deleting it or generating a blank cover.

7. **Everything added for content must be editable.**
   Do not paste a full-slide screenshot over text, cards, or tables. Background images may remain as background only when they are truly template assets.

## Workflow

### 1. Preflight

- Confirm the source file paths exist.
- Select the template/current PPTX using the template priority order.
- If using `assets/default-template.pptx`, copy it to a new output file before editing; never modify the asset file directly.
- Copy the selected PPTX to a new output file before editing.
- Check whether the PPTX is standard OpenXML. If not, use WPS COM only.
- If WPS is already open or busy, reuse the active WPS COM instance. Avoid parallel WPS COM calls.

### 2. Extract Template Parameters

Before layout changes, inventory the current/reference PPT:

- slide size and page count
- title positions and fonts
- footer/brand bar positions
- background objects
- card dimensions and colors
- picture placeholders
- table structures
- existing user content that must be preserved

If using the bundled default template, inventory `assets/default-template.pptx` with WPS COM and keep page 1's blue title box. Load `references/ai-results-may-master-config.json` only for layout choices and theme defaults; current PPT/template parameters override the config.

### 3. Convert Document to Slide Plan

Remove sections the user excludes, such as "姹囨姤瀹氫綅".

Map content by type:

- agenda -> directory page
- conclusion + evidence -> core judgement + screenshot page
- metrics -> dashboard page
- system/process -> process page
- scenario proof -> case page with screenshots
- assets/methods -> asset library page
- roadmap/future plan -> roadmap or four-quadrant page
- issues/risks -> table or issue-card page
- final summary -> four-card summary page

For leadership decks:

- titles should be conclusion/action titles, not generic topic labels
- show the key point first, then evidence
- reserve screenshot areas when persuasion depends on proof
- avoid repeating one layout on many pages

### 4. Build or Edit Slides

Use extracted object parameters as the base.

General rules:

- Title: keep the template title position and weight.
- Cards: use template card fills, accent lines, and text sizes.
- Image placeholders: use editable rectangle placeholders with clear labels.
- Tables: keep editable tables, not table screenshots.
- Footer/brand areas: do not place content into the footer safe zone.
- Page 2 onward: follow the template/current background rule requested by the user.

### 5. Global Layout QA

Run QA across the whole deck, not just the page the user noticed.

Check every content slide for:

- **Text overflow**: no text crosses its container or gets clipped.
- **Duplicate text**: no old label remains under a new label.
- **Footer safe zone**: no body text enters the template footer/brand bar.
- **Element gaps**: bordered elements must not touch each other; keep at least `12pt` gap, preferably `16-20pt` when one element is a bottom summary bar.
- **Bottom summary cards**: if used, keep the card top high enough that all text bottom edges stay above the footer safe line.
- **Metric values**: currency, percentages, and fractions must stay on one line; reduce font size before allowing wrap.
- **Screenshot placeholders**: placeholder label should be centered and low-contrast, not compete with content.
- **Repeated components**: if one page has a component bug, scan all slides using the same component.

Recommended safety values for the current company template:

- Bottom body text must end at or above `366pt`.
- Bottom summary body text should end at or above `358pt`.
- Bottom summary card should leave visible space above the footer brand bar.
- Bordered upper modules and bottom summary cards need at least `12pt` gap; use `20pt` when possible.
- Currency metric text should use about `17-18pt` if the metric card width is near `96pt`.

### 6. Visual Verification

After edits:

- Export previews through WPS COM.
- Inspect a contact sheet or key page previews.
- If the deck has a known recurring component, inspect all slides containing it.
- Re-run object-coordinate checks for bottom text, large cards, and known risky pages.

Do not claim the PPT is ready until fresh verification has been run.

## WPS COM Pattern

Use PowerShell WPS COM for encrypted or non-OpenXML files:

```powershell
$app = New-Object -ComObject KWPP.Application
$p = $app.Presentations.Open($src, $true, $false, $false)
for ($si = 1; $si -le $p.Slides.Count; $si++) {
  $slide = $p.Slides.Item($si)
  for ($i = 1; $i -le $slide.Shapes.Count; $i++) {
    $shape = $slide.Shapes.Item($i)
    # Read Left, Top, Width, Height, Type, Fill, Line, TextFrame, Font.
  }
}
$p.Close()
```

Convert OLE RGB values to `#RRGGBB`. Tables require reading `shape.Table.Cell(row,col).Shape.TextFrame.TextRange.Text`.

Avoid parallel WPS COM operations. If WPS returns `RPC_E_CALL_REJECTED`, reuse the active instance or wait and retry instead of starting multiple competing automation sessions.

## Common Failure Patterns

- A bottom "姹囨姤鍙ｅ緞" bar is fixed on one slide but overflows on other slides using the same component.
- A new label is added over an old label, creating duplicate text.
- Metric cards wrap currency values such as `$134.70` into two lines.
- Screenshot placeholders are too large and touch summary bars.
- Right/left cards are visually attached because their borders have no gap.
- A slide looks acceptable in one preview, but object coordinates show text entering the footer safe zone.
- The original deck is overwritten instead of saving a new version.

## Final Response Checklist

Report:

- output PPTX path
- source document and template/current PPT used
- whether WPS COM or agent-slides was used
- pages changed or generated
- QA performed, including preview export and any object-coordinate checks
- unresolved placeholders or content the user still needs to provide

