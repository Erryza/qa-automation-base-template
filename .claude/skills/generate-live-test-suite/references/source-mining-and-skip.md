# Source-mining inventory, spec-vs-code mismatch report, and the SKIP policy

Read this when the **frontend source repo is available** and you want an
authoritative, exhaustive selector/validation/API inventory BEFORE (or alongside) live
exploration — and when you need to classify TCs whose expectation the code does not match.

## Why mine the source at all (vs live-only)
Live DOM gives real selectors but not the *why*: validation rules, i18n keys, conditional
rendering, which API each button calls, and enable/disable conditions. The source has all of
that precisely. Mining it first turns "guess-and-check against a slow live app" into
"look it up, then confirm one thing live". It also surfaces **spec-vs-code mismatches** the
Excel can't (a TC expects behaviour the code doesn't implement).

## What to mine, per feature folder
Locate the feature's folder in the FE source (commonly `apps/<app>/src/**/<feature>/` or
`src/pages/<feature>/`). For each screen (list, register/edit form, sub-popups) and its service/API
layer,
capture into one markdown inventory doc:
- **Buttons/actions**: label / i18n key, the BEST Playwright locator (priority:
  `data-testid` > RHF `name=` > `id` > role+accessible-name > visible text > placeholder),
  what it triggers, which API, and enable/visible conditions.
- **Fields**: label, type, selector, required?, validation rules (verbatim), option source
  (static enum vs an API fetcher — note the endpoint that populates each select).
- **Table columns / filters** (list): sortable?, data field, debounce, query param.
- **API contracts**: method + resolved path, key request/response fields. Mine two extra things
  while you are in there, because they are what makes data-dependent test cases automatable
  instead of blocked: the **auth endpoint** (path, the field names it expects, and where the token
  sits in the response — the three `ADAPT` points in `utils/seed.js`), and the **create/delete pair**
  for each entity a test case needs as a precondition (`Seeder.create(label, create, remove)`).
- **Conditional logic**: e.g. selecting one option reveals extra fields; immutable-on-edit
  fields; auth gates (`AuthorizeView access="..." privileges={[...]}`).
- **Exact BE/i18n copy, landed as ONE constant map.** Assertions must match production copy
  character for character, so mine the strings and put them in a single named map at the top of the
  suite rather than scattering literals through forty TCs:
  ```js
  // exact BE/i18n strings, mined from source — one place to update when the copy changes
  const MSG = {
    NOT_ELIGIBLE:    'The account is not registered or not verified yet.',
    ALREADY_INVITED: 'This account has already been invited.',
    MALFORMED:       'The file format is not valid.',
  };
  ```
  Inline literals break on any copy change and give no clue where the expectation came from.

For a large feature this parallelises well: one reader per screen + one for the service layer,
each returning its section, then stitch. Write the doc to the project's `docs/` (the same place
the Excel lives) so it feeds test authoring AND review.

## The mismatch report (a real deliverable)
While mining, every place a **TC expects X but the code does Y** is a mismatch. Collect them
into a focused report with, per item: an ID (M1, M2, …), a one-line summary, **severity**
(High = a field/feature is absent or a core behaviour differs; Medium = a validation rule
differs; Low = wording/assertion/data-shape only), an **owner** (BA/Product decides scope,
FE implements a missing rule, QA/TC corrects the test), the exact **evidence** (`file:line`),
which **TCs** it affects, and a recommended action. Confirm the high-severity ones live.
Real examples caught this way: a mandatory field the tests treat as optional; a "PDF only"
rule the code relaxes to PDF/DOC/DOCX; a field the tests reference that isn't implemented;
a label the tests abbreviate but the UI renders in full; a fixed-count assertion ("exactly 5
options") where the list is API-driven and returns a different count per environment.

## The SKIP policy — never silently drop a test case
Mismatch-blocked and environment-blocked test cases stay **in the suite and the report** with
status **`SKIP`** and a one-line reason — do NOT delete them. When the blocker clears (BA descopes,
FE fixes, an account/endpoint appears), they flip to real assertions.

**A blocked test case is a real `test()` that calls `markBlocked(...)` — not an entry in a data
list replayed in `afterAll`.** Each one keeps its own title, its own row, and its own place in the
file next to the assertions it will eventually carry:
```js
test('TC-014 the Purpose field rejects an empty value', async () => {
  // The reason is a bare sentence: markBlocked already prepends the status
  // (`test.skip(true, `SKIP: ${reason}`)`), so a 'SKIP:' prefix here would read
  // "SKIP: SKIP: ..." and carry the duplicate into the report's Notes column.
  markBlocked('TC-014', 'Submitting with an empty Purpose shows a validation error',
    'M1: the Purpose field is not implemented in the FE — raised with BA.');
});
```
`markBlocked` annotates `tc.status = SKIP` and then calls `test.skip()`, so nothing after it runs
and the test is skipped rather than pretending to assert. Quote the **mismatch id** (`M1`, `M2`, …)
in the reason so the report row points straight back at the mismatch report.

Why not the old list-in-`afterAll`: it existed because the report was built by the suite, so a
blocked test case had to be injected into that array by hand. The reporter builds the report from
real test results now — a test case that is not a `test()` does not exist at all, and one that is
gets its row for free. The list also drifted, since nothing tied its ids to the file's tests.

The three `mark*` helpers, by meaning (`utils/tc.js`):

| helper | status | means |
|---|---|---|
| `markBlocked(id, expected, reason)` | `SKIP` | automatable, blocked right now — mismatch, missing account/endpoint, unseedable data, do-not-mutate policy |
| `markNotApplicable(id, expected, reason)` | `SKIPPED` | the control or page does not exist on this variant |
| `markManual(id, expected, reason)` | `MANUAL` | no UI surface at all |

### SKIP vs MANUAL — decide by what the workbook claims, not by convenience
- Workbook says **Manual** and there is no UI surface → `markManual`.
- Workbook says **Automation** but no script exists yet (blocked, deferred, out of scope) →
  `markBlocked`. `MANUAL` would state that the test case is executed by hand *by design*, which
  hides a real automation gap. `SKIP` says "automation coverage that is genuinely missing", which
  is the truth.
- Automatable but blocked by the do-not-mutate policy → `markBlocked` with that reason (CLAUDE.md
  house rule 5), never `markManual`.

The blocked set is now self-documenting: `grep -n "markBlocked" suites/<Feature>/test.js` lists
every one with its reason, and each is a test in the report. A reconciliation pass cannot quietly
relabel them as Manual to make the numbers look better.

Typical SKIP buckets: **code mismatch** (field absent / rule not enforced — needs a code
change), **out-of-UI** (email delivery, audit trail — no UI surface), **out-of-scope**
(a different portal/phase the user has deferred), and **missing account/endpoint** (until
provided). Before leaving a test case blocked, re-check the activatable ones: missing data →
**seed it** (`apiLogin` + `Seeder`, `utils/seed.js`) rather than skipping; system-error →
route-mock; access-denied → a no-privilege account from `<prefix>_noaccess_accounts`;
download integrity → filename + size + magic bytes; create/duplicate → often unblocked once
a missing field (see `create-auth-and-gotchas.md`) is supplied.

## The REPORTER renders the status — the suite only annotates
No suite writes a report or a status any more. `reporters/excel-html-reporter.js` is registered in
`playwright.config.js`, runs in the main process (so it sees every worker's results), and resolves
each row like this:

1. a `tc.status` annotation, if the test declared one via a `mark*` helper → `SKIP` / `SKIPPED` /
   `MANUAL` / `COMBINE`;
2. otherwise Playwright's own verdict → `PASSED`, `FAILED`, or `SKIPPED` for a plain `test.skip`.

It then calls the same `generateHTMLReport` as before, so `suites/<Feature>/test_report.html` is
the same client-facing document — plus a line per run in `reports/history.jsonl`.

`utils/reporter.js` still keys colours by status, and a status outside `STATUS_COLORS` still falls
through to the FAILED colour (red). `PASSED FAILED MANUAL COMBINE SKIP SKIPPED` are all wired up;
adding a new one means editing all three of `STATUS_COLORS`, the notes-colour branch, and the
summary cards, or the report renders rows it does not count. In practice you should not need a new
status — use the `mark*` helper that already carries the meaning.

## Reconcile at the end
Keep the Excel, the inventory doc, the mismatch report, and the test.js consistent: if a test case
first classed SKIP/Manual turns out runnable during exploration (or a "BE-blocked" create turns out
to just need a field), replace the `mark*` call with the real assertions and note it to the user.
The HTML report needs no editing — it is regenerated from the results of the next full run, so
reconcile first, then run once (SKILL.md Principle 5).
