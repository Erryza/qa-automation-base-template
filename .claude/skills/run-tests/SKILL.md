---
name: run-tests
description: Run Playwright suites in this repo, read the exit code, and triage failures. Use when the user says "run tests", "execute testing", "run the test suite", names a feature (e.g. "run the transaction list tests"), asks to re-run one test case, or asks why a suite failed. Covers the standard standalone `suites/<Feature>/test.js` suites (`npm run lint` first, ENV / COUNTRY / HEADLESS / CI switches, `-g` to select one test case, traces, flaky handling, per-suite test_report.html). Single-suite runs on one named environment go through scripts/run-suite.js.
allowed-tools: Read, Bash, Glob
---

# Run Tests

Run a suite, capture per-test-case evidence, produce `suites/<Feature>/test_report.html`, and
**believe the exit code**.

**The standard suite shape is a standalone `suites/<Feature>/test.js`, and one test case is one
real `test()`.** Everything below assumes that.

Read this once, because the rest of the procedure depends on it. The previous shape put many test
cases inside a single `test()` behind a `runTC(id, body, onError)` helper that caught their
assertion errors so the next one could still run. Measured on a real suite: **two test cases
FAILED, Playwright reported "1 passed", exit code 0.** A fully red suite reported success, so no
gate built on it could ever have worked. Assertions now throw, Playwright owns the verdict, and
that is what makes the exit code, per-test retries and traces below mean anything.

## Step 1 — Lint before you spend a run

```bash
npm run lint            # node scripts/check-conventions.js
```

Dependency-free, no browser, no credentials, no environment — seconds. It scans `suites/` only. Exit 0 with
`[lint] no suites yet — nothing to check.` in a fresh clone.

| Rule | Rejects |
|---|---|
| `no-fixed-sleep` | `page.waitForTimeout(...)` — wait on a real signal (`utils/waits.js`) |
| `no-hardcoded-url` | an `http(s)://` literal in a suite (`localhost`, `127.0.0.1` and `example.com/.org` are allowed) — it belongs in `environments/<env>.env` |
| `no-test-only` | `test.only` / `describe.only` left behind — it silently drops every other test case |
| `no-record-helper` | a hand-rolled `record()` / `runTC()` — the shape that swallowed failures |
| `tc-id-required` | a `test()` with no test-case id in its title and no `tc()` call — untraceable in the report |

Genuine exception: `// lint-ok: <reason>` on that line. `.gitlab-ci.yml` runs the same script on
every push, so a lint failure here is a red pipeline there.

## Step 2 — Establish what to run and where

```bash
ls -d suites/*/ suites/*/*/ 2>/dev/null            # available suites
ls environments/                                    # which env profiles exist
```

Ask the user which environment (`dev` / `sit` / `uat`) if they did not say. Show a one-line
summary before running: environment, suite path, and the target URL (from the env profile — never
print the password).

If `environments/<env>.env` is missing, `readProfile` fails with instructions to copy
`environments/example.env`. Report that and stop; do not invent credentials.

## Step 3 — Prerequisites

```bash
ls node_modules/@playwright/test/package.json >/dev/null 2>&1 && echo "deps OK" || echo "MISSING — run npm install"
node -e "
const {readProfile,getEnvProfilePath}=require('./utils/profile');
const env=process.env.ENV||'dev';
try{const p=readProfile(getEnvProfilePath(env));console.log('profile OK  url:',p.url,' user:',p.username);}
catch(e){console.log('profile FAIL:',e.message);process.exit(1);}
"
```

## Step 4 — Run

Environment switches, and who reads each:

| Variable | Values | Read by | Effect |
|---|---|---|---|
| `ENV` | `dev` `sit` `uat` | `global-setup.js`, `utils/profile.js` | Picks `environments/<env>.env`. Unset + a TTY → interactive prompt; unset + no TTY → defaults to `dev`. |
| `COUNTRY` | `all` `id` `ph` | `filterVariantsByCountry()` | Optional variant filter. Unset = all variants. A value that matches **no** variant runs 0 tests and leaves the previous report on disk — `utils/profile.js` warns when that happens. |
| `HEADLESS` | `1` | `playwright.config.js` | Forces headless. Use only in CI (`test:ci` sets it), with no display, or when the user asks. Local runs on this Mac are **headed** by default — do not add it by habit. |
| `CI` | `1` | `playwright.config.js`, the reporter | Switches to the CI profile: `retries: 2` (0 locally), `workers: 2` (4 locally), `forbidOnly: true` so a stray `test.only` fails the run. Also stamps `"ci": true` on the `reports/history.jsonl` line. `npm run test:ci` = `CI=1 HEADLESS=1 playwright test`. |

**Selecting test cases is Playwright's job now.** `FOCUS` is deleted — test-case ids live in
`test()` titles, so `-g` does the same work with none of the custom machinery. Verified on the
reference suite: 28 tests listed, `-g "TC-004"` selects 2 (one per variant).

| Flag | Effect |
|---|---|
| `-g "TC-004"` | Runs that test case in every variant. The fast iteration loop. |
| `-g "TC-004\|TC-007"` | It is a regex — alternation, prefixes (`-g "TC-01"`) and `VEP_030` all work. |
| `--grep-invert "TC-013"` | Everything except the match. |
| `--last-failed` | Re-runs only the failures of the previous run. The triage loop. |
| `--repeat-each=5` | Run the same test 5× — how you prove a flake instead of guessing. |
| `--retries=1` | Locally retries are 0, so `trace: 'on-first-retry'` never fires. Add this to get a trace (Step 7). |
| `--fail-on-flaky-tests` | Makes a pass-on-retry a non-zero exit. Use it when a flake must block. |
| `--pass-with-no-tests` | "no suites yet" exits 0 instead of 1. Use it in any script or gate. |
| `--list` | Enumerate without running. `globalSetup` does not run, so it needs no credentials. |

```bash
# iterate one test case, fast — the loop you use while fixing selectors
ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-001"

# the whole suite
ENV=dev npx playwright test "suites/<Feature>/test.js"

# everything, one environment
npm run test:dev

# the CI profile locally (retries 2, workers 2, forbidOnly) — set ENV yourself, there is no prompt
ENV=sit npm run test:ci
```

**Run ONCE and parse every status from that single output.** A full run is slow and hits the live
server; never invoke twice, once for the tally and once for the failures.

**From an agent shell**, a proxy/wrapper may hijack the bare `playwright` command. Call the
local CLI directly (headed by default; prefix `HEADLESS=1` only in CI / no display / on request):

```bash
ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js" -g "TC-001"
```

## Step 5 — Read the exit code, then the tally

The exit code is the headline result, and it is finally trustworthy: a failed assertion is a
failed `test()` is a non-zero exit. Capture it directly — a pipe throws it away (`cmd | tail`
reports `tail`'s status, not Playwright's):

```bash
ENV=dev npx playwright test "suites/<Feature>/test.js" > /tmp/run.txt 2>&1; code=$?
cat /tmp/run.txt; echo "exit=$code"
```

| Exit | Meaning |
|---|---|
| `0` | Every test passed. Includes tests that passed only on retry — see Step 8; that is a defect, not a pass. |
| `1` | At least one test failed or timed out, **or** the run never started: no tests found (without `--pass-with-no-tests`), a config error, a `globalSetup` throw, or `test.only` under `forbidOnly` in CI. |
| `130` | Interrupted (Ctrl-C / SIGINT). Nothing is proven; the report holds a partial run. |

Then the per-status tally. `PASSED` / `FAILED` are Playwright's verdict; `MANUAL`, `SKIP`,
`SKIPPED` and `COMBINE` are declared by the `utils/tc.js` `mark*` helpers, so Playwright counts
the first three as "skipped" and only the report separates them. The one machine-readable line
that already has all of it is the run the reporter just appended:

```bash
node -e "
const l=require('fs').readFileSync('reports/history.jsonl','utf-8').trim().split('\n').pop();
const r=JSON.parse(l);
console.log(r.status, JSON.stringify(r.totals), 'passRate='+(r.passRate===null?'n/a':r.passRate+'%'), 'flaky='+r.flaky.length, r.durationMs+'ms');
"
```

`passRate` is `PASSED / (PASSED + FAILED)` — graded tests only, so skips and manual rows cannot
inflate it. `null` means nothing was graded.

Summarise for the user as a table — TC id, status, notes — then the totals per status, the pass
rate, and the exit code.

Statuses `utils/reporter.js` understands: `PASSED` `FAILED` `MANUAL` `COMBINE` `SKIP` `SKIPPED`.
**A status outside that list renders with the FAILED colour**, so unexplained red rows are worth
checking against what the suite actually annotated before reporting a failure.

The report reflects the **last** run. If you iterated with `-g`, the report now contains only those
test cases — finish with one full run before handing it over.

## Step 6 — Artefacts

| Artefact | Path | Written by |
|---|---|---|
| Per-suite HTML report (client deliverable) | `suites/<Feature>/test_report.html` | `reporters/excel-html-reporter.js`, in the main process |
| Per-test-case evidence | `suites/<Feature>/screenshots/[<variant>/]<name>.png` | the suite's `evidence()` calls |
| Run history, one line per run | `reports/history.jsonl` | the same reporter |
| Playwright's own report | `reports/playwright-html/index.html` (`npm run report`) | `html` reporter |
| Machine-readable results | `reports/results.json` | `json` reporter |
| JUnit XML (the GitLab MR test summary) | `reports/junit.xml` | `junit` reporter |
| Traces, videos, failure screenshots | `test-results/<...>/` | Playwright |
| PDF per suite, every run | `REPORT/<timestamp>_<Suite>.pdf`, or `REPORT/<group>/<menu>/…` when the suite has a `report.json` (e.g. `REPORT/MF/Investment Manager/`) | the same reporter, via `generateSuitePdfs` in `global-teardown.js` |
| PDF for one suite, on demand | `npm run report:pdf -- "suites/<Feature>"` → `suites/<Feature>/test_report.pdf` | `scripts/report-to-pdf.js` |

Suites no longer write reports themselves and there is no `.<variant>_results.json` sidecar to
merge: the reporter runs in the main process and is handed every worker's results.

`npm run publish:report` refuses to run without `REPORTS_PUBLIC_ACK=1` — it uploads full-page
screenshots of a live dashboard, which may contain customer data. Prefer CI artifacts.

## Step 7 — Open the trace first

The Playwright trace is the primary debugging tool in this repo. It carries the DOM snapshot,
network log, console and the action timeline for every step, so a failure is replayable instead of
reconstructed from screenshots.

```bash
ls test-results/                                     # find the failing test's folder
npx playwright show-trace test-results/<...>/trace.zip
```

- `trace: 'on-first-retry'` in `playwright.config.js`: a passing run costs nothing, and a retried
  test always leaves one. The trace of the retry lives in the `...-retry1` folder.
- **Locally `retries` is 0**, so a first-run failure produces a video and a failure screenshot but
  no trace. Reproduce it with `--retries=1` (or `--trace on`) and you get one:
  ```bash
  ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-004" --retries=1
  ```
- In CI `retries` is 2, so every failure already has a trace; `test-results/` is in the job
  artifacts (Step 10).
- `npm run report` opens Playwright's HTML report, which links each trace, video and error
  directly — usually faster than hunting the folder name.

Do this before reading screenshots. Screenshot archaeology answers "what did the page look like";
the trace answers "what did the test do, what did the app return, and where did it diverge".

## Step 8 — Flaky

A test that fails and then passes on a retry is **flaky**. Playwright still exits 0. It is
recorded in three places:

- console: `[excel-report] N flaky (passed only on retry):` with the test titles,
- the suite report: the row's notes carry `flaky: passed on retry <n>`, and the row shows the
  final verdict,
- `reports/history.jsonl`: a `flaky: [...]` array on that run's line.

**A test that only passes on retry is a defect in the test, not a pass.** Treat it as work, not as
noise: it will fail for real on a slow day, and every flake erodes the reason for having a gate.
Diagnose it, do not re-run it until it is green.

```bash
ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-004" --repeat-each=5   # confirm it
ENV=dev npx playwright test "suites/<Feature>/test.js" --fail-on-flaky-tests         # make it red
```

Almost every flake here is one of: a fixed sleep that was long enough yesterday (`npm run lint`
catches these — replace with `utils/waits.js`), an assertion made before the fetch resolved
(`actAndWait`), a locator that matches during a re-render, or two workers sharing one account
(`utils/accounts.js`).

## Step 9 — Triage failures

Do not "fix" a failure by weakening the assertion. **Open the trace (Step 7) before forming a
theory**, then decide which of these it is:

| Symptom | Likely cause | Action |
|---|---|---|
| Anything you cannot explain in ten seconds | — | `npx playwright show-trace test-results/<...>/trace.zip`. Re-run with `--retries=1` if no trace was produced. |
| Every test in a describe fails, suite dies in `beforeAll` | Login never established, or a second login evicted the session this worker had | The suite asserts the URL left `/login` — read that message. Give each worker its own account: `<prefix>_accounts=user1:pass1,user2:pass2` in `environments/<env>.env` (`utils/accounts.js`), at least as many accounts as `workers`. |
| `[accounts] worker N is reusing <prefix> account #k` warning, then unrelated selector failures | Fewer accounts than workers, so two workers share a login and evict each other | Add accounts to the pool, or lower `workers` in `playwright.config.js`. |
| `beforeAll` fails on the login page across all retries | The app holds ONE session per account for ~60s, so an immediate second login is rejected (or the environment is rate-limiting) | Back off **past** the hold (~65s) and retry — it self-clears. Do not abandon the run, and do not "fix" the test. |
| Test passes alone, fails in a full run; or passes only on retry | A fixed sleep, or an assertion racing a fetch | Replace with a deterministic wait: `actAndWait(page, action, {url})` for the request the UI is waiting on, `countChangedFrom` / `countSettled` for a table, `until(read, predicate, what)` for anything else (`utils/waits.js`). `npm run lint` fails on `waitForTimeout` for exactly this reason. |
| `SKIP: no row with status X on this environment`, or a test that asserts nothing because the filter matched no rows | The test depends on whatever data happens to exist | Seed the precondition over the API and remove it afterwards: `apiLogin(...)` + `Seeder` (`utils/seed.js`). That is what replaces env keys recording which value happened to have rows. Genuinely no API, or writes forbidden → `markBlocked` with the reason. |
| `strict mode violation` | A locator matched >1 element | `.first()` / `.last()` / `.count()`. A trailing `.catch(()=>false)` hides this. |
| Timeout on `networkidle` | The dashboard holds long-polling connections | Navigate with `waitUntil: 'domcontentloaded'`. |
| Filter test fails with "chip applied but N/M rows do NOT contain ..." | **A genuine app defect** — the filter does not filter | Keep it FAILED and report it. |
| A test expects a field or rule the app does not have | Spec drift | Assert the live UI and `note()` the drift; if truly blocked, `markBlocked` with the reason — never delete the test case. |
| Value visible in the screenshot but the assertion failed | Stale handle after a table re-render | Re-query the locator with `.nth(i)` instead of reusing an `elementHandle`. |
| Exit 1 but zero failures listed | No tests matched, a `globalSetup` throw, or `test.only` under `forbidOnly` in CI | Re-read the top of the output; add `--pass-with-no-tests` only when "no suites yet" is a legitimate pass. |
| Report missing or stale after a run | The run matched 0 tests (a `COUNTRY` value that matches no variant, or a `-g` that matched nothing) | Check for the `[profile] COUNTRY=... matched none` warning; re-run without the filter. |

Report genuine defects loudly. A suite that is green because assertions were softened is worse
than a red one.

## Step 10 — CI

`.gitlab-ci.yml`, two stages:

| Job | Trigger | Image | Does |
|---|---|---|---|
| `lint` | every push and merge request | `node:22-alpine` | `node scripts/check-conventions.js` + `node --check` over every `.js`. No browsers, no credentials, seconds. |
| `nightly` | a schedule (set `TARGET_ENV`, e.g. `sit`) | `mcr.microsoft.com/playwright:v1.60.0-noble` | Full run with `--pass-with-no-tests`. |
| `manual` | run it from the pipeline UI | same | Same, plus an optional `GREP` variable: `GREP="TC-004"` runs just that test case on every variant. `allow_failure: true`. |

Credentials come from masked CI/CD variables (`AUTOMATION_URL`, `AUTOMATION_USERNAME`,
`AUTOMATION_PASSWORD`, `AUTOMATION_OTP`, or `AUTOMATION_ACCOUNTS` for a pool). A pool also needs
`ACCOUNTS_PREFIX`: the job writes `"${ACCOUNTS_PREFIX}_accounts=…"`, and that prefix must match the
suite's own `<prefix>_accounts` key — the one `accountForWorker(profile, '<prefix>')` reads.
Mismatch it and every worker shares one login, which is the session eviction the pool prevents.
`environments/<env>.env` is written from them at run time and deleted in `after_script`, so
secrets never enter the repository or outlive the job.

Artifacts, kept 30 days, `when: always`: `suites/**/test_report.html`, `suites/**/screenshots/`,
`reports/`, and `test-results/` — that last one is where the traces from retried tests are, so a CI
failure is debuggable with `show-trace` locally. `reports/junit.xml` is surfaced as the merge
request test summary, so a failure is visible without downloading anything.

The image tag is pinned to the installed Playwright (1.60.0), which `package.json` pins exactly.
Bump all three together — dependency, installed version, image tag — a mismatch is
the usual cause of "Executable doesn't exist" on a runner.

Artifacts do not carry into the next pipeline, so `reports/history.jsonl` in CI only ever holds
that one run. For a real trend, push each run's line somewhere durable.
