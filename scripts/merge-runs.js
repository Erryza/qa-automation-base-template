#!/usr/bin/env node
/**
 * One report from every kept run of a suite on ONE environment — `node scripts/merge-runs.js --suite <Feature> --env sit`.
 * A run is kept in <suite>/.runs/<env>/<stamp>/ by reporters/excel-html-reporter.js when the suite's
 * report.json says { "keepRuns": true }; runs from before that are not included.
 *
 *   node scripts/merge-runs.js --suite <Feature> --env sit [--since 2026-10-13]
 *
 * The rule, oldest run first: a test case takes its row from the first run that executed it, and a later run replaces that
 * row ONLY when it PASSED. A pass is never lost to a later failure (a DNS blip, a slow server), and a re-run contributes
 * nothing but its passes. A row SKIPPED (not executed — the run died before it) never counts as a result.
 *
 * Every row says which run it came from. Output: <suite>/report-all/<env>/test_report.html (+ its own screenshots/) and
 * REPORT/<stamp>_<Suite>_ALL-<ENV>.pdf (or the suite's REPORT/<group>/<menu>/). Runs nothing against a server.
 *
 *   --since <stamp>   ignore runs older than this (prefix of the folder name, e.g. 2026-10-13 or 2026-10-13_14-00) — for when
 *                     the workbook was renumbered and older runs speak of other test cases.
 *
 * <suite>/renumber.json (optional) carries older runs across a workbook renumbering instead of dropping them:
 *   [{ "before": "2026-10-16_13-34", "drop": ["TC-PMF-015", …], "shift": [[198, 234, -2], …] }]
 * A run whose folder sorts before `before` has `drop` ids removed (deleted TCs, and TCs whose content changed) and every id in
 * [from, to] moved by the shift; rules apply oldest first, so a run older than two revisions goes through both. Its
 * evidence is renamed to the new id and its note says the old number.
 */
const fs = require('fs');
const path = require('path');
const { generateHTMLReport } = require('../utils/reporter');
const { generatePdf, reportFolder } = require('../global-teardown');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const suite = opt('suite');
const env = (opt('env') || '').toLowerCase();
const since = opt('since') || '';
if (!suite || !env) { console.error('usage: merge-runs.js --suite <folder> --env sit|dev|uat [--since <stamp>]'); process.exit(2); }

const suiteDir = path.join(ROOT, 'suites', suite);
const runsDir = path.join(suiteDir, '.runs', env);
const runs = (fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : [])
  .filter(d => fs.existsSync(path.join(runsDir, d, 'rows.json')) && d >= since)
  .sort();
if (!runs.length) {
  console.error(`[merge] no kept runs in ${path.relative(ROOT, runsDir)}${since ? ` since ${since}` : ''} — run the suite on ${env} first (report.json needs "keepRuns": true).`);
  process.exit(1);
}

const label = run => run.replace(/^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d).*/, '$1 $2:$3');
const key = r => String(r.tcId || '').trim().split(/\s+/)[0];   // "TC-PMF-312b <title>" (a row that never reached tc()) = TC-PMF-312b

const renumberFile = path.join(suiteDir, 'renumber.json');
const renumber = (fs.existsSync(renumberFile) ? JSON.parse(fs.readFileSync(renumberFile, 'utf8')) : [])
  .sort((a, b) => a.before.localeCompare(b.before));
const renumberId = (id, run) => {
  for (const rule of renumber) {
    if (run >= rule.before) continue;
    if ((rule.drop || []).includes(id)) return null;
    const m = /^(.*?)(\d+)$/.exec(id);
    const hit = m && (rule.shift || []).find(([from, to]) => +m[2] >= from && +m[2] <= to);
    if (hit) id = m[1] + String(+m[2] + hit[2]).padStart(m[2].length, '0');
  }
  return id;
};

const merged = new Map();      // suiteName -> Map(tcId -> { row, run })
const order = new Map();       // suiteName -> tcIds in the order of the newest run that listed them
const upgraded = [];
const perRun = Object.fromEntries(runs.map(r => [r, { rows: 0, executed: 0, renumbered: 0, dropped: 0 }]));
for (const run of runs) {
  const saved = JSON.parse(fs.readFileSync(path.join(runsDir, run, 'rows.json'), 'utf8'));
  for (const [suiteName, raw] of Object.entries(saved)) {
    const rows = [];
    for (const row of raw) {
      const id = key(row);
      const now = renumberId(id, run);
      if (now === null) { perRun[run].dropped++; continue; }
      if (now !== id) perRun[run].renumbered++;
      rows.push(now === id ? row : { ...row, tcId: now, renumberedFrom: id });
    }
    if (!merged.has(suiteName)) merged.set(suiteName, new Map());
    const byId = merged.get(suiteName);
    order.set(suiteName, [...rows.map(key), ...(order.get(suiteName) || [])].filter((id, i, all) => all.indexOf(id) === i));
    for (const row of rows) {
      const id = key(row);
      perRun[run].rows++;
      if (row.status === 'SKIPPED') continue;
      perRun[run].executed++;
      const have = byId.get(id);
      if (!have || have.row.status === 'SKIPPED') byId.set(id, { row, run });
      else if (row.status === 'PASSED' && have.row.status !== 'PASSED') {
        upgraded.push(`${id}: ${have.row.status} (${label(have.run)}) → PASSED (${label(run)})`);
        byId.set(id, { row, run });
      } else if (row.status === 'PASSED') byId.set(id, { row, run });   // the newest pass, with its evidence
    }
    for (const row of rows) if (!byId.has(key(row))) byId.set(key(row), { row, run });   // never executed anywhere yet
  }
}

const outDir = path.join(suiteDir, 'report-all', env);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
const payload = [];
const totals = {};
const fromRun = {};
const missing = [];
for (const [suiteName, byId] of merged) {
  const results = [];
  for (const id of order.get(suiteName)) {
    const { row: { renumberedFrom, ...row }, run } = byId.get(id);
    const shots = [].concat(row.screenshot || []).map(sh => {
      const file = typeof sh === 'object' ? sh.file : sh;
      const dest = renumberedFrom ? file.split(renumberedFrom).join(id) : file;
      const src = path.join(runsDir, run, 'screenshots', file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'screenshots', dest));
      else missing.push(`${id}: ${file}`);
      return typeof sh === 'object' ? { ...sh, file: dest } : dest;
    });
    if (row.screenshot) row.screenshot = Array.isArray(row.screenshot) ? shots : shots[0];
    const from = renumberedFrom ? ` · nomor lama ${renumberedFrom}` : '';
    results.push({ ...row, tcId: id, notes: `[Run ${label(run)}${from}] ${row.notes || ''}`.trim() });
    totals[row.status] = (totals[row.status] || 0) + 1;
    fromRun[label(run)] = (fromRun[label(run)] || 0) + 1;
  }
  payload.push({ suiteName, results });
}
const html = generateHTMLReport(payload, outDir, 'screenshots');

console.log(`[merge] ${suite} on ${env.toUpperCase()}: ${runs.length} run(s)`);
for (const run of runs) {
  const p = perRun[run];
  const re = p.renumbered || p.dropped ? `, ${p.renumbered} renumbered, ${p.dropped} dropped (renumber.json)` : '';
  console.log(`  ${label(run)}  ${p.executed}/${p.rows} executed, ${fromRun[label(run)] || 0} rows used${re}`);
}
console.log(`[merge] result ${JSON.stringify(totals)}`);
if (upgraded.length) { console.log(`[merge] ${upgraded.length} turned PASSED in a later run:`); upgraded.forEach(u => console.log(`  ${u}`)); }
if (missing.length) console.log(`[merge] ${missing.length} evidence file(s) not kept with their run: ${missing.slice(0, 10).join(', ')}`);
console.log(`[merge] wrote ${path.relative(ROOT, html)}`);

(async () => {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const dir = reportFolder(suiteDir);
  fs.mkdirSync(dir, { recursive: true });
  const pdf = path.join(dir, `${stamp}_${suite}_ALL-${env.toUpperCase()}.pdf`);
  await generatePdf(html, pdf, path.join(outDir, 'screenshots'), 'screenshots/');
  console.log(`[merge] PDF ${path.relative(ROOT, pdf)}`);
})().catch(e => { console.error(`[merge] PDF generation failed: ${e.message}`); process.exit(1); });
