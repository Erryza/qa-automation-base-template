/**
 * Serve the app's static bundle from a per-process cache, fetching it with a short timeout and
 * retries.
 *
 * WHY: on a slow dev server a SPA's app bundle (e.g. /assets/index-*.js, loaded by a blocking
 * <script>) can take ~10s, sometimes 40s, and sometimes NEVER finishes downloading. Every new browser context downloads it again (contexts share no cache), so a suite
 * that opens a maker and a checker context paid it twice per worker, and a hung download failed
 * the whole suite in beforeAll even with a 90s navigation budget. A hung request is abandoned
 * after `timeout` and retried; once fetched, later contexts in the same worker get it from memory.
 *
 * Only hashed, immutable build assets are cached — never an API call, never HTML.
 */
// e.g. runtime-env.js is static per environment and has hung too; a worker only ever targets one env.
const STATIC = /\/admin\/(assets\/[^?]+\.(js|css|woff2?|ttf|svg|png|jpe?g)|js\/runtime-env\.js)(\?.*)?$/;
const cache = new Map();
const { getTimeoutScale } = require('./profile');

async function cacheStaticAssets(context, { timeout = 20000 * getTimeoutScale(), attempts = 4 } = {}) {
  await context.route(STATIC, async route => {
    const url = route.request().url();
    const hit = cache.get(url);
    if (hit) return route.fulfill(hit);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await route.fetch({ timeout });
        const entry = { status: res.status(), headers: res.headers(), body: await res.body() };
        if (res.status() === 200) cache.set(url, entry);
        return route.fulfill(entry);
      } catch (err) {
        // The page/context went away mid-download (a test moved on) — nothing left to serve.
        if (/has been closed/.test(err.message)) return undefined;
        lastErr = err;
      }
    }
    console.warn(`[assets] ${url} failed ${attempts}x: ${lastErr && lastErr.message}`);
    return route.abort().catch(() => {});
  });
}

module.exports = { cacheStaticAssets };
