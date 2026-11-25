/**
 * API-based test-data seeding.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tests that depend on "whatever happens to be in the environment" are not tests,
 * they are observations. The symptom is unmistakable: this framework's predecessor
 * accumulated environment keys like `<x>_txn_type_with_rows` and
 * `<x>_status_with_rows` — configuration whose only job was to record which values
 * happened to have rows on that environment that week. Every one of them is a
 * test that will silently stop covering anything when the data changes, plus a
 * long tail of SKIPs for "no row with this status exists here".
 *
 * Seeding through the API inverts that: the test states the precondition it needs,
 * creates it, and removes it afterwards. It then asserts the same thing on every
 * environment, every run.
 *
 * WHEN NOT TO USE IT
 * ------------------
 * - No API for the entity (some records only exist through a multi-step UI flow).
 * - The environment forbids writes, or the record is financial and cannot be
 *   removed cleanly. Those stay SKIP with a reason — that is what SKIP is for.
 *
 * ADAPT: the login shape below (path, payload keys, where the token lives in the
 * response) differs per backend. Confirm it against the real API once, then this
 * file needs no further changes.
 */

const { request: playwrightRequest } = require('@playwright/test');

function pluck(obj, dottedPath) {
  return String(dottedPath).split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/**
 * Log in over HTTP and return an APIRequestContext that carries the token.
 *
 * Much faster and far more reliable than driving the login form, and it does not
 * consume one of the app's UI sessions — so seeding never evicts the browser
 * session the test is about to use (see utils/accounts.js).
 *
 * @param {{baseURL: string, username: string, password: string,
 *          loginPath?: string, userField?: string, passField?: string,
 *          tokenPath?: string, scheme?: string}} opts
 */
async function apiLogin(opts) {
  const {
    baseURL,
    username,
    password,
    loginPath = '/api/v1/auth/login',   // ADAPT
    userField = 'username',             // ADAPT
    passField = 'password',             // ADAPT
    tokenPath = 'data.accessToken',     // ADAPT
    scheme = 'Bearer',
  } = opts;

  const anon = await playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1' });
  const res = await anon.post(loginPath, { data: { [userField]: username, [passField]: password } });
  if (!res.ok()) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    await anon.dispose();
    throw new Error(`API login failed: ${res.status()} ${res.statusText()} at ${loginPath}. Body: ${body}`);
  }
  const json = await res.json();
  const token = pluck(json, tokenPath);
  await anon.dispose();

  if (!token) {
    throw new Error(
      `API login succeeded but no token at "${tokenPath}". ` +
      `Response keys: ${Object.keys(json || {}).join(', ')}. Adjust tokenPath in utils/seed.js.`
    );
  }

  return playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
    extraHTTPHeaders: { Authorization: `${scheme} ${token}` },
  });
}

/**
 * Tracks what a run created so it can be removed afterwards.
 *
 * Cleanup runs LIFO (children before parents) and is best-effort: one failing
 * delete must not hide the others or fail the suite. What it cannot remove it
 * reports loudly, because silent leftovers are how a dev environment fills with
 * AUTOTEST records nobody dares delete.
 */
class Seeder {
  constructor(api) {
    this.api = api;
    this.created = [];
  }

  /**
   * @param {string} label     human name for the report/log, e.g. 'employee'
   * @param {(api) => Promise<any>} create   returns the created record
   * @param {(api, record) => Promise<any>} remove
   */
  async create(label, create, remove) {
    const record = await create(this.api);
    this.created.push({ label, record, remove });
    return record;
  }

  /** Name every created record so it is identifiable if cleanup ever fails. */
  static mark(prefix = 'AUTOTEST') {
    return `${prefix} ${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  }

  async cleanup() {
    const leaked = [];
    for (const item of [...this.created].reverse()) {
      if (!item.remove) { leaked.push(item.label); continue; }
      try {
        await item.remove(this.api, item.record);
      } catch (err) {
        leaked.push(`${item.label} (${err.message})`);
      }
    }
    this.created = [];
    if (leaked.length) {
      console.warn(`[seed] ${leaked.length} record(s) left behind — delete them manually: ${leaked.join(', ')}`);
    }
    if (this.api) await this.api.dispose().catch(() => {});
  }
}

module.exports = { apiLogin, Seeder };
