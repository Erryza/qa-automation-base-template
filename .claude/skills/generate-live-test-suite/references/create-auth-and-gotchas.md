# Create/mutation, multi-role login, and hard-won gotchas

Read this when the feature has **create/edit (mutating) TCs**, **more than one login
role/portal**, or when a create submit mysteriously fails. These are lessons that cost hours.

## 1. Creating real data (when the user opts in)

The default is "fill but Cancel — don't mutate" (SKILL.md Principle 4). Two questions come before
you drive a create form at all:

- **Do you only need the record as a PRECONDITION for another test case?** Then seed it over the
  API — `apiLogin` + `Seeder` in `utils/seed.js`, with a paired `remove` and `seeder.cleanup()` in
  `afterAll` (reference suite TC-006). It is faster, it does not consume one of the app's UI
  sessions, and it deletes what it created. This is also what stops a suite growing env keys that
  merely record which value happened to have rows that week.
- **Is the test case about the FORM itself** (create-success, duplicate-rejection, field
  validation)? Only then drive the UI, and only with the user's explicit go-ahead.

Either way: name every created record with `Seeder.mark()` (`AUTOTEST 20260826093012`) so a
leftover is identifiable, register it with the seeder so cleanup removes it, and warn the user that
**each run creates N records on that environment**. A create with no cleanup path and no go-ahead
is `markBlocked(id, expected, 'would mutate real data; needs explicit go-ahead')` — never a silent
mutation.

### The single biggest time-sink: a "generic 400" on submit usually means a MISSING field the FE doesn't flag
A fully client-valid form can still 400 at the backend because an **optional-looking field
was never populated**. Real case: on a "register new entity" form an empty **logo image** made the
create return `400 "Failed to register …"` / raw `"Bad Request Exception"` — the FE treated the
logo as optional, but the BE rejected the create without it. **Uploading the logo made the create
succeed on every portal.** So before concluding "the create endpoint is broken / not built":
- Fill EVERY field that has an input, even optional-looking ones (logo, etc.).
- For image/file fields wired to a **temporary-upload** endpoint (the field uploads first and the
  form submits the URL it returns), wait for that upload's RESPONSE before submitting — a fixed
  sleep is both flaky and rejected by `npm run lint`:
  ```js
  await actAndWait(page, () => page.locator('input[type="file"][accept*="image"]').setInputFiles(fx.png),
                   { url: /\/upload|\/temp-file/ });
  ```
  If you cannot name the endpoint, key on the UI signal the finished upload produces (the preview
  appearing): `await expect(dialog.locator('img[src^="http"]').first()).toBeVisible()`.
- File-input selectors differ per screen — a `data-testid` may exist on one form and not
  another. `input[type="file"][accept*="image"]` (logo) and `input[type="file"][accept*="pdf"]`
  (document) are robust cross-form fallbacks.

### Fixtures for upload-validation TCs — generate them at require time
"Wrong file type", "file too large", "malformed CSV" TCs need fixture files, and binaries do not
belong in git. Build them in the suite instead (write to `suites/<Feature>/fixtures/`, which is
where a reviewer expects them), so the whole class of validation test cases is writable rather than
`markBlocked` for want of a test file:

```js
function buildFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const w = (n, buf) => { const f = path.join(dir, n); fs.writeFileSync(f, buf); return f; };
  return {
    // A structurally valid minimal PDF: header + one empty page + a REAL xref table whose
    // byte offsets you compute as you build it. A "%PDF-1.4" string alone is rejected by any
    // validator that parses the file rather than sniffing the first five bytes.
    pdf:      w('valid.pdf', Buffer.from(buildMinimalPdf(), 'latin1')),
    // Valid magic signatures: sniffers look at the bytes, not the extension.
    png:      w('valid.png', Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex')),
    gif:      w('valid.gif', Buffer.from('GIF89a', 'latin1')),
    // Oversized: >2 MB of padding is enough to trip a size rule.
    tooBig:   w('too-big.pdf', Buffer.alloc(2200000, 0x20)),
    // Wrong type that still sniffs as a real office document: a zip header is enough.
    docx:     w('wrong-type.docx', Buffer.from('504B0304', 'hex')),
    csvOk:    w('rows-valid.csv', Buffer.from('name,phone\nA,0810000001\n')),
    csvBad:   w('rows-invalid.csv', Buffer.from('name,phone\n,\n')),
    csvMixed: w('rows-mixed.csv', Buffer.from('name,phone\nA,0810000001\n,\n')),
    csvCols:  w('wrong-columns.csv', Buffer.from('foo,bar\n1,2\n')),
  };
}
```

A zero-byte file with the right extension is NOT a valid fixture: many validators sniff the
content, so an empty `.pdf` fails for the wrong reason and the TC proves nothing.

### Assert create SUCCESS by the modal closing, not by a toast
On success the register modal closes (Create button gone) and the list refetches; on
rejection the modal stays open. So `await expect(page.getByRole('button',{name:/^create$/i})).toHaveCount(0)`
is a reliable success signal — and it auto-retries, so it IS the wait; nothing extra is needed.
For the "after" screenshot, key on the list refetch rather than the clock:
`await actAndWait(page, () => createBtn.click(), { url: LIST_API })`, then
`await evidence(page, 'TC-0xx_after', { variant: variant.id })`. Do **not** use
`waitForLoadState('networkidle')` here — dashboards hold long-polling connections, so it never
settles.

### Duplicate-rejection TCs: capture the ACTUAL alert, don't just assert a specific string
A typical FE maps a BE error containing `name`→"<Name> already used", a tax/ID token→
"<Tax ID> already used", else a generic message. But the BE is often inconsistent: in the real
case a duplicate **ID-only** returned the friendly "already used" message (PASS), while a duplicate
**name + ID** returned a raw `"Bad Request Exception"` (a genuine UX finding → the TC correctly
FAILED).
So: poll for the alert text (`.notistack-Snackbar, [role=alert], .MuiFormHelperText-root.Mui-error`)
with `until(...)`, put what was actually shown into `note()` so the report row carries it, and let a
genuine bad message FAIL loud — the assertion error is captured into the row automatically.

### Evidence screenshots for create/edit test cases — call `evidence()` twice
```js
await evidence(page, 'TC-007_form',  { variant: variant.id });   // filled in, before submit/cancel
await evidence(page, 'TC-007_after', { variant: variant.id });   // the result
```
Each call pushes one `tc.evidence` annotation; the reporter collects them into an array and
`utils/reporter.js` renders each as its own "View" link on the row — there is no array to assemble
by hand any more, and no `snap()` helper to write. `evidence()` is full-page by default (pass
`{ fullPage: false }` to opt out), but full-page alone is not enough: the context viewport must be
**tall** (`height: 2000`, applied only when `HEADLESS=1` — see the reference suite's `beforeAll`)
so a scrolling MUI dialog fits WITHOUT internal scroll. Otherwise the capture shows a form scrolled
to the bottom with the top fields cut off.

## 2. Multi-role / sub-portal login

Login URL and account differ per role — do NOT assume one portal:
- **Every account comes from `environments/<env>.env` through `accountForWorker`**
  (`utils/accounts.js`), one prefix per role:
  ```
  # used in: suites/<Feature>/test.js
  <prefix>_accounts=user1:pass1,user2:pass2               # the run account, one per worker
  <prefix>_noaccess_accounts=noaccess1:pass1,noaccess2:pass2   # the no-privilege role
  ```
  ```js
  const account = accountForWorker(P, variant.prefix);            // in beforeAll
  const other   = accountForWorker(P, 'example_noaccess');        // in the authorization test
  ```
  It keys on `TEST_PARALLEL_INDEX`, so worker 2 never logs in as worker 1's user. It falls back to
  `<prefix>_username`/`<prefix>_password` and then the top-level pair, so a suite can adopt pooling
  later without touching its call sites.
- **Admin portal**: `<host>/<portal>/login` → the admin area (`/<portal>/...`).
- **Tenant / sub-portal**: often a DIFFERENT URL such as `<host>/<portal>/<tenant-area>/login`.
  Logging a tenant user in at the admin login returns `400 email/password invalid`, because auth is
  tenant-scoped (`/{tenant}/authorization/...`). Never assume one login serves every role.
- **Role-variant accounts** for authorization test cases: a user WITHOUT a privilege (a member with
  no access to the module, or a user without the "Update" privilege). Menu-visibility /
  access-denied cases are automatable — log in as that account in its own context and assert the
  menu link is absent (`toHaveCount(0)`). Working version: reference suite **TC-009**. If the
  environment has no such account, that is `markBlocked(...)`, not MANUAL.

### Whatever logs in, VERIFY the session actually established
A login helper that swallows a failed sign-in (a `waitForURL(!/login)` with a `.catch`) returns
"OK" while still on the login page, and every later assertion then fails with a confusing selector
error. The single-shot check belongs in `beforeAll`, where the message is the truth — that is what
the reference suite does:

```js
await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
expect(page.url(), 'login did not establish a session').not.toMatch(/\/login/);
```

For extra contexts opened mid-suite, the same check with a retry + backoff:
```js
async function openAs(browser, loginUrl, targetUrl, email, password) {
  for (let i = 1; i <= 3; i++) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true, acceptDownloads: true });
    const page = await ctx.newPage();
    try {
      await login(page, { url: loginUrl, username: email, password, otp: '' }, {});
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (/\/login/.test(page.url())) throw new Error('login did not establish a session');
      return { context: ctx, page };
    } catch (e) { await ctx.close().catch(()=>{}); await new Promise(r=>setTimeout(r,3000)); }
  }
  throw new Error('login failed after retries');
}
```
- Use `waitUntil: 'domcontentloaded'` (NOT `networkidle`) for navigations — dashboards keep
  long-polling connections, so `networkidle` times out on the list page.
- **A second login for the same account is REJECTED while the app holds that user's session — the
  real fix is a POOL, not a longer sleep.** Many apps keep ONE ACTIVE SESSION PER USER (often a
  Redis key with a ~60s TTL) and refuse a second sign-in for that account, leaving the page on
  `/login` (sometimes with an "account is active on another device" message). With `workers: 4`
  and one shared account this is guaranteed, and the victim fails somewhere unrelated. Give every
  worker and every role its own account via `<prefix>_accounts` + `accountForWorker` and the whole
  class of failure disappears; `accountForWorker` warns when the pool is smaller than the worker
  count, which is precisely the situation that re-creates it.

  Seeding helps for the same reason: `apiLogin` authenticates over HTTP and does not consume a UI
  session, so setting up data never evicts the browser session the test is about to use.

  Back-off is only for the residual case — you genuinely have one account, or the environment is
  rate-limiting after dozens of logins. Retrying on a 3s gap burns all three attempts INSIDE the
  hold, `beforeAll` dies, and — because Playwright kills the worker on the first failure — the rest
  of that file never runs. Detect the signature and wait past it:
  ```js
  const sessionHeld = /still on \/login|did not establish a session|active .*(device|session)/i.test(e.message || '');
  await new Promise(r => setTimeout(r, sessionHeld ? 65000 : 3000));
  ```
  It self-clears in about a minute. Genuine rate-limiting after dozens of logins looks identical
  and is also cured by waiting — in neither case is it a test bug to "fix".

## 3. Multi-role tests that need their OWN contexts (not the describe's shared page)
A menu-authorization test case involves two accounts, and the second one cannot use the describe's
shared page. Take `browser` from the test's fixtures, build a throwaway context, and close it in a
`finally` so a failed assertion cannot leak it. `evidence()` takes the page as its first argument,
so a foreign page is screenshotted exactly like the shared one. Working version: **TC-009** in
`examples/_reference-suite/test.js`:
```js
test('TC-009 the menu is hidden from a user without access', async ({ browser }) => {
  tc('TC-009', 'A user without the privilege does not see the Example List menu');
  if (!P.example_noaccess_accounts && !P.example_noaccess_username) {
    markBlocked('TC-009', 'A user without the privilege does not see the menu',
      'no no-privilege account is provisioned on this environment.');
  }
  const other = accountForWorker(P, 'example_noaccess');
  // storageState: undefined — playwright.config.js sets use.storageState whenever
  // .auth/state.json exists, and a hand-built context inherits it (test-js-anatomy §8).
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: undefined });
  try {
    const p2 = await ctx.newPage();
    // ... log p2 in as `other`, verify the session established ...
    await expect(p2.getByRole('link', { name: /example list/i })).toHaveCount(0);
    await evidence(p2, 'TC-009_noaccess', { variant: variant.id });
  } finally {
    await ctx.close().catch(() => {});
  }
  await expect(page.getByRole('link', { name: /example list/i })).toHaveCount(1);
  await evidence(page, 'TC-009_admin', { variant: variant.id });
});
```
Assert **both halves** — the privileged user sees the menu AND the unprivileged one does not. A
test that only checks the absence passes just as well when the menu is broken for everyone.

### Concurrent multi-role sessions (maker / approver flows)
Several roles can be logged in **at the same time** — the constraint is per ACCOUNT, not per run.
Hold one long-lived context per role and hand state between them:
```js
const maker = await openAs(browser, LOGIN, HOME, MAKER_EMAIL, PASS);
const l1    = await openAs(browser, LOGIN, HOME, APPROVER1_EMAIL, PASS);
const l2    = await openAs(browser, LOGIN, HOME, APPROVER2_EMAIL, PASS);
let submittedRef = null;                 // maker writes it, the approvers read it
// ... maker submits -> submittedRef = ...; l1 approves it; l2 approves it ...
for (const r of [maker, l1, l2]) await r.context.close();
```
Rules: one context per account, each account from its own env prefix (never share cookies between
roles); pass identifiers, not locators, between roles; if a later role finds nothing to act on,
`markBlocked(...)` with the reason rather than passing vacuously; and close every context in the
same `afterAll`, even on failure. So a maker-checker test case is **not** Manual for needing a
second login — Manual is for things with no UI surface at all.

A flow that spans roles is one behaviour, so it is one `test()`, not one per role. Splitting it
across `test()`s would make each half depend on the previous one having run — and with
`retries: 2` in CI, a retry re-runs only the failed half.

## 4. Test-data lifecycle inside one run
More coverage is lost to data the suite itself consumed than to any selector. Five rules:

1. **Seed on demand instead of skipping.** If an earlier test case (or a `beforeAll` cleanup)
   drained the rows a later one needs, create it at that point with `Seeder.create(label, create,
   remove)` rather than marking it blocked — otherwise the run reports a "coverage gap" that is
   really an ordering artefact of the suite's own doing. `seeder.cleanup()` in `afterAll` removes
   everything LIFO, best-effort, and names whatever it could not delete on stdout.
2. **Reserve a SPARE fixture for states the suite destroys.** Keep the primary fixture untouched by
   the destructive test cases so the rest of the suite still has a clean starting record.
3. **Discover the row in the required state at RUNTIME; do not pin an identifier.** One identifier
   can own several rows over time (ACTIVE last week, removed today), and a suite pinned to it fails
   for a data reason that looks like a defect. Search the table for a row in the state you need.
4. **Make destructive TCs idempotent.** Clean up (or cancel) what you created so a second run starts
   from the same place; a suite that only passes on a fresh database is not re-runnable.
5. **A sentinel fixture value must THROW, never widen a locator.** `"-"` usually means UNAVAILABLE
   and also appears in almost every row — building `rowWith("-")` from it silently matches EVERY
   row, so the TC asserts against whatever row is first and passes. Validate the value before you
   put it in a locator.

## 5. System-error / timeout test cases are automatable via route interception
"On a service timeout the save fails with 'Please try again'" needs no real backend fault —
intercept the API, force the error, assert the FE message, and **unroute in a `finally`** so the
mock cannot leak into the next test case sharing this page (reference suite TC-008):
```js
await page.route(/\/api\/v1\/<resource>/, r => r.fulfill({ status: 500, body: '{}' }));
try {
  // ... navigate and assert the error message ...
} finally {
  await page.unroute(/\/api\/v1\/<resource>/);
}
```
Reserve MANUAL only for things with NO UI surface (email delivery, audit trail) or for a
row-for-row comparison of an exported file's contents — the downloaded file's own filename, size
and magic bytes are automatable (reference suite TC-012).
