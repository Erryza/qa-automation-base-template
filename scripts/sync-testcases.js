#!/usr/bin/env node
/**
 * Sync a suite's `testcases.json` from its Excel workbook, and say what changed.
 *
 *   node scripts/sync-testcases.js <xlsx> <sheet> <out.json> [idRegex] [--map tcmap.json --handlers cases/ [--accept]]
 *   node scripts/sync-testcases.js suites/<Feature>/"<Feature>.xlsx" "<Sheet>" suites/<Feature>/testcases.json "^TC-FEAT-\d+$"
 *
 * WHY THIS EXISTS: the TC workbook changes. A suite that has the test cases typed into its
 * test.js has to be rebuilt every time; a suite that READS testcases.json only needs this
 * script re-run. The workbook stays the single source of truth, the JSON is derived from it
 * (never edit the JSON by hand), and the handlers (cases/*.js) only say HOW to verify an id.
 *
 * It prints a diff against the previous JSON so the author knows exactly which handlers to
 * touch:  ADDED (no handler yet -> the suite reports it as SKIP "no automation yet"),
 *         REMOVED (handler is now orphaned), CHANGED (steps/expected/data changed -> re-check
 *         the handler's assertions).
 *
 * RENUMBERING (opt-in: --map / --handlers). A workbook revision can shift TC numbers wholesale (Mutual Fund Settlement:
 * 131 of 154 shared scenarios moved between two revisions in one day), and handlers keyed by number would then silently
 * verify the WRONG scenario. With --map, every handler is tied to the scenario text it was written for (tcmap.json:
 * "TC id" -> { handler, scenario }); sync follows a scenario to its new number, flags wording that changed, and drops
 * the mapping of a TC that has no handler. --accept re-snapshots the wording after a human re-checked the handlers.
 *     RENUMBERED  the handler follows the scenario to its new id
 *     CHANGED     same id, wording differs enough to doubt the handler  -> test runs, with a "re-check" note
 *     NEW         no handler matches                                       -> the suite reports SKIP "no handler yet"
 *     ORPHAN      a handler no TC points to any more
 *
 * Columns are resolved by HEADER NAME, never by index (a different workbook layout must not
 * silently shift every field).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const text = c => {
  if (c == null) return '';
  if (typeof c !== 'object') return String(c);
  if (c.richText) return c.richText.map(t => t.text).join('');
  return String(c.text || c.result || '');
};
const clean = s => text(s).replace(/\r/g, '').trim();

// header name (lower-cased) -> field. First match wins; several spellings per field.
const HEADERS = {
  id: ['tc id', 'test case id', 'tc_id'],
  kind: ['normal/negative', 'positive/negative', 'test case type', 'tc type'],
  scenario: ['test scenario', 'scenario', 'test description'],
  steps: ['steps', 'test steps', 'step'],
  data: ['data', 'test data'],
  expected: ['expected result', 'expected results'],
  review: ['status review tc'],
  fsd: ['feature'],
};

// ── scenario similarity: word-set Jaccard on lower-cased words (punctuation and quotes ignored) ──────────────────────────
const words = t => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(w => w.length > 1));
function similarity(a, b) {
  if (a === b) return 1;
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const SAME = 0.85;     // >= : the same scenario (typo / punctuation edits)
const CLOSE = 0.5;     // >= : probably the same scenario, reworded — keep the handler but tell the author

function handlerKeys(dir) {
  const keys = new Set();
  if (!dir || !fs.existsSync(dir)) return keys;
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && !n.startsWith('_'))) {
    // Alphanumeric segments AND dots: 'TC-FEAT-R2-025' (a revision infix) and 'TC-5.7-001' (a dotted module number) both have to match.
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*'([A-Za-z]{2,6}(?:[-_][\w.]+)+)'\s*:/gm)) keys.add(m[1]);
  }
  return keys;
}

function syncMap({ cases, mapFile, handlersDir, accept }) {
  const prev = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  const keys = handlerKeys(handlersDir);
  const next = {};
  const claimed = new Set();
  const report = { renumbered: [], changed: [], added: [], orphan: [] };
  const byHandler = new Map(Object.entries(prev).map(([id, e]) => [e.handler, { id, ...e }]));
  const everMapped = new Set(byHandler.keys());       // handlers some earlier sync already tied to a TC

  // pass 0: an IDENTICAL scenario text is the same scenario, claimed before similarity can mix up neighbours. Two rows that
  // differ by one decisive word ("...saat Approve" / "...saat Reject", "Office Phone" / "Mobile Phone") score above SAME, so
  // after a one-row shift pass 1 handed each id its NEIGHBOUR's handler and the suite verified the wrong scenario.
  const squash = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  for (const c of cases) {
    const hits = [...byHandler.values()].filter(e => keys.has(e.handler) && !claimed.has(e.handler) && squash(e.scenario) === squash(c.scenario));
    const e = hits.find(h => h.id === c.id) || hits[0];       // twins: same id first, else in workbook order
    if (!e) continue;
    next[c.id] = { handler: e.handler, scenario: accept ? c.scenario : e.scenario };
    claimed.add(e.handler);
    if (e.id !== c.id) report.renumbered.push(`${e.id} -> ${c.id}`);
  }

  // pass 1: an id whose mapped handler still describes (nearly) the same scenario keeps it
  const pending = [];
  for (const c of cases) {
    if (next[c.id]) continue;
    const e = prev[c.id];
    if (e && keys.has(e.handler) && !claimed.has(e.handler)) {
      const sim = similarity(c.scenario, e.scenario);
      if (sim >= SAME) { next[c.id] = { handler: e.handler, scenario: accept ? c.scenario : e.scenario }; claimed.add(e.handler); continue; }
    }
    pending.push(c);
  }
  // pass 2: follow a scenario to its new number, else keep a reworded one on its own number, else it is NEW
  for (const c of pending) {
    let best = null;
    for (const [handler, e] of byHandler) {
      if (claimed.has(handler) || !keys.has(handler)) continue;
      const sim = similarity(c.scenario, e.scenario);
      if (sim >= SAME && (!best || sim > best.sim)) best = { handler, sim, e };
    }
    if (best) {
      next[c.id] = { handler: best.handler, scenario: accept ? c.scenario : best.e.scenario };
      claimed.add(best.handler);
      if (best.e.id !== c.id) report.renumbered.push(`${best.e.id} -> ${c.id}`);
      continue;
    }
    const own = prev[c.id];
    if (own && keys.has(own.handler) && !claimed.has(own.handler) && similarity(c.scenario, own.scenario) >= CLOSE) {
      next[c.id] = { handler: own.handler, scenario: accept ? c.scenario : own.scenario, review: !accept };
      claimed.add(own.handler);
      if (!accept) report.changed.push(c.id);
      continue;
    }
    // a handler that was never mapped before is BRAND NEW: it was written for the TC that carries its own number today
    if (keys.has(c.id) && !claimed.has(c.id) && !everMapped.has(c.id)) {
      next[c.id] = { handler: c.id, scenario: c.scenario };
      claimed.add(c.id);
      continue;
    }
    report.added.push(c.id);
  }
  report.orphan = [...keys].filter(k => !Object.values(next).some(e => e.handler === k));
  fs.mkdirSync(path.dirname(mapFile), { recursive: true });
  fs.writeFileSync(mapFile, JSON.stringify(next, null, 1));
  console.log(`[sync] map ${mapFile}: ${Object.keys(next).length} of ${cases.length} test cases have a handler (${keys.size} handlers found)`);
  console.log(`[sync] RENUMBERED (${report.renumbered.length}): ${report.renumbered.join(', ') || '-'}`);
  console.log(`[sync] REWORDED   (${report.changed.length}): ${report.changed.join(', ') || '-'}   <- handler kept, re-check it, then run with --accept`);
  console.log(`[sync] NEW        (${report.added.length}): ${report.added.join(', ') || '-'}   <- no handler: reported as SKIP until one is written`);
  console.log(`[sync] ORPHAN     (${report.orphan.length}): ${report.orphan.join(', ') || '-'}   <- handler no TC points to`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = n => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const bool = n => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
  const mapFile = flag('--map');
  const handlersDir = flag('--handlers');
  const accept = bool('--accept');
  const [xlsx, sheetName, out, idRe = '^TC-[A-Z]+-\\d+$'] = argv;
  if (!xlsx || !sheetName || !out) {
    console.error('usage: sync-testcases.js <xlsx> <sheet> <out.json> [idRegex]');
    process.exit(2);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`sheet "${sheetName}" not in workbook; sheets: ${wb.worksheets.map(w => w.name).join(', ')}`);

  // find the header row: the first row containing a "TC ID" cell
  let headerRow = 0;
  const col = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    row.eachCell((cell, c) => {
      if (HEADERS.id.includes(clean(cell.value).toLowerCase())) headerRow = n;
    });
  });
  if (!headerRow) throw new Error('no header row with a "TC ID" column found');
  ws.getRow(headerRow).eachCell((cell, c) => {
    const h = clean(cell.value).toLowerCase();
    for (const [field, names] of Object.entries(HEADERS)) if (names.includes(h) && !col[field]) col[field] = c;
  });
  const missing = ['id', 'scenario', 'expected'].filter(f => !col[f]);
  if (missing.length) throw new Error(`workbook has no column for: ${missing.join(', ')}`);

  const re = new RegExp(idRe);
  const cases = [];
  let feature = '';
  ws.eachRow((row, n) => {
    if (n <= headerRow) {
      const m = clean(row.getCell(1).value).match(/Feature\s*\d+[^()]*/i);
      if (m) feature = m[0].trim();
      return;
    }
    const first = clean(row.getCell(1).value);
    const id = clean(row.getCell(col.id).value);
    if (!re.test(id)) {
      const m = first.match(/Feature\s*\d+[^()]*/i);
      if (m) feature = m[0].trim();
      return;
    }
    const c = {
      id,
      feature,
      kind: col.kind ? clean(row.getCell(col.kind).value) : '',
      scenario: clean(row.getCell(col.scenario).value),
      steps: col.steps ? clean(row.getCell(col.steps).value) : '',
      data: col.data ? clean(row.getCell(col.data).value) : '',
      expected: clean(row.getCell(col.expected).value),
      review: col.review ? clean(row.getCell(col.review).value) : '',
      fsd: col.fsd ? clean(row.getCell(col.fsd).value) : '',
    };
    c.hash = crypto.createHash('sha1').update([c.scenario, c.steps, c.data, c.expected].join('\u0001')).digest('hex').slice(0, 10);
    cases.push(c);
  });

  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')).cases || [] : [];
  const was = new Map(prev.map(c => [c.id, c]));
  const now = new Map(cases.map(c => [c.id, c]));
  const added = cases.filter(c => !was.has(c.id)).map(c => c.id);
  const removed = prev.filter(c => !now.has(c.id)).map(c => c.id);
  const changed = cases.filter(c => was.has(c.id) && was.get(c.id).hash !== c.hash).map(c => c.id);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    source: path.basename(xlsx), sheet: sheetName, syncedAt: new Date().toISOString(), cases,
  }, null, 2));

  if (mapFile) syncMap({ cases, mapFile, handlersDir, accept });

  console.log(`[sync] ${cases.length} test cases -> ${out}`);
  if (prev.length) {
    console.log(`[sync] ADDED   (${added.length}): ${added.join(', ') || '-'}`);
    console.log(`[sync] REMOVED (${removed.length}): ${removed.join(', ') || '-'}`);
    console.log(`[sync] CHANGED (${changed.length}): ${changed.join(', ') || '-'}   <- re-check these handlers`);
  } else {
    console.log('[sync] first sync — nothing to diff against');
  }
}

main().catch(e => { console.error('[sync] ' + e.message); process.exit(1); });
