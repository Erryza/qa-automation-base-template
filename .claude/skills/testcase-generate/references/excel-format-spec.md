# Excel format specification

The deliverable workbook. Match this structure, colors, fonts, and cell patterns exactly. Concrete values here are the template — do not "genericize them away."

> Skill workflow: [../SKILL.md](../SKILL.md) · per-column content: [column-reference.md](column-reference.md)

---

## Workbook structure

| Sheet | Purpose |
|-------|---------|
| **Summary** | Execution dashboard — one row per feature tab with COUNTIF rollups |
| **{Feature Name}** | One tab per feature (e.g. `Authentication`, `Login Screen`, `Payment`) |
| **No-Test Log** | Support sheet — candidate behaviors deliberately not tested + reason (see [new-vs-regression.md](new-vs-regression.md)) |
| Rule Register / Checklist | Optional support sheets |

**File naming:** `Test Cases - <Feature Name>.xlsx` (Title Case, spaces). One workbook per spec engagement; **multiple feature tabs** inside (not one file per feature).

---

## Feature tab layout

### Row structure

| Row | Content |
|-----|---------|
| **1** | Column headers (merged with row 2 for cols A–W) |
| **2** | Sub-labels: O2=`Manual`, P2=`Automation`; COUNTIF counters in the X2–AB2 band (TC validation, to-be-executed, passed, failed, blocked) per the client sample |
| **3** | Empty separator row — same header fill color as row 1 |
| **4+** | Test case data (S.No. starts at `1.0`) |

**Auto-filter:** `$A$3:$AB${lastRow}` · **Data starts:** row 4

### Column map

Core authoring cols **A–N**, tracking band **O–W**, COUNTIF counters in the **X–AB** band (match the client sample's existing columns). The client template has **no** New/Regression column — when classification is needed, append an **optional `Test Category`** column *after* the existing columns (or keep it on a separate No-Test Log sheet) so the A–N + tracking layout still matches the sample exactly.

| Col | Header | Authoring | Notes |
|-----|--------|-----------|-------|
| A | S.No. | Yes | `1.0`, `2.0`… |
| B | TC ID | Yes | `PREFIX-SEQ` |
| C | ID FSD - RTM | Yes | Spec URL / doc §section / Figma link. Blue font |
| D | TC Type | Yes | `Positive` / `Negative` only |
| E | Platform | Yes | `API` / `Web` / `UI` / `Mobile` / `Service` |
| F | Module | Yes | Feature label; often the tab name but MAY differ (e.g. tab `Inquiry QR` → module `API Decode QR MPM`); a tab may carry >1 module |
| G | Scenario | Yes | Short condition title; merge vertically when shared |
| H | Test Description | Yes | Full purpose sentence |
| I | Pre-Condition | Yes | Endpoint+method (API) or precondition (UI) |
| J | Test Data | Yes | `Header:`+`Body:` (API) or field values (UI); bold the varied line |
| K | Test Steps | Yes | Numbered steps |
| L | Testing Type | Yes | `Automation` or `Manual` |
| M | Expected Results | Yes | Numbered status/header/body (API) or outcomes (UI) |
| N | Actual Results | Blank at authoring | Header `Actual Results` (no trailing space; validator tolerates either) |
| O | Status | Blank | `Passed` / `Failed` / `Blocked` / `Invalid` / `to be executed` |
| P | (under Status merge) | — | Row 2 only: `Automation` sub-label |
| Q | Link Evidence | Blank | `ScreenShot : {url}` |
| R | No Jira Bug Tracker | Blank | Ticket ID if failed |
| S | PIC QA | Optional | QA owner |
| T | PIC BA | Optional | BA owner |
| U | Remarks | Blank | Free text |
| V | Status review TC | Blank | e.g. `Done` |
| W | Reviewer Comment | Blank | Review notes |
| **X** | **Test Category** | **Yes** | **`New` or `Regression`** (far-right; placed after the tracking band so it never shifts the validator's hardcoded A–N indices) |
| Y | To be Executed | Formula | `=COUNTIF(O:O,"to be executed")` in row 2 |
| Z | Passed | Formula | `=COUNTIF(O:O,"Passed")` |
| AA | Failed | Formula | `=COUNTIF(O:O,"failed")` |
| AB | Blocked | Formula | `=COUNTIF(O:O,"Blocked")` |
| AC | Invalid | Formula | `=COUNTIF(O:O,"Invalid")` |
| **AD** | **TR-ID** | **When TSD has TR-IDs** | The TR-ID(s) the TC verifies (semicolon-separated), resolved from the TSD §10.2 matrix by the TC's §section. Shared key for Epic↔TC / WBS joins — see [column-reference.md](column-reference.md#tr-id-column). |

> If you place the Test Category / TR-ID columns elsewhere, keep them **clear of** the validator's hardcoded indices: TC ID=2, Type=4, Platform=5, Module=6, Test Data=10, Expected=13, Actual=14, COUNTIF=25. The far-right band (X for Test Category, AD for TR-ID) is safest.

---

## Colors & fonts

### Header rows 1–2 (cols A–N) + separator row 3

| Property | Value |
|----------|-------|
| Fill | `#ACB9CA` |
| Font | Arial 11pt **bold** |
| Alignment | Center H+V, wrap |
| Border | Thin all sides |

### Data rows (row 4+)

| Property | Value |
|----------|-------|
| Fill | None (white) — **never** yellow on col J |
| Font | Calibri 11pt |
| Wrap | Yes on cols J, K, M, N |
| Alignment | Top / left |
| Col C (RTM) | Blue font `#0000FF` |

### Summary sheet

| Element | Fill | Font |
|---------|------|------|
| Title (row 1) `TEST CASE EXECUTION DETAILS` | `#1F4E78` | Arial 9 bold white |
| Sub-headers (row 2) | `#D9D9D9` (A–J) / `#E2EFDA` (% cols K–N) | Arial 9 bold |
| Feature names (col A) | — | Arial bold `#0000FF` |

**Yellow fill (`#FFF2CC`)** is allowed only on a Summary section title — **never** on a feature-tab col J Test Data cell. The validator flags yellow on Test Data.

---

## Column widths (reference)

| Col | Width | Col | Width |
|-----|-------|-----|-------|
| A–E | 13.0 | J Test Data | 62.13 |
| F Module | 15.88–19.63 | K Test Steps | 42.25 |
| G Scenario | 21.88 | L | 13.0 |
| H Test Description | 16.38 | M Expected Results | 54.75 |
| I Pre-Condition | 16.13 | N Actual Results | 95.38 |

Set `wrap_text=True` on J, K, M, N.

---

## Summary sheet formulas

Per feature row (example row 3 = `Authentication`):

| Col | Formula |
|-----|---------|
| D # Total TC | `=E3+F3` |
| E # to be executed | `='Authentication'!Y2` |
| F # Executed | `=G3+H3+I3` |
| G # Passed | `='Authentication'!Z2` |
| H # Failed | `='Authentication'!AA2` |
| I # Blocked | `='Authentication'!AB2` |
| J # Invalid | `='Authentication'!AC2` |
| K % Executed | `=IFERROR(F3/D3,0)` |
| L % Passed | `=IFERROR(G3/D3,0)` |
| M % Fail | `=IFERROR(H3/D3,0)` |
| N % Block | `=IFERROR(I3/D3,0)` |

---

## Generating with openpyxl

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont

HEADER_FILL = PatternFill("solid", fgColor="ACB9CA")
HEADER_FONT = Font(name="Arial", size=11, bold=True)
DATA_FONT   = Font(name="Calibri", size=11)
RTM_FONT    = Font(name="Calibri", size=11, color="0000FF")
VARIED = InlineFont(b=True); NORMAL = InlineFont(b=False)
WRAP   = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
THIN   = Side(style="thin")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
```

- Apply `HEADER_FILL` + `HEADER_FONT` + `CENTER` + `BORDER` to rows 1–2 and separator row 3.
- Apply `DATA_FONT` + `WRAP` + `BORDER` to data rows; `RTM_FONT` to col C.
- **Bold Test Data (col J):** build a `CellRichText` of `TextBlock(InlineFont(b=...), line+"\n")` — one TextBlock per line, never mix plain `str` with `TextBlock` or Excel flattens the bold.
- Validate with `load_workbook(path, rich_text=True)` so bold is detectable.

A runnable mixed API+UI example is bundled at [../assets/example-testcases.xlsx](../assets/example-testcases.xlsx).
