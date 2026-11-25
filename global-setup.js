const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readProfile, getEnvProfilePath, ENVIRONMENTS, COUNTRIES } = require('./utils/profile');
const { chromium } = require('@playwright/test');
const { login } = require('./utils/login');
const LOGIN = require('./utils/login-config');

// Shared login: reuse .auth/state.json when it exists, else sign in through utils/login.js with the
// selectors in utils/login-config.js and save the session there. For a login a script cannot pass
// (captcha / SSO), capture the session by hand with `npm run login` and it is reused here.

async function promptEnvironment() {
  // Non-interactive modes (--ui, --headed launched from UI, CI pipes) have no TTY.
  // Fall back silently to DEV so the setup doesn't hang.
  if (!process.stdin.isTTY) {
    console.log('\n[setup] Non-interactive mode detected — defaulting to DEV.');
    console.log('[setup] To use SIT run:  npm run test:sit');
    console.log('[setup] To use UAT run:  npm run test:uat');
    return 'dev';
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n┌─────────────────────────────────────┐');
    console.log('│       Select Test Environment        │');
    console.log('├─────────────────────────────────────┤');
    console.log('│  0. DEV  (default)                   │');
    console.log('│  1. SIT                              │');
    console.log('│  2. UAT                              │');
    console.log('└─────────────────────────────────────┘');

    rl.question('\n  Enter choice [0/1/2] (default: 0 DEV): ', (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      if (choice === '' || choice === '0' || choice === 'dev') return resolve('dev');
      if (choice === '1' || choice === 'sit') return resolve('sit');
      if (choice === '2' || choice === 'uat') return resolve('uat');
      reject(new Error(`Invalid choice "${answer}". Enter 0 (DEV), 1 (SIT), 2 (UAT), or press Enter for DEV.`));
    });
  });
}

async function globalSetup() {
  for (const dir of ['.auth', 'screenshots', 'reports']) {
    fs.mkdirSync(path.resolve(__dirname, dir), { recursive: true });
  }

  // Determine environment: ENV variable → interactive prompt
  let selectedEnv = (process.env.ENV || '').toLowerCase().trim();
  if (!ENVIRONMENTS.includes(selectedEnv)) {
    selectedEnv = await promptEnvironment();
  } else {
    console.log(`\n[setup] Environment set via ENV variable: ${selectedEnv.toUpperCase()}`);
  }

  // One id per `playwright test` invocation. Environment variables set here reach every
  // worker, including the fresh worker Playwright starts after a failed test — which is what a
  // suite needs to find its own per-run state again (module-level variables are lost with the
  // old worker), e.g. a suite that keys a lifecycle file on it.
  process.env.RUN_ID = process.env.RUN_ID || String(Date.now());

  // Persist selection for test workers (workers are separate processes)
  fs.writeFileSync(
    path.resolve(__dirname, '.selected-env.json'),
    JSON.stringify({ env: selectedEnv }, null, 2)
  );

  // COUNTRY is opt-in filtering.  With no explicit value, always run both
  // countries; this keeps ordinary `ENV=dev npx playwright test ...` runs
  // non-interactive.
  let selectedCountry = (process.env.COUNTRY || '').toLowerCase().trim();
  if (!COUNTRIES.includes(selectedCountry)) {
    if (selectedCountry) console.log(`[setup] Unknown COUNTRY value "${selectedCountry}" — defaulting to ALL countries.`);
    else console.log('[setup] COUNTRY not set — defaulting to ALL countries.');
    selectedCountry = 'all';
  } else {
    console.log(`[setup] Country set via COUNTRY variable: ${selectedCountry.toUpperCase()}`);
  }

  fs.writeFileSync(
    path.resolve(__dirname, '.selected-country.json'),
    JSON.stringify({ country: selectedCountry }, null, 2)
  );

  const profilePath = getEnvProfilePath(selectedEnv);
  console.log(`\n[setup] Loading profile: ${profilePath}`);

  const profile = readProfile(profilePath);

  // API-only runs do not need a browser session at all: the API suites talk to the
  // Partner API over APIRequestContext and never open a page. Logging into the
  // dashboard anyway couples an API run to the dashboard being up — a confusing
  // failure where "Check Balance" dies in global setup because a UI is down.
  //   SKIP_UI_LOGIN=1 npx playwright test "suites/api"
  if (process.env.SKIP_UI_LOGIN === '1') {
    console.log('[setup] SKIP_UI_LOGIN=1 — no browser login (API-only run).');
    return;
  }

  const statePath = path.resolve(__dirname, '.auth/state.json');
  console.log(`[setup] Target URL  : ${profile.url}`);
  console.log(`[setup] Username    : ${profile.username}`);
  if (fs.existsSync(statePath) && process.env.FRESH_LOGIN !== '1') {
    console.log('[setup] Reusing saved session from .auth/state.json (FRESH_LOGIN=1 forces a new sign-in).');
    return;
  }

  // Headless on purpose: this is a one-off sign-in, not a test the user watches.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1' });
    const page = await context.newPage();
    await login(page, profile, LOGIN);
    if (/\/login/.test(new URL(page.url()).pathname)) {
      throw new Error(
        `Sign-in did not leave the login page (${page.url()}).\n` +
        'Check utils/login-config.js selectors and the credentials in environments/' + selectedEnv + '.env.\n' +
        `If the login has a captcha / SSO, capture the session by hand:  ENV=${selectedEnv} npm run login`
      );
    }
    await context.storageState({ path: statePath });
    console.log('[setup] Signed in — session saved to .auth/state.json.');
  } finally {
    await browser.close();
  }
}

module.exports = globalSetup;
