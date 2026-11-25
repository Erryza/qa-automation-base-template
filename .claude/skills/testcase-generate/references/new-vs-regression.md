# New vs Regression vs No-Test classification

The headline feature of this skill: before authoring, **check the source code** and classify every candidate scenario into one of three buckets. This stops you from re-testing unchanged behavior, ensures regression risk is covered, and records why anything was skipped.

| Class | Definition | Action |
|-------|------------|--------|
| **New** | Behavior the spec introduces that doesn't exist in the code yet (or is being built by this change) | Author full new test cases. Tag **New**. |
| **Regression** | Existing behavior that the change touches or could break — the call paths into and around the changed code | Author regression test cases. Tag **Regression**. |
| **No-Test** | Existing behavior unrelated to / unaffected by the change | Do **not** author. Record on the **No-Test Log** with a one-line reason. |

---

## How to classify

### 1. Build the candidate list

From the spec inventory (Phase 1), list every scenario you *could* test: each endpoint behavior, each field validation, each screen state, each business rule.

### 2. Locate each candidate in the code

Find whether the behavior already exists, and where.

**Prefer CodeGraph when available** (`codegraph_*` tools) — it is a pre-built AST index, faster and more accurate than grep:

| Question | Tool |
|----------|------|
| Where is this symbol / handler / endpoint defined? | `codegraph_search` |
| What is the deal with this feature/area? | `codegraph_context` |
| What calls this (who could break)? | `codegraph_callers` |
| What would changing this break? | `codegraph_impact` |
| How does input X reach behavior Y? | `codegraph_trace` |

**Fallback:** if CodeGraph is not initialized, use grep/read — search for the endpoint path, controller/handler name, field name, or validation message.

### 3. Decide the class

```
Does the behavior exist in the code today?
├── No  → the spec is introducing it ......................... NEW
└── Yes → Does this change touch it, or call into/through it?
          ├── Yes (in the impact/caller set of the change) ... REGRESSION
          └── No  (unrelated, unaffected) ................... NO-TEST (log it)
```

- **New** also covers behavior that is *being built* as part of this change — the spec describes it, the code doesn't have it finished yet. Author the test cases the spec mandates.
- **Regression** = anything in the blast radius: direct callers of the changed code, code the change calls into, shared state/fields, and parallel flows that use the same modified component. When unsure whether something is in the radius, lean toward **Regression** rather than No-Test — under-testing risk is worse than an extra test.
- **No-Test** = genuinely separate behavior. You must still record it so a reviewer can see it was a deliberate decision, not an omission.

---

## Tagging in the workbook

- **Add the `Test Category` column only on a mixed run** — when the suite contains both New and Regression rows (generating against an existing codebase with a change). Place it far-right, after the tracking band: [column-reference.md](column-reference.md#test-category-column).
- **Omit it for an all-new / first-time suite** (every scenario is New). Real client templates (e.g. the QR MPM sample) don't carry this column, so leaving it off keeps the layout an exact match; just note in the handoff that all rows are New.
- Do **not** encode New/Regression in the TC-ID prefix. The prefix stays one-per-sheet with contiguous numbering (the validator enforces this); when present, the category is its own far-right column.
- Keep a **No-Test Log** support sheet so nothing is silently dropped. Suggested columns:

  | Candidate behavior | Where (file / endpoint / screen) | Why skipped (no-test) |
  |--------------------|----------------------------------|-----------------------|
  | Forgot-password flow | `auth/ForgotPasswordController` | Unchanged by this FSD; no call path into the modified token logic |

  The validator treats `No-Test Log` as a support sheet (skipped, not validated as a feature tab).

---

## Why this matters

- **Regression coverage is invisible without it.** Authoring only New behavior leaves the surrounding code untested even though the change can break it.
- **No-Test must be explicit.** "We didn't test X" should be a documented decision with a reason, not an accident a reviewer discovers later.
- **It scopes the workbook honestly.** TC count follows New + Regression scenarios, not every behavior in the system.
