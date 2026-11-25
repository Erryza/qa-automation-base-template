/**
 * Deterministic waits — the replacement for `page.waitForTimeout()`.
 *
 * WHY THIS EXISTS
 * ---------------
 * A survey of this framework's predecessor found 936 fixed sleeps across 15,826
 * lines — one every 16 lines, averaging 910ms, totalling 14.2 minutes of pure
 * waiting per full run. A fixed sleep is wrong in both directions: too short and
 * the test fails on a slow day, too long and every run pays for the worst case.
 * It is simultaneously the biggest source of flakiness and of wasted wall-clock.
 *
 * Every wait below keys off a real signal — the response the UI is waiting for,
 * or the DOM actually changing — so it returns as soon as the app is ready and
 * fails fast with a useful message when it never becomes ready.
 *
 * `waitForTimeout` is rejected by `npm run lint` — scripts/check-conventions.js,
 * rule `no-fixed-sleep`. There is no eslint in this repo; that checker is
 * dependency-free on purpose. The rare genuine exception is an animation with no
 * observable completion signal: append `// lint-ok: <reason>` to that line.
 *
 *     await page.waitForTimeout(500); // lint-ok: CSS transition has no completion event
 */

const { expect } = require('@playwright/test');
const { getTimeoutScale } = require('./profile');

/**
 * Perform an action and wait for the network call it triggers.
 *
 * The classic case: typing a filter term and pressing Enter. The list only holds
 * the new rows once its fetch resolves — so wait for the fetch, not for a guess.
 *
 *   await actAndWait(page, () => input.press('Enter'), { url: /\/api\/v1\/list/ });
 *
 * The listener is armed BEFORE the action (Promise.all), otherwise a fast response
 * lands before the wait starts and the test hangs until timeout.
 *
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<any>} action
 * @param {{url: RegExp|string, status?: number, timeout?: number}} opts
 */
async function actAndWait(page, action, opts) {
  const { url, status = 200, timeout = 20000 * getTimeoutScale() } = opts;
  const matches = (r) => {
    const u = r.url();
    const hit = url instanceof RegExp ? url.test(u) : u.includes(url);
    return hit && (status === null || r.status() === status);
  };
  const [response] = await Promise.all([
    page.waitForResponse(matches, { timeout }),
    action(),
  ]);
  return response;
}

/**
 * Wait until a locator's count stops changing — for lists that render
 * progressively and expose no single "done" signal.
 *
 * Prefer actAndWait() when the feature has an API call to key off; this is the
 * fallback, and it is still strictly better than a fixed sleep because it returns
 * as soon as the DOM is stable instead of always paying the worst case.
 */
async function countSettled(locator, opts = {}) {
  const { timeout = 15000 * getTimeoutScale(), stableForMs = 400 } = opts;
  let last = -1;
  let stableSince = 0;
  await expect
    .poll(async () => {
      const n = await locator.count();
      const now = Date.now();
      if (n !== last) { last = n; stableSince = now; return -1; }
      return now - stableSince >= stableForMs ? n : -1;
    }, { timeout, message: 'the row count never stopped changing' })
    .not.toBe(-1);
  return last;
}

/**
 * Wait until a locator's count differs from a known previous value.
 *
 * Use it to prove an action had an effect — expanding rows, applying a filter that
 * removes rows, paging. Asserting the delta is what separates "the control
 * responded" from "the table actually changed".
 */
async function countChangedFrom(locator, before, opts = {}) {
  const { timeout = 15000 * getTimeoutScale() } = opts;
  await expect
    .poll(() => locator.count(), {
      timeout,
      message: `the row count never moved away from ${before} — the action had no effect`,
    })
    .not.toBe(before);
  return locator.count();
}

/**
 * Wait for a value read from the page to satisfy a predicate.
 *
 * The general-purpose escape hatch: any "keep looking until it is true" wait,
 * with a message that says what was being waited for.
 *
 *   await until(() => columnValues(/Status/), v => v.every(s => /Active/.test(s)),
 *               'every Status cell to read Active');
 */
async function until(read, predicate, what, opts = {}) {
  const { timeout = 15000 * getTimeoutScale() } = opts;
  await expect
    .poll(async () => (predicate(await read()) ? 'ok' : 'pending'), {
      timeout,
      message: `timed out waiting for ${what}`,
    })
    .toBe('ok');
}

/**
 * Navigate, retrying with a long wait in between when the failure looks like a down/unstable
 * backend (a connection-level error) rather than a real bug — SIT/UAT in particular have been
 * observed to go through multi-minute windows of "net::ERR_TOO_MANY_RETRIES" / "Internal Server
 * Error" and then recover on their own (confirmed live 2026-10-13: a run hit a cluster of these on
 * consecutive TCs, and the SAME flow worked fine moments later once the service recovered).
 *
 * This is the one place in this project where waiting WITHOUT a polled signal is correct instead
 * of a `// lint-ok` exception: there is no cheaper way to ask "has the backend recovered?" than
 * literally retrying the navigation — polling some other endpoint would just be a second guess at
 * the same question. A short, fixed-interval retry (as Playwright's own --retries does) would just
 * re-hit the same outage; the wait is sized to actually outlast one, not to dodge a UI timing race.
 *
 *   await gotoResilient(page, `${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 * @param {object} [options] - forwarded to page.goto()
 * @param {{retries?: number, waitMs?: number}} [retryOpts] - retries: extra attempts after the
 *   first (default 2, so 3 attempts total); waitMs: delay between attempts (default 150000 = 2.5m).
 */
async function gotoResilient(page, url, options = {}, retryOpts = {}) {
  const { retries = 2, waitMs = 150000 } = retryOpts;
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, options);
      return;
    } catch (err) {
      const message = String(err && err.message || '');
      // Confirmed live on a SIT environment (two separate runs):
      // a flaky backend can also surface as Playwright's own "interrupted by another navigation to
      // chrome-error://chromewebdata" instead of a network ERR_* code — Chrome's own error
      // interstitial racing the real navigation. Same transient-backend symptom, different message
      // shape, so it needs its own branch in this regex.
      const transient = /ERR_TOO_MANY_RETRIES|ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_SOCKET|chrome-error:\/\/chromewebdata/i.test(message);
      if (!transient || attempt >= retries) throw err;
      console.log(`[goto-retry] ${url} failed (attempt ${attempt + 1}/${retries + 1}): ${message.split('\n')[0]} — waiting ${Math.round(waitMs / 1000)}s for the service to recover before retrying`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

module.exports = { actAndWait, countSettled, countChangedFrom, until, gotoResilient };
