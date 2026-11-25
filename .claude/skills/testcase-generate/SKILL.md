---
name: testcase-generate
description: Generate client-ready test cases from an FSD (plus optional TSD/API spec) and the existing source code, output as an Excel workbook (Summary sheet + one tab per feature, PREFIX-001 TC IDs, RTM traceability). Auto-detects scope from inputs — API test cases from an API spec/TSD, UI/FE test cases from FSD screen designs or a Figma link, or both. Classifies every scenario against the code as New, Regression, or No-Test so regression cases are authored and unaffected behavior is skipped with a reason. Use when asked to generate test cases, SIT test cases, a test case xlsx from an FSD/TSD/spec, regression test cases, test cases from source code, API test cases, or UI test cases.
---

# Test case generation

Generate client-ready test cases from a spec (FSD required-ish; TSD / API spec optional) **and the existing source code**, output as an Excel workbook that matches the template in [excel-format-spec.md](references/excel-format-spec.md): a **Summary** sheet plus **one tab per feature**, `PREFIX-001` TC IDs, RTM/traceability, and per-feature COUNTIF rollups.

This skill is **fully standalone** — it self-validates with its own bundled `scripts/validate_workbook.py`. It does **not** depend on any other skill. For independent QA you may *recommend* (never require) running a separate `testcase-review` skill.

What makes this skill different from a plain "write test cases" task: it reads the **source code** and classifies each candidate scenario as **New / Regression / No-Test** ([references/new-vs-regression.md](references/new-vs-regression.md)), and it **auto-detects** whether to author API, UI, or both kinds of test cases from the inputs ([references/scope-detection.md](references/scope-detection.md)).

> **Follow the client-submitted spec tables, not misleading samples:** [references/tsd-alignment.md](references/tsd-alignment.md)
> **Avoid repeat defects:** [references/common-mistakes.md](references/common-mistakes.md)
> **Get smarter each run:** [references/continuous-improvement.md](references/continuous-improvement.md)
> **Project overlay:** none yet for this repo · how to write one: [project-playbooks/README.md](project-playbooks/README.md)

---

## Inputs

| Input | Required? | Used for |
|-------|-----------|----------|
| **FSD** (functional spec) | Strongly preferred | Features, screen designs, field tables, business rules, validations |
| **TSD / API spec** | Optional | Endpoints, request/response contracts, headers, error codes |
| **Source code** | Required for New/Regression classification | What already exists, what the change touches, impact radius |
| **Figma MCP / shared Figma link** | Optional | Derive UI test cases (screens, components, states) when present |

**Figma is conditional.** If a Figma MCP or a shared Figma link is available, use it to derive UI test cases; otherwise derive UI test cases from the FSD screen designs. No Figma MCP is required — never hard-require it.

---

## Output

```
test-cases/<project or feature>/Test Cases - <Feature Name>.xlsx
```

- **One workbook** per spec engagement; **one sheet per feature name** (no mixing features on a tab).
- Data rows start at **row 4** (rows 1–2 = headers, row 3 = empty separator).
- Save the `.xlsx`, then report the output path, the feature tab names, and per-tab TC counts.

You choose the output folder with the user; the only hard rules are one workbook + one tab per feature. Detailed layout, colors, widths, formulas → [references/excel-format-spec.md](references/excel-format-spec.md). Per-column content → [references/column-reference.md](references/column-reference.md).

---

## Workflow (5 phases)

### Phase 1 — Input analysis

- Read the **full** spec end-to-end. For `.docx`, dump **tables**, not only paragraphs — header/field **definition tables** are the source of truth for algorithms, M/O/C cardinality, and max lengths. See [references/tsd-alignment.md](references/tsd-alignment.md).
- Identify **features** (one sheet each): API groups, auth flows, screens, modules, infrastructure flows.
- For each feature, inventory every testable item: endpoints + headers + body fields (with Mandatory / Optional / Conditional), screen fields + validations + states, error/response codes, business rules.
- Map each feature to RTM (col C): full spec URL if available, else a `FSD/TSD <file> — §section` reference or a Figma link.
- Assign a **3-letter TC-ID prefix per feature sheet** (derived from the feature name). One prefix per sheet; sequence restarts per sheet.

### Phase 2 — Scope detection + New/Regression/No-Test classification

This phase decides **what kinds** of test cases to author and **which** scenarios to author at all.

**A. Detect scope from the inputs** ([references/scope-detection.md](references/scope-detection.md)):

| Signal in inputs | Author |
|------------------|--------|
| API spec, or API/endpoint sections in the TSD | **API** test cases — request/response I/O, headers, body, M/O/C fields, error codes, timeouts, anomalies |
| FSD screen designs / field tables / a Figma reference | **UI/FE** test cases — fields, validations, navigation, states |
| Both present | **Both** |

Do **not** hardcode "API only." A project with no front-end naturally yields API-only test cases because no UI signal exists — that falls out of detection, it is not a rule.

**B. Classify every candidate scenario against the source code** ([references/new-vs-regression.md](references/new-vs-regression.md)). Use **CodeGraph** (`codegraph_*` tools) if available — `codegraph_search` to locate the symbol, `codegraph_impact`/`codegraph_callers` to find the blast radius — otherwise grep/read:

| Class | Meaning | Action |
|-------|---------|--------|
| **New** | Behavior the spec introduces that does not exist (or is being built) in the code | Author full new test cases; tag **New** |
| **Regression** | Existing behavior the change touches or could break (call paths into/around the changed code) | Author regression test cases; tag **Regression** |
| **No-Test** | Existing behavior unrelated to / unaffected by the change | Do **not** author; record on the **No-Test Log** sheet with a one-line reason |

**When to add the `Test Category` column — conditional, to stay faithful to the client template:**
- If the run produces a **mix of New and Regression** (you are generating against an existing codebase where some scenarios are regression), add a **`Test Category`** column (far-right, *after* the tracking band — see [references/column-reference.md](references/column-reference.md#test-category-column)) holding `New` / `Regression` per row. This adds information the client template doesn't otherwise carry.
- If the run is an **all-new / first-time suite** (every scenario is New — like a greenfield SIT), **omit** the column so the layout matches the client template exactly (A–N + tracking band, nothing extra). Note in your handoff that all rows are New.
- Either way, **always keep the No-Test Log** support sheet when anything was skipped, so nothing is silently dropped: candidate behavior, where it lives, why it was skipped. (It's a support sheet — appended, doesn't change the feature tabs; the validator skips it.)

### Phase 3 — Authoring

- Fill cols **A–M** for each TC; leave **N** (Actual Results) blank. Set the **`Test Category`** column to `New` / `Regression` **only if** that column was added per the rule above (mixed run); omit it for an all-new suite.
- Apply Excel styling per [references/excel-format-spec.md](references/excel-format-spec.md).
- For every **Negative** (and any Positive that varies one field), **bold** the exact varied field line in **Test Data (col J)** — see [Test Data — bold varied field](#test-data--bold-varied-field). Mirror it in Test Steps with `(with invalid data)` / `(with empty data)`.
- Copy `responseCode` / error values and validation messages **verbatim from the spec** — never invent them.

### Phase 4 — Self-review

- Run the bundled validator (Phase-4 gate):
  ```bash
  python3 scripts/validate_workbook.py "<path-to-xlsx>"
  ```
  Add `--strict-scope` (or `--profile api-only`) **only** when a project profile bans non-API rows. Fix every BLOCKER/MAJOR and re-run until it exits 0.
- Walk the [Self-review checklist](#self-review-checklist). Read [references/common-mistakes.md](references/common-mistakes.md) and [references/tsd-alignment.md](references/tsd-alignment.md); confirm none apply.
- Update the project playbook + (if reusable) common-mistakes per [references/continuous-improvement.md](references/continuous-improvement.md).

### Phase 5 — Done

- Save to the output path; report feature tab names, per-tab TC counts, and the New / Regression / No-Test breakdown.
- **Recommended (optional):** run a separate `testcase-review` skill for an independent QA pass. This is a recommendation, not a gate — the workbook is deliverable once Phase 4 passes.

---

## Client quality bar (generic)

1. **Coverage** — every testable spec item that is **New or Regression** has at least one TC. No-Test items are logged, not authored.
2. **Zero spec errors** — no invented response codes, endpoints, validation messages, or M/O classifications.
3. **Zero duplicates** — one inventory row → one TC (invalid vs empty for the same field is allowed; copy-paste rows are not).
4. **Template match** — columns, colors, row layout per [references/excel-format-spec.md](references/excel-format-spec.md).
5. **Traceability** — RTM in col C; New/Regression tag per row; No-Test Log present.

### Per-endpoint / per-screen coverage minimum

- **API:** 1× Positive (valid) + per **Mandatory** header/body field: Negative invalid **and** Negative empty + ≥1 TC per spec `responseCode` + conditional/business rules + boundary (max length) where the spec defines one.
- **UI:** 1× valid-path Positive per flow + per required field: empty + invalid-format Negative + field-level validation messages + navigation/state transitions + key error states.

TC count is **spec-driven** — derive it from the inventory, not from a global target. A large spec may need 300+ TCs; a small one fewer than 100. Neither is wrong if coverage is complete.

---

## TC ID naming convention

Format: `{PREFIX}-{SEQ}`

- **PREFIX** = a 3-letter code derived from the **feature name** (e.g. `AUT` for Authentication, `DEC` for Decode, `LGN` for Login Screen, `PAY` for Payment). One prefix per sheet.
- **SEQ** = 3-digit zero-padded, **restarts per sheet** (`001`, `002`, …), contiguous (no gaps).
- New vs Regression is **NOT** encoded in the prefix — it goes in the **Test Category** column. This keeps one prefix + contiguous numbering per sheet (which the validator enforces).

Project-specific prefixes (e.g. legacy `EAI`/`PTI`/`DQR`/`PYH`) belong in a project overlay, not here — see [project-playbooks/README.md](project-playbooks/README.md).

---

## Column quick reference (A–N + Test Category)

| Col | Header | Value / Rule |
|-----|--------|--------------|
| A | S.No. | `1.0`, `2.0`, `3.0`… |
| B | TC ID | `PREFIX-001` |
| C | ID FSD - RTM | Spec URL / doc §section / Figma link; blue font |
| D | TC Type | `Positive` or `Negative` |
| E | Platform | `API`, `Web`, `UI`, `Mobile`, `Service` (drives which checks apply) |
| F | Module | Feature label — usually the tab name but may differ (e.g. tab `Inquiry QR` → `API Decode QR MPM`) |
| G | Scenario | Short condition title |
| H | Test Description | Full purpose sentence |
| I | Pre-Condition | Endpoint+method (API) or screen/precondition (UI) |
| J | Test Data | `Header:` + `Body:` (API) or field values (UI); **bold** the line under test; no cell fill |
| K | Test Steps | Numbered steps; API ends with `Click the Send button` |
| L | Testing Type | `Automation` or `Manual` |
| M | Expected Results | `1. Status / 2. Header / 3. Body` (API) or observable outcomes (UI) |
| N | Actual Results | Blank at authoring (header `Actual Results`, no trailing space) |
| (far-right, optional) | Test Category | `New` / `Regression` — **only** added on a mixed new+regression run; omit for an all-new suite |
| (far-right, when TSD has TR-IDs) | TR-ID | The TR-ID(s) the TC verifies (from the TSD §10.2 matrix, by the TC's §section); the shared key that makes Epic↔TC / WBS joins exact — see [column-reference.md](references/column-reference.md#tr-id-column) |

Full detail: [references/column-reference.md](references/column-reference.md).

---

## Test Data — bold varied field

For every **Negative** (or Positive that varies one field), the reader must see **which** field drives the Expected Result.

| Rule | Detail |
|------|--------|
| **Bold** the exact header/JSON/field line that differs from happy path | Use Excel rich text (`CellRichText` of `TextBlock`) |
| **No** cell background color on col J | Transparent / white — never yellow fill |
| **No** `► [CHANGED]` prefix | Bold alone marks the field under test |
| Show the **actual** invalid/empty value | Not the baseline valid value |
| Scenario ↔ Test Data agree | "empty X" → line `X: ` (blank value, header line kept); "invalid X" → the actual bad value |
| Empty header | `X-TIMESTAMP: ` — keep the line, **never** double the prefix (`X-TIMESTAMP: X-TIMESTAMP: `) |

Happy-path TCs with no variation: plain text, no bold. Validation requires `load_workbook(path, rich_text=True)` to detect bold. Implementation detail: [references/column-reference.md](references/column-reference.md#test-data-col-j) and [references/excel-format-spec.md](references/excel-format-spec.md).

---

## Self-review checklist

Complete before declaring done:

- [ ] `validate_workbook.py` exits 0 (add `--strict-scope` only if a profile requires it)
- [ ] Scope detected correctly: API and/or UI tabs match the inputs
- [ ] Every **New** and **Regression** scenario has a TC; every **No-Test** item is on the **No-Test Log** with a reason
- [ ] If a mixed new+regression run: **Test Category** = `New`/`Regression` on every row; if all-new: column omitted, handoff notes all rows are New
- [ ] Every Negative TC: **bold** the varied line in col J; no yellow fill; value matches the Scenario
- [ ] Every Negative: Test Data shows the invalid/empty value; Expected Results are not success-200
- [ ] Every Mandatory field has invalid **and** empty Negative TCs (or a documented exception)
- [ ] No duplicate row (same Scenario+Type / same Test Data / same Scenario+Type+Expected)
- [ ] `responseCode` / validation messages copied from spec — none invented
- [ ] One workbook + one tab per feature; one coherent feature per tab (Module col F may differ from the tab label); row 3 separator; data from row 4
- [ ] Playbook + (if reusable) common-mistakes updated per continuous-improvement.md
