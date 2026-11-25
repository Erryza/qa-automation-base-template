---
name: generate-live-test-suite
description: Generate a standalone Playwright test.js for a feature page by (1) reading its Excel test cases, (2) classifying each TC as Automation or Manual and writing Testing Type + Manual Reason columns back into the Excel, (3) using the frontend source repo plus a LIVE browser session to capture real selectors, then (4) writing and running the test.js until green. Use when the user provides an Excel test-case file for a feature/page and asks to "buatkan automation test.js", "analisa mana yang bisa di-automate", "generate test for <page> by checking the live app", or to classify TCs and update the Excel with Manual reasons. This is the standalone-test.js + live-exploration flow. Reach for it too when the frontend source repo (e.g. web-fe) is available and you want a source-mined selector/validation/API **inventory** plus a **spec-vs-code mismatch report** before authoring; when the feature has **multiple login roles or sub-portals** (e.g. an admin portal vs a tenant portal, or a no-privilege account for menu-authorization tests); or when it has **create / edit / duplicate** TCs that mutate data on dev. Blocked or mismatched TCs are kept in the report as **SKIP with a reason**, never silently dropped. Also triggers on "cek mana yang bisa di-skip/aktifkan", "kenapa create-nya 400", "buatkan report mismatch spec vs kode".
allowed-tools: Read, Bash, Glob, Grep, Edit, Write
---

# Generate Live Test Suite

Turn an Excel test-case sheet into a working, asserted standalone Playwright `test.js`,
driven by live inspection of the real app. Each test case is a real `test()`, so the exit code is
the verdict; the per-suite `test_report.html` is written by the registered reporter, not by the
suite.

**Canonical reference implementation:** `examples/_reference-suite/test.js` — a complete,
annotated suite demonstrating every convention (one `test()` per test case, variants +
per-variant config, `utils/tc.js` report metadata, per-worker accounts, a seeded precondition,
SKIP/SKIPPED/MANUAL via the `mark*` helpers, result-asserting filters, multi-role contexts, route
mocking, download integrity, dual evidence screenshots). **Read it first and mirror its structure —
do not reinvent the conventions.** For the rule behind each part and why it exists, read
`references/test-js-anatomy.md`. That pair IS the house standard; there is no other.

## When to use
- User hands over an Excel test-case file for a feature/page and wants automation.
- User asks to decide which TCs are automatable vs manual and fill the Excel.
- User wants a `test.js` whose selectors are verified against the live dev app.

## Capabilities & limits of THIS framework (drives Automation vs Manual)
The runner asserts **presence/state** via Playwright: navigation, filling fields,
opening modals, column headers, pagination, element/text presence, **computed styles**
(so colour CAN be asserted), `isDisabled`/enabled state, value-to-value consistency.

Four things that get mis-classified as Manual are all demonstrated in the reference suite:
- **A downloaded file IS verifiable** — `download.suggestedFilename()`, then `download.path()` →
  byte length and magic bytes (an XLSX is a zip, so it must start with `PK`). Reference suite
  **TC-012**. That check is exactly what catches a server returning an HTML error page under an
  `.xlsx` filename.
- **Several roles at once IS the standard pattern** — a second account in its own
  `browser.newContext()`, closed in a `finally`. Reference suite **TC-009**. Concurrent
  maker/checker contexts are fine: the one-session limit is per ACCOUNT, not per run.
- **Preconditions ARE seedable** — `apiLogin` + `Seeder` (`utils/seed.js`) create the record the
  test case needs over the API, assert against it, and remove it afterwards. Reference suite
  **TC-006**.
- **Backend failures ARE forcible** — `page.route(...).fulfill({ status: 500 })`. Reference
  suite **TC-008**.

Parallel workers no longer collide either: `accountForWorker` (`utils/accounts.js`) gives each
worker its own account from `<prefix>_accounts`, so "one active session per user" stops capping
the run at a single worker.

It CANNOT: compare an exported file's rows **row-for-row** against the table (no XLSX/PDF parser
ships here — reference suite TC-013 is the MANUAL example); hold **two simultaneous sessions for
the SAME account** (use a second account from the pool — a second login evicts the first); or seed
an entity that has **no API** (only creatable through a multi-step UI flow) or on an environment
that forbids writes. That last one is `markBlocked` (SKIP with the reason), not MANUAL.

---

## Core principles (hard-won — apply throughout)

1. **Assert RESULTS, not presence.** A control/chip appearing does NOT prove it works —
   presence-only checks pass even when the feature is broken (this is how a real "filter
   shows a chip but doesn't actually filter the table" defect was caught). For every filter:
   seed the term from REAL data (read the first row's cell), apply it, then read that
   column's values for ALL visible rows and assert they all match the term. Reusable helper:
   `columnValues(re)` → `headers.findIndex(re)` then read each `table tbody tr` cell.
2. **Spec drift is normal — assert the LIVE UI, flag the drift, don't fail on it.** The Excel
   is often outdated: "exactly 11 columns / 3 filters", a column the document calls
   "Reference No" that the app now renders as "Transaction Number", a documented "120 days" that
   is live "720 days", and extra controls nobody wrote down. Assert the documented CORE subset is
   PRESENT (not exact counts), map Excel labels → live labels, put the drift in the row's `note()`,
   and tell the user — never fail a test because the document drifted.
3. **Fail loud (CLAUDE.md house rule 3).** When a strengthened assertion reveals a genuine app bug, keep the
   TC FAILED with a crystal-clear message (e.g. "chip applied but N/M rows don't match → not
   filtered"). Do NOT weaken it to green; surface it to the user.
4. **Don't mutate real data.** For financial / maker-checker flows, fill the form but do NOT
   submit (Save→password→Submit) — Cancel to discard, and assert the no-op (row count unchanged),
   or the test case only proves that a dialog closed. Record Approve/Reject with
   `markBlocked(...)` — automatable but policy-blocked is SKIP, never MANUAL. A record the suite
   **created itself and removes in `afterAll`** is not "real data": `utils/seed.js` is the
   sanctioned way to obtain a precondition.
5. **Run ONCE, then read the report — never double-run.** Each full run is slow and hits the live
   server, so never invoke twice (one run for the tally, another for the failures). The tally no
   longer comes from grepping console lines: the **exit code** is the pass/fail gate, and
   `suites/<Feature>/test_report.html` — written by `reporters/excel-html-reporter.js` from the run
   that just finished — holds every row with its status, notes and evidence. Same rule in
   `run-tests/SKILL.md` Step 4; keep the two consistent.
6. **One test case = one real `test()`, and assertions are allowed to throw.** Never wrap a test
   case body in a helper that catches its error so the next one can run. That shape was measured
   here: two test cases FAILED, Playwright reported "1 passed", **exit code 0** — a fully red suite
   reporting success, which no CI gate could ever have caught. `npm run lint` fails the build on a
   hand-rolled `record()`/`runTC()` for this reason.

### Playwright pitfalls checklist
- **Never `page.waitForTimeout`**: wait on a real signal — `actAndWait(page, action, {url})`,
  `countChangedFrom`, `countSettled`, `until(read, predicate, what)` in `utils/waits.js`. A fixed
  sleep is wrong in both directions (too short → fails on a slow day, too long → every run pays the
  worst case). The predecessor held 936 of them across 15,826 lines — one every 16 lines, 14.2
  minutes of pure sleeping per full run. `npm run lint` rejects them; genuine exception →
  `// lint-ok: <reason>` on the line.
- **Strict mode**: `.isVisible()`/`toBeVisible()` on a locator matching >1 element throws, and
  a trailing `.catch(()=>false)` swallows it → false negative. Use `.first()` or `.count()`.
- **Re-render detaches handles**: tables that re-render on expand/select invalidate stored
  `elementHandle`s (clicks then silently fail). Re-query the locator with `.nth(i)` each click.
- **Structural > text signals**: verify expand/collapse by `table tbody tr` count delta
  (e.g. N→2N→N for expand-all/collapse-all), not by panel text (which may read "… (N items)"
  OR "No detail data available").
- **Filters often return 0 rows** → accept chip OR "Showing X of Y" OR an empty state
  ("No Data Registered Yet"); some filters match the FULL value only (a prefix → 0 rows).
- **Money parsing** for computed fields (a total that must equal a base ± an amount):
  `parseFloat("120.000,00")` returns 120, and a comparison against `NaN` fails open — so strip `.`,
  turn `,` into `.`, then `parseFloat` → 120000.00. See `parseMoney` in the reference suite.
- **Strong, data-independent checks** worth reusing: pagination math (page-1 rows == pageSize,
  last-page rows == remainder, sum == total) and computed-field arithmetic.

---

## Extended references (read the one that fits the task)

The core loop below is for the common single-role, non-mutating case. Two situations need
more — read the reference file, don't reinvent its lessons:

- **`references/source-mining-and-skip.md`** — when the frontend **source repo is available**:
  build an exhaustive selector/validation/API **inventory** from the code before live probing;
  produce a **spec-vs-code mismatch report** (severity + owner + `file:line`); and apply the
  **SKIP-with-reason policy** (blocked/mismatch TCs keep their own `test()` and call
  `markBlocked(...)` — never dropped, never a list assembled in `afterAll`).
- **`references/create-auth-and-gotchas.md`** — when the feature has **create/edit (mutating)**
  TCs or **multiple roles/sub-portals**: the create-`400`-is-a-missing-field trap (e.g. an
  unuploaded logo blocks the whole create), asserting success by modal-close, dual-evidence
  full-page screenshots (tall viewport for scrolling modals), multi-portal login
  (`<host>/<portal>/login` vs `<host>/<portal>/<tenant>/login`), verifying `login.js` actually established the session,
  and route-mocking for system-error TCs.

**Running from an agent shell:** an `rtk`/proxy hook may hijack the bare `playwright`
command. Invoke the local CLI directly to bypass it:
`ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js" -g "TC-003"`.
Runs are **headed** by default (the user's Mac has a display and wants to watch the browser). Add
`HEADLESS=1` only in CI, on a machine with no display, or when the user asks for headless.
Filter with Playwright's own **`-g`** — the TC id lives in the `test()` title now, so `-g "TC-003"`
selects that test case in every variant (2 of the reference suite's 28) and no custom `FOCUS`
variable exists any more. Set `getSelectedEnv()` via `ENV=dev`.

---

## Workflow

### Step 0 — No source workbook?

Every step below assumes an Excel of test cases exists: Step 1 reads it, Step 2 writes the
`Testing Type` / `Manual Reason` columns back into it, Step 7 reconciles against it, and
`references/test-js-anatomy.md` §11 requires every workbook row to exist as a `test()`. A request
that names only a page ("automate the Biller Transaction List") is legitimate, but it has no source
of truth, and `npm run lint`'s `tc-id-required` rule accepts **any** `[A-Za-z]{2,6}[-_]\d{1,4}` id —
so a fabricated id scheme cannot be caught mechanically, and the next author on the same feature
will invent a different one. Do this first:

1. **Derive the test cases** from the live page (Step 4's probe) plus the frontend source repo when
   one is available (`references/source-mining-and-skip.md`).
2. **Pick a per-suite id prefix from the feature name**, not the reference suite's generic `TC-0nn`
   — e.g. `BTL-001…` for Biller Transaction List. `TC-` is the example file's placeholder; reusing
   it across two real suites makes `-g "TC-004"` select unrelated test cases in both.
3. **Write the derived list to `suites/<Feature>/<Feature>-testcases.md`** — id, precondition,
   steps, expected result. This becomes the source of truth §11's checklist reconciles against.
4. **Confirm that list with the user before writing the suite.** Deriving the scope is a judgement
   call; making it silently is how a suite ends up covering what was easy instead of what matters.

Then run Step 1 onwards against that file in place of the workbook.

### Step 1 — Read & group the Excel
Read the file with `openpyxl` (data-driven; binary). **Resolve every column by HEADER NAME, never
by a fixed index.** Real workbooks differ: the header is often a two-row band (row 1 headers, row 2
sub-headers such as `Manual`/`Automation`, data from row 3); a `Page/Feature` column frequently does
not exist; and names vary (`TC ID` vs `Test Case ID`, `Expected Results` vs `Expected Result`,
`Test Description` vs `Scenario`). Fixed indices do not raise on a different layout — they print
the wrong columns under the right labels, and nothing errors, so the whole run proceeds on garbage.

Group by whatever grouping columns exist (`Page/Feature` if present, else `Module` + `Scenario`)
and confirm with the user **which page/module** to automate now.

```bash
python3 - <<'XLSX'
import openpyxl
wb = openpyxl.load_workbook('<excel>', data_only=True); ws = wb[wb.sheetnames[0]]
hdr = {str(c.value).strip(): i for i, c in enumerate(ws[1]) if c.value}
SYN = {'id': ['TC ID', 'Test Case ID', 'TC_ID'],
       'type': ['Test Case Type', 'TC Type', 'Test Type'],
       'module': ['Module'], 'scenario': ['Scenario', 'Test Description'],
       'steps': ['Test Steps', 'Steps'], 'expected': ['Expected Results', 'Expected Result'],
       'testing_type': ['Testing Type'], 'manual_reason': ['Manual Reason']}
col = {}
for k, names in SYN.items():
    hits = [hdr[n] for n in names if n in hdr]
    if not hits:
        print('WARNING: no column found for %s (tried %s)' % (k, names))
    if len(hits) > 1:
        print('WARNING: %s matched MORE THAN ONE column %s - ask which is authoritative' % (k, hits))
    if hits: col[k] = hits[0]
# Two-row header band: row 2 holds sub-headers, not data.
start = 2 if 'id' in col and ws.cell(2, col['id'] + 1).value else 3
print('headers:', hdr); print('resolved:', col, '| data starts at row', start)
get = lambda r, k: (str(r[col[k]]) if k in col and r[col[k]] else '')
for r in ws.iter_rows(min_row=start, values_only=True):
    if 'id' in col and r[col['id']]:
        print(get(r, 'id'), '|', get(r, 'type'), '|', get(r, 'expected')[:200])
XLSX
```

### Step 2 — Classify Automation vs Manual, write columns back
For each TC decide **Automation** or **Manual** using the capabilities above. **Manual** is now
only two buckets: (a) comparing an exported file's rows **row-for-row** with the table — the
file's name, type, size and magic bytes ARE automatable (reference suite TC-012); (b) anything
with **no UI surface at all** (email delivery, audit trail, a DB-only side effect).

Everything the old classification sent to Manual for want of a mechanism is Automation now:
- **A different role / portal login is NOT Manual** — a second account in its own context is the
  standard pattern (reference suite TC-009), with the accounts coming from `<prefix>_accounts`.
- **"Needs specific data" is NOT Manual and is not a SKIP either, until you have tried seeding.**
  Create the precondition over the API with `apiLogin` + `Seeder` (reference suite TC-006), assert,
  then remove it. Only when the entity has no API, the environment forbids writes, or the record
  cannot be cleanly removed does it become `SKIP` with that exact reason.
- **A state-changing action on a real record** is `SKIP` ("would mutate real data; needs explicit
  go-ahead"), not `MANUAL`: it is automatable and policy-blocked, and calling it Manual hides a
  real coverage gap.
- **A system-error / timeout TC** is Automation via `page.route` (reference suite TC-008).

Everything else (presence, filters, modals, columns, pagination, field-accepts-input, **colour via
computed style**, enabled/disabled) is Automation. When unsure if something visual is automatable,
prefer Automation — e.g. colour-coded status is checkable by reading `getComputedStyle(el).color`.

Write the classification into two columns, **located by header name**:
- **`Testing Type`** = `Automation` | `Manual`
- **`Manual Reason`** = one concise sentence for Manual rows (why it can't be automated); empty for Automation.

The sheet is usually not blank, so:
1. **Find each column by header name first and REUSE it.** Insert only if it is genuinely absent.
2. **If a header name matches more than one column, stop and ask the user which is authoritative.**
   Writing to either creates a second source of truth; a blind insert creates a third copy.
3. **Anchor an insertion to the last populated header column**, not to `Page/Feature` — that column
   frequently does not exist.
4. **A sheet where EVERY row carries the same `Testing Type` and the same `Manual Reason` has not
   been classified.** Treat it as unclassified, re-derive per row, and report the before/after
   distribution so the change is visible.
5. Copy cell style from an adjacent column so the new columns match the sheet.

```bash
python3 - <<'PY'
import openpyxl, copy
from openpyxl.styles import Alignment
path='<excel>'; wb=openpyxl.load_workbook(path); ws=wb['Sheet1']
# insert_cols / set headers, then per-row set Testing Type + Manual Reason
# copy cell style from an adjacent column so the new columns match the sheet
wb.save(path)
PY
```
Report the final distribution (e.g. `Automation=63 Manual=16`).

### Step 3 — Gather context: existing tests + source repos + framework
- **Read `examples/_reference-suite/test.js` and `references/test-js-anatomy.md` FIRST.** They
  define the file's shape. Start from the reference suite; never compose the structure from memory.
- **Then grep sibling `test.js` files under `suites/`.** Where suites already exist, a related one
  usually encodes the login portal/account, navigation, and modal selectors for this feature —
  reusing them saves most of the live exploration. In a fresh template repo `suites/` is empty and
  this yields nothing: that is expected, not a sign that context is missing. If a suite for this
  feature exists under a different TC-ID scheme, do a **coverage audit** (map by ID AND by
  function) and report gaps before building.
- If the **frontend source repo** is available locally, grep it for the page route, field
  placeholders, test-ids, and modal structure.
- Read `utils/tc.js` (how a suite declares report metadata) and `utils/reporter.js` — the
  authoritative status list is `STATUS_COLORS`: PASSED/FAILED/MANUAL/COMBINE/SKIP/SKIPPED (`SKIP` =
  blocked with a reason, `SKIPPED` = not applicable to this variant; any other string renders with
  the FAILED colour). A suite never writes a status directly: PASSED/FAILED are Playwright's own
  verdict, and MANUAL/SKIP/SKIPPED/COMBINE come from the `mark*` helpers'
  annotations, which `reporters/excel-html-reporter.js` maps onto those colours. Also read
  `playwright.config.js` (the reporter registration, retries, workers), `utils/waits.js`,
  `utils/accounts.js`, `utils/seed.js`, `utils/profile.js`, `global-setup.js`, and
  `environments/<env>.env`.

### Step 4 — LIVE browser exploration (capture real selectors)
Write a **throwaway** Playwright probe (run via `node`, channel `chrome`) that logs in
and dumps the page so selectors are real, not invented. Key lessons baked in:

- **Login / session:**
  - Many dashboards allow **one active session per user**: a second login with the same account
    invalidates the first, and the victim then dies in `beforeAll` with a selector error that looks
    like a bug in the test. The fix is a per-worker account pool —
    `<prefix>_accounts=user1:pass1,user2:pass2` in `environments/<env>.env`, read by
    `accountForWorker(P, prefix)` (`utils/accounts.js`) on `TEST_PARALLEL_INDEX`. Provide at least
    as many accounts as `workers` in `playwright.config.js`; with fewer, it wraps and warns.
  - `global-setup.js` still saves the shared login at `.auth/state.json`, and
    `playwright.config.js` applies it as `storageState` **only when that file exists**. A suite that
    logs in per variant (the reference suite's shape) builds its own context and does not depend on
    it.
  - Any **secondary portal** is a separate account and URL: form-login it inside the suite, and
    keep its URL/account in `environments/<env>.env` under a per-suite key prefix.
  - **Portal path, tenant suffix, and account can vary per feature** — a feature may live under a
    tenant-scoped path with a role-specific account rather than the generic portal. Ask the user;
    do not assume one portal serves every page.
  - A given env file may point at different stacks — confirm the active URL before probing.
- **Determine the page's variant shape — don't assume it is uniform.** A page may exist on several
  portals/roles or on only one. Where it exists on several, the difference must be verified live:
  a portal may drop a FILTER but keep the COLUMN, or drop a COLUMN but keep the filter, and a
  control's TYPE can differ (combobox on one, plain text input on another). Capture each variant's
  columns/filters explicitly into its own `dash` config — see `VARIANTS` in the reference suite.
- **Dump** headings, `th/[role=columnheader]`, `input/textarea` (name/placeholder/role),
  buttons, links; then open autocompletes, filter chips, and the detail modal and dump
  those too. **MUI autocomplete does not auto-close on select → press `Escape` after
  picking an option.** Pagination is MUI (`MuiPagination-root`, buttons aria-label
  `Go to page N` / `Go to next page`). Use `.count()` (not `.isVisible()` on a multi-match
  locator, which throws strict-mode and gets swallowed by `.catch`).
- **Date pickers vary** — could be MUI (`.MuiPickersDay-root` / StaticDatePicker) OR
  react-date-range (`.rdrCalendarWrapper` with preset radios "Last 7/30/90 Days" + a Confirm
  button). Probe which one, then drive it accordingly; verify "applied" via the field showing
  the range OR a date chip (not a brittle day-grid click).
- For **colour** TCs, read the value element's `getComputedStyle(el).color` and assert
  the expected channel dominates (e.g. green: `g>120 && g>r+40 && g>b+40`).

Probe skeleton:
```js
const { chromium } = require('@playwright/test'); const fs=require('fs');
// read env <env>.env → url/username/password/co_url
const browser = await chromium.launch({ channel:'chrome', headless:false });
const page = await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
// login → goto feature page → page.evaluate(() => dump headings/cols/inputs/buttons)
// open modal/autocomplete → dump → screenshot to /tmp for visual confirmation
```
Ask the user for live test data when needed (e.g. which dropdown row to pick) — they can
watch the browser and answer.

### Step 5 — Write the test.js
Create it at `suites/<Feature>/test.js` (next to the Excel), mirroring the reference suite:
- Header docblock (keep the `SELECTORS: UNVERIFIED` line until Step 4 has actually run); one `SEL`
  block holding every component-library selector; a `VARIANTS` array with a per-variant config
  (`id`, `name`, `prefix`, `loginUrl`, `appBase`, variant-specific columns/filters).
- **One test case = one `test()`.** Put the TC id in the title (`test('TC-004 Reference No filter
  narrows the list', …)`) so `-g "TC-004"` finds it, and call `tc(id, expected)` as the first line
  of the body. Let assertions throw. Do **not** reintroduce a `runTC`-style wrapper, an `onError`
  callback, or a module-level results array — Principle 6, and `npm run lint` fails on it.
- Report metadata comes from `utils/tc.js`, nothing else:

  | helper | when |
  |---|---|
  | `tc(id, expected)` | first line of every test body — id + the workbook's expected result |
  | `note(text)` | an observation for the report row (`term="INV0", 12 rows all match`) |
  | `await evidence(page, name, { variant })` | screenshot into `screenshots/<variant>/` **and** link it from the report |
  | `markNotApplicable(id, expected, reason)` | the control/page does not exist on this variant → `SKIPPED` |
  | `markBlocked(id, expected, reason)` | automatable but blocked (mismatch, missing account, policy) → `SKIP` |
  | `markManual(id, expected, reason)` | no UI surface at all → `MANUAL` |
  | `markCombined(id, expected, coveredIds)` | one row standing for several workbook rows → `COMBINE` |

  `markNotApplicable` / `markBlocked` / `markManual` annotate and then call `test.skip()`, which
  aborts the test — the code after them never runs, so no `return` is needed (see reference suite
  TC-003). `markCombined` does NOT skip: the test carries on and its assertions cover every id it
  listed. A failed assertion's message is captured into the row automatically; `note()` is for
  extra context.
- **The suite writes no report.** No `record()`, no `allResults`, no `generateCombinedReport`, no
  `.<variant>_results.json`. `reporters/excel-html-reporter.js` is registered in
  `playwright.config.js`, runs in the main process, receives every worker's results and writes
  `suites/<Feature>/test_report.html` (plus a line in `reports/history.jsonl`). The sidecar merge
  only ever existed because workers cannot share memory; a reporter solves that natively.
- `beforeAll` per variant builds ONE context + page: `accountForWorker(P, variant.prefix)` for the
  credentials, `acceptDownloads: true`, `ignoreHTTPSErrors: true`, a tall viewport only when
  `HEADLESS=1`, then form-login and **assert the session established**
  (`expect(page.url(), 'login did not establish a session').not.toMatch(/\/login/)`). `afterAll`
  runs `seeder.cleanup()` first, then closes page and context — nothing else.
- **Waits**: `actAndWait(page, action, { url })` for anything that fires a request,
  `countChangedFrom` / `countSettled` for list changes, `until(read, predicate, what)` for the rest
  (`utils/waits.js`). No `waitForTimeout`.
- **Data preconditions: seed, don't skip.** A test case that needs a record in a particular state
  creates it with `apiLogin` + `Seeder` (paired `create`/`remove`, cleaned up LIFO in `afterAll`) —
  reference suite TC-006. `markBlocked` is the fallback when there is no API, writes are forbidden,
  or the record cannot be removed cleanly. Never add an env key that records which value happened
  to have rows on that environment.
- Variant-not-applicable → `markNotApplicable(...)` at the top of the body. For single-variant
  pages, drop the `VARIANTS` loop entirely and hardcode the one portal.
- **Apply the Core principles**: filters assert results (Principle 1); spec drift → assert live +
  `note()` the drift (Principle 2); no state-changing submits (Principle 4).
- `require('../../utils/...')` assumes `suites/<Feature>/test.js`. In a **nested subfolder**
  (`suites/<Group>/<Feature>/test.js`) add one `../` per extra level.

`playwright.config.js` `testMatch` already includes `suites/**/test.js` (any depth), so no
registration is required — drop the file at `suites/<Feature>/test.js` and it runs. `examples/` is
deliberately excluded so the reference suite never executes.

The test cases in one `describe` share the logged-in page, which is why `playwright.config.js`
keeps `fullyParallel: false`: parallelism is across **files**, not across the test cases of one
file. Do not flip it without giving every test its own context.

### Step 6 — Run, iterate, verify (house rules 10 & 2: loop to green, never hide skips)
Iterate ONE test case at a time with Playwright's own `-g` (fast, ~30s), then run the whole suite
ONCE (Principle 5 — don't double-run):
```bash
# iterate on one test case, across every variant (~30s)
ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js" -g "TC-004"
# full run — a single invocation is all you need
ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js"; echo "exit=$?"
# conventions (no browser, no credentials, seconds)
npm run lint
```
`-g` matches the `test()` title, which is where the TC id now lives — there is no `FOCUS`
variable any more.

**Where the tally comes from.** Not from grepping console lines. Two sources, both authoritative:
- **The exit code.** 0 = every test passed or skipped; non-zero = a real failure. This is the whole
  point of the rewrite — the previous shape reported "1 passed" and exited 0 with two test cases
  failing, so "it exited 0" used to mean nothing.
- **`suites/<Feature>/test_report.html`**, written by the reporter for the run that just finished:
  every row with PASSED / FAILED / SKIPPED / SKIP / MANUAL / COMBINE, the notes, and the evidence
  links. `reports/history.jsonl` gets one line per run (env, per-status totals, passRate, flaky
  list, duration) if you want the trend. The `list` reporter's "N passed / N failed / N skipped"
  line is fine for a glance, but it collapses MANUAL / SKIP / SKIPPED into one "skipped" count and
  shows a COMBINE row as an ordinary pass — only the report separates them.

Fix failing selectors against the live app until all non-Manual test cases PASS — **except** when a
failure is a genuine app defect: keep it FAILED with a clear message and report it (Principle 3).

Two things to check before handing over:
- **The report reflects the LAST run.** A `-g` iteration rewrites `test_report.html` with only that
  test case, so always finish with one full run.
- **Flaky is a finding, not noise.** Locally `retries: 0`, so a failure is a failure. In CI
  (`retries: 2`) a test that passes only on retry is recorded as flaky — a note on its report row,
  a line on stdout, and an entry in `reports/history.jsonl`. The cause is almost always a wait that
  is not keyed to a real signal; fix it with `utils/waits.js` rather than re-running.

### Step 7 — Reconcile Excel with reality
If a TC first classed **Manual** turns out automatable during exploration (e.g. colour via
computed style), flip its `Testing Type` to `Automation`, clear its `Manual Reason`, and
update the report — keep the Excel and the test.js in sync.

## Output summary to the user
- Excel: columns written + Automation/Manual distribution.
- test.js path, the run's **exit code**, and per-variant counts read from the report
  (PASSED/FAILED/SKIPPED/SKIP/MANUAL/COMBINE).
- Any classification corrections made (Manual→Automation, or Manual→SKIP-with-a-reason).
- Run commands (`-g "<TC-ID>"` for one test case, plain for the suite) and the report location
  (`suites/<Feature>/test_report.html`).
