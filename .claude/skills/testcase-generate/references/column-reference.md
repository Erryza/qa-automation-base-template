# Column reference

Per-column content rules. Layout/colors/formulas live in [excel-format-spec.md](excel-format-spec.md).

> **One Excel tab per feature name** — Module column (F) must match the sheet tab.

---

## S.No. (col A)
Numeric sequence: `1.0`, `2.0`, `3.0`… one per TC row, no gaps.

## TC ID (col B)
Format `{PREFIX}-{SEQ}` — e.g. `AUT-001`, `LGN-014`, `PAY-082`. PREFIX = 3-letter code from the feature name, one per sheet; SEQ = 3-digit zero-padded, restarts per sheet, contiguous. New vs Regression is **not** in the prefix — see [Test Category column](#test-category-column).

## ID FSD - RTM (col C)
Traceability link: full spec URL (Notion/Confluence/Google Doc), or `FSD/TSD <file> — §section`, or a Figma link for UI features. Render as blue font (`#0000FF`). One link per feature sheet is acceptable (repeated across its rows). **When the TSD carries TR-IDs (its §10.2 traceability matrix), also cite the TR-ID(s) for that section here, e.g. `TSD_X.md — §4.1.3 [TR-CORPACT-002]`**, and populate the dedicated [TR-ID column](#tr-id-column) so downstream joins (e.g. mapping TCs to WBS epics) are exact rather than heuristic.

## TC Type (col D)
`Positive` (happy path, valid inputs, optional-field variations) or `Negative` (missing/invalid/empty/wrong-format/auth-failure). **Do not** use `Positive Case` / `Negative Case`.

## Platform (col E)
The row type — drives which validator checks apply:

| Value | Use |
|-------|-----|
| `API` / `Service` | API/back-end test cases (gets API-specific checks: bold negative, Header:/Body:, signature shape) |
| `Web` / `UI` / `Mobile` | Front-end test cases (no API-shaped content required) |

## Module (col F)
Feature/capability name **without** a "Module " prefix (e.g. `Authentication`, `Login Screen`, `Payment`). All TCs on a sheet share the same Module value = the tab name.

## Scenario (col G)
Short title for the condition; often mirrors the API operation or the screen action. Merge cells `G{row}:G{row+1}` when consecutive TCs share a scenario group.

## Test Description (col H)
Full sentence explaining purpose, usually scenario name + detail.

## Pre-Condition (col I)
- **API:** numbered endpoint + method —
  ```
  1. Endpoint: .../{version}/account-inquiry
  2. Method set to POST
  ```
- **UI:** the screen/state the user starts from — `1. User is on the Login screen`.

## Test Data (col J)

### API rows
Two sections separated by a blank line:
```
Header:
POST .../v1.0/account-inquiry HTTP/1.1
Content-Type: application/json
Authorization: Bearer {token}
X-TIMESTAMP: 2020-12-21T10:21:34+07:00
X-SIGNATURE: {value per the spec's header definition table — not a sample-block hex}

Body:
{
  "beneficiaryAccountNo": "60004400184",
  "partnerReferenceNo": "2020102900000000000001"
}
```

### UI rows
Field-name : value pairs (no Header:/Body: requirement):
```
Username: validuser
Password: (empty)
```

### Bold varied field (required)
When a TC varies a field from the happy-path baseline:
1. **Bold** the exact header/JSON/field line under test (Excel rich text).
2. **No** cell background color (transparent — never yellow).
3. Put the **actual** invalid/empty value (not the valid baseline).
4. Mirror in Test Steps: `(with invalid data)` / `(with empty data)`.
5. Expected Results must match what the bold field triggers.

Positive happy-path TCs with no variation: plain text, no bold.

### Programmatic generation (openpyxl)
```python
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
VARIED, NORMAL = InlineFont(b=True), InlineFont(b=False)
rich = CellRichText()
for line in lines:
    font = VARIED if line_matches_flag(line, changed_flags) else NORMAL
    rich.append(TextBlock(font, f"{line}\n"))   # every part a TextBlock
cell.value = rich
```

| Pitfall | Fix |
|---------|-----|
| Bold not detected by validator | `load_workbook(path, rich_text=True)` |
| Bold lost on save | Don't mix `str` + `TextBlock` in one `CellRichText` |
| No line bolded | `changed_flags` must match real header/JSON/field text, not scenario labels |
| Empty header doubled | `X-TIMESTAMP: ` (replace value only) — never `X-TIMESTAMP: X-TIMESTAMP: ` |
| Empty field line removed | Keep the line (`CHANNEL-ID: `) so bold can attach |

## Test Steps (col K)
Numbered steps listing **every** field with `(Mandatory)` / `(Optional)` (not `[M]`/`[O]`). Annotate the varied field: `- Authorization (with invalid data)`.
- **API:** Postman-style, ending with `5. Click the Send button`.
- **UI:** user actions (open screen, enter X, click Y).

## Testing Type (col L)
`Automation` or `Manual` — match the project convention.

## Expected Results (col M)
- **API positive:**
  ```
  1. Status: 200 Ok
  2. Header data appears:
  Content-Type: application/json
  3. Body data appears:
  {"responseCode":"2001600","responseMessage":"..."}
  ```
- **API negative:** `1. Status: 400 Bad Request` + response body with the spec `responseCode`.
- **UI:** observable outcomes — `1. Inline error 'Password is required' appears` / `2. User stays on the Login screen`.

Use exact codes/messages from the spec — never invented.

## Actual Results (col N)
**Blank** at authoring. Header is `Actual Results` (no trailing space; the validator tolerates either form).

## Test Category column
A dedicated column (far-right, after the tracking band — col X in the reference layout) holding **`New`** or **`Regression`** on every TC row. See [new-vs-regression.md](new-vs-regression.md). Kept out of the TC-ID prefix so each sheet stays one-prefix + contiguous (validator requirement). `No-Test` scenarios are **not** rows here — they go on the **No-Test Log** support sheet.

## TR-ID column
**Add this whenever the TSD carries TR-IDs** (its §10.2 traceability matrix). A dedicated column at the **far right** (after the Test Category + COUNTIF band, clear of the validator's hardcoded A–N/COUNTIF indices — e.g. column AD) holding the **TR-ID(s)** that the TC verifies, semicolon-separated when more than one. Resolve them from the TSD §10.2 matrix by the TC's §section (the same section cited in col C). Why it matters: TR-IDs are the **shared key** between test cases and the WBS (whose tasks/epics also carry TR-IDs), so emitting them here makes the Epic↔TC / RTM join **exact** instead of a section/keyword heuristic. Omit the column only when there is no TSD or it has no TR-IDs (trace to FSD §section in col C instead).

## Execution tracking columns (O–W)
Blank at authoring. `O Status`, `Q Link Evidence`, `R bug ticket`, `S/T PIC`, `V review status`.

---

## Scenario coverage matrix (per endpoint / screen)

| Priority | API scenario | UI scenario | TC Type |
|----------|--------------|-------------|---------|
| P1 | Valid request (happy path) | Valid path through the screen | Positive |
| P1 | Each mandatory field — invalid | Each required field — invalid format | Negative |
| P1 | Each mandatory field — empty | Each required field — empty | Negative |
| P2 | Field exceeding max length | Field exceeding max length | Negative |
| P2 | Optional field — empty | Conditional field visibility | Negative/Positive |
| P2 | Nested object — invalid/empty | Navigation / routing | Negative/Positive |
| P3 | Variant inputs (currency, channel) | State variants (loading, error, empty) | Positive/Negative |
