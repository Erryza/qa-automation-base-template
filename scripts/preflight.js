#!/usr/bin/env node
/**
 * Generic pre-run check — `node scripts/preflight.js --env sit [--suite <Feature>]`.
 * scripts/run-suite.js runs it automatically unless the suite brings its own suites/<Feature>/preflight.js
 * (copy this file there and add the suite's own checks: accounts, data flags, testcases.json mapping, ...).
 *
 * It answers one question BEFORE a long run on a restricted network: "is everything this run needs already on this machine and
 * filled in?". It opens no browser and makes NO network request, so it is safe on any network.
 *
 * Exit code 0 = ready (warnings allowed), 1 = something that would make the run fail or hit the wrong environment.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ENV = String(flag('--env') || process.env.ENV || '').toLowerCase().trim();
const SUITE_NAME = flag('--suite') || '';
const SUITE = SUITE_NAME ? path.join(ROOT, 'suites', SUITE_NAME) : null;
const QUIET = argv.includes('--quiet');

const out = { fail: [], warn: [], ok: [] };
const ok = m => out.ok.push(m);
const warn = m => out.warn.push(m);
const fail = m => out.fail.push(m);

function parseEnvFile(file) {
  const p = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) p[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return p;
}
const originOf = u => { try { return new URL(u).origin; } catch (_) { return null; } };

function main() {
  // ── 1. environment ────────────────────────────────────────────────────────────────────────────
  if (!['dev', 'sit', 'uat'].includes(ENV)) {
    fail('environment not chosen: run with ENV=dev|sit|uat (or --env sit). There is deliberately NO default — a run that silently falls back to dev is how SIT work ends up on dev.');
    return;
  }
  const file = path.join(ROOT, 'environments', `${ENV}.env`);
  if (!fs.existsSync(file)) {
    fail(`environments/${ENV}.env does not exist — create it from environments/example.env`);
    return;
  }
  const P = parseEnvFile(file);
  ok(`profile environments/${ENV}.env found`);

  // ── 2. nothing left to fill in ────────────────────────────────────────────────────────────────
  const placeholders = Object.entries(P).filter(([, v]) => /^ISI_|^CHANGE_?ME$|^<.*>$/i.test(v)).map(([k]) => k);
  if (placeholders.length) fail(`still to fill in (placeholder value): ${placeholders.join(', ')}`);
  else ok('no placeholder values left');
  for (const k of ['url', 'username', 'password']) if (!P[k]) fail(`required key "${k}" is empty`);

  // ── 3. ONE host, and not another environment's ────────────────────────────────────────────────
  const origin = originOf(P.url);
  if (!origin) fail(`url is not a valid URL: "${P.url}"`);
  else {
    ok(`target host: ${origin}`);
    // a sit/uat profile copied from dev and not edited points at the dev host
    for (const other of ['dev', 'sit', 'uat'].filter(e => e !== ENV)) {
      const f = path.join(ROOT, 'environments', `${other}.env`);
      if (fs.existsSync(f) && originOf(parseEnvFile(f).url) === origin) fail(`${ENV}.env points at the same host as ${other}.env (${origin}) — copy/paste mistake?`);
    }
  }

  // ── 4. what is installed on THIS machine (must already be there when the network is restricted) ──
  for (const m of ['@playwright/test', 'exceljs', 'otplib']) {
    try { require.resolve(m, { paths: [ROOT] }); } catch (_) { fail(`npm package "${m}" is not installed — run "npm install" while you still have internet`); }
  }
  try {
    const exe = require(require.resolve('@playwright/test', { paths: [ROOT] })).chromium.executablePath();
    if (exe && fs.existsSync(exe)) ok('Chromium for Playwright is installed');
    else fail('Chromium for Playwright is NOT installed — run "npx playwright install chromium" while you still have internet');
  } catch (e) { fail('cannot locate Chromium: ' + String(e.message).split('\n')[0]); }

  // ── 5. the suite itself (only with --suite) ───────────────────────────────────────────────────
  const jsFiles = [];
  if (SUITE) {
    if (!fs.existsSync(path.join(SUITE, 'test.js'))) { fail(`suites/${SUITE_NAME}/test.js does not exist`); return; }
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (['legacy', 'screenshots', 'node_modules', '.runs', 'report-all'].includes(f.name)) continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) jsFiles.push(p);
      }
    })(SUITE);
    const bad = jsFiles.filter(f => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0);
    if (bad.length) fail(`syntax error in: ${bad.map(f => path.relative(ROOT, f)).join(', ')}`); else ok(`${jsFiles.length} suite file(s) parse`);
  }

  // ── 6. nothing in the code reaches another host ───────────────────────────────────────────────
  const hostRe = /(["'`])https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i;
  const scan = [...jsFiles, ...['utils/login.js', 'utils/tc.js', 'utils/waits.js', 'global-setup.js', 'playwright.config.js'].map(f => path.join(ROOT, f))]
    .filter(f => fs.existsSync(f));
  const hits = [];
  for (const f of scan) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => { if (!/^\s*(\/\/|\*|\/\*)/.test(l) && hostRe.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`); });
  }
  if (hits.length) warn(`a literal URL appears in code: ${hits.slice(0, 5).join(', ')}`); else ok('no hardcoded host in the suite or the shared helpers');

  // ── 7. leftovers of another environment ───────────────────────────────────────────────────────
  const state = path.join(ROOT, '.auth', 'state.json');
  if (fs.existsSync(state) && origin) {
    try {
      const s = JSON.parse(fs.readFileSync(state, 'utf8'));
      const hosts = [...new Set([...(s.origins || []).map(o => o.origin), ...(s.cookies || []).map(c => 'https://' + String(c.domain).replace(/^\./, ''))])];
      if (hosts.length && !hosts.includes(origin)) warn(`.auth/state.json is a saved session of another host (${hosts.join(', ')}); scripts/run-suite.js removes it`);
    } catch (_) { /* unreadable cache: harmless */ }
  }
}

main();

if (!QUIET) {
  const line = (s, m) => console.log(`  ${s} ${m}`);
  console.log(`\n[preflight] ${SUITE_NAME || '(no suite)'} — ENV=${ENV || '(not set)'}\n`);
  out.ok.forEach(m => line('OK  ', m));
  out.warn.forEach(m => line('WARN', m));
  out.fail.forEach(m => line('FAIL', m));
  console.log(`\n[preflight] ${out.fail.length ? `NOT READY — ${out.fail.length} problem(s) to fix` : 'READY'}${out.warn.length ? `, ${out.warn.length} warning(s)` : ''}. No network request was made.\n`);
}
module.exports = { out };
process.exitCode = out.fail.length ? 1 : 0;
