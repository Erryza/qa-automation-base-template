# Reviewer checklist

Use with [../SKILL.md](../SKILL.md) and [coverage-matrix.md](coverage-matrix.md).
Mark each item: **Pass** / **Fail** / **N/A**.

**Mandate:** 100% coverage of in-scope inventory rows · 0 spec errors · no
approval with any GAP, DUP, or silently-dropped (SKIP-BAD) coverage.

Severity when Fail:
- **BLOCKER** — coverage GAP, spec error, broken file → REJECT + advisory
- **MAJOR** — quality issue a client would question → REJECT unless fixed now
- **MINOR** — cosmetic; fix before send or note for next time

Genericize every literal to the project under review.

---

## S. Coverage (Gate 2–3 — do first)

| # | Check | Sev |
|---|--------|-----|
| S1 | Inventory built from source specs + code (not from the workbook) | BLOCKER |
| S2 | Scope auto-detected: API spec → API cases; FSD/Figma screens → UI cases | BLOCKER |
| S3 | Every in-scope endpoint / screen has a feature tab | BLOCKER |
| S4 | Coverage matrix completed: all in-scope rows COVERED | BLOCKER |
| S5 | GAP count = 0 | BLOCKER |
| S6 | WEAK count = 0 (or remediated) | BLOCKER |
| S7 | Every mandatory input: invalid + empty negatives | BLOCKER |
| S8 | Every spec response code / result state has ≥ 1 TC | BLOCKER |
| S9 | Append advisory issued for all GAPs; author implemented | BLOCKER |
| S10 | Coverage sign-off block filled | BLOCKER |
| S11 | DUP count = 0 (no two TCs per inventory row) | BLOCKER |
| S12 | `validate_workbook.py` reports no duplicate Scenario/Data/condition | BLOCKER |
| S13 | Critical-thinking checks reviewed | MAJOR |
| S14 | Every Negative: bold varied field in Test Data; no yellow fill | MAJOR |
| S15 | Summary: authoring vs delivery honest (no premature client approval) | MAJOR |

---

## SR. New / regression / no-test coverage (Gate 2–3)

| # | Check | Sev |
|---|--------|-----|
| SR1 | Each spec behavior classified NEW / REGRESSION / NO-TEST (reviewer re-derived from code, not trusting the author) | BLOCKER |
| SR2 | Every **NEW** behavior covered by a new test case | BLOCKER |
| SR3 | Every **REGRESSION**-risk behavior touched by the change covered by a regression test case | BLOCKER |
| SR4 | Every **NO-TEST** scenario is genuinely unaffected (off the changed path) and carries a recorded skip reason | BLOCKER |
| SR5 | No scenario silently dropped — absence without a NO-TEST reason is a GAP (SKIP-BAD) | BLOCKER |
| SR6 | NEW vs REGRESSION balance sane — not all happy-path NEW with zero regression cases | MAJOR |

---

## A. File & workbook shell

| # | Check | Sev |
|---|--------|-----|
| A1 | Summary sheet exists | BLOCKER |
| A2 | One tab per feature (no mixed features per tab) | BLOCKER |
| A3 | Row 3 separator; data starts row 4 | MAJOR |
| A4 | Header fill `#ACB9CA`, bold header row | MAJOR |
| A5 | No `#REF!` / broken formulas on Summary | BLOCKER |
| A6 | Filename follows the project naming convention | MINOR |

---

## B. Columns & constants (every feature tab)

| # | Check | Sev |
|---|--------|-----|
| B1 | Col D (TC Type) = `Positive` or `Negative` only | BLOCKER |
| B2 | Col E (Platform) consistent with the project profile (API / Web / Mobile) | MAJOR |
| B3 | Col F (Module) matches the sheet tab name | BLOCKER |
| B4 | Col N (Actual Results) blank at authoring | MAJOR |
| B5 | S.No. sequential, no gaps | MAJOR |
| B6 | TC IDs unique; single prefix per sheet | BLOCKER |
| B7 | COUNTIF formula present in row 2 | MAJOR |

---

## C. Spec alignment (sample + spot)

| # | Check | Sev |
|---|--------|-----|
| C1 | Col C RTM link / section resolves | BLOCKER |
| C2 | Endpoint / screen in Pre-Condition matches spec | BLOCKER |
| C3 | Method / interaction correct | BLOCKER |
| C4 | Expected response code / state exists in spec | BLOCKER |
| C5 | Mandatory/Optional in Test Steps matches spec | MAJOR |
| C6 | Computed values (e.g. signatures) match the spec's **definition table / algorithm**, not a sample literal | BLOCKER |

> **Follow the client-submitted spec, not a misleading sample.** When an example
> block in the spec contradicts the normative definition table, the definition
> table wins. Flag the discrepancy; do not propagate the sample.

---

## D. Coverage per endpoint / screen on tab

| # | Check | Sev |
|---|--------|-----|
| D1 | ≥ 1 Positive happy path | BLOCKER |
| D2 | Each mandatory input: invalid negative | MAJOR |
| D3 | Each mandatory input: empty negative | MAJOR |
| D4 | Auth / permission inputs covered if in spec | MAJOR |
| D5 | No duplicate TC for the same condition (1 inv row → 1 TC) | BLOCKER |
| D6 | No duplicate Scenario+Type / Test Data on sheet | BLOCKER |

---

## E. Content quality (per sampled TC)

| # | Check | Sev |
|---|--------|-----|
| E1 | Scenario matches what the Test Data actually changes | BLOCKER |
| E1b | Empty-input TCs: `Field: ` only (no doubled `Field: Field: `); invalid TCs show a bad value | BLOCKER |
| E2 | Varied input **bold** in Test Data (no yellow fill); aligns with Expected Results | MAJOR |
| E3 | Changed field: concrete invalid value OR empty | BLOCKER |
| E4 | Steps annotate the change `(with invalid/empty data)` | MAJOR |
| E5 | Expected Results structured (status / response / state) | MAJOR |
| E6 | Negative TC does not expect a success result | BLOCKER |

---

## F. Summary sheet

| # | Check | Sev |
|---|--------|-----|
| F1 | One row per feature tab | BLOCKER |
| F2 | Sheet name in formula matches tab exactly | BLOCKER |
| F3 | TC counts align with feature tab rows after appends | MAJOR |

---

## (Opt-in) G. API-only profile — only when a profile forbids non-API work

| # | Check | Sev |
|---|--------|-----|
| G1 | `validate_workbook.py --scope-api-only` passes | BLOCKER |
| G2 | No DB / SQL / network / packet-capture steps in Test Data | BLOCKER |
| G3 | No forbidden tabs / TC prefixes the profile bans | BLOCKER |

Do **not** apply Section G unless the project profile explicitly forbids the
category. Absent that, UI / DB-adjacent content is in scope, not a violation.

---

## Review log template

| Gate | Result | Notes |
|------|--------|-------|
| 0 Hygiene | | |
| 1 Structure (script) | | |
| 2 Inventory / scope | | |
| 3 Coverage + NEW/REGR/NO-TEST | | |
| 4 Spec-error audit | | |
| 5 Content sample | | |
| 6 Summary | | |

**Final verdict:** authoring-approved / delivery-approved / REJECTED
**Blocker count:** __   **Major count:** __
