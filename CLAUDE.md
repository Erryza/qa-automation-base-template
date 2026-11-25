# CLAUDE.md

Reusable Playwright base setup for web-dashboard UI automation. The repo ships the framework, the
conventions, and one reference suite — the project's own suites get added on top. This file is a
**router**, not a manual: it is loaded into every session, so the detail lives in the files it
points to. Go read them rather than guessing.

## This project — TBD (fill in when you start a project on this template)

- **Application** — TBD: name, stack (e.g. React SPA), and which page is the login. Hosts per
  environment live in `environments/<env>.env`, never here.
- **Login** — TBD. Pick one and delete the others:
  - *Plain form (default)* — adapt `utils/login-config.js`; `global-setup.js` signs in through
    `utils/login.js` and saves `.auth/state.json`, which every run reuses.
  - *Captcha / SSO a script cannot pass* — a human signs in once with `npm run login`
    (`scripts/manual-login.js`, headed) and `.auth/state.json` is reused until
    `npm run check:session` reports EXPIRED. Never use an OCR / third-party captcha "solver".
  - *Captcha with a fixed test value on an environment* — put it in `captcha=` in that env file
    and use `npm run login:auto` (`scripts/auto-login.js`).
- **Accounts / roles** — TBD. Top-level `username`/`password` is the default account; add
  `<prefix>_*` keys when a suite needs another role. Note whether creates are maker-checker.
- **Certificate** — TBD. Set `IGNORE_HTTPS_ERRORS=1` only for an internal host with a
  self-signed / expired cert.
- **UI kit** — TBD (confirm from the first suite: how dropdowns, field errors, confirmations and
  toasts render). Update `utils/tc.js` / `utils/evidence-fit.js` evidence-crop class names to match.

## The standard — read before writing any suite

**A suite is a standalone `suites/<Feature>/test.js`, and one test case is one real `test()`.**
Assertions are allowed to throw, so pass/fail is Playwright's own verdict. The predecessor put many
test cases inside a single `test()` behind a `runTC(id, body, onError)` helper that caught their
assertion errors: two test cases failed, Playwright reported "1 passed", **exit code 0** — a fully
red suite reporting success, so no CI gate built on it could ever have worked. Never reintroduce
`record()` / `runTC()`; `npm run lint` rejects them by name.

| Read | For |
|---|---|
| `examples/_reference-suite/test.js` | The canonical implementation. **Copy and adapt it.** |
| `utils/tc.js` | The metadata every test attaches: `tc`, `note`, `evidence`, `mark*`. |
| `.claude/skills/generate-live-test-suite/references/test-js-anatomy.md` | Why each part of that file exists, and the framework contract it must satisfy. |
| `.claude/skills/generate-live-test-suite/SKILL.md` | The end-to-end flow: Excel test cases → Automation/Manual classification → live-probed selectors → a green `test.js`. |
| `.../references/create-auth-and-gotchas.md` | Only when the feature mutates data or has more than one login role/portal. |
| `.../references/source-mining-and-skip.md` | Only when the frontend source repo is available, or you need a spec-vs-code mismatch report. |
| `.claude/skills/testcase-generate/SKILL.md` | Upstream of the above: FSD/TSD + source → the Excel TC workbook (`Document/`) that `generate-live-test-suite` consumes. |
| `.claude/skills/testcase-review/SKILL.md` | Approve/reject a TC workbook (coverage, duplicates, spec gaps) before automating it. |
| `.claude/skills/traceability-matrix/SKILL.md` | Optional: RTM (BRD→FSD→TSD→ticket→TC) with coverage/gap audit, for client sign-off. |

`suites/` being empty in a fresh clone is expected — the reference suite is what replaces "go read
a sibling `test.js`". Never compose a suite's structure from memory.

## Repo map

| Path | What it is |
|---|---|
| `suites/<Feature>/test.js` | Your suites. Picked up by `testMatch` at any depth, no registration. |
| `examples/_reference-suite/` | The canonical reference suite. Excluded from `testMatch`. **Do not delete.** |
| `utils/tc.js` | `tc(id, expected)`, `note(text)`, `evidence(page, name, {variant})`, `markManual` / `markBlocked` / `markNotApplicable` / `markInvalid` / `markCombined`. Annotations only; a suite never writes a report. |
| `utils/waits.js` | `actAndWait(page, action, {url})`, `countSettled`, `countChangedFrom`, `until(read, predicate, what)` — the replacements for `page.waitForTimeout`. |
| `utils/manual-evidence.js` | The tester's own pictures (`suites/<Feature>/manual-evidence/<TC id>_manual_<n>.png`) and verdicts (`manual-results.json`: `{ "TC-…": { status: PASSED\|FAILED, date, by, note } }`), applied to the report rows on EVERY generation (the reporter's `onEnd`, `scripts/rebuild-report.js`). A verdict replaces only SKIP / SKIPPED / MANUAL, never an automated PASSED or FAILED; the row gets a MANUAL chip. A suite never attaches them itself. |
| `utils/accounts.js` | `accountForWorker(profile, prefix)` picks this worker's account from `<prefix>_accounts=user1:pass1,user2:pass2`. Many dashboards allow one session per user, so a second login evicts the first. |
| `utils/seed.js` | `apiLogin` + `Seeder`: state the precondition, create it, remove it (LIFO, best-effort). This is what replaces env keys recording which value happened to have rows. |
| `utils/profile.js`, `utils/login.js` | Env profile loading (`getSelectedEnv`, `filterVariantsByCountry`); shared form login + OTP. |
| `utils/login-config.js` | The login form's selectors (`username_css`, `submit_css`, `otp_prefix`, `dashboard_url_pattern`, …). **ADAPT first.** Credentials stay in `environments/<env>.env`. |
| `utils/reporter.js` | `generateHTMLReport` + `STATUS_COLORS` — the owner of the status list. |
| `reporters/excel-html-reporter.js` | Registered in `playwright.config.js`. Runs in the MAIN process with every worker's results, writes each `suites/<Feature>/test_report.html`, flags flaky (passed only on retry), appends one line per run to `reports/history.jsonl`, then renders each report to `REPORT/`. |
| `scripts/check-conventions.js` | `npm run lint`. Dependency-free; scans `suites/` only. Rules: no-fixed-sleep, no-hardcoded-url, no-test-only, no-record-helper, tc-id-required. |
| `playwright.config.js` | Retries/workers/trace/video/screenshot and the reporter list. `fullyParallel: false` on purpose — test cases in one describe share a logged-in page, so parallelism is across FILES. |
| `.gitlab-ci.yml` | Lint on every push; nightly + manual full runs; `environments/<env>.env` written from masked CI variables and deleted after; junit as the MR test summary. |
| `global-setup.js` | Environment selection, one shared login → `.auth/state.json` (applied only when the file exists). |
| `global-teardown.js` | Runs BEFORE the reporters' `onEnd`, so it must not read a report or call `process.exit`. Exports `generateSuitePdfs`, which the reporter calls to write `REPORT/<timestamp>_<Suite>.pdf` — or, when the suite has a `suites/<Feature>/report.json` (`{ "group": "<Group>", "menu": "<Menu>", "also": [...] }`), into `REPORT/<group>/<menu>/` (`also` = suite files copied beside the PDF). |
| `environments/example.env` | Template. Copy to `dev.env` / `sit.env` / `uat.env` — those are git-ignored. |
| `scripts/publish-report.sh` | Refuses to run without `REPORTS_PUBLIC_ACK=1`: it uploads full-page screenshots of a live dashboard. Prefer CI artifacts. |
| `scripts/run-suite.js`, `scripts/preflight.js` | One suite on one explicitly named env (`npm run suite -- --suite <Feature> --env sit`): offline preflight first (a suite may bring its own `preflight.js`), then the run, then `post-run.js` if present. Options read from `suites/<Feature>/report.json`. |
| `scripts/sync-testcases.js` | Excel workbook → `suites/<Feature>/testcases.json`, and what changed since last sync. |
| `Document/` | Local-only client documents (FSD, TC workbooks, loaders). Contents are git-ignored; see its README. |

## House rules

These bind every task here. They exist because each one was learned from a failure.

1. **Assert results, not presence.** A control appearing does not prove it works. For a filter:
   seed the term from real data, apply it, then read that column for every visible row and assert
   they all match. A presence-only check passes while the feature is broken.
2. **Never silently drop a test case.** A blocked, mismatched or not-applicable TC stays in the
   suite as its own `test()` calling `markBlocked` / `markNotApplicable` / `markManual` with a
   one-line reason. Deleting a TC hides scope.
3. **Fail loud — now structurally.** One test case = one `test()`, so a failed assertion is a
   failed test and a non-zero exit code. Never weaken an assertion to get green, and never catch
   one so the next test case can run: that is the exact defect this shape removed.
4. **Wait on a signal, never on a clock.** Use `utils/waits.js`. `waitForTimeout` fails
   `npm run lint` — the predecessor had 936 of them in 15,826 lines (one every 16 lines, 14.2
   minutes of sleeping per run). Genuine exception: `// lint-ok: <reason>` on that line.
5. **Do not mutate real data** unless the user explicitly says so — fill the form, then Cancel. A
   mutating step that is automatable but blocked by this policy is `markBlocked(...)`, reason
   "would mutate real data; needs explicit go-ahead". `MANUAL` stays for no-UI-surface cases only.
6. **Environment-dependent values live in `environments/<env>.env`**, never hardcoded in a
   `test.js`, namespaced per suite under a `# used in: <path>` comment. Better still: seed the
   precondition (`utils/seed.js`) rather than add a key recording which value happens to have rows.
7. **Run once, parse every status from that single output.** A full run is slow and hits a live
   server. Never run twice — once for the tally and once for the failures.
8. **Spec drift is normal.** The Excel is often older than the app. Assert the live UI, record the
   drift in the TC note, tell the user — do not fail a test because the document drifted.
9. **Read before you write, and match what is there.** Read the reference suite and the helpers
   first; conformance beats taste. If two patterns contradict, pick one and say why — never blend.
10. **Define success, then loop to it.** Iterate one test case with `-g "TC-001"` until it is
    genuinely green, then do one full run.

## Statuses

Two owners, no third copy: `STATUS_COLORS` in `utils/reporter.js` owns the status strings;
`utils/tc.js` owns which helper declares which status **and whether it skips**. Read them there,
not from memory — a restated copy here is how "`markCombined` skips the test" (it does not) once
survived in four files at once. The one line worth repeating: `markBlocked` /
`markNotApplicable` / `markManual` annotate then `test.skip`; `markCombined` only annotates, so
its assertions still run and still decide the verdict.

## Commands

The checks a change must pass (the `wbs-issue` skill's verify step reads this list). Run them in
this order and report each result as it is:

```bash
npm run lint                                                                              # conventions; no browser
ENV=dev npm run check:session                                                             # must say VALID before any run
ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js" -g "<TC id>"  # one test case (headed)
ENV=dev node node_modules/@playwright/test/cli.js test "suites/<Feature>/test.js"               # the suite, once (headed)
```

A failing `check:session` is not a code failure: stop and ask the user to sign in again (see
"This project" → Login). Test-case sources: TBD — the TC workbook(s) in `Document/`.

## Running

| Variable / flag | Effect |
|---|---|
| `ENV=dev\|sit\|uat` | Picks `environments/<env>.env`. Unset + TTY → prompt; unset + no TTY → `dev`. |
| `-g "TC-004"` | Playwright's own title filter, and the iteration loop. TC ids live in `test()` titles now, so it selects that test case in every variant. The custom `FOCUS` variable is gone. |
| `COUNTRY=all\|id\|ph` | Optional variant filter (`filterVariantsByCountry`). Unset = all variants. A value matching no variant runs 0 tests and leaves the old report on disk (a warning is printed). |
| `HEADLESS=1` | Forces headless. Use it ONLY in CI (`npm run test:ci` sets it), on a machine with no display, or when the user asks. Local runs on this Mac have a display, so they run **headed** (the config default) — do not add `HEADLESS=1` by habit. |
| `IGNORE_HTTPS_ERRORS=1` | Accept an expired / self-signed certificate (internal hosts only). Off by default. |
| `SKIP_UI_LOGIN=1` | No shared browser login in `global-setup.js` (API-only runs, or suites that log in per role). |

**Session:** with a plain form `global-setup.js` signs in by itself. For a captcha / SSO login, capture the session once:

```bash
ENV=dev npm run login          # headed; sign in manually + solve the captcha → .auth/state.json
ENV=dev npm run check:session  # is the saved session still valid? (re-run `login` when EXPIRED)
```

`global-setup.js` reuses `.auth/state.json` when it exists; otherwise it signs in through `utils/login.js`
(`FRESH_LOGIN=1` forces a new sign-in). If a run lands on the login page, the session expired.

```bash
npm run lint                                                        # conventions; no browser, no credentials
ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-001"  # iterate one test case
ENV=dev npx playwright test "suites/<Feature>/test.js"              # full run
npm run test:ci                                                     # CI=1 HEADLESS=1: retries 2, workers 2, forbidOnly
```

In an agent shell a wrapper may hijack the bare `playwright` command — call the local CLI directly:
`ENV=dev node node_modules/@playwright/test/cli.js test "<file>" -g "TC-001"` (headed; prefix `HEADLESS=1` only in CI / no display / on request).
Full run/triage procedure: `.claude/skills/run-tests/SKILL.md`.

## First task in a fresh clone

1. `npm install && npx playwright install chromium`. Playwright is pinned to 1.60.0 in
   `package.json` and `.gitlab-ci.yml` pins the matching image — bump all three together
   (`package.json`, the installed version, the image tag).
2. `npm run lint` → `[lint] no suites yet — nothing to check.`, **exit 0**.
3. `cp environments/example.env environments/dev.env` and fill `url` / `username` / `password`;
   adapt `utils/login-config.js` to the real sign-in form, and fill "This project" above.
4. `npx playwright test --list --pass-with-no-tests` → `Total: 0 tests in 0 files`, **exit 0** — a
   healthy empty template. Without the flag Playwright also prints `Error: No tests found` and
   exits 1; still expected here, but always use the flag in a script or CI gate so "no suites yet"
   is not indistinguishable from a real failure. `globalSetup` does NOT run for `--list`, so this
   works before step 3 too. Both messages go away once the first suite exists.
5. Read `examples/_reference-suite/test.js`, then write the first suite into `suites/<Feature>/`.

Debugging a failure: `trace: 'on-first-retry'`, so a retried test leaves a full trace —
`npx playwright show-trace test-results/<...>/trace.zip` replays its DOM, network and actions.
Retries are 0 locally; add `--retries=1` when you want that trace.
