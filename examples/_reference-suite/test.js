/**
 * Test Suite  : Example List Page          ← REFERENCE IMPLEMENTATION, NOT A REAL SUITE
 * Module      : Web Dashboard — page "Example List"
 * Source TC   : <TestCases>.xlsx (group by whatever column identifies the page;
 *               not every workbook has "Page/Feature" — confirm with the user)
 *
 * SELECTORS   : UNVERIFIED — everything in the `SEL` block is a guess until
 *               SKILL.md Step 4 (the live probe) has run. Keep this banner until
 *               the selectors were confirmed against a real DOM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS THE PROJECT'S CANONICAL SUITE. Copy it to suites/<Feature>/test.js
 * and adapt it. Every convention is demonstrated exactly once, with a "WHY:".
 * The rule behind each part: references/test-js-anatomy.md.
 *
 * It is excluded from playwright.config.js `testMatch` and self-skips without
 * `example_*` env keys, so it never runs.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONE TEST CASE = ONE `test()`. This is not a style choice.
 * The previous shape put every test case inside one big `test()` and caught their
 * assertion errors so the next one could run — so Playwright saw a single passing
 * test however many test cases had failed, and the process exited 0. A fully red
 * suite reported success. Here failures are Playwright's own, which is what makes
 * the exit code, per-test retries, and traces work.
 *
 * Report statuses come from utils/tc.js annotations and are rendered by
 * reporters/excel-html-reporter.js into the same client-facing test_report.html:
 *   PASSED / FAILED  – Playwright's verdict
 *   SKIPPED          – not applicable to this variant
 *   SKIP             – blocked, with a reason (never delete a test case)
 *   MANUAL           – no UI surface at all
 *   COMBINE          – one row covering several workbook rows
 *
 * Run one test case by title — no custom FOCUS machinery needed:
 *   npx playwright test "suites/<Feature>/test.js" -g "TC-004"
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const { readProfile, getEnvProfilePath, getSelectedEnv } = require('../../utils/profile');
const { accountForWorker } = require('../../utils/accounts');
// utils/waits.js also exports countSettled and countChangedFrom — the DOM-signal
// fallbacks for a list with no request to key off. They are not imported here
// because every wait in this suite has a real request (LIST_API); see TC-011 for
// when to reach for them, and never import a helper you do not call.
const { actAndWait, until } = require('../../utils/waits');
const { tc, note, evidence, markManual, markBlocked, markNotApplicable } = require('../../utils/tc');
const { apiLogin, Seeder } = require('../../utils/seed');

// WHY: getSelectedEnv() reads ENV and falls back to .selected-env.json, which
// global-setup wrote — workers are separate processes and never see its prompt.
// The try/catch is only so this reference file survives a repo with no profile;
// a REAL suite calls readProfile() directly and lets it throw.
let profile = null;
try { profile = readProfile(getEnvProfilePath(getSelectedEnv() || 'dev')); } catch (_) { profile = null; }
const ENABLED = Boolean(profile && profile.example_base_url);
const P = profile || {};

const ADMIN_BASE  = (P.example_base_url || '').replace(/\/login\/?$/, '').replace(/\/$/, '');
const TENANT_BASE = (P.example_tenant_url || '').replace(/\/$/, '');
const PAGE_PATH   = '/example-list/';
const LIST_API    = /\/api\/v1\/example-list/;   // ADAPT: the request the list page fires

// ─────────── SEL — every component-library selector in ONE place ─────────────
// WHY: these are one library's vocabulary (MUI here), not a universal truth.
// One block to correct after the live probe beats 15 inlined class substrings.
const SEL = {
  option:     'li[role="option"]',
  chip:       '[class*="MuiChip"]',
  pagination: '[class*="MuiPagination-root"]',
  nextPage:   'button[aria-label="Go to next page"]',
  // .last(): a confirm dialog stacked over a form makes .first() resolve to the
  // layer underneath, which IS visible — so the failure reads like a bad selector.
  dialog:     '[role="dialog"]',
};

const ALL_COLUMNS = ['Owner', 'Reference No', 'Name', 'Amount', 'Status', 'Created Date', 'Action'];

// WHY no filterVariantsByCountry() here: this suite's variant axis is the PORTAL,
// not a country, and `filterVariantsByCountry` matches on a `country` field or an
// `_id`/`_ph` id suffix — wrapping this array would make `npm run test:*:id|ph`
// select zero variants and run zero tests. If your variants ARE countries, import
// `filterVariantsByCountry` from utils/profile and wrap the array:
//   const VARIANTS = filterVariantsByCountry([{ id: 'admin_id', country: 'id', ... }]);
// otherwise leave the field off and do not set COUNTRY (test-js-anatomy.md §4).
const VARIANTS = [
  {
    id: 'admin', name: 'Admin Portal', prefix: 'example',
    loginUrl: `${ADMIN_BASE}/login/`, appBase: ADMIN_BASE,
    hasOwnerFilter: true, expectedColumns: ALL_COLUMNS,
  },
  {
    id: 'tenant', name: 'Tenant Portal', prefix: 'example_tenant',
    loginUrl: `${TENANT_BASE}/${P.example_tenant_prefix}/login/`,
    appBase: `${TENANT_BASE}/${P.example_tenant_prefix}`,
    // The column stays; only the FILTER is absent. Verify this live per page —
    // portals differ in ways no one can predict from the spec.
    hasOwnerFilter: false, expectedColumns: ALL_COLUMNS,
  },
];

for (const variant of VARIANTS) {
  test.describe(`Example List — ${variant.name}`, () => {
    test.skip(!ENABLED, 'Reference suite: environments/<env>.env has no example_* keys. This file is documentation.');

    // WHY: one context for the whole variant. Test cases share a logged-in page,
    // which is why playwright.config.js keeps fullyParallel:false — parallelism is
    // across FILES. Re-logging in per test case would be slow and, on apps that
    // allow one session per user, would evict the session it just created.
    let context;
    let page;
    let seeder;

    test.beforeAll(async ({ browser }) => {
      // WHY: each worker takes its own account from the pool, so worker 2's login
      // cannot invalidate worker 1's session. See utils/accounts.js.
      const account = accountForWorker(P, variant.prefix);

      context = await browser.newContext({
        viewport: process.env.HEADLESS === '1' ? { width: 1440, height: 2000 } : null,
        ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
        acceptDownloads: true,
      });
      page = await context.newPage();

      await page.goto(variant.loginUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="username"]').fill(account.user);
      await page.locator('input[type="password"]').fill(account.pass);
      await page.getByRole('button', { name: 'Login', exact: false }).first().click();
      await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
      // WHY: a login helper that swallows a failed sign-in returns "OK" while still
      // on the login page, and every later assertion then fails with a confusing
      // selector error. Fail here instead, where the message is the truth.
      expect(page.url(), 'login did not establish a session').not.toMatch(/\/login/);
    });

    test.afterAll(async () => {
      // WHY: cleanup first — a leaked seeded record outlives the browser.
      if (seeder) await seeder.cleanup();
      await page?.close().catch(() => {});
      await context?.close().catch(() => {});
      // NOTE: no report writing here. reporters/excel-html-reporter.js runs in the
      // main process and receives every worker's results, so the old sidecar
      // .<variant>_results.json merge is gone.
    });

    // ── helpers scoped to this page's markup ─────────────────────────────────
    const gotoList = () => page.goto(variant.appBase + PAGE_PATH, { waitUntil: 'domcontentloaded' });
    const rows = () => page.locator('table tbody tr');

    const columnHeaders = () => page.evaluate(() =>
      [...document.querySelectorAll('th,[role="columnheader"]')].map(e => (e.innerText || '').trim()).filter(Boolean));

    // WHY: find the column by header regex, never by a fixed index — column order
    // changes between portals and releases, an index does not survive it.
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

    // WHY: parseFloat("120.000,00") returns 120, and comparisons against NaN fail
    // open — a broken computed-field assertion then looks like a passing one.
    const parseMoney = s => parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));

    // ═══════════════════ NAVIGATION — the plain shape ════════════════════════
    test('TC-001 opens the Example List page', async () => {
      tc('TC-001', 'The Example List page loads and its header is visible');
      await gotoList();
      await expect(page.getByRole('heading', { name: 'Example List', exact: false })).toBeVisible();
      expect(page.url()).toContain('example-list');
      await evidence(page, 'TC-001', { variant: variant.id });
    });

    // ═══════════════════ SPEC DRIFT — assert the documented subset ═══════════
    test('TC-002 shows the documented columns', async () => {
      tc('TC-002', `Table shows: ${variant.expectedColumns.join(', ')}`);
      await gotoList();
      const headers = await columnHeaders();
      // WHY: the workbook is usually older than the app. Assert the documented
      // columns are PRESENT; never assert an exact count, and never fail because
      // the app grew a column the document does not know about — record the drift.
      const missing = variant.expectedColumns.filter(c => !headers.some(h => h.toLowerCase().includes(c.toLowerCase())));
      expect(missing, `columns missing from the live page: ${JSON.stringify(missing)}`).toHaveLength(0);
      const extra = headers.filter(h => !variant.expectedColumns.some(c => h.toLowerCase().includes(c.toLowerCase())));
      if (extra.length) note(`drift: the live page also has ${JSON.stringify(extra)}, not in the TC document`);
      await evidence(page, 'TC-002', { variant: variant.id });
    });

    // ═══════════════════ SKIPPED — absent on this variant ════════════════════
    test('TC-003 filters the list by Owner', async () => {
      // WHY: a control that does not exist here is not a failure and not a deletion.
      if (!variant.hasOwnerFilter) {
        markNotApplicable('TC-003', 'Selecting an Owner filters the list',
          'The Owner filter does not exist on the Tenant Portal.');
      }
      tc('TC-003', 'Selecting an Owner filters the list');
      await gotoList();
      const owner = page.getByPlaceholder('select owner name');
      await expect(owner).toBeVisible();
      await owner.click();
      // WHY: MUI autocomplete does not close on select and then eats the next
      // click. Escape first, always.
      await actAndWait(page, async () => {
        await page.locator(SEL.option).nth(1).click();
        await page.keyboard.press('Escape');
      }, { url: LIST_API });
      await expect(page.locator(SEL.chip).first()).toBeVisible();
      await evidence(page, 'TC-003', { variant: variant.id });
    });

    // ═══════════════════ THE ONE TO INTERNALISE: assert RESULTS ══════════════
    test('TC-004 Reference No filter narrows the list to matching rows', async () => {
      tc('TC-004', 'Only rows whose Reference No contains the term remain');
      await gotoList();

      // WHY: seed the term from REAL data. A hardcoded term returns zero rows on
      // another environment and the test then passes having verified nothing.
      const before = await columnValues(/Reference No/);
      const seed = before.find(v => v.trim().length >= 4) || '';
      expect(seed, 'no rows to seed the filter from — the filter was never exercised').not.toBe('');
      const term = seed.trim().slice(0, 4);

      const input = page.getByPlaceholder('type reference no');
      await input.fill(term);
      // WHY: wait for the fetch the UI is waiting for, not for a guessed duration.
      // This is both the flake fix and the speed fix — see utils/waits.js.
      await actAndWait(page, () => input.press('Enter'), { url: LIST_API });

      const after = await columnValues(/Reference No/);
      expect(after.length, `filter "${term}" returned no rows`).toBeGreaterThan(0);
      // WHY: THIS is the assertion that matters. A chip appearing proves the UI
      // registered the input; it does NOT prove the table was filtered. Reading
      // every row back is how a real "chip shows, nothing filters" defect is caught.
      const nonMatching = after.filter(v => !v.toLowerCase().includes(term.toLowerCase()));
      expect(nonMatching.length,
        `chip applied but ${nonMatching.length}/${after.length} rows do NOT contain "${term}" → the table was NOT filtered: ${JSON.stringify(nonMatching)}`
      ).toBe(0);

      note(`term="${term}", ${after.length} rows all match`);
      await evidence(page, 'TC-004', { variant: variant.id });
    });

    // ═══════════════════ DATA-INDEPENDENT ARITHMETIC ═════════════════════════
    test('TC-005 every Amount renders as a valid number', async () => {
      tc('TC-005', 'Every Amount parses as a non-negative number');
      await gotoList();
      const parsed = (await columnValues(/Amount/)).map(parseMoney).filter(n => !Number.isNaN(n));
      expect(parsed.length, 'no parseable Amount values on the page').toBeGreaterThan(0);
      const negative = parsed.filter(n => n < 0);
      expect(negative, `negative amounts rendered: ${JSON.stringify(negative)}`).toHaveLength(0);
      note(`${parsed.length} rows checked`);
    });

    // ═══════════════════ SEEDED PRECONDITION — deterministic data ════════════
    test('TC-006 a record with status Pending appears in the list', async () => {
      tc('TC-006', 'A Pending record is listed with the Pending status');
      // WHY: without seeding this test case becomes "SKIP: no Pending row on this
      // environment", or worse, an env key recording which status happened to have
      // rows. Create the precondition, assert it, remove it. See utils/seed.js.
      if (!P.example_api_url) {
        markBlocked('TC-006', 'A Pending record is listed with the Pending status',
          'example_api_url is not configured, so the precondition cannot be seeded.');
      }
      seeder = seeder || new Seeder(await apiLogin({
        baseURL: P.example_api_url,
        username: P.example_api_user,
        password: P.example_api_password,
      }));
      const marker = Seeder.mark();
      await seeder.create('example-record',
        api => api.post('/api/v1/example', { data: { name: marker, status: 'PENDING' } })
                  .then(r => r.json()),
        (api, rec) => api.delete(`/api/v1/example/${rec.id}`));

      await gotoList();
      const input = page.getByPlaceholder('type reference no');
      await input.fill(marker);
      await actAndWait(page, () => input.press('Enter'), { url: LIST_API });
      await until(() => columnValues(/Name/), v => v.some(n => n.includes(marker)),
        `the seeded record "${marker}" to appear in the list`);
      note(`seeded and found "${marker}"`);
      await evidence(page, 'TC-006', { variant: variant.id });
    });

    // ═══════════════════ MUTATION — fill, then CANCEL ════════════════════════
    test('TC-007 the Add New form accepts input and Cancel discards it', async () => {
      tc('TC-007', 'Add New accepts input; Cancel closes the form without creating a record');
      await gotoList();
      const countBefore = await rows().count();

      await page.getByRole('button', { name: /add new/i }).click();
      const dialog = page.locator(SEL.dialog).last();
      await expect(dialog).toBeVisible();
      await dialog.getByPlaceholder('type name').fill(`AUTOTEST ${Date.now()}`);
      // WHY: two shots — "it was filled" is not provable from one image.
      await evidence(page, 'TC-007_form', { variant: variant.id });

      // WHY: default policy is DO NOT mutate real data — fill, then Cancel.
      // Creating records needs the user's explicit go-ahead; a create that is
      // automatable but blocked by this policy is SKIP, not MANUAL.
      await dialog.getByRole('button', { name: /^cancel$/i }).click();
      await expect(dialog).toBeHidden();
      // WHY: assert the no-op too. Without this the test proves only that a dialog
      // closed, not that nothing was created.
      expect(await rows().count(), 'Cancel must not change the list').toBe(countBefore);
      await evidence(page, 'TC-007_after', { variant: variant.id });
    });

    // ═══════════════════ SYSTEM ERROR — route interception ═══════════════════
    test('TC-008 a failing list API surfaces an error to the user', async () => {
      tc('TC-008', 'When the list service errors, the page shows a retry message');
      // WHY: no real backend fault needed. This is why "system error" test cases
      // are NOT manual.
      await page.route(LIST_API, r => r.fulfill({ status: 500, body: '{}' }));
      try {
        await gotoList();
        await expect(page.getByText(/try again|something went wrong|failed to load/i).first()).toBeVisible();
        await evidence(page, 'TC-008', { variant: variant.id });
      } finally {
        await page.unroute(LIST_API);
      }
    });

    // ═══════════════════ MULTI-ROLE — its own contexts ═══════════════════════
    test('TC-009 the menu is hidden from a user without access', async ({ browser }) => {
      tc('TC-009', 'A user without the privilege does not see the Example List menu');
      if (!P.example_noaccess_accounts && !P.example_noaccess_username) {
        markBlocked('TC-009', 'A user without the privilege does not see the menu',
          'no no-privilege account is provisioned on this environment.');
      }
      // WHY: a second account cannot use the describe's shared page. Build a
      // throwaway context, and close it in a finally so a failure cannot leak it.
      // WHY `storageState: undefined`: playwright.config.js sets `use.storageState`
      // whenever .auth/state.json exists, and a hand-built context INHERITS it — so
      // without this the "no privilege" page opens already signed in as
      // global-setup's privileged account and toHaveCount(0) asserts nothing.
      const other = accountForWorker(P, 'example_noaccess');
      const ctx = await browser.newContext({ ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1', storageState: undefined });
      try {
        const p2 = await ctx.newPage();
        await p2.goto(variant.loginUrl, { waitUntil: 'domcontentloaded' });
        await p2.locator('input[name="username"]').fill(other.user);
        await p2.locator('input[type="password"]').fill(other.pass);
        await p2.getByRole('button', { name: 'Login', exact: false }).first().click();
        await p2.waitForURL(u => !u.toString().includes('/login'), { timeout: 20000 }).catch(() => {});
        await expect(p2.getByRole('link', { name: /example list/i })).toHaveCount(0);
        await evidence(p2, 'TC-009_noaccess', { variant: variant.id });
      } finally {
        await ctx.close().catch(() => {});
      }
      await expect(page.getByRole('link', { name: /example list/i })).toHaveCount(1);
      await evidence(page, 'TC-009_admin', { variant: variant.id });
    });

    // ═══════════════════ COLOUR — automatable, never MANUAL ══════════════════
    test('TC-010 a Success status is rendered in green', async () => {
      tc('TC-010', 'A Success status is colour-coded green');
      await gotoList();
      const statuses = await columnValues(/Status/);
      const i = statuses.findIndex(v => /success|active/i.test(v));
      if (i < 0) {
        markBlocked('TC-010', 'A Success status is colour-coded green',
          'no row with a Success/Active status on this environment — seed one to enable this.');
      }
      // WHY: "colour-coded" looks manual but is not — read the computed style.
      // Assert the channel DOMINATES rather than an exact hex, so a theme tweak
      // does not break a test that is really about "is it green".
      const rgb = await page.evaluate((row) => {
        const headers = [...document.querySelectorAll('th,[role="columnheader"]')].map(e => (e.innerText || '').trim());
        const col = headers.findIndex(h => /Status/.test(h));
        const cell = document.querySelectorAll('table tbody tr')[row]?.querySelectorAll('td,[role="cell"]')[col];
        const el = cell?.querySelector('span,div') || cell;
        return el ? getComputedStyle(el).color : null;
      }, i);
      expect(rgb, 'could not read the status cell colour').not.toBeNull();
      const [r, g, b] = (rgb.match(/\d+/g) || []).map(Number);
      expect(g > 120 && g > r + 40 && g > b + 40, `expected green, computed colour was ${rgb}`).toBeTruthy();
      note(`computed colour ${rgb}`);
    });

    // ═══════════════════ PAGINATION — arithmetic, not data ═══════════════════
    test('TC-011 pagination splits results across pages', async () => {
      tc('TC-011', 'Page 2 shows a different, non-empty set of rows');
      await gotoList();
      if (await page.locator(SEL.pagination).count() === 0) {
        markNotApplicable('TC-011', 'Pagination splits results across pages',
          'Not enough rows on this environment to paginate.');
      }
      const firstRow = (await columnValues(/Reference No/))[0];
      const pageOne = await rows().count();
      await actAndWait(page, () => page.locator(SEL.nextPage).click(), { url: LIST_API });
      // WHY actAndWait and not countChangedFrom(rows(), pageOne): page 2 of a full
      // list legitimately has the SAME row count as page 1, so "wait until the count
      // moves" would time out on the healthy case. Reach for the DOM-signal waits
      // only when there is no request to key off:
      //   countChangedFrom(locator, before) — the action must change the row count
      //   countSettled(locator)             — a list that renders progressively
      // Both beat a fixed sleep; neither is a substitute for a request that exists.
      const pageTwo = await rows().count();
      expect(pageTwo, 'page 2 returned no rows').toBeGreaterThan(0);
      // WHY: holds regardless of how many records the environment has.
      expect(pageTwo, `page 2 (${pageTwo}) has more rows than page 1 (${pageOne})`).toBeLessThanOrEqual(pageOne);
      expect((await columnValues(/Reference No/))[0], 'page 2 shows the same first row as page 1').not.toBe(firstRow);
      note(`page1=${pageOne} page2=${pageTwo}`);
    });

    // ═══════════════════ DOWNLOAD — also not MANUAL ══════════════════════════
    test('TC-012 the export downloads a non-empty XLSX', async () => {
      tc('TC-012', 'Export produces a downloadable XLSX file');
      await gotoList();
      // WHY: a download's own integrity IS automatable — filename, size, and the
      // magic bytes that prove it is really an XLSX and not an HTML error page.
      // Only a row-for-row comparison of its CONTENTS is manual (TC-013).
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /export/i }).click(),
      ]);
      const file = await download.path();
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
      const fs = require('fs');
      const buf = fs.readFileSync(file);
      expect(buf.length, 'the downloaded file is empty').toBeGreaterThan(1024);
      // XLSX is a zip: it must start with "PK".
      expect(buf.slice(0, 2).toString(), 'not a zip/xlsx — the server likely returned an error page').toBe('PK');
      note(`${download.suggestedFilename()}, ${buf.length} bytes`);
    });

    // ═══════════════════ MANUAL — genuinely no UI surface ════════════════════
    test('TC-013 the exported rows equal the filtered table rows', async () => {
      // WHY: note how narrow MANUAL is. Colour (TC-010), service errors (TC-008),
      // access control (TC-009) and download integrity (TC-012) are all automated
      // above. What remains is comparing the file's parsed contents to the table.
      markManual('TC-013', 'Exported rows match the filtered table row for row',
        'requires parsing the workbook and diffing it against the UI — no UI surface for this');
    });

    // ═══════════════════ BLOCKED — kept, with a reason ═══════════════════════
    test('TC-014 the Purpose field rejects an empty value', async () => {
      markBlocked('TC-014', 'Submitting with an empty Purpose shows a validation error',
        'M1: the Purpose field is not implemented in the FE — raised with BA.');
    });
  });
}
