#!/usr/bin/env node
/**
 * One-time MANUAL login → captured session for a captcha-protected app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Some apps cannot be signed into by a script: a server-side image captcha, an SSO / MFA step,
 * or an anti-bot control. Do not use an OCR / third-party captcha "solver" (flaky, defeats the
 * control, and ships credentials + captcha images to an outside service).
 *
 * Instead a human solves the captcha ONCE in a real browser window; this script then
 * captures the resulting session into .auth/state.json (cookies + localStorage, which
 * playwright.config.js loads automatically) and dumps sessionStorage to
 * .auth/session-storage.json for diagnosis. The captured cookies are what let every later test run start already signed in — until the session
 * expires, when you simply run this again.
 *
 * USAGE
 * -----
 *   npm run login            # ENV defaults to dev
 *   ENV=sit npm run login
 *
 * This is a standalone Node script, NOT a Playwright test: globalSetup does not run for
 * `--list`, and an interactive, headed, wait-for-a-human flow does not belong in the
 * per-run setup. Run it by hand whenever the saved session has expired.
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { readProfile, getEnvProfilePath, getSelectedEnv } = require('../utils/profile');

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, '.auth');
const STATE_PATH = path.join(AUTH_DIR, 'state.json');
const SESSION_PATH = path.join(AUTH_DIR, 'session-storage.json');

function appOrigin(loginUrl) {
  // Login page is e.g. https://app.example.com/auth/login — the app lives at the origin.
  return new URL(loginUrl).origin;
}

/** Success = we have left every sign-in page (login form, OAuth authorize, code callback). */
function isSignedInUrl(u) {
  try {
    const { pathname } = new URL(u);
    return !/login|\/auth(\/|$)|oauth2|signin/i.test(pathname);
  } catch {
    return false;
  }
}

async function main() {
  const env = getSelectedEnv() || 'dev';
  const profile = readProfile(getEnvProfilePath(env));
  const origin = appOrigin(profile.url);

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  MANUAL LOGIN — ${env.toUpperCase()}  (${origin})`);
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  A browser window will open on the login page.');
  console.log(`  Sign in manually:  username "${profile.username}", your password,`);
  console.log('  and the captcha shown on screen. Solve the captcha yourself —');
  console.log('  this script does NOT bypass it.');
  console.log('  The session is captured automatically the moment you land on the app.');
  console.log('──────────────────────────────────────────────────────────────\n');

  // Headed on purpose: a human must see and solve the captcha. Ignores HEADLESS.
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: null,
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
  });
  const page = await context.newPage();

  // Log the OAuth token exchange so we learn the real token lifetimes (answers "how often
  // must I re-login?"). We only READ the response; we do not store tokens anywhere.
  page.on('response', async (res) => {
    if (/oauth2\/token/i.test(res.url())) {
      try {
        const body = await res.json();
        const info = {
          expires_in: body.expires_in,
          refresh_expires_in: body.refresh_expires_in,
          token_type: body.token_type,
          scope: body.scope,
          has_refresh_token: Boolean(body.refresh_token),
        };
        console.log(`[login] token response ${res.status()} ${JSON.stringify(info)}`);
        if (info.expires_in) {
          console.log(`[login] access token lifetime ≈ ${Math.round(info.expires_in / 60)} min` +
            (info.refresh_expires_in ? `, refresh ≈ ${Math.round(info.refresh_expires_in / 60)} min` : ', refresh lifetime not reported'));
        }
      } catch { /* non-JSON token response — ignore */ }
    }
  });

  await page.goto(profile.url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  console.log('[login] Waiting for you to sign in (up to 5 minutes)…');
  // Wait on the URL SIGNAL, not a clock: resolves only once we have left all sign-in pages.
  await page.waitForURL((u) => isSignedInUrl(u.toString()), { timeout: 300000 });
  // Let the SPA finish its post-login boot (silent authorize + first render).
  await page.waitForLoadState('networkidle').catch(() => {});

  console.log(`[login] Signed in — landed on ${page.url()}`);

  // Capture the full browser session: cookies + localStorage for every origin.
  await context.storageState({ path: STATE_PATH });

  // sessionStorage is NOT part of storageState — dump it separately for diagnosis. If the
  // sanity check below passes, cookies alone are enough and this file is only informational.
  const stores = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(window.localStorage)),
    session: Object.fromEntries(Object.entries(window.sessionStorage)),
  }));
  fs.writeFileSync(SESSION_PATH, JSON.stringify({ origin: origin, sessionStorage: stores.session }, null, 2));

  const tokenish = (obj) => Object.keys(obj).filter((k) => /token|auth|access|refresh|oauth|user/i.test(k));
  console.log(`[login] localStorage keys: ${Object.keys(stores.local).join(', ') || '(none)'}`);
  console.log(`[login] sessionStorage keys: ${Object.keys(stores.session).join(', ') || '(none)'}`);
  const tk = [...tokenish(stores.local), ...tokenish(stores.session)];
  if (tk.length) console.log(`[login] token-looking keys: ${tk.join(', ')} (if a reuse check fails, these may need restoring)`);

  console.log(`[login] Saved session → ${STATE_PATH}`);
  await browser.close();

  // ── Immediate reuse check: open a FRESH context with only the saved state and confirm
  //    we are not bounced back to a sign-in page. This proves the capture is usable before
  //    you depend on it for a real run.
  console.log('\n[verify] Re-opening a fresh browser with the saved session…');
  const vb = await chromium.launch({ headless: true });
  const vctx = await vb.newContext({
    storageState: STATE_PATH,
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
  });
  const vpage = await vctx.newPage();
  await vpage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await vpage.waitForLoadState('networkidle').catch(() => {});
  const landedUrl = vpage.url();
  const ok = isSignedInUrl(landedUrl);
  await vb.close();

  if (ok) {
    console.log(`[verify] OK — reused session stays signed in (${landedUrl}).`);
    console.log('\n✅ Done. Run tests normally, e.g.:');
    console.log(`     ENV=${env} npx playwright test "suites/<Feature>/test.js"\n`);
  } else {
    console.error(`[verify] FAILED — reused session was redirected to a sign-in page (${landedUrl}).`);
    console.error('[verify] The app likely keeps its token in sessionStorage (not captured by');
    console.error(`[verify] storageState). See ${SESSION_PATH} for the keys; a sessionStorage`);
    console.error('[verify] restore fixture is then needed. Tell Claude: "reuse check failed".');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[login] Failed:', e.message);
  process.exit(1);
});
