/**
 * Per-worker test accounts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Many dashboards allow one active session per user: signing in again invalidates
 * the previous session. With a single shared account that makes parallelism
 * impossible — worker 2's login silently kills worker 1's session, and worker 1
 * then fails somewhere unrelated with a selector error that looks like a bug in
 * the test. In this framework's predecessor that was documented as "the most
 * common cause of a suite dying in beforeAll".
 *
 * Give each worker its own account and the constraint disappears. Playwright sets
 * TEST_PARALLEL_INDEX (0..workers-1) in every worker process, which is a stable
 * key for exactly this.
 *
 * ENV FORMAT — a comma-separated pool under a per-suite prefix:
 *
 *   # used in: suites/<Feature>/test.js
 *   tl_accounts=qa.auto1@example.com:Passw0rd1,qa.auto2@example.com:Passw0rd2
 *
 * Fewer accounts than workers is allowed (the pool wraps) but is a real risk: two
 * workers then share a login and can evict each other. accountForWorker() warns
 * once when that happens rather than failing, because a two-account pool running
 * four workers is still useful when the suites do not overlap in time.
 */

const WARNED = new Set();

function parsePool(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const idx = entry.indexOf(':');
      if (idx <= 0 || idx === entry.length - 1) {
        throw new Error(
          `Account pool entry #${i + 1} is malformed: "${entry}". ` +
          `Expected "username:password" (the first colon separates them, so a password may contain colons).`
        );
      }
      return { user: entry.slice(0, idx), pass: entry.slice(idx + 1) };
    });
}

/** 0-based index of the worker process, or 0 when running single-threaded. */
function workerIndex() {
  const raw = process.env.TEST_PARALLEL_INDEX;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Pick this worker's account for a suite.
 *
 * Falls back to `<prefix>_username` / `<prefix>_password`, and then to the
 * profile's top-level `username` / `password`, so a suite can adopt pooling later
 * without changing its call site.
 *
 * @param {object} profile   parsed environment profile (utils/profile.js)
 * @param {string} prefix    the suite's env-key prefix, e.g. 'tl'
 * @returns {{user: string, pass: string, index: number, pooled: boolean}}
 */
function accountForWorker(profile, prefix) {
  const pool = parsePool(profile[`${prefix}_accounts`]);
  const i = workerIndex();

  if (pool.length === 0) {
    const user = profile[`${prefix}_username`] || profile.username;
    const pass = profile[`${prefix}_password`] || profile.password;
    if (!user || !pass) {
      throw new Error(
        `No account for "${prefix}". Set ${prefix}_accounts (a pool), or ` +
        `${prefix}_username/${prefix}_password, in environments/<env>.env.`
      );
    }
    return { user, pass, index: 0, pooled: false };
  }

  if (i >= pool.length && !WARNED.has(prefix)) {
    WARNED.add(prefix);
    console.warn(
      `[accounts] worker ${i} is reusing ${prefix} account #${i % pool.length + 1} of ${pool.length}. ` +
      `If this app allows one session per user, the two workers sharing it can evict each other — ` +
      `add more accounts to ${prefix}_accounts or lower "workers" in playwright.config.js.`
    );
  }

  return { ...pool[i % pool.length], index: i % pool.length, pooled: true };
}

/** Per-worker storageState path, so pooled accounts never share one auth file. */
function storageStatePathFor(prefix) {
  return `.auth/${prefix}-worker-${workerIndex()}.json`;
}

module.exports = { accountForWorker, storageStatePathFor, workerIndex, parsePool };
