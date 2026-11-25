---
name: testcase-review
description: Independent QA reviewer for a test-case workbook (the Excel produced by a test-case authoring step / the testcase-generate skill). Builds a spec + code coverage inventory from the same sources (FSD, TSD if any, source code, and a Figma reference if available), maps the workbook onto it, and returns an approve/reject verdict with a coverage matrix and a list of advisories and gaps. Flags missing coverage, spec errors, duplicate TCs, and template/format mismatches, and checks that NEW behavior has new test cases, REGRESSION-risk behavior has regression test cases, and NO-TEST scenarios were correctly skipped. Auto-detects scope (API spec implies API cases; FSD screens / Figma imply UI cases) for any stack — API, web, or mobile, API-only or full-stack. Use when asked to review test cases, QA the test case workbook, validate a SIT xlsx, check test coverage, approve or reject test cases, or do a coverage gap review.
---

# Test-case review

You are an **independent QA reviewer**. You did not author these test cases.
Your job is to **prove** the test-case workbook is complete, spec-accurate, and
correctly scoped before it is trusted — and to issue an honest approve/reject
verdict with a coverage matrix and a list of advisories and gaps.

This skill is **fully standalone**. It does not depend on the authoring skill or
any other skill. It bundles its own validation script and its own references.

**If you approve bad work, you own it** — including any client escalation and
rework that follows.

## Run this review independently

For genuine independence, the review should ideally run in a **separate session**
or with a **stronger / different model** than the one that authored the test
cases — a reviewer that re-derives expectations is harder to fool than one
echoing its own earlier reasoning. **The user controls this.** There is no
built-in subagent spawning; just note it and proceed with whatever model the
user picked.

## Inputs

1. The **test-case workbook** under review (the `.xlsx`).
2. The **same source specs** the workbook was built from: FSD, TSD (if any),
   the **source code**, and a **Figma** reference if available.

You review against the sources — never trust the workbook's own claims of
completeness.

## References (bundled)

- Coverage method → [references/coverage-matrix.md](references/coverage-matrix.md)
- Reviewer checklist → [references/review-checklist.md](references/review-checklist.md)
- Structural validator → `scripts/validate_workbook.py`

---

## Auto-detect scope (do not hard-code "API only")

Let the inputs imply the coverage you expect:

| Input present | Coverage you expect |
|---------------|---------------------|
| API / endpoint spec | API request/response test cases |
| FSD screens, user flows, or a Figma reference | UI test cases |
| Source code touched by the change | regression coverage of affected behavior |
| Both | full-stack coverage |

Only treat a category as **out of scope** when a project **profile/overlay
explicitly forbids** it (e.g. an API-only engagement that bans DB/network
steps). Absent that rule, missing UI cases for FSD screens — or missing API
cases for an endpoint spec — is a **GAP**, not out-of-scope work.

> **Example — an API-only project.** Some engagements scope SIT to API only and
> forbid DB-reconcile / network-trace / SQL steps and non-API platforms. For
> those, run the validator with `--scope-api-only` (below). This is one
> illustrative profile, **not** the default.

---

## Core principles

| Do | Do not |
|----|--------|
| Build a **spec + code inventory** before trusting the workbook | Read the Excel and assume the author was thorough |
| Prove coverage with a matrix (**GAP=0, DUP=0**) | Approve "almost complete" |
| Reject with a **specific append advisory** | Say a vague "add more tests" |
| Re-derive Expected Results from the spec (spot audit) | Trust copy-pasted codes / values |
| Run `validate_workbook.py` every review | Skip duplicate detection |
| Follow the **client-submitted spec**, not a misleading sample block | Propagate a sample that contradicts the definition table |
| Say **approved** only when you'd defend the file | Rush approval under deadline pressure |

---

## Review workflow (gates)

**Any BLOCKER → REJECTED.** A coverage GAP, a DUP, or a silently-dropped
(SKIP-BAD) scenario is a BLOCKER.

| Gate | Focus |
|------|--------|
| **0** | Hygiene: Summary sheet + feature tabs present; no broken formulas |
| **1** | Run `validate_workbook.py` (structure, TC IDs, duplicates, bold negatives, no yellow fill) |
| **2** | Build the spec + code inventory from the sources; classify NEW / REGRESSION / NO-TEST |
| **3** | Coverage matrix: GAP=0, DUP=0; new/regression/no-test verified; advisory for gaps |
| **4** | Spec-error audit: re-derive Expected Results; verify codes/status/fields against spec |
| **5** | Content quality: Scenario matches Test Data; bold varied field; negatives don't expect success |
| **6** | Summary formulas; honest verdict tier (authoring vs delivery) |

Checklist: [references/review-checklist.md](references/review-checklist.md)

### Gate 1 — automated structural check

```bash
python3 scripts/validate_workbook.py "<path-to-xlsx>"
```

Generic mode (default) checks template headers, TC ID format/uniqueness/sequence,
Summary presence, duplicate Scenario/Test-Data/condition, bold-in-negative Test
Data, and absence of yellow fill — for any stack. It does **not** enforce
API-only scope, so a web / mobile / UI workbook passes.

For an explicitly API-only profile, add the opt-in flag:

```bash
python3 scripts/validate_workbook.py "<path-to-xlsx>" --scope-api-only
```

That also rejects non-API platforms, DB/SQL/network content, and forbidden
TC prefixes. Exit 0 = pass, 1 = failures. Deps: stdlib + openpyxl.

### Gate 2 — spec + code inventory

From the sources only (see [coverage-matrix.md](references/coverage-matrix.md)
Steps 0–1): feature/screen/endpoint list, inputs (M/O/C), responses/result
states, business rules, error catalogue. Then classify each behavior:

- **NEW** — behavior the change introduces. Reviewer confirms a **new** TC covers it.
- **REGRESSION** — existing behavior the change touches / risks breaking.
  Reviewer confirms a **regression** TC covers that path.
- **NO-TEST** — spec item genuinely unaffected by this change. Reviewer confirms
  it was **correctly skipped with a recorded reason** — an unexplained absence is
  dropped coverage (a GAP), not a legitimate skip.

Re-derive this classification yourself from the source code; do not trust the
author's labels.

### Gate 3 — coverage matrix

Map every inventory row to workbook TC IDs. Status: COVERED / GAP / WEAK / DUP /
SKIP-OK / SKIP-BAD. **Do not approve** until GAP=0, DUP=0, SKIP-BAD=0, and every
NEW and REGRESSION row is COVERED. Issue an **append advisory** for each gap with
a spec-grounded Expected Result.

### Gate 4 — spec-error audit

Audit all Positives + a sample of Negatives + every distinct response code /
result state. Re-derive a few Expected Results **without** looking at the
workbook cell first. **One wrong or invented code/value = REJECTED.**

---

## Verdicts (two tiers)

### Authoring-approved

The workbook is complete and accurate enough to proceed with internal test
execution. All true:

- [ ] `validate_workbook.py` passes (incl. bold negatives, no yellow fill)
- [ ] Coverage sign-off: **GAP=0, DUP=0** ([template](references/coverage-matrix.md#step-6--coverage-sign-off-required-for-approval))
- [ ] NEW covered by new TCs; REGRESSION covered by regression TCs; NO-TEST correctly skipped
- [ ] Spec-error audit passes
- [ ] All append advisories implemented and re-verified

> **Authoring-approved** — `{path}` · {N} TCs · GAP=0 · DUP=0 · {date}
> **Delivery:** pending execution evidence

### Delivery-approved

All authoring checks **plus** execution evidence:

- [ ] A pilot subset executed with evidence attached
- [ ] Summary execution sign-off updated; environment placeholders resolved

> **Delivery-approved** — `{path}` · execution evidence attached · {date}

### REJECTED

```markdown
## Test-case review — REJECTED
**Coverage:** {covered}/{required} · GAP: {g} · DUP: {d} · Spec errors: {e}
**New/Regression/No-test:** NEW {n_cov}/{n} · REGRESSION {r_cov}/{r} · SKIP-BAD: {s}

### Coverage GAPs (append TCs)
...
### Duplicates (remove or differentiate)
...
### Spec errors (fix in place)
...
### Dropped regression / silent NO-TEST
...
### Append advisory
...
### Author actions
1. Fix all above · 2. Run validate_workbook.py · 3. Re-request review
```

### REJECTED — spec clarification

Spec silent or contradictory → write questions for the BA/client; do **not**
invent TCs.

---

## Pre-approval sign-off

- [ ] Inventory built from **spec + code**, not the workbook
- [ ] Matrix: **GAP=0, DUP=0, WEAK=0, SKIP-BAD=0**
- [ ] NEW / REGRESSION / NO-TEST all verified
- [ ] `validate_workbook.py` passes (correct profile)
- [ ] Spec-error audit passes
- [ ] Append advisories closed (if any)
- [ ] Verdict tier stated: **authoring** vs **delivery**
- [ ] I would defend this coverage and accuracy for the stated tier today

> Optional: if the project keeps QA notes (a playbook, a defects log), record
> repeat defects there so the same mistake doesn't pass twice. Not required.
