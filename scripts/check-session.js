#!/usr/bin/env node
/**
 * Is the saved session still usable?  Opens the app with .auth/state.json and checks we are
 * not bounced to a sign-in page. Run it any time to decide whether `npm run login` is needed
 * again (the session/refresh token eventually expires).
 *
 *   npm run check:session           # ENV defaults to dev
 *   ENV=sit npm run check:session
 *
 * Exit 0 = still signed in. Exit 1 = expired or never captured (run `npm run login`).
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { readProfile, getEnvProfilePath, getSelectedEnv } = require('../utils/profile');

const STATE_PATH = path.resolve(__dirname, '..', '.auth', 'state.json');

function isSignedInUrl(u) {
  try {
    const { pathname } = new URL(u);
    return !/login|\/auth(\/|$)|oauth2|signin/i.test(pathname);
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(STATE_PATH)) {
    console.error('[check] No .auth/state.json — run `npm run login` first.');
    process.exit(1);
  }
  const env = getSelectedEnv() || 'dev';
  const profile = readProfile(getEnvProfilePath(env));
  const origin = new URL(profile.url).origin;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: STATE_PATH,
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const url = page.url();
  await browser.close();

  if (isSignedInUrl(url)) {
    console.log(`[check] OK — session is still valid (landed on ${url}).`);
    process.exit(0);
  }
  console.error(`[check] EXPIRED — redirected to a sign-in page (${url}). Run \`npm run login\`.`);
  process.exit(1);
}

main().catch((e) => {
  console.error('[check] Failed:', e.message);
  process.exit(1);
});
