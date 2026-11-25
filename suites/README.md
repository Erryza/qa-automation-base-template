# suites/

Your test suites live here, one folder per feature:

```
suites/<Feature>/test.js            # the suite itself — this is the standard
suites/<Feature>/<TestCases>.xlsx   # the source test cases
suites/<Feature>/screenshots/       # evidence from evidence(), under <variant>/ (git-ignored)
suites/<Feature>/test_report.html   # written by the reporter — COMMITTED
```

**A suite writes nothing but assertions.** `test_report.html` is produced by
`reporters/excel-html-reporter.js`, which is registered in `playwright.config.js`, runs in the MAIN
process and is handed every worker's results. There is no `afterAll` report writing and no
`.<variant>_results.json` sidecar: those only ever existed because workers are separate processes
and could not share the old module-level results array, which a reporter solves natively.

The report rows come from the annotations `utils/tc.js` attaches — `tc(id, expected)`, `note(text)`,
`evidence(page, name, { variant })`, and the `mark*` helpers for `SKIP` / `SKIPPED` / `MANUAL` /
`COMBINE`. `PASSED` / `FAILED` is Playwright's own verdict, because **one test case is one real
`test()`** and assertions are allowed to throw.

`test_report.html` travels with the suite folder, so `.gitignore`'s HTML rule is scoped to the repo
root (`/*.html`) rather than being a bare `*.html`. Screenshots are git-ignored.

`playwright.config.js` picks up `suites/**/test.js` at any depth — no registration needed.

**Before writing a new suite**, read, in this order:

1. `examples/_reference-suite/test.js` — the canonical implementation. Copy and adapt it.
2. `utils/tc.js` — the helpers every test calls, and what each status means.
3. `.claude/skills/generate-live-test-suite/references/test-js-anatomy.md` — why each part exists.
4. `.claude/skills/generate-live-test-suite/SKILL.md` — the end-to-end authoring flow.

Then: iterate one test case with `npx playwright test "suites/<Feature>/test.js" -g "TC-001"`, and
run `npm run lint` before calling a suite done — it scans this folder only.

Do not compose a suite's structure from memory. This folder being empty in a fresh clone is
expected; the reference suite is what replaces "go read a sibling test.js".
