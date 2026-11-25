# Coverage matrix — independent reviewer method

Goal: prove that **every** testable item the spec and the change introduce or
touch has at least one test case in the workbook under review. No partial
coverage, no "good enough." The reviewer builds the inventory **from the
source specs and code**, not from the workbook, then maps the workbook onto it.

Works for any stack (API, web/FE, mobile) and any project profile. Genericize
every literal below to the project under review.

---

## Step 0 — Detect scope (auto)

Look at the inputs and let them imply coverage expectations. Do **not** assume
"API only" or "UI only" unless a project profile/overlay says so.

| Input present | Coverage expectation it implies |
|---------------|---------------------------------|
| API / endpoint spec (paths, methods, request/response, codes) | API request/response test cases |
| FSD screens, user flows, or a Figma reference | UI test cases (fields, validation, navigation, states) |
| Source code touched by the change | Regression coverage for affected behavior |
| Both API + UI | Full-stack coverage; expect both categories |

Only flag a category as **out of scope** when a profile/overlay **explicitly
forbids** it (e.g. an "API-only" engagement that bans DB/network steps). Absent
that, missing UI cases for FSD screens — or missing API cases for an endpoint
spec — is a **GAP**, not out of scope.

---

## Step 1 — Build the spec + code inventory (from the sources)

Extract into tables **before** opening the workbook.

### 1.1 Feature / screen / endpoint list
| # | Feature (→ sheet tab) | Endpoint or screen | Method / interaction | Spec § |

### 1.2 Inputs (per endpoint or screen)
Headers, request-body fields, form fields, query params.
| # | Input (e.g. `additionalInfo.bankCode`, "Amount" field) | M/O/C | Type / max length / enum | Spec § |

### 1.3 Outputs / responses / result states
| # | Status / state | Code or message | When triggered | Spec § |

### 1.4 Business rules & flows (non-field)
| # | Rule (e.g. duplicate reference, currency, role split, navigation guard) | Spec § |

### 1.5 Error / edge catalogue
Every row in spec error tables, validation messages, and boundary notes → its
own inventory row.

### 1.6 Change classification (NEW / REGRESSION / NO-TEST)
The authoring step classifies each scenario by checking the **source code**.
The reviewer rebuilds the same classification independently and records it:

| Class | Meaning | What the workbook must show |
|-------|---------|-----------------------------|
| **NEW** | Behavior the change introduces (in spec, not previously in code) | A **new** TC covering it |
| **REGRESSION** | Existing behavior the change *touches* / risks breaking | A **regression** TC over that path |
| **NO-TEST** | Spec item genuinely unaffected by this change | Correctly skipped — **and recorded as skipped**, not silently dropped |

Tie each inventory row to a class. A NO-TEST row needs a one-line reason
("not on the changed code path"); an unexplained absence is a GAP, not NO-TEST.

---

## Step 2 — Define required TCs (minimum per inventory row)

| Inventory type | Required TCs (minimum) |
|----------------|------------------------|
| Endpoint / screen exists | ≥ 1 **Positive** happy path (all mandatory valid) |
| Mandatory input F | **Negative** invalid F + **Negative** empty F |
| Optional input F | **Negative** empty F; **Positive** with/without if behavior differs |
| Max length on F | **Negative** over max length |
| Enum field F | **Negative** value not in enum |
| Conditional field C (when parent = P) | **Positive** with C + **Negative** missing C when required |
| Each distinct response code / result state | ≥ 1 TC whose Expected Results assert it |
| Auth / signature / permission failure | **Negative** missing + invalid (+ expired if spec distinguishes) |
| Business rule row | ≥ 1 TC (Positive or Negative per rule) |
| **NEW** behavior row | ≥ 1 **new** TC exercising the new behavior |
| **REGRESSION** behavior row | ≥ 1 **regression** TC over the touched path |
| **NO-TEST** row | 0 TCs — but a recorded skip reason |

**Sanity formula:** `Expected TC count ≥ Positives + Σ(2 × mandatory inputs) +
optional/edge rows + NEW + REGRESSION rows`. Adjust upward for enums, lengths,
business rules.

---

## Step 3 — Map workbook → inventory

For each inventory row record:

| Inv # | Class | Required | Workbook TC ID(s) | Status |
|-------|-------|----------|-------------------|--------|

Status values:
- **COVERED** — exactly **one** TC exists; content verified (not just an ID)
- **GAP** — no TC, or the TC does not actually test this item
- **WEAK** — TC exists but wrong Expected Result / wrong field changed → treat as GAP
- **DUP** — two+ TCs map to one inventory row → **BLOCKER**; merge until one remains
- **SKIP-OK** — NO-TEST row correctly skipped with a recorded reason
- **SKIP-BAD** — NO-TEST claimed but the item *is* on the changed path → GAP (dropped regression coverage)

---

## Step 4 — Gap → advisory (append list)

For every GAP / WEAK, write an **append advisory** row:

| Priority | Sheet | Suggested TC ID | Inv ref | Class | TC Type | Scenario (draft) | What to test |
|----------|-------|-----------------|---------|-------|---------|------------------|--------------|
| P0 | Login | LGN-034 | 1.2-07 empty | NEW | Negative | Password empty | Submit empty password; expect validation error per spec §X |

Do **not** approve until GAP = 0, DUP = 0, and SKIP-BAD = 0.

---

## Step 5 — Critical-thinking checks (beyond the counts)

1. **Wrong surface** — TC tests path A but the spec section is path B?
2. **Copied Expected Results** — same response/state on every negative (lazy paste)?
3. **Asymmetric gaps** — two sibling sheets for one feature family with wildly different counts — why?
4. **Undocumented but in architecture** — webhooks, callbacks, idempotency, async states: spec silent → flag **Spec Clarification** (do not invent; ask BA/client).
5. **Version / variant** — versioned paths or A/B variants both covered?
6. **Nested objects** — parent and child both need rows?
7. **Happy-path variants** — currency, locale, device, env: spec lists them?
8. **Security inputs** — auth, signature, permission headers: often under-tested. Verify against the spec's **definition table / algorithm**, not a sample literal copied from an example block.
9. **NEW vs REGRESSION balance** — change introduces new behavior but workbook has only happy-path NEW cases and no regression cases over touched code?
10. **Silent NO-TEST** — scenarios absent with no recorded skip reason: dropped coverage masquerading as out-of-scope.

---

## Step 6 — Coverage sign-off (required for approval)

```markdown
## Coverage sign-off
| Metric | Value |
|--------|-------|
| Spec + code inventory rows | N |
| Required TC slots | M |
| Workbook TC rows | X |
| GAPs found | 0 |
| DUPs found | 0 |
| WEAK remediated | 0 |
| NEW rows covered by new TCs | a / a |
| REGRESSION rows covered by regression TCs | b / b |
| NO-TEST rows with recorded skip reason | c / c |
| Negatives with bold Test Data | X / X |
| Append advisories issued | K (all implemented) |
| Verdict tier | authoring-approved / delivery-approved |

Reviewer certifies: 100% of inventory rows COVERED (exactly one TC each) or
correctly skipped, no duplicates, spec-accurate Expected Results, NEW and
REGRESSION behavior both covered.
```

> **Scale is project-specific.** Inventory size is driven by the submitted
> spec + the change, never by a global "~180 / ~230 / ~300 TC" rule. Support
> sheets are excluded from the feature-tab count.

Attach the inventory + matrix to the review findings on every engagement.
