const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { getTimeoutScale } = require('./utils/profile');

const HEADLESS = process.env.HEADLESS === '1';
const CI = Boolean(process.env.CI);
// SIT/UAT are reached over VPN + corporate network — see utils/profile.js getTimeoutScale().
const TIMEOUT_SCALE = getTimeoutScale();

// Fill the screen instead of asking for a fixed size: macOS clamps a window to
// the screen, so --window-size larger than the display leaves the bottom
// hanging off. Suites needing a viewport bigger than the window take the real
// window (`viewport: null`) and scale the presentation down themselves.
const headedArgs = HEADLESS ? [] : ['--start-maximized'];

// A fresh clone has no .auth/state.json until global-setup has logged in once.
// Naming a missing file here makes every test fail to start with an opaque
// ENOENT, so only apply it when it exists.
const STORAGE_STATE = path.resolve(__dirname, '.auth/state.json');
const storageState = fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined;

module.exports = defineConfig({
  testDir: '.',
  // Suites live in suites/<Feature>/test.js (any depth). examples/ is deliberately
  // NOT matched: examples/_reference-suite/test.js is documentation, not a suite.
  testMatch: ['tests/**/*.spec.js', 'suites/**/test.js'],

  // Test cases inside one feature share a logged-in page (see the reference suite's
  // beforeAll), so they must stay in file order within a worker. Parallelism is
  // across FILES, not across the test cases of one file — do not set this to true
  // without giving every test its own context.
  fullyParallel: false,

  // A UI test that fails once and passes on retry is flaky, not broken. Locally
  // you want the failure in your face; in CI you want the run to finish and the
  // flake recorded. trace/video below are keyed to the retry, so a retried test
  // produces a full trace at no cost to the happy path.
  retries: CI ? 2 : 0,
  workers: CI ? 2 : 4,
  timeout: 300000,
  // WHY this is set explicitly: Playwright's default expect timeout is 5s, which
  // is far shorter than the actionTimeout/navigationTimeout below and too short
  // for a cold SPA boot. The dashboard is a Vite/React app that runs an OAuth
  // introspection before it renders any menu or form, so the FIRST suite of a run
  // regularly needs more than 5s for its first `toBeVisible()`. Leaving the
  // default made whichever suite happened to sort first fail every test with
  // "element never rendered", against a page that was merely still spinning —
  // a data-independent failure that looks exactly like a missing field.
  expect: { timeout: 15000 * TIMEOUT_SCALE },
  // Never let a green-looking run hide a `test.only` left behind in a commit.
  forbidOnly: CI,

  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',

  reporter: [
    ['list'],
    // Produces the per-suite, client-facing test_report.html from the annotations
    // each test records, and appends one line per run to reports/history.jsonl.
    ['./reporters/excel-html-reporter.js'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    // GitLab renders this as the merge-request test summary (.gitlab-ci.yml
    // `reports: junit:`), so a failure is visible without opening artifacts.
    ['junit', { outputFile: 'reports/junit.xml' }],
  ],

  use: {
    browserName: 'chromium',
    // Headed by default; HEADLESS=1 forces headless (CI / no-GUI sessions).
    headless: HEADLESS,
    launchOptions: { args: headedArgs },
    storageState,

    // The Playwright trace is the single best debugging artefact this project has:
    // DOM snapshot, network, console and the action timeline for every step.
    // 'on-first-retry' means a passing run costs nothing and a failure always has one.
    //   npx playwright show-trace test-results/<...>/trace.zip
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    // Suites capture their own labelled evidence via evidence() — 'on' would store
    // a second, unlabelled copy of every test.
    screenshot: 'only-on-failure',

    viewport: { width: 1440, height: 900 },
    // Opt-in: IGNORE_HTTPS_ERRORS=1 for an internal dev/SIT/UAT host whose certificate is
    // expired or self-signed (navigation otherwise fails with net::ERR_CERT_*). Off by default —
    // never leave it on for a host you do not control. global-setup.js, utils/seed.js and the
    // reference suite read the same switch.
    ignoreHTTPSErrors: process.env.IGNORE_HTTPS_ERRORS === '1',
    actionTimeout: 15000 * TIMEOUT_SCALE,
    navigationTimeout: 30000 * TIMEOUT_SCALE,
  },
});
