# QA Automation Base Template

A reusable Playwright base for web-dashboard UI automation. It ships the **framework, the
conventions and one reference suite** — no project suites, no data, no reports. Clone it, adapt the
login, add suites. (Bahasa Indonesia: [README.id.md](README.id.md).)

- **One test case = one real `test()`.** Assertions throw, Playwright owns the verdict, so the exit
  code and the CI gate mean something.
- **Suites never write reports.** `reporters/excel-html-reporter.js` builds each
  `suites/<Feature>/test_report.html` + a PDF from the annotations every test attaches via
  `utils/tc.js`, and can write the results back into the TC workbook.
- **Environments** `dev` / `sit` / `uat` from `environments/<env>.env` (git-ignored).
- **Lint** (`npm run lint`) rejects fixed sleeps, hardcoded URLs, `test.only`, missing TC ids and the
  old `record()` / `runTC()` shape.

## Structure

```
.
├── .claude/                     # Claude Code settings + skills (generate-live-test-suite, run-tests)
├── Document/                    # local-only client docs (FSD, TC workbooks, loaders) — contents git-ignored
├── environments/example.env     # profile template → copy to dev.env / sit.env / uat.env
├── examples/_reference-suite/   # the canonical suite: copy and adapt (never executed)
├── reporters/                   # excel-html-reporter.js — HTML/PDF report, flaky detection, history
├── scripts/                     # lint, run-suite, preflight, sync-testcases, report rebuild/merge/PDF, publish
├── suites/                      # your suites: suites/<Feature>/test.js (empty in a fresh clone)
├── utils/                       # tc, waits, login(+login-config), profile, accounts, seed, reporter, excel, evidence…
├── global-setup.js              # env selection + one shared login → .auth/state.json
├── global-teardown.js           # PDF rendering helpers used by the reporter
├── playwright.config.js
├── .gitlab-ci.yml               # lint on push, nightly + manual runs
└── CLAUDE.md                    # router for AI sessions: standard, repo map, house rules
```

## Quick start

```bash
npm install
npx playwright install chromium
npm run lint                                     # → "[lint] no suites yet — nothing to check."
npx playwright test --list --pass-with-no-tests  # → "Total: 0 tests in 0 files"

cp environments/example.env environments/dev.env # fill url / username / password (/ otp)
# adapt utils/login-config.js to the real sign-in form
# fill "This project" in CLAUDE.md
```

Then copy `examples/_reference-suite/test.js` to `suites/<Feature>/test.js` and adapt it.

## Running

```bash
ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-001"   # iterate one test case
ENV=dev npx playwright test "suites/<Feature>/test.js"               # one suite
npm run suite -- --suite <Feature> --env sit                         # preflight + run + report paths
npm run test:ci                                                      # CI=1 HEADLESS=1
```

| Variable | Effect |
|---|---|
| `ENV=dev\|sit\|uat` | Which `environments/<env>.env`. Unset + TTY → prompt; no TTY → `dev`. |
| `HEADLESS=1` | Headless browser (default is headed). |
| `COUNTRY=…` | Optional variant filter. |
| `IGNORE_HTTPS_ERRORS=1` | Accept an expired / self-signed certificate (internal hosts only). |
| `SKIP_UI_LOGIN=1` | No shared login in global setup (API-only runs). |
| `REPORT_MERGE=1` | Merge a partial (`-g`) run into the previous report. |

Output: `suites/<Feature>/test_report.html`, `REPORT/<timestamp>_<Suite>.pdf`,
`reports/` (Playwright HTML, JSON, junit, `history.jsonl`). Debug a failure with
`npx playwright show-trace test-results/<…>/trace.zip` (traces are kept on first retry).

## Writing a suite

Read, in order: `examples/_reference-suite/test.js` → `utils/tc.js` →
`.claude/skills/generate-live-test-suite/references/test-js-anatomy.md`. The house rules are in
`CLAUDE.md`; the short version: assert results not presence, never drop a TC (use `markBlocked` /
`markNotApplicable` / `markManual`), wait on signals not clocks (`utils/waits.js`), keep
environment values in `environments/<env>.env`, don't mutate real data without a go-ahead.

## CI

`.gitlab-ci.yml`: lint on every push; nightly and manual test jobs on the pinned Playwright image.
`environments/<env>.env` is written from masked CI variables at run time and deleted afterwards.
Playwright is pinned to **1.60.0** — bump `package.json`, the installed version and the image tag
together.
