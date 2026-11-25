# Anatomy of a `test.js` suite

The house standard, written down. This file exists because the conventions below used to be
learned by opening a neighbouring `test.js` — and in a template repo there is no neighbour.

Read it alongside `examples/_reference-suite/test.js`. **That file is the shape; this file is the
reason.** Where they disagree, the reference suite wins — it is executable and therefore cannot
rot silently.

## The rule everything else hangs off

**One test case = one real `test()`. Assertions are allowed to throw.**

The predecessor put every test case of a page inside a single `test()` and wrapped each one in
`runTC(id, body, onError)`, which caught the assertion error so the next test case could still run.
Measured on a real suite: **two test cases FAILED, Playwright reported "1 passed", exit code 0.**
Playwright never saw a failure, so a fully red suite reported success and no CI gate built on it
could ever have worked — the project's own "Fail loud" house rule, inverted by its own framework.

Removing that is what §4, §6, §8 and §12 are about. Everything downstream — per-test retries,
traces, `-g`, junit in a merge request, a pipeline that can block a merge — only works because
pass/fail is now Playwright's own verdict.

---

## 1. The file contract

```
suites/<Feature>/test.js                 ← the suite
suites/<Feature>/<TestCases>.xlsx        ← the source test cases, next to it
suites/<Feature>/screenshots/<variant>/  ← evidence, written by evidence()   (git-ignored)
suites/<Feature>/test_report.html        ← written by reporters/excel-html-reporter.js (COMMITTED)
```

- `playwright.config.js` matches `suites/**/test.js` **at any depth**. Nothing to register.
- `require('../../utils/...')` is correct for `suites/<Feature>/test.js`. Add one `../` per extra
  nesting level (`suites/<Group>/<Feature>/test.js` needs `../../../`).
- `npm run lint` scans `suites/` only.
- `examples/` is deliberately outside `testMatch` — the reference suite must never execute.

**The suite writes no report and no results file.** `reporters/excel-html-reporter.js` groups
results by `path.dirname(<the test file>)`, so each suite's report lands in its own folder without
the suite naming a path. The old `suites/<Feature>/.<variant>_results.json` sidecar is **gone** —
see §4 for why it existed at all.

**Why a folder per feature:** the suite, its Excel, its evidence, and its report travel together.
A reviewer opens one folder and has everything.

---

## 2. Header docblock

Every suite opens with one. It is the only place a reader learns what the file covers before
reading 800 lines of assertions.

```js
/**
 * Test Suite  : <Feature>
 * Module      : Web Dashboard — page "<Feature>"
 * Source TC   : <TestCases>.xlsx (Module = "<Module>", Scenario = "<Scenario>")
 *
 * SELECTORS   : UNVERIFIED — the SEL block is a guess until SKILL.md Step 4 has run.
 *               (Delete this line once the selectors were confirmed live.)
 *
 * VARIANTS — the same test cases run against every portal this page exists on:
 *   - Admin Portal  : has the "<X>" filter
 *   - Tenant Portal : same columns, "<X>" filter absent
 *
 * ONE TEST CASE = ONE `test()`. Assertions throw; pass/fail is Playwright's verdict.
 *
 * Report statuses — utils/tc.js annotations, rendered by reporters/excel-html-reporter.js:
 *   PASSED / FAILED   Playwright's own verdict
 *   SKIPPED           markNotApplicable — not applicable to this variant
 *   SKIP              markBlocked       — blocked, with a reason (never delete a test case)
 *   MANUAL            markManual        — no UI surface at all
 *   COMBINE           markCombined      — one row covering several workbook rows
 *
 * Run one test case:  npx playwright test "suites/<Feature>/test.js" -g "TC-004"
 */
```

Required: suite name, module, **the source Excel and which sheet/grouping it came from**, the
variant list with how they differ, and the status legend. The source-Excel line is what lets
anyone reconcile the report against the test-case document months later.

**Fill the placeholders from the real workbook — never ship the template text.** Not every
workbook has a `Page/Feature` column; many group by `Module` + `Scenario` instead. Use whatever
columns the file actually has, and confirm the page with the user before writing (SKILL.md Step 1).
A docblock naming a workbook or page that does not exist is a fabricated source reference.

**Selectors written before the live probe.** SKILL.md Step 4 needs `environments/<env>.env` and a
reachable app; a fresh clone has neither, so the honest first deliverable is an *unprobed*
skeleton. That is a supported shape with one requirement: collect every component-library selector
into a single `SEL = { ... }` object marked `// UNVERIFIED until SKILL.md Step 4 has run`, carry
the `SELECTORS: UNVERIFIED` line in the docblock, and reference `SEL.x` from the test bodies
instead of inlining class substrings. Correcting one block after the probe beats hunting ~15 call
sites.

---

## 3. Module-level config

Everything environment-dependent is resolved once, at the top, before any `describe`.

```js
const { test, expect } = require('@playwright/test');
const { readProfile, getEnvProfilePath, getSelectedEnv } = require('../../utils/profile');
const { accountForWorker } = require('../../utils/accounts');
const { actAndWait, countChangedFrom, until } = require('../../utils/waits');
const { tc, note, evidence, markManual, markBlocked, markNotApplicable } = require('../../utils/tc');
const { apiLogin, Seeder } = require('../../utils/seed');

const profile = readProfile(getEnvProfilePath(getSelectedEnv() || 'dev'));

const ADMIN_BASE  = (profile.url || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const TENANT_BASE = (profile.xx_tenant_url || '').replace(/\/$/, '');   // xx_ = your suite prefix

const PAGE_PATH   = '/<feature-path>/';
const LIST_API    = /\/api\/v1\/<feature>/;      // the request this page's list fires
const ALL_COLUMNS = ['<Col A>', '<Col B>', 'Amount', 'Status', 'Created Date'];

// Every component-library selector, in ONE place. UNVERIFIED until Step 4 has run.
const SEL = {
  option: 'li[role="option"]', chip: '[class*="MuiChip"]',
  pagination: '[class*="MuiPagination-root"]', nextPage: 'button[aria-label="Go to next page"]',
  dialog: '[role="dialog"]',
};
```

- **`getSelectedEnv()`, not `process.env.ENV` directly.** Workers are separate processes and never
  see `global-setup`'s interactive prompt; `getSelectedEnv()` falls back to `.selected-env.json`,
  which the prompt wrote. **Keep the `|| 'dev'`:** `getSelectedEnv()` returns `null` when `ENV` is
  unset and `.selected-env.json` is absent, and `getEnvProfilePath(null)` then throws at *file
  load* time — which fails collection for the entire run, not just this suite.
- **`readProfile(...)` bare — no `try/catch`, no `ENABLED` flag.** The reference suite wraps it and
  guards every describe with `test.skip(!ENABLED, ...)` purely so that file can never run. When you
  copy it, **delete `ENABLED`, the `try/catch`, and the `test.skip(!ENABLED, ...)` lines.** A suite
  that self-skips exits 0 while asserting nothing, and its report reads all-SKIPPED — which looks
  like "nothing applicable here", not "this suite is disabled". A missing profile should stop the
  run.
- **Normalise base URLs by stripping `/login/`.** The env profile stores the login URL; suites
  need the app base. Doing it once avoids a dozen inconsistent `replace` calls.
- **Name the expected columns/filters as constants.** They are asserted in one test case and
  referenced in others; a literal repeated inline drifts.
- **`LIST_API` is load-bearing, not decoration.** Nearly every wait in the suite keys off it
  (`actAndWait(page, action, { url: LIST_API })`, `page.route(LIST_API, …)`). One regex, defined
  once, is what makes the deterministic waits of §5 possible.

### Selecting test cases — there is no `FOCUS`

`FOCUS` / `FOCUS_TCS` / `isFocused` are **deleted**. Test-case ids live in `test()` titles, so
Playwright's own `-g` does the job and needs no code in the suite:

```bash
npx playwright test "suites/<Feature>/test.js" -g "TC-004"     # one test case, every variant
npx playwright test -g "TC-004|TC-007"                          # several
npx playwright test -g "Tenant Portal"                          # one variant
```

Verified against a suite shaped like the reference one (14 test cases × 2 variants = **28 tests**):
`-g "TC-004"` selects **2**, `-g "TC-004|TC-007"` selects 4, `-g "Tenant Portal"` selects 14 —
`-g` is a regular expression matched against the **full** title, describe titles included.

One caveat, and it is the same class of bug the old `FOCUS` regex had: `-g` matches a *substring*.
`-g "TC-01"` also selects TC-010…TC-014 (10 tests, verified). When ids collide by prefix, anchor
it: `-g "TC-001\b"`. Underscore ids (`VEP_030`, `NAV_001`) need nothing special — they are matched
literally, which is precisely the trap the deleted `/\b[A-Z]{2,4}-\d+\b/` FOCUS regex fell into.

### Variants — encode the difference as data

A page rarely looks identical on every portal or role. Encode the difference as data, once — on
the variant object itself:

```js
const VARIANTS = [
  { id: 'admin',  name: 'Admin Portal',  prefix: 'example',
    loginUrl: `${ADMIN_BASE}/login/`, appBase: ADMIN_BASE,
    hasOwnerFilter: true,  expectedColumns: ALL_COLUMNS },
  { id: 'tenant', name: 'Tenant Portal', prefix: 'example_tenant',
    loginUrl: `${TENANT_BASE}/${profile.xx_tenant_prefix}/login/`,
    appBase: `${TENANT_BASE}/${profile.xx_tenant_prefix}`,
    hasOwnerFilter: false, expectedColumns: ALL_COLUMNS },
];

for (const variant of VARIANTS) {
  test.describe(`<Feature> — ${variant.name}`, () => { /* … */ });
}
```

**Why data, not `if`:** a test case asks
`if (!variant.hasOwnerFilter) markNotApplicable(id, expected, 'The Owner filter does not exist on the Tenant Portal.');`
Sprinkling `if (variant.id === 'tenant')` through forty test cases makes adding a third portal a
rewrite.

**The describe title is client-facing.** The reporter builds each report section's name from the
describe chain, so `<Feature> — <Variant name>` is what appears as the suite heading in
`test_report.html`. Keep it a sentence a client can read.

`prefix` is the variant's env-key prefix — it is what `accountForWorker(profile, variant.prefix)`
resolves the login against (below).

**A page on only one portal?** Delete the variant machinery entirely and hardcode the portal.
Carrying unused abstraction is worse than not having it.

`filterVariantsByCountry` (utils/profile.js) is an **optional** utility for projects whose variant
axis is a country. It matches on a variant's `country` field (or an `_id`/`_ph` id suffix). If your
variants differ only by portal, leave the field off and do not set `COUNTRY` — a `COUNTRY` value
that matches no variant yields zero tests and no regenerated report (a warning is printed).

### Per-worker accounts

```js
const account = accountForWorker(profile, variant.prefix);   // inside beforeAll
```

```
# environments/<env>.env
example_accounts=qa.auto1@example.com:Passw0rd1,qa.auto2@example.com:Passw0rd2
```

**Why this exists.** Many dashboards allow ONE ACTIVE SESSION PER USER: signing in again
invalidates the previous session. With a single shared account, parallelism is impossible —
worker 2's login silently kills worker 1's session, and worker 1 then fails somewhere unrelated
with a selector error that looks like a bug in the test. In the predecessor this was documented as
"the most common cause of a suite dying in `beforeAll`".

`accountForWorker` keys off `TEST_PARALLEL_INDEX`, which Playwright sets per worker process
(0…workers-1), so each worker gets its own login. Details that matter:

- The **first colon** splits user from password, so passwords may contain colons.
- A malformed entry **throws** with the offending entry quoted — it does not silently skip.
- Fewer accounts than workers is allowed (the pool wraps) and warns **once** per prefix, because a
  two-account pool with four workers is still useful when the suites do not overlap in time.
  Size the pool to `workers` in `playwright.config.js` (4 locally, 2 in CI) when you can.
- Fallback order: `<prefix>_accounts` → `<prefix>_username`/`<prefix>_password` → the profile's
  top-level `username`/`password`. A suite can therefore adopt pooling later without touching its
  call site. With none of them set it throws, naming the keys to add.
- `storageStatePathFor(prefix)` gives a per-worker auth file (`.auth/<prefix>-worker-<n>.json`) so
  pooled accounts never share one.

### What `playwright.config.js` already decides — do not fight it

| Setting | Value | What it means for a suite |
|---|---|---|
| `fullyParallel` | `false` | Test cases in one describe share a logged-in page. Parallelism is across **files**. **Never add `test.describe.configure({ mode: 'parallel' })`** to a describe that shares a page — the test cases would run concurrently against one `page`. |
| `retries` | `2` in CI, `0` locally | Locally you want the failure in your face; in CI you want the run to finish and the flake recorded. The reporter labels a test that passed only on retry as flaky. |
| `workers` | `2` in CI, `4` locally | The number the account pool should match. |
| `forbidOnly` | `true` in CI | A stray `test.only` fails the pipeline instead of quietly running one test. `npm run lint` catches it earlier. |
| `trace` | `on-first-retry` | A passing run costs nothing; a failure always has one. `npx playwright show-trace test-results/<…>/trace.zip`. |
| `video` | `retain-on-failure` | |
| `screenshot` | `only-on-failure` | Suites take their own **labelled** evidence via `evidence()`; `'on'` stored a second, unlabelled copy of every test. |
| `storageState` | `.auth/state.json`, **only when the file exists** | Naming a missing file makes every test fail to start with an opaque ENOENT in a fresh clone. See §8 — this is inherited by contexts you build yourself. |
| `timeout` / `actionTimeout` / `navigationTimeout` | 300s / 15s / 30s | A test case that needs longer is usually waiting on a clock instead of a signal (§5). |

The reporter list is `list` (console), this project's `excel-html-reporter`, Playwright's own HTML
report in `reports/playwright-html/`, `reports/results.json`, and `reports/junit.xml` — which
GitLab renders as the merge-request test summary.

---

## 4. Report metadata: `utils/tc.js` and the reporter

This is where the old "four core helpers" (`record` / `snap` / `runTC` / `generateCombinedReport`)
used to be. All four are gone. A suite now *annotates*; a reporter *renders*.

### The API

| Call | Effect |
|---|---|
| `tc(id, expected)` | Declares which workbook test case this `test()` covers, and its expected result. **First line of every test body.** |
| `note(text)` | Appends an observation to the report row. Callable many times; the reporter joins them with ` \| `. |
| `await evidence(page, name, { variant })` | Screenshot into `suites/<Feature>/screenshots/<variant>/<name>.png`, link it from the report, and attach it to the Playwright report too. Returns the report-relative path. `fullPage` unless you pass `fullPage: false`. |
| `markManual(id, expected, reason)` | Status `MANUAL`, then skips the test. |
| `markBlocked(id, expected, reason)` | Status `SKIP`, then skips the test. |
| `markNotApplicable(id, expected, reason)` | Status `SKIPPED`, then skips the test. |
| `markCombined(id, expected, coveredIds)` | Status `COMBINE` and a `Covers: …` note. **Does not skip** — see the caveat below. |

Every one of them is a Playwright annotation (`tc.id`, `tc.expected`, `tc.notes`, `tc.evidence`,
`tc.status`) pushed onto `test.info().annotations`. That is the whole contract. A suite never
imports the reporter, never holds an array of results, never writes a file.

### What the reporter does with them

`reporters/excel-html-reporter.js` is registered in `playwright.config.js`, runs in the **main
process**, receives every worker's results, and calls the same `generateHTMLReport` from
`utils/reporter.js` — so `suites/<Feature>/test_report.html` is byte-for-byte the same kind of
document as before. Per test it builds one row:

| Column | Source | Fallback |
|---|---|---|
| `tcId` | the `tc.id` annotation | the first `/\b[A-Za-z]{2,6}[-_]\d{1,4}\b/` match in the test title, else the whole title |
| `status` | a declared `tc.status`, if any | Playwright's verdict: passed → `PASSED`, skipped → `SKIPPED`, anything else → `FAILED` |
| `expected` | the `tc.expected` annotation | the test title |
| `notes` | every `tc.notes` annotation, plus the cleaned assertion error, plus a `flaky: passed on retry N` line | — |
| `screenshot` | every `tc.evidence` annotation — one string, or an array rendered as several "View" links | `-` |
| suite heading | the describe chain | the suite folder name |
| output folder | `path.dirname(<the test file>)` | — |

Three behaviours worth knowing:

- **Annotations are deduped on type + description.** Playwright surfaces runtime annotations on
  both `TestCase` and `TestResult`; a naive concat linked the same screenshot twice in the report.
  Two different notes both survive; an identical pair collapses.
- **A retry replaces its earlier attempt** (rows are keyed on `test.id`), so the report shows the
  final verdict and the `flaky:` note is what preserves the fact that it took a retry. The console
  also prints a flaky list at the end of the run.
- **One line per run is appended to `reports/history.jsonl`**: timestamp, `env`, `ci`, commit,
  overall status, duration, totals per status, `passRate`, and the flaky list. A single report
  answers "is it green today"; the history answers "is it getting better" and "which test case is
  quietly flaky". Note that CI artifacts do not survive into the next pipeline, so in CI that file
  only ever holds the current run — push it somewhere durable if you want a real trend.

### Why the sidecar merge existed, and why it is gone

**Keep this paragraph. It is the reasoning that justifies the current design, and someone will
otherwise reinvent the old one.**

The suites used to build the report themselves: a module-level `allResults` array, a `record()`
call per test case, and `generateCombinedReport()` in `afterAll`. Each variant runs in its own
worker, and **workers are separate OS processes that share no memory** — so no single process held
every result. The workaround was a sidecar: each worker wrote
`suites/<Feature>/.<variant>_results.json`, then re-read all of its siblings and regenerated the
whole document, so whichever variant finished last produced the complete report. On top of that,
Playwright discards a worker after a test failure and starts a fresh one, which re-`require`s the
suite file with an **empty** `allResults` — so the write had to *merge* with what was on disk
rather than overwrite it, except on worker 0 where anything on disk is stale output from a previous
run. The classic symptom when that merge was missing: a report claiming "29 passed, 0 failed" for
a run that had actually produced 64 passed and 7 failed.

Every line of that machinery was working around one fact: workers cannot share memory. **A
Playwright reporter runs in the main process and is handed every result from every worker.** So the
sidecar file, the sibling re-read, the last-worker-wins race, and the worker-restart merge all
disappear at once — and the main process outlives any worker restart, which is what made the merge
necessary in the first place. `.gitignore` still carries `.*_results.json`; nothing writes them.

The bigger win is the exit code. Building the report inside one mega-`test()` *required* a helper
that caught assertion errors so the next test case could run, which is what made a red suite exit
0. Annotations do not need that, because they are not the pass/fail channel.

### Three caveats

1. **`test.skip(true, reason)` aborts the test body immediately.** Verified: code placed after it
   does not run. So `markManual` / `markBlocked` / `markNotApplicable` need no `return` after them,
   and the reference suite's shape is correct:
   ```js
   if (!variant.hasOwnerFilter) {
     markNotApplicable('TC-003', 'Selecting an Owner filters the list',
       'The Owner filter does not exist on the Tenant Portal.');
   }
   // execution never reaches here on the tenant variant
   ```
2. **`markCombined` does not skip.** The assertions after it still run and still decide the exit
   code. A declared status wins in `test_report.html`, so a failing COMBINE test renders purple for
   the client while Playwright, junit and the exit code call it a failure. Declare COMBINE only
   where the assertions that follow genuinely cover every listed id.
3. **Do not parse a tally out of `console.log`.** The old `record()` printed `[PASSED] TC-001` lines
   for exactly that. Now the `list` reporter prints the run, the reporter prints the report paths,
   and `reports/results.json` + `reports/history.jsonl` hold the machine-readable totals. House
   rule "run once, parse everything from that output" is unchanged; only the parse target moved.

---

## 5. Helpers

### 5.1 Wait on a signal, never on a clock

```js
const { actAndWait, countSettled, countChangedFrom, until } = require('../../utils/waits');
```

| Helper | Use it when |
|---|---|
| `actAndWait(page, action, { url, status = 200, timeout = 20000 })` | The action triggers a request. Arms the listener **before** the action (`Promise.all`) — otherwise a fast response lands before the wait starts and the test hangs to timeout. Returns the `Response`. |
| `countSettled(locator, { timeout, stableForMs = 400 })` | A list renders progressively and exposes no single "done" signal. |
| `countChangedFrom(locator, before, { timeout })` | Prove an action had an effect — expanding rows, a filter that removes rows, paging. Fails with "the row count never moved away from N — the action had no effect". |
| `until(read, predicate, what, { timeout })` | Anything else. `what` becomes the timeout message: `timed out waiting for <what>`. |

```js
await actAndWait(page, () => input.press('Enter'), { url: LIST_API });
await until(() => columnValues(/Status/), v => v.every(s => /Active/.test(s)),
            'every Status cell to read Active');
```

**`page.waitForTimeout` is banned and `npm run lint` rejects it** (`scripts/check-conventions.js`,
rule `no-fixed-sleep`). The measurement behind the ban, taken from this framework's predecessor:
**936 fixed sleeps across 15,826 lines — one every 16 lines, averaging 910ms, 14.2 minutes of pure
sleeping per full run.** A fixed sleep is wrong in both directions: too short and the test fails on
a slow day, too long and every run pays for the worst case. It is simultaneously the biggest source
of flakiness and of wasted wall-clock, and it is why "the suite is slow" and "the suite is flaky"
were the same problem.

The genuine exception is an animation with no observable completion signal. Take it per line, with
a reason:

```js
await page.waitForTimeout(300); // lint-ok: CSS transition has no completion event
```

### 5.2 Seed the precondition instead of hoping for data

```js
const { apiLogin, Seeder } = require('../../utils/seed');
```

A test that depends on "whatever happens to be in the environment" is not a test, it is an
observation. The predecessor's symptom was unmistakable: env keys like `<x>_status_with_rows` and
`<x>_txn_type_with_rows` — **configuration whose only job was to record which value happened to
have rows on that environment that week**, plus a long tail of SKIPs for "no row with this status
exists here". Every such key is a test that will silently stop covering anything when the data
changes.

```js
seeder = seeder || new Seeder(await apiLogin({
  baseURL: P.xx_api_url, username: P.xx_api_user, password: P.xx_api_password,
}));
const marker = Seeder.mark();                      // "AUTOTEST 20260826011142"
await seeder.create('example-record',
  api => api.post('/api/v1/example', { data: { name: marker, status: 'PENDING' } }).then(r => r.json()),
  (api, rec) => api.delete(`/api/v1/example/${rec.id}`));
```

- `apiLogin` returns an `APIRequestContext` carrying the token. It is far faster and more reliable
  than driving the login form, and **it does not consume a UI session** — so seeding never evicts
  the browser session the test is about to use (§3, per-worker accounts).
- Its login shape differs per backend: `loginPath`, `userField`, `passField`, `tokenPath`,
  `scheme` are all marked `ADAPT` in `utils/seed.js`. Confirm them against the real API once. Both
  failure modes are explicit — a non-2xx quotes the response body, and a 2xx with no token at
  `tokenPath` lists the response's keys and tells you which option to change.
- **`create` takes a paired `remove`.** Cleanup is LIFO (children before parents) and best-effort:
  one failing delete must not hide the others or fail the suite. What it cannot remove it reports
  loudly — silent leftovers are how a dev environment fills with AUTOTEST records nobody dares
  delete.
- `Seeder.mark()` names every record `AUTOTEST <yyyymmddhhmmss>`, so a leak is identifiable and a
  filter test has a term guaranteed to match exactly one row.
- Call `seeder.cleanup()` in `afterAll` **before** closing the browser (§8); it also disposes the
  API context.

**When not to seed:** there is no API for the entity (some records only exist through a multi-step
UI flow), or the environment forbids writes, or the record is financial and cannot be removed
cleanly. Those are `markBlocked` with a reason — that is what `SKIP` is for.

### 5.3 Reading the table

```js
const columnHeaders = () => page.evaluate(() =>
  [...document.querySelectorAll('th,[role="columnheader"]')].map(e => (e.innerText || '').trim()).filter(Boolean));

async function columnValues(re) {
  const headers = await columnHeaders();
  const idx = headers.findIndex(h => re.test(h));
  if (idx < 0) return [];
  return page.evaluate((i) => {
    const tb = document.querySelector('table tbody');
    return tb ? [...tb.querySelectorAll('tr')].map(r => {
      const c = r.querySelectorAll('td,[role="cell"]')[i];
      return c ? (c.innerText || '').trim() : '';
    }) : [];
  }, idx);
}
```

`columnValues` is the most-reused helper in the codebase — it is what turns "a chip appeared" into
"the table is actually filtered". **Find the column by header regex, never by a fixed index.**
Column order changes between portals and releases; an index does not survive it.

```js
const parseMoney = s =>                            // "120.000,00" → 120000.00
  parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
```

`parseFloat("120.000,00")` returns `120` — and a comparison against `NaN` fails open, so a broken
computed-field assertion looks like a passing one.

```js
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```

Define this the moment you build a `RegExp` from data. Row names, biller names and option labels
come from the app and routinely contain regex metacharacters; `new RegExp(name)` on unescaped data
silently matches the wrong row.

### 5.4 Proving a sort

Sorting and filtering are usually **server-side** (a `sort`/filter query param → refetch), so the
deterministic signal is the outgoing list request, not a timer.

```js
// Click the sort LABEL, not the <th>: clicking the header cell often activates the
// first sort but then fails to toggle it. actAndWait awaits the refetch for you.
async function clickSort(header) {
  const th = page.locator('th').filter({ hasText: header }).first();
  const label = th.locator('[class*="TableSortLabel"]').first();
  await actAndWait(page, async () => ((await label.count()) ? label.click() : th.click()),
                   { url: LIST_API });
}

// Assert the request itself when you want to prove the param, not just the order.
async function expectListParam(param, expected, action) {
  const res = await actAndWait(page, action, { url: LIST_API });
  const url = new URL(res.request().url());
  expect(url.searchParams.get(param), `list request sent ${param}=${url.searchParams.get(param)}`)
    .toBe(expected);
}

function isSortedBy(values, cmp, dir) {          // ties are allowed
  const sign = dir === 'desc' ? -1 : 1;
  return values.every((v, i) => i === 0 || sign * cmp(values[i - 1], v) <= 0);
}
```

Keep `LIST_API` narrow enough to exclude an export/download request, or the export satisfies the
wait and you read the table before the sort landed.

Comparator traps, each of which turns a correct ordering into a false FAILED:

| Trap | Rule |
|---|---|
| `localeCompare` on text | Backends usually sort **case-sensitively by codepoint**. `w f a P D` is monotonic by codepoint but not case-insensitively, so `localeCompare` calls a correct order unsorted. Compare with `<`/`>` on the raw strings. |
| Blank / `-` cells | APIs commonly sort **nulls last**: blanks are last for ASC and first for DESC. A plain comparator treats `''` as smallest. Strip the sentinels before the monotonic check, or use a nulls-last comparator. |
| Money / dates | Compare parsed values (`parseMoney`, `Date.parse`), never the rendered string. |
| Mixed display formats in one column (raw digits vs formatted) | A monotonic check on rendered text is unreliable. Prove instead that the order **changed** between ASC and DESC, plus the direction indicator flipped. |
| Reading the direction | The direction class often sits on the icon **child**, not on the sort-label root. Read the `<th>`'s `aria-sort` as well as the icon class. |

**Always await the list refetch before reading rows** — otherwise you read the pre-sort table and
the failure looks like a flaky selector rather than a missing synchronisation.

### 5.5 Locator priority

1. `getByRole('button'|'heading'|'option'|'columnheader', { name })`
2. `getByPlaceholder('<the exact live placeholder>')`
3. `getByTestId('<app test id>')`
4. `getByText('<label>', { exact: false })`
5. Component-library internals by **class substring** — `[class*="MuiChip"]`,
   `[class*="MuiPagination-root"]`, `li[role="option"]`, `[role="dialog"]`, `table tbody tr`.
   Never a full hashed class name.
6. Raw CSS last (disabled-state assertions sometimes have no role handle).

Three rules that travel with it:

- **`.first()` on anything that can match more than once.** Strict mode makes `.isVisible()` on a
  multi-match locator *throw*, and a trailing `.catch(() => false)` turns that throw into a silent
  false negative. Use `.count()` when you want a number.
- **Anchor exact matches** — `/^view$/i`, not `/view/i`, which also matches "View & Manage".
- **Pin the role instead of leaning on `.first()`** when a label appears in both the nav and the
  page body. `getByText(title).first()` resolves to the *nav link*, which precedes the heading in
  the DOM and is visible on every page — so the assertion passes on pages the test never meant to
  accept. Use `getByRole('heading', { name })`.

The class substrings above are one component library's vocabulary, not a universal truth. Confirm
them against a live DOM probe before relying on them — and keep them in the single `SEL` block
(§3) so the correction is one edit.

**Stacked dialogs:** when a flow can open a confirm on top of a form, address the top layer with
`getByRole('dialog').last()`. `.first()` silently targets the layer underneath, which is genuinely
visible, so the failure reads like a bad selector instead of a layering problem.

### 5.6 A second account needs its own context

A multi-role test case cannot use the describe's shared page. Build a throwaway context inside the
test, and close it in a `finally` so a failure cannot leak it:

```js
const other = accountForWorker(P, 'xx_noaccess');
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: undefined });
try {
  const p2 = await ctx.newPage();
  // …sign in as `other`, assert what this role can and cannot see…
} finally {
  await ctx.close().catch(() => {});
}
```

- `storageState: undefined` is not noise — see §8. Without it the context inherits the shared
  session from `playwright.config.js` and starts logged in as somebody else.
- **Verify the session actually established.** A login helper that swallows a failed sign-in
  returns "OK" while still sitting on `/login`, and every subsequent assertion then fails with a
  confusing selector error:
  `expect(page.url(), 'login did not establish a session').not.toMatch(/\/login/);`
- If a sign-in is rejected because the app holds one session per account for ~60s, the answer is a
  bigger account pool (§3), not a longer retry loop. The same signature appears after dozens of
  logins as genuine rate-limiting, and is likewise cured by not competing for one account.

---

## 6. Anatomy of one test case

```js
test('TC-004 Reference No filter narrows the list to matching rows', async () => {
  tc('TC-004', 'Only rows whose Reference No contains the term remain');
  await gotoList();

  // Seed the term from REAL data — a hardcoded term returns zero rows on another
  // environment and the test then passes having verified nothing.
  const before = await columnValues(/Reference No/);
  const seed = before.find(v => v.trim().length >= 4) || '';
  expect(seed, 'no rows to seed the filter from — the filter was never exercised').not.toBe('');
  const term = seed.trim().slice(0, 4);

  const input = page.getByPlaceholder('type reference no');
  await input.fill(term);
  await actAndWait(page, () => input.press('Enter'), { url: LIST_API });

  const after = await columnValues(/Reference No/);
  const nonMatching = after.filter(v => !v.toLowerCase().includes(term.toLowerCase()));
  expect(nonMatching.length,
    `chip applied but ${nonMatching.length}/${after.length} rows do NOT contain "${term}" → the table was NOT filtered`
  ).toBe(0);

  note(`term="${term}", ${after.length} rows all match`);
  await evidence(page, 'TC-004', { variant: variant.id });
});
```

Invariants:

- **The test-case id is the first token of the title.** It is how `-g` selects the test, how the
  reporter recovers the id if `tc()` were ever missing, and what `npm run lint`'s `tc-id-required`
  rule checks. A title with no id and no `tc()` call fails lint.
- **`tc(id, expected)` is the first line of the body** — the only thing allowed before it is a
  `mark*` guard, which calls `tc()` itself. The `expected` string is the **workbook's**
  expectation, phrased for a reader of the report — not a locator dump. `humanizeExpected()` in
  `utils/reporter.js` also understands prefixed forms (`ROLE:button:Save`, `MODAL:Add:Title:Cancel`,
  `URL:/path`, `TESTID:x`, `ELEMENT:x`) if you prefer structure.
- **Put the explanation in the assertion message.** On a failure the reporter captures the
  assertion error into the report's Notes column, so a message naming what was expected and what
  was observed is what a client reads. `expect(x).toBe(0)` with no message produces an unreadable
  row.
- **`note()` carries what makes a pass believable** (`term="INV0", 12 rows all match`). It is not
  needed for failures — the error is captured automatically.
- **`evidence()` at the end**, and twice for a mutation (the filled form and the result): "it was
  saved" is not provable from one image. Failure screenshots come free from the config's
  `screenshot: 'only-on-failure'`.
- **No `try`/`catch` around assertions. Ever.** That is the defect this architecture removed. If
  something genuinely must be cleaned up, use `try { … } finally { … }` — a `finally` does not
  swallow the error.
- A comment above each test with its id and one-line intent, so the file can be scanned.

### The six outcomes

| Outcome | How | When |
|---|---|---|
| `PASSED` | assertions pass; nothing to declare | normal |
| `FAILED` | an assertion throws | normal — **including genuine app defects, which stay FAILED** |
| `SKIPPED` | `markNotApplicable(id, expected, reason)` | the control or page does not exist on this variant |
| `SKIP` | `markBlocked(id, expected, reason)` | automatable in principle, blocked now: spec-vs-code mismatch, missing account or endpoint, unseedable data, or a mutation the policy will not perform |
| `MANUAL` | `markManual(id, expected, reason)` | no UI surface at all. The framework's capability decides, not the workbook — SKILL.md Step 2 *writes* the `Testing Type` column from this classification, so it is an output, not a precondition |
| `COMBINE` | `markCombined(id, expected, ['TC-021','TC-022'])` | one report row standing for several workbook rows verified together |

```js
test('TC-014 the Purpose field rejects an empty value', async () => {
  markBlocked('TC-014', 'Submitting with an empty Purpose shows a validation error',
    'M1: the Purpose field is not implemented in the FE — raised with BA.');
});
```

**Never delete a test case.** A deleted test case is invisible; a blocked one is a `test()` that
still appears in the report with its reason and flips to a real assertion the moment the blocker
clears. There is no `SKIPPED_TCS` list any more — a blocked test case is simply a one-line
`test()`, which also means `-g "TC-014"` still finds it.

To skip a whole variant or suite, use `test.skip(condition, reason)` at the top of the describe
(the reference suite does exactly that to keep itself from ever running).

---

## 7. Status taxonomy

`STATUS_COLORS` in `utils/reporter.js` is the owner of this list — check it there, not from memory:

| Status | Meaning |
|---|---|
| `PASSED` | asserted and correct |
| `FAILED` | asserted and wrong — including genuine app defects, which stay FAILED |
| `SKIPPED` | not applicable to this variant |
| `SKIP` | blocked, reason recorded |
| `MANUAL` | not automatable: email delivery, an audit trail, or a row-for-row comparison of an exported file's contents |
| `COMBINE` | one report row covering several test cases verified together |

`PASSED` / `FAILED` / `SKIPPED` also arrive without being declared: with no `tc.status` annotation
the reporter maps Playwright's own verdict (passed → `PASSED`, skipped → `SKIPPED`, everything else
→ `FAILED`). `SKIP`, `MANUAL` and `COMBINE` exist only when a `mark*` helper declares them.

**A status outside this list falls through to the FAILED colour and renders red.** If you
introduce one, add it to `STATUS_COLORS`, to the notes-colour branch, and to the summary cards —
all three, or the report lies.

`MANUAL` is much narrower than it looks, and the reference suite automates every case people
usually call manual:

| Looks manual | Actually | Reference |
|---|---|---|
| "the status is colour-coded green" | `getComputedStyle(el).color`, asserting the channel **dominates** rather than an exact hex | TC-010 |
| "the page shows an error when the service fails" | `page.route(LIST_API, r => r.fulfill({ status: 500 }))` | TC-008 |
| "a user without the privilege cannot see it" | a no-privilege account in its own context — the standard pattern, not a limitation | TC-009 |
| "the export downloads a file" | `download.path()` gives a local path: assert the filename, the size, and the magic bytes (`PK` for xlsx/zip — an HTML error page fails that) | TC-012 |
| "the exported rows equal the filtered table" | genuinely `MANUAL` — needs a workbook parser this framework does not ship | TC-013 |

A mutating action that is automatable but blocked by the do-not-mutate policy (CLAUDE.md house
rules) is `markBlocked` with the reason "would mutate real data; needs explicit go-ahead" — not
`markManual`. Likewise a test case the workbook classifies as **Automation** but which nobody has
scripted yet is `SKIP`: `MANUAL` would hide a real automation gap, `SKIP` keeps it visible.

---

## 8. `beforeAll` / `afterAll`

```js
let context, page, seeder;

test.beforeAll(async ({ browser }) => {
  const account = accountForWorker(P, variant.prefix);

  context = await browser.newContext({
    viewport: process.env.HEADLESS === '1' ? { width: 1440, height: 2000 } : null,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  page = await context.newPage();

  await page.goto(variant.loginUrl, { waitUntil: 'domcontentloaded' });
  // …fill credentials, submit…
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
  expect(page.url(), 'login did not establish a session').not.toMatch(/\/login/);
});

test.afterAll(async () => {
  if (seeder) await seeder.cleanup();          // cleanup FIRST — a seeded record outlives the browser
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
});
```

- **One context per describe.** The test cases share a logged-in page, which is why
  `fullyParallel` stays `false` and why you must not mark the describe parallel. Re-logging in per
  test case would be slow and, on an app that allows one session per user, would evict the session
  it just created.
- **`browser.newContext()` inherits the `use` block from `playwright.config.js` — including
  `storageState`.** Verified: with `use.storageState` set, a context created by hand carried its
  cookies; `browser.newContext({ storageState: undefined })` did not. Two consequences:
  - A suite that wants `global-setup`'s shared session does not need to name the file.
  - **A context for a different account, or one that must start anonymous, has to pass
    `storageState: undefined`.** Otherwise it opens already signed in as `global-setup`'s account
    and your sign-in stacks a second session on top of it — which on a one-session-per-user app is
    the eviction bug wearing a disguise, and on a no-privilege test case can make the assertion
    fail for reasons that have nothing to do with privileges.
  - Form-logging in the *same* account `global-setup` already logged in is still the classic way to
    kill a run. Use the stored session, or a different account from the pool.
- **A failing `beforeAll` fails the first test in the describe and marks the rest skipped.**
  Verified: one `FAILED` row carrying the hook's error, the remaining rows `SKIPPED`, exit code 1.
  That is why the login assertion above carries the message `login did not establish a session` —
  that string is the only explanation the report will contain for a wall of skipped rows.
- **Viewport: tall when headless, the real window when headed.** `fullPage: true` still captures a
  scrolling dialog scrolled to the bottom if the window is short, so headless emulates a 2000px
  viewport. But a 2000px window cannot exist on a shorter screen — macOS clamps a window to the
  display, and scaling the page to fit breaks Playwright's click coordinates — so a headed run
  takes the real maximised window (`viewport: null`). `playwright.config.js` launches headed
  Chromium with `--start-maximized` for the same reason.
- **`acceptDownloads: true` and `ignoreHTTPSErrors: true` on every context**, including throwaway
  ones. `acceptDownloads` must be set on the context that will fire `waitForEvent('download')`, or
  the download test fails with no hint anywhere in the docs.
- **No `fs.mkdirSync` for screenshots.** `evidence()` creates
  `suites/<Feature>/screenshots/<variant>/` itself.
- **`afterAll` writes no report.** No `generateCombinedReport`, no `.<variant>_results.json`, no
  `SKIPPED_TCS` loop. The reporter runs in the main process and already has every result — and it
  writes the report even when tests failed, which a suite-side `afterAll` could not guarantee.

---

## 9. Environment and credentials

`environments/<env>.env`, loaded by `utils/profile.js`. `url`, `username`, `password` are required
(`readProfile` throws when one is empty); `otp` takes a static code or a TOTP base32 secret;
everything else is per-suite.

```
# used in: suites/<Feature>/test.js
# xx_ prefix = <Feature>
xx_tenant_url=
xx_tenant_prefix=

# One account per worker — a second login on the same user evicts the first (utils/accounts.js).
xx_accounts=qa.auto1@example.com:Passw0rd1,qa.auto2@example.com:Passw0rd2
xx_tenant_accounts=

# Seeding, so this suite does not depend on which rows happen to exist (utils/seed.js).
xx_api_url=
xx_api_user=
xx_api_password=
```

Five rules:

1. **Every value that differs per environment lives here** — URLs, portal prefixes, accounts.
2. **Prefix per suite** so keys never collide, and use the same prefix as the variant's `prefix`
   field so `accountForWorker(profile, variant.prefix)` resolves.
3. **Group under `# used in: <path>`** so any key can be traced to its consumer — and so a deleted
   suite's dead keys are obvious.
4. **Keys identical across `dev.env` / `sit.env` / `uat.env`; only values differ.**
5. **Prefer seeding over a data-dependent key.** The old rule said data-dependent literals — which
   status has rows, which dropdown option exists — belong in the env file. They do, if there is no
   other choice; but `<prefix>_status_with_rows` is a key whose only job is to record which value
   happened to have rows that week, and the test stops covering anything the moment that changes.
   If the entity has an API, seed the precondition (§5.2) and delete the key. If it does not,
   keep the key *and* the reason in a comment.

`environments/*.env` is git-ignored; only `example.env` is committed. CI never commits one either:
`.gitlab-ci.yml` writes `environments/<TARGET_ENV>.env` from masked CI/CD variables at run time and
`rm -f environments/*.env` in `after_script`, so credentials live in GitLab and never on a runner
that may be reused.

---

## 10. Evidence

```
suites/<Feature>/screenshots/<variant>/TC-004.png        # pass
suites/<Feature>/screenshots/<variant>/TC-007_form.png   # before  ┐ two evidence() calls
suites/<Feature>/screenshots/<variant>/TC-007_after.png  # after   ┘ → two "View" links
```

```js
await evidence(page, 'TC-004', { variant: variant.id });
```

- **Named by test-case id** so a report row maps to a file without a lookup.
- **`{ variant: variant.id }` is required** whenever a suite has more than one variant, or the two
  portals overwrite each other's evidence and the report shows one portal's screenshot for both.
  `evidence()` falls back to `process.env.TC_VARIANT`, then to no subdirectory.
- **Two shots for a mutating test case** — the filled form and the result. The reporter turns
  multiple `tc.evidence` annotations into several "View" links on the one row.
- The path recorded is **relative to the suite's `screenshots/`**, because that is the base
  `generateHTMLReport` links against. `evidence()` returns exactly that string; never construct an
  absolute one.
- The file is also `attach`ed to the Playwright report, so it shows up in the trace viewer beside
  the network log and DOM snapshots.
- A screenshot failure is swallowed (`.catch(() => {})`) — evidence must never mask the assertion
  failure that caused it. Failure screenshots themselves are automatic
  (`screenshot: 'only-on-failure'`); `evidence()` is for the *labelled* ones a client will read.
- `screenshots/` is git-ignored; `suites/<Feature>/test_report.html` is committed, which is why
  `.gitignore`'s HTML rule is scoped to the repo root.

---

## 11. Definition of done

- [ ] `npm run lint` is clean, or every exception carries `// lint-ok: <reason>`.
- [ ] Every test case in the source Excel exists as a `test()` and appears in `test_report.html`
      with a status. None deleted.
- [ ] Every filter test case asserts the resulting **rows**, not just that a chip appeared.
- [ ] No hardcoded URL, account, or environment-dependent literal in `test.js`; preconditions are
      seeded wherever an API exists.
- [ ] No `waitForTimeout`, no `try/catch` around an assertion, no `test.only`.
- [ ] Genuine app defects are left FAILED with a clear message and reported — not softened.
- [ ] Spec drift is recorded in the test's `note()`, and the test asserts the live UI.
- [ ] Every status used is one the reporter knows.
- [ ] **The exit code matches the report.** A run whose report shows FAILED rows must exit
      non-zero — `npx playwright test "suites/<Feature>/test.js"; echo $?`. A red report with
      exit 0 means something is catching assertions; that is the §12 defect, reintroduced.
      If the suite happens to be all-green, prove the gate anyway: break one assertion, rerun,
      confirm `echo $?` prints non-zero, then put it back. Catching assertions is not the only
      way to lose the verdict — a `process.exit(0)` anywhere in `globalTeardown` or a reporter
      throws it away too, and `globalTeardown` runs **before** the reporters' `onEnd`.
- [ ] Finished with **one full run per variant**, so the report is complete rather than the remnant
      of a `-g` run.
- [ ] `reports/history.jsonl` gained a line for that run.
- [ ] The Excel's `Testing Type` / `Manual Reason` columns agree with what the suite actually does.

---

## 12. Appendix — the legacy mega-`test()` + `record()` shape

**This is documented so you can recognise and migrate an existing suite. Do not write a new one
this way.** `npm run lint` rejects it by name (`no-record-helper`), and the reference suite, this
document and `playwright.config.js` all assume the per-test-case shape.

### What it looked like

One `test()` per variant, containing forty `runTC(id, body, onError)` calls; a module-level
`allResults` array filled by `record(tcId, status, expected, notes, screenshot)`; a `snap()`
helper for screenshots; `FOCUS=TC-001` filtering by id; a `SKIPPED_TCS` list replayed in
`afterAll`; and `generateCombinedReport()` writing `.<variant>_results.json` before regenerating
the HTML from every sibling's file.

```js
async function runTC(tcId, body, onError) {
  if (!isFocused(tcId)) return;
  try { await body(); }
  catch (err) { if (onError) { try { await onError(err); } catch (_) {} } }
}
```

### The defect

`runTC` caught the assertion error so the next test case could still run — the whole reason the
shape existed. But Playwright only ever saw the enclosing `test()`, which did not throw.
**Measured: two test cases FAILED, Playwright reported "1 passed", exit code 0.** The HTML report
was accurate and red; the process said success. A pipeline gated on it would have been permanently,
misleadingly green, and "Fail loud" was unenforceable in the framework that mandated it.

Second-order damage that all came from the same root:

- The report had to be built by the suite, which meant `allResults`, which meant a per-worker
  sidecar file and a sibling re-read, because workers share no memory (§4).
- A worker restart after a failure re-`require`d the file with an empty `allResults`, so the
  sidecar write had to merge with disk rather than overwrite — except on `TEST_WORKER_INDEX === '0'`,
  where anything on disk was a previous run's stale output. Getting that wrong under-reported the
  run (a report claiming "29 passed, 0 failed" for a run that produced 64 passed and 7 failed).
- Retries were meaningless: a test that never fails is never retried, so a flaky UI just recorded
  FAILED. `trace: 'on-first-retry'` produced nothing.
- One failure could not isolate: everything after it in the mega-test ran against whatever state
  the failed test case had left behind.

### The migration, piece by piece

| Old | New |
|---|---|
| one `test()` per variant with N `runTC` calls | N `test()` calls inside `test.describe(...)`, ids in the titles |
| `runTC(id, body, onError)` | the test body itself — let assertions throw |
| `onError` → `record(id, 'FAILED', …)` | delete it; Playwright records the failure and the reporter captures the message |
| `record(id, 'PASSED', expected, notes, shot)` | `tc(id, expected)` + `note(notes)` + `await evidence(page, id, { variant })` |
| `record(id, 'SKIPPED'/'SKIP'/'MANUAL'/'COMBINE', …)` | `markNotApplicable` / `markBlocked` / `markManual` / `markCombined` |
| `snap(id, suffix)` | ``evidence(page, `${id}_${suffix}`, { variant })`` |
| `FOCUS` + `isFocused` + `titleIsFocused` | `-g "TC-004"` (§3) |
| `SKIPPED_TCS` replayed in `afterAll` | one `test()` per blocked case calling `markBlocked` |
| `generateCombinedReport` + `.<variant>_results.json` + the worker-restart merge | `reporters/excel-html-reporter.js`, already registered |
| `afterAll` writing the report | `afterAll` doing cleanup only (§8) |
| `page.waitForTimeout(n)` | `utils/waits.js` (§5.1) |
| `<prefix>_status_with_rows` | seed it (§5.2) and delete the key |

Migrate one variant at a time and check the exit code after each step: `npx playwright test
"suites/<Feature>/test.js"; echo $?`. Until that number tracks the report, the migration is not
done — a green console from a suite of this shape proves nothing about the test cases inside it.

---

## 13. Anti-patterns

| Don't | Because |
|---|---|
| Hand-roll `record()` / `runTC()` | They swallowed assertion errors: two failures, "1 passed", exit 0. `npm run lint` rejects both by name (`no-record-helper`). |
| Wrap an assertion in `try`/`catch` so the next step runs | The same defect in miniature. Use `try`/`finally` for cleanup — `finally` does not swallow the error. |
| Call `generateHTMLReport` from a suite | The reporter already writes it in the main process with every worker's results. A suite-side write races it and can only ever see its own worker. |
| `page.waitForTimeout(...)` | Wrong in both directions, and the predecessor's 936 of them cost 14.2 minutes of pure sleeping per run. Wait on a signal (`utils/waits.js`); genuine exception → `// lint-ok: <reason>`. Fails `npm run lint`. |
| A URL, hostname or account literal in `test.js` | Passes on dev, fails on UAT, and it is how credentials reach git. Fails `npm run lint`. |
| Leave `test.only` / `describe.only` in the file | It silently drops every other test case while still exiting 0 and still writing a report. Fails `npm run lint`, and `forbidOnly` fails the CI run. |
| A test title with no test-case id and no `tc()` | The report row cannot be traced back to the workbook, and `-g` cannot select it. Fails `npm run lint` (`tc-id-required`). |
| Mark something `MANUAL` because it looks visual | Colour → `getComputedStyle`; a service error → `page.route`; access denied → a no-privilege account; a download's integrity → `download.path()`. `MANUAL` hides a real automation gap; if it is automatable but blocked, it is `markBlocked`. |
| Add an env key recording which value has rows | It is configuration that records one week's data. Seed the precondition (§5.2) or say in a comment why you cannot. |
| Share one account across workers | A second login evicts the first and the victim fails somewhere unrelated. Use `<prefix>_accounts` and `accountForWorker`. |
| `test.describe.configure({ mode: 'parallel' })` on a describe that shares a page | Those test cases would run concurrently against one `page`. Parallelism here is across files. |
| `browser.newContext()` for a *different* account without `storageState: undefined` | It inherits `use.storageState` and opens already signed in as `global-setup`'s account (§8). |
| `markCombined` on a test whose assertions do not cover the listed ids | The declared status wins in the client report, so a failing test renders as COMBINE while the exit code says failure. |
| Assert only that a control is visible | Presence-only checks pass while the feature is broken. Assert the result. |
| `expect(headers).toHaveLength(11)` | The app grows columns. Assert the documented subset is present. |
| Weaken an assertion to get green | That converts a found defect into a hidden one. |
| Delete a blocked test case | Invisible scope loss. `markBlocked` with a reason. |
| `.isVisible()` on a locator matching several elements | Strict-mode throw, then swallowed by a trailing `.catch(() => false)` → silent false negative. Use `.first()` or `.count()`. |
| Reuse an `elementHandle` across a table re-render | The handle detaches and clicks silently do nothing. Re-query with `.nth(i)`. |
| `waitUntil: 'networkidle'` on a dashboard | Long-polling connections mean it never settles. Use `'domcontentloaded'`. |
| Select a MUI autocomplete option and click on | The listbox stays open and eats the next click. Press `Escape` first. |
| `parseFloat("120.000,00")` | Returns `120`. Use `parseMoney`. |
| Verify expand/collapse by panel text | The text may read "(N items)" *or* "No detail data available". Assert the row-count delta instead (`countChangedFrom`). |
| Run the suite twice — once for the tally, once for the failures | Each run is slow and hits a live server. Run once; `reports/results.json` and `history.jsonl` hold the totals. |
| Form-login an account `global-setup` already logged in | Invalidates the stored session and kills the run. Use the stored session, or another account from the pool. |
| Seed a filter with a hardcoded term | Returns 0 rows on another environment and the test passes vacuously. Seed from the first row's real value, or from `Seeder.mark()`. |
| Perform a state-changing action without asserting its precondition | If the state is already the target state the action is a no-op, the post-assertion passes vacuously, and the test reports a successful change having changed nothing. Assert the precondition with a message naming the assumption. |
| Mark a download test `MANUAL` | `download.path()` gives you the file. Assert size + magic bytes (+ row count); only the row-for-row data comparison is manual. |
| Read table rows straight after clicking sort/filter | Server-side sort refetches. Await the list response (`actAndWait`) or assert the request's query param first, or you read the pre-sort table. |
| Build a locator from a sentinel fixture value (`"-"`, `"N/A"`) | The sentinel appears in almost every row, so the locator silently matches ALL of them and the test asserts against whichever row is first. Make a sentinel throw. |
