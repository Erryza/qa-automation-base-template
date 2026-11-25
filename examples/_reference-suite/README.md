# `examples/_reference-suite/` — do not delete

`test.js` in this folder is the **canonical implementation of this project's suite standard**.
It is documentation that happens to be executable code.

## Why it exists

This repository is a template: it ships with no real suites. But the way a suite is written here
is not obvious from the framework alone. It lives in conventions — one test case is one real
`test()`, report metadata comes from `utils/tc.js` annotations, waits key off a signal instead of a
clock, each worker takes its own account, a precondition is seeded rather than hoped for, and a
filter is proved by reading every row back — that used to be learned by opening a neighbouring
`test.js` and copying it.

With `suites/` empty there is no neighbour to copy. **This file is that neighbour.**

Prose cannot replace it. `references/test-js-anatomy.md` explains the rules, but a human — or an
AI — writing a suite reproduces a working example far more reliably than a description of one.
Keep both: the example for the shape, the anatomy doc for the reasoning.

The single most important thing it encodes: **one test case = one `test()`, and assertions are
allowed to throw.** The predecessor put many test cases inside a single `test()` behind a
`runTC(id, body, onError)` helper that caught their assertion errors. Measured: two test cases
FAILED, Playwright reported "1 passed", **exit code 0**. A fully red suite reported success, so no
CI gate built on it could ever have worked. Copy this file and that cannot happen again.

## Why it never runs

Two independent guards:

1. `playwright.config.js` matches `['tests/**/*.spec.js', 'suites/**/test.js']` — `examples/` is
   not in `testMatch`. Pointing Playwright straight at the path still prints `Error: No tests
   found.` and exits 1 (exit 0 with `--pass-with-no-tests`): guard 1 filters the file out *before*
   the CLI argument applies, so guard 2 never fires there.
2. Each `test.describe` opens with `test.skip(!ENABLED, ...)`, and `ENABLED` is
   `Boolean(profile && profile.example_base_url)` — with no `example_*` keys in the env profile
   every test case skips with a message saying this file is documentation. Guard 2 is what protects
   you if someone later widens `testMatch`, or copies the file into `suites/` without adapting it.

The `readProfile` call is wrapped in a `try/catch` for the same reason — only so this reference
file survives a repo with no env profile at all. **A real suite calls `readProfile()` directly and
lets it throw**; a missing profile should stop the run, not silently disable it.

It still passes `node --check`, and `.gitlab-ci.yml`'s `lint` job runs `node --check` over every
`.js` outside `node_modules` on every push — so a syntax break here is caught in CI, not
discovered by the next person who copies the file. Note the limit: `npm run lint`
(`scripts/check-conventions.js`) scans `suites/` **only**, so the convention rules are not applied
to this file. When you change a convention, change this file by hand.

## How to adapt it into a real suite

1. **Copy the folder**, don't move it:
   ```bash
   mkdir -p "suites/<Feature>"
   cp examples/_reference-suite/test.js "suites/<Feature>/test.js"
   ```
   The `require('../../utils/...')` depth is already correct for `suites/<Feature>/test.js`.
   Add one `../` per extra nesting level.

2. **Rewrite the header docblock** — suite name, module, the source Excel, the variants and how
   they differ, and the status legend. This is the first thing anyone reads.

   **Keep the `SELECTORS: UNVERIFIED` banner** until every entry in `SEL` has been confirmed
   against the real DOM (the live probe, `generate-live-test-suite` SKILL.md Step 4). Every
   component-library selector lives in that one `SEL` block — one block to correct beats 15
   inlined class substrings.

3. **Replace the config block** — `ADMIN_BASE` / `TENANT_BASE`, `PAGE_PATH`, `LIST_API` (the
   request the page actually fires; `actAndWait` keys off it), `SEL`, `ALL_COLUMNS`, and
   `VARIANTS`. If the page exists on only one portal, delete the `for (const variant of VARIANTS)`
   loop entirely and hardcode the single portal; do not carry machinery you do not need.

   **Then delete the self-skip guard** — `ENABLED`, the `try/catch` around `readProfile`, and the
   `test.skip(!ENABLED, ...)` line at the top of each describe. They exist only so this reference
   file can never run (see "Why it never runs"). A real suite calls `readProfile()` directly and
   lets a missing profile throw. Leave `ENABLED` pointing at `example_base_url` after renaming the
   prefix and every test skips, the run exits 0, and the report reads all-SKIPPED — which looks
   like "nothing applicable here" rather than "this suite is disabled".

   `filterVariantsByCountry` (`utils/profile.js`) is opt-in and deliberately **not** used here:
   this suite's variant axis is the portal, so wrapping the array would make `COUNTRY=id|ph` match
   nothing and run zero tests. Wrap it only when your variants really are countries.

4. **Add the env keys** to `environments/<env>.env` under a `# used in: suites/<Feature>/test.js`
   comment, with a short per-suite prefix. Never hardcode a URL, account, or data-dependent
   literal in `test.js` — `npm run lint` fails on a hardcoded URL. Include:
   - `<prefix>_accounts=user1:pass1,user2:pass2` — at least as many accounts as `workers`, because
     many dashboards allow one session per user and worker 2's login evicts worker 1's
     (`utils/accounts.js`);
   - `<prefix>_api_url` / `<prefix>_api_user` / `<prefix>_api_password` if the suite seeds
     (`utils/seed.js`).

   Prefer seeding over a key like `<prefix>_status_with_rows`: a key that only records which value
   happened to have rows on that environment stops covering anything the week the data changes.

5. **Keep the `utils/tc.js` calls — and delete the report plumbing, because there is none left.**

   Keep, verbatim in shape:
   - one `test()` per test case, with the TC id in the title, and assertions that throw;
   - `tc(id, expected)` as the first line of every body;
   - `note(text)` for the observation that makes a pass believable, `await evidence(page, name,
     { variant })` for a screenshot the report links;
   - the statuses that are not a pass/fail verdict: `markManual` / `markBlocked` /
     `markNotApplicable` annotate the row and then skip the test, so it appears in the report
     without pretending to be an assertion; `markCombined` annotates and lets the test run, so one
     row can stand for several workbook test cases;
   - deterministic waits from `utils/waits.js`: `actAndWait(page, action, { url })` wherever the
     list refetches, `until(read, predicate, what)` for anything else. `countSettled` and
     `countChangedFrom` are there for tables with no request to key off. `page.waitForTimeout` is
     a lint failure.

   The `reason` argument is a **bare sentence**: `markBlocked` / `markManual` /
   `markNotApplicable` already prepend the status (`test.skip(true, \`SKIP: ${reason}\`)`), so a
   `'SKIP: …'` prefix produces "SKIP: SKIP: …" and drags the duplicate into the report's Notes.

   Do **not** reintroduce, and do not go looking for them — they were deleted:
   - `record()`, `snap()`, `runTC()` and any `onError` catch. `npm run lint` rejects
     `record`/`runTC` by name.
   - `generateCombinedReport()` and the `.<variant>_results.json` sidecar merge. Workers cannot
     share memory, which is all that machinery ever solved;
     `reporters/excel-html-reporter.js` is registered in `playwright.config.js`, runs in the MAIN
     process with every worker's results, and writes the same `suites/<Feature>/test_report.html`.
     **A suite never writes a report.**
   - the `FOCUS` gate. Test-case ids are in `test()` titles, so `-g "TC-004"` selects them.

   `afterAll` therefore only cleans up — `seeder.cleanup()`, then the page, then the context, in
   that order, because a leaked seeded record outlives the browser.

6. **Replace the test cases.** The fourteen here are shape examples, one per case you will hit:

   | TC | Shape it demonstrates |
   |---|---|
   | TC-001 | The plain shape — navigate, assert the heading, take evidence |
   | TC-002 | Spec drift — assert the documented columns are PRESENT, `note()` the extras, never fail because the app grew a column |
   | TC-003 | `markNotApplicable` → `SKIPPED` — the Owner filter does not exist on the Tenant Portal |
   | TC-004 | **Assert results, not presence** — seed the term from real data, then read every row back. The one to internalise |
   | TC-005 | Data-independent arithmetic — money parsing that holds on any dataset |
   | TC-006 | Seeded precondition — `apiLogin` + `Seeder` create it, `until()` proves it appeared, `afterAll` removes it; `markBlocked` when no API is configured |
   | TC-007 | Mutation — fill Add New, then **Cancel**, and assert the row count did not change; two screenshots, because "it was filled" is not provable from one |
   | TC-008 | System error via `page.route` — a 500 with no broken backend, `unroute` in a `finally`. This is why "system error" test cases are not MANUAL |
   | TC-009 | Multi-role — a second account needs its own context, closed in a `finally`; `markBlocked` when no no-privilege account is provisioned |
   | TC-010 | Colour via `getComputedStyle`, asserting the channel dominates rather than an exact hex — "visual" is not automatically MANUAL |
   | TC-011 | Pagination arithmetic that holds on any dataset; `markNotApplicable` when there are too few rows to paginate |
   | TC-012 | Download — filename, size, and the `PK` magic bytes that prove it is really an XLSX and not an HTML error page |
   | TC-013 | `markManual` → `MANUAL` — genuinely no UI surface. Note how narrow that is: TC-008, TC-009, TC-010 and TC-012 are all automated above; what remains is diffing the file's parsed rows against the table |
   | TC-014 | `markBlocked` → `SKIP` — a blocked test case stays in the suite and the report with its reason. Never delete one; a deleted test case is invisible |

   Two variants × 14 test cases = 28 tests. Blocked and not-applicable cases are ordinary `test()`s
   now — there is no `SKIPPED_TCS` list at the top any more.

7. **Run it.** Lint first, iterate one test case, then one full run for the report:
   ```bash
   npm run lint
   ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-001"
   ENV=dev npx playwright test "suites/<Feature>/test.js"
   ```
   `-g` is a regex over the test title and hits every variant — on this suite,
   `-g "TC-004"` selects 2 of 28. Full run and triage procedure:
   `.claude/skills/run-tests/SKILL.md`.

## If you change the framework

If you add a reporter status, a helper, or a new convention, **update this file too**. A
convention that exists only in prose drifts within a release; one encoded here is exercised by
`node --check` in CI and by everyone who copies it. `npm run lint` will not catch the drift for
you — it does not scan `examples/`.
