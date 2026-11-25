#!/usr/bin/env node
/**
 * Runs one suite on ONE explicitly named environment:
 *   node scripts/run-suite.js --suite <Feature> --env sit [-g "TC-001"] [--headless] [--merge] [--read-only]
 * Add a pair of npm scripts per suite when it is run often, e.g.
 *   "feat:dev": "node scripts/run-suite.js --suite <Feature> --env dev"
 *
 *   --suite <folder>    required: the folder under suites/
 *   --env sit|dev|uat   required. There is no default: a run that quietly falls back to dev is how SIT work ends up on dev.
 *                       (global-setup.js still prompts/defaults when Playwright is started by hand; this script never does.)
 *   -g, --grep "TC-004" run only the matching test cases (Playwright's own title filter; the loop for one TC)
 *   --read-only         sets <PREFIX>_ALLOW_MUTATION=off and <PREFIX>_ALLOW_CONFIG_CHANGE=off for this run only, where <PREFIX> is
 *                       suites/<S>/report.json "flagPrefix". The suite reads those flags and marks its data-changing TCs SKIP.
 *   --headless          no visible browser (default is headed)
 *   --merge             REPORT_MERGE=1: keep the other rows of the previous report, replace only the TCs this run executed (after -g)
 *   --flow <name>       run a named flow of the suite (suites/<S>/report.json "flows"). Sets SUITE_FLOW for the suite to read,
 *                       and implies --merge (the rows of the full run are kept) unless --no-merge.
 *   --no-merge          with --flow: the report holds only this run
 *   --skip-preflight    do not run the preflight first (not recommended)
 *   --                  everything after is passed to `playwright test` unchanged
 *
 * suites/<S>/report.json (all keys optional):
 *   { "group": "...", "menu": "...", "also": [...],   // where global-teardown files the PDF (see CLAUDE.md)
 *     "flagPrefix": "FEAT",                            // for --read-only
 *     "flows": ["..."],                                // for --flow
 *     "ownLogin": true }                               // the suite logs in per role itself → SKIP_UI_LOGIN=1
 *
 * Steps: preflight (suites/<S>/preflight.js, else scripts/preflight.js; no network) -> drop a saved session of ANOTHER host ->
 * `playwright test` with ENV set -> suites/<S>/post-run.js when present -> point at the report and PDF.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const rest = [];
const o = { env: process.env.ENV || '', grep: '', readOnly: false, headless: false, merge: false, preflight: true, suite: '', flow: '', noMerge: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--') { rest.push(...args.slice(i + 1)); break; }
  else if (a === '--suite') o.suite = args[++i];
  else if (a === '--env') o.env = args[++i];
  else if (a === '-g' || a === '--grep') o.grep = args[++i];
  else if (a === '--read-only') o.readOnly = true;
  else if (a === '--headless') o.headless = true;
  else if (a === '--merge') o.merge = true;
  else if (a === '--skip-preflight') o.preflight = false;
  else if (a === '--flow') o.flow = String(args[++i] || '').toLowerCase();
  else if (a === '--no-merge') o.noMerge = true;
  else { console.error(`[run] unknown option "${a}" (see the header of scripts/run-suite.js)`); process.exit(2); }
}
if (!o.suite) {
  console.error('[run] choose the suite: --suite <folder under suites/>');
  process.exit(2);
}
const env = String(o.env || '').toLowerCase().trim();
if (!['dev', 'sit', 'uat'].includes(env)) {
  console.error('[run] choose the environment: --env dev|sit|uat. There is no default.');
  process.exit(2);
}

const SUITE_DIR = path.join(ROOT, 'suites', o.suite);
const SUITE_FILE = `suites/${o.suite}/test.js`;
if (!fs.existsSync(path.join(ROOT, SUITE_FILE))) { console.error(`[run] suite "${o.suite}" not found (${SUITE_FILE})`); process.exit(2); }
let reportJson = {};
try { reportJson = JSON.parse(fs.readFileSync(path.join(SUITE_DIR, 'report.json'), 'utf8')); } catch (_) { /* a suite without report.json files its PDF in REPORT/ */ }
if (o.flow && !(reportJson.flows || []).map(String).includes(o.flow)) {
  console.error(`[run] suite "${o.suite}" has no flow "${o.flow}" (suites/${o.suite}/report.json "flows": ${JSON.stringify(reportJson.flows || [])})`);
  process.exit(2);
}
const REPORT_DIR = reportJson.menu ? path.join(ROOT, 'REPORT', reportJson.group || '', reportJson.menu) : path.join(ROOT, 'REPORT');

const childEnv = { ...process.env, ENV: env };
delete childEnv.COUNTRY;
if (reportJson.ownLogin) childEnv.SKIP_UI_LOGIN = '1';
if (o.headless) childEnv.HEADLESS = '1';
if (o.flow) { childEnv.SUITE_FLOW = o.flow; if (!o.noMerge) o.merge = true; }   // a flow is a SUBSET of the workbook: keep the other rows
if (o.merge) childEnv.REPORT_MERGE = '1';
if (o.readOnly) {
  const prefix = reportJson.flagPrefix;
  if (!prefix) { console.error(`[run] --read-only needs "flagPrefix" in suites/${o.suite}/report.json`); process.exit(2); }
  childEnv[`${prefix}_ALLOW_MUTATION`] = 'off';
  childEnv[`${prefix}_ALLOW_CONFIG_CHANGE`] = 'off';
}

// 1. preflight — same flags/env as the run, so it reports what THIS run will do. A suite may bring its own (suites/<S>/preflight.js).
if (o.preflight) {
  const own = path.join(SUITE_DIR, 'preflight.js');
  const script = fs.existsSync(own) ? own : path.join(__dirname, 'preflight.js');
  const pf = spawnSync(process.execPath, [script, '--env', env, '--suite', o.suite], { stdio: 'inherit', env: childEnv });
  if (pf.status !== 0) { console.error('[run] preflight failed — nothing was started. Fix the lines marked FAIL, then run again.'); process.exit(1); }
}

// 2. a saved session of another host must not be picked up by Playwright's default context (a SIT run carrying a dev cookie).
//    It is a git-ignored cache that global-setup rewrites; removing it is harmless.
try {
  const state = path.join(ROOT, '.auth', 'state.json');
  if (fs.existsSync(state)) {
    const P = {};
    for (const line of fs.readFileSync(path.join(ROOT, 'environments', `${env}.env`), 'utf8').split(/\r?\n/)) {
      const t = line.trim(); const i = t.indexOf('=');
      if (t && !t.startsWith('#') && i > 0) P[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    const origin = new URL(P.url).origin;
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    const hosts = [...new Set([...(s.origins || []).map(x => x.origin), ...(s.cookies || []).map(c => 'https://' + String(c.domain).replace(/^\./, ''))])];
    if (hosts.length && !hosts.includes(origin)) { fs.unlinkSync(state); console.log(`[run] removed .auth/state.json (a saved session of ${hosts.join(', ')}, not ${origin})`); }
  }
} catch (_) { /* best effort */ }

// 3. the run — the local Playwright CLI directly (a wrapper on PATH may hijack the bare `playwright` command)
const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const pwArgs = [cli, 'test', SUITE_FILE];
if (o.grep) pwArgs.push('-g', o.grep);
pwArgs.push(...rest);
console.log(`\n[run] ${o.suite}  ENV=${env.toUpperCase()}${o.flow ? `  FLOW: ${o.flow}` : ''}${o.readOnly ? ' (READ-ONLY: no data or configuration is changed)' : ''}${o.grep ? `  filter: ${o.grep}` : ''}${o.merge ? '  (merging into the previous report)' : ''}\n`);
const r = spawnSync(process.execPath, pwArgs, { stdio: 'inherit', env: childEnv, cwd: ROOT });

// 3b. a suite may hold a shared setting open for the whole run (a worker restart after a failed test would otherwise undo it every
//     time): suites/<S>/post-run.js puts it back once, after the browser is gone
const postRun = path.join(SUITE_DIR, 'post-run.js');
if (fs.existsSync(postRun)) {
  console.log('\n[run] post-run: putting shared settings back');
  const pr = spawnSync(process.execPath, [postRun, '--env', env], { stdio: 'inherit', env: childEnv, cwd: ROOT });
  if (pr.status !== 0) console.error(`\n[run] !!! post-run.js failed (exit ${pr.status}) — run it again: node suites/${o.suite}/post-run.js --env ${env}\n`);
}

// 4. where the results are
console.log('\n[run] finished (exit code ' + (r.status === null ? 'killed' : r.status) + ')');
console.log(`[run] report : suites/${o.suite}/test_report.html`);
console.log(`[run] PDF    : ${path.relative(ROOT, REPORT_DIR)}${path.sep}<timestamp>_${o.suite}.pdf`);
process.exit(r.status === null ? 1 : r.status);
