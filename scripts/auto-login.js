#!/usr/bin/env node
/**
 * Headless sign-in → captured session, for an environment whose captcha has a fixed test value.
 *
 * Use it when an environment's captcha accepts a fixed test value (`captcha=` in
 * environments/<env>.env). When that key is set, this script fills the real sign-in form
 * (username, password, captcha) headlessly and saves the session — no human needed. When it is
 * empty, use `npm run login` (manual, headed) as before.
 *
 *   ENV=dev npm run login:auto                      # top-level account → .auth/state.json
 *   ENV=dev npm run login:auto -- --account admin2  # admin2_username/password → .auth/state-admin2.json
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { readProfile, getEnvProfilePath, getSelectedEnv } = require('../utils/profile');
const { login } = require('../utils/login');
const LOGIN = require('../utils/login-config');

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(ROOT, '.auth');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : '';
}

async function main() {
  const env = getSelectedEnv() || 'dev';
  const P = readProfile(getEnvProfilePath(env));
  const account = arg('account');
  const username = account ? P[`${account}_username`] : P.username;
  const password = account ? P[`${account}_password`] : P.password;
  if (!P.captcha) throw new Error(`environments/${env}.env has no captcha= value — use \`npm run login\` (manual).`);
  if (!username || !password) throw new Error(`no credentials for ${account ? `${account}_username / ${account}_password` : 'username / password'} in environments/${env}.env`);
  const out = path.join(AUTH_DIR, account ? `state-${account}.json` : 'state.json');

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1' });
    const page = await context.newPage();
    // Same form login as global-setup (selectors in utils/login-config.js); it fills captcha= too.
    await login(page, { ...P, username, password }, LOGIN);
    if (/\/login/.test(new URL(page.url()).pathname)) throw new Error(`still on ${page.url()} — wrong credentials or captcha?`);
    await page.waitForLoadState('networkidle');
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: out });
    console.log(`[auto-login] ${env.toUpperCase()} ${username} signed in → ${path.relative(ROOT, out)}`);
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(`[auto-login] FAILED: ${e.message}`); process.exit(1); });
