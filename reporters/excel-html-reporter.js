/**
 * Playwright reporter that produces this project's client-facing per-suite
 * test_report.html — the same document as before, from real Playwright results.
 *
 * WHY THIS EXISTS
 * ---------------
 * The suites used to build that report themselves: a module-level `allResults`
 * array, a `record()` call per test case, and a sidecar `.<variant>_results.json`
 * per worker that every worker re-read and merged so the last one to finish wrote
 * a complete document.
 *
 * All of that was working around one thing: workers are separate processes and
 * cannot share memory. A Playwright reporter runs in the MAIN process and is
 * handed every result from every worker — so the sidecar merge, the re-read loop
 * and the "whichever variant finishes last wins" race all disappear.
 *
 * The bigger win is the exit code. Building the report inside a single mega-test
 * required a helper that caught assertion errors so the next test case could still
 * run; Playwright therefore saw one passing test regardless of how many test cases
 * had failed, and exited 0. Now each test case is its own `test()`, failures are
 * real failures, and `npx playwright test` can gate a pipeline.
 *
 * Suites contribute report metadata through utils/tc.js annotations; nothing here
 * needs the suite to know a reporter exists.
 */

const fs = require('fs');
const path = require('path');
const { generateHTMLReport } = require('../utils/reporter');
const { applyManualEvidence } = require('../utils/manual-evidence');
const { ANNOTATION } = require('../utils/tc');
const { writeTcResults } = require('../utils/excel');
const { getSelectedEnv } = require('../utils/profile');

const ROOT = path.resolve(__dirname, '..');
// Whole ids, multi-part ones included: TC-004, VEP_030, TC-SALES-138, TC-EXCHRATE-001.
const TC_ID_IN_TITLE = /\b[A-Za-z]{2,10}(?:[-_][A-Za-z]{2,10})*[-_]\d{1,4}\b/;

/**
 * How many `test(...)` cases this suite FILE defines in total (a plain count, not an id parse —
 * ids like "TC-5.1-001" mix letters/digits/dots in ways not worth re-matching here). Used so the
 * PDF filename only gets a TC-range suffix for a genuinely PARTIAL run (e.g. `-g` on a subset); a
 * full run of the module keeps its plain name. Best-effort: an unreadable file means "don't know
 * the total", treated as "not a full run" (0 never satisfies the >= check below).
 */
function totalTestCountInFile(file) {
  try {
    const src = fs.readFileSync(file, 'utf-8');
    return src.split('\n').filter(line => /^\s*test\s*\(\s*(['"`])/.test(line)).length;
  } catch (_) { return 0; }
}

/**
 * Playwright surfaces runtime annotations on BOTH TestCase and TestResult, so a
 * naive concat duplicates every one of them — which showed up as the same
 * screenshot linked twice in the report. Dedupe on type+description: two notes
 * with different text both survive, an identical pair collapses to one.
 */
function annotationsOf(test, result) {
  const seen = new Set();
  const out = [];
  for (const a of [].concat(test.annotations || [], (result && result.annotations) || [])) {
    if (!a || !a.type) continue;
    const key = `${a.type} ${a.description || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function firstAnnotation(anns, type) {
  const hit = anns.find(a => a.type === type);
  return hit ? hit.description : '';
}

function allAnnotations(anns, type) {
  return anns.filter(a => a.type === type).map(a => a.description).filter(Boolean);
}

/**
 * evidence() writes a plain filename normally, or a JSON-encoded {file,label}
 * when the suite gave that call a caption (a before/after story needs more than
 * generic "View N" links) — see utils/tc.js. Parse the latter back to an object;
 * anything that is not valid {file,...} JSON stays a plain filename string, which
 * is also what every call without a label still produces.
 */
function parseEvidence(items) {
  return items.map(d => {
    if (typeof d === 'string' && d.startsWith('{')) {
      try {
        const parsed = JSON.parse(d);
        if (parsed && typeof parsed === 'object' && parsed.file) return parsed;
      } catch (_) {}
    }
    return d;
  });
}

/** Playwright's own verdict, unless the test declared a non-verdict status. */
function resolveStatus(anns, result) {
  const declared = firstAnnotation(anns, ANNOTATION.STATUS);
  if (declared) return declared;
  if (result.status === 'passed') return 'PASSED';
  if (result.status === 'skipped') return 'SKIPPED';
  return 'FAILED';
}

function cleanError(result) {
  const err = result.error || (result.errors && result.errors[0]);
  if (!err) return '';
  return String(err.message || err.value || '')
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    // Keep the assertion's own message and its Expected/Received lines — that is the "why" the
    // report owes the reader; the Call log / code frame / stack below it is noise there.
    .filter(l => !/^(at |Call log:|- |\d+ \||>\s*\d+ \||\|)/.test(l))
    .slice(0, 8)
    .join('\n');
}

/**
 * Reviewer comments for FAILED / SKIP / INVALID rows: suites/<Feature>/review_comments.json, keyed by TC id.
 *
 *   { "TC-SALES-001": { "status": "FAILED", "comment": "why it failed / what to do" },
 *     "TC-SALES-002": { "status": "FAILED", "category": "bug|script|data|drift|config|todo|cek",
 *                       "why": "plain-language reason", "check": "how to validate it by hand" },
 *     "TC-SALES-138": "a plain string applies to any FAILED / SKIP / SKIPPED / INVALID verdict" }
 *
 * A row nobody reviewed still gets a guessed triage, labelled as such (utils/explain.js).
 *
 * A comment is written AFTER a run, by someone who read the trace — it is triage, not a test
 * result, so it never changes a status. It only attaches while the row still has the verdict it
 * was written for: a TC that passes on a later run drops the comment, and a `status` pins it to
 * one verdict so a FAILED explanation never lands on a SKIP. `scripts/rebuild-report.js`
 * re-renders the report with fresh comments without re-running the suite.
 */
const COMMENTED = new Set(['FAILED', 'SKIP', 'SKIPPED', 'INVALID']);

function loadComments(dir) {
  const file = path.join(dir, 'review_comments.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[excel-report] ignoring ${path.relative(ROOT, file)}: ${err.message}`);
    return {};
  }
}

function commentFor(comments, tcId, status) {
  if (!COMMENTED.has(status)) return '';
  const entry = comments[tcId];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (entry.status && entry.status !== status) return '';
  // A structured triage (utils/explain.js): category + plain-language why + how to validate by hand.
  if (entry.category || entry.why) return { category: entry.category || '', why: entry.why || '', check: entry.check || '', comment: entry.comment || '' };
  return entry.comment || '';
}

/** The describe chain, minus the project and file entries Playwright prepends. */
function suiteNameOf(test) {
  const parts = test.titlePath().filter(Boolean);
  const describes = parts.slice(0, -1).filter(p => !p.endsWith('.js') && p !== '');
  return describes.length ? describes.join(' — ') : path.basename(path.dirname(test.location.file));
}

/**
 * Evidence file names are the same every run, so a folder that several runs wrote into mixes them:
 * a test case that passed today kept yesterday's `<id>_failed.png`, a test case Blocked today kept the
 * `<id>.png` of an older pass, and an interrupted run overwrote half the images a finished report links
 * (2026-09-28 audit: 133 of 270 PNGs came from a run that never produced a report). For every test case
 * that ran in THIS run, delete the `<id>.png` / `<id>_*.png` files this run did not attach. Test cases
 * outside the run (a `-g` rerun) are left alone.
 */
/**
 * A row KEPT by REPORT_MERGE (not re-run now) links the screenshots of the run that produced it. screenshots/ is shared by every run
 * and a file name is the same each run, so by now such a file may be gone (another machine's run, a run that took other shots) or
 * overwritten by a later run — a dead link, or worse, another run's picture beside this row's notes (2026-10-19: 11 dead links and a
 * dozen of today's pictures under 2026-10-07 notes in one merged New Transaction MF report). Keep a link only when the file exists and
 * was written no later than the row's own run; otherwise drop it and say so in the row. Returns the row (a copy when changed).
 */
function checkKeptEvidence(dir, row) {
  const list = [].concat(row.screenshot || []);
  if (!list.length) return row;
  const ended = Date.parse(row.timestamp || '') || 0;
  const fileOf = e => (typeof e === 'string' ? e : e.file);
  const kept = []; const lost = [];
  const exists = p => { try { return fs.statSync(p); } catch (_) { return null; } };
  for (const e of list) {
    const st = exists(path.join(dir, 'screenshots', fileOf(e)));
    // A tester's own picture (<TC>_manual_<n>.png, utils/manual-evidence.js) is added AFTER the run and re-copied from
    // <suite>/manual-evidence/ on every generation: it is not a run's evidence, so it is never dated — only required to exist.
    if (/_manual_\d+/i.test(path.basename(fileOf(e)))) {
      if (st || exists(path.join(dir, 'manual-evidence', path.basename(fileOf(e))))) kept.push(e); else lost.push(`${path.basename(fileOf(e))} (file tidak ada)`);
      continue;
    }
    // 2 s of slack for file-system timestamp granularity; a row without a timestamp can only be checked for existence
    if (st && (!ended || st.mtimeMs <= ended + 2000)) kept.push(e); else lost.push(`${path.basename(fileOf(e))} (${st ? 'ditimpa run lain' : 'file tidak ada'})`);
  }
  if (!lost.length) return row;
  const when = row.timestamp ? row.timestamp.slice(0, 16).replace('T', ' ') : 'sebelumnya';
  const note = `evidence run ${when} tidak tersedia lagi: ${lost.join(', ')} — jalankan ulang TC ini untuk evidence baru`;
  return { ...row, screenshot: kept.length === 0 ? null : kept.length === 1 ? kept[0] : kept, notes: [row.notes, note].filter(Boolean).join(' | ') };
}

function pruneStaleEvidence(dir, payload) {
  const shots = path.join(dir, 'screenshots');
  if (!fs.existsSync(shots)) return;
  const keep = new Set();
  const ids = new Set();
  for (const { results } of payload) {
    for (const r of results) {
      ids.add(r.tcId);
      // an entry is a plain path or, for a labelled shot, { file, label } (parseEvidence)
      for (const e of [].concat(r.screenshot || [])) keep.add(path.normalize(typeof e === 'string' ? e : e.file));
    }
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ours = new RegExp(`^(${[...ids].filter(Boolean).map(esc).join('|')})(_[^/]*)?\\.(png|txt)$`);
  const walk = (d, rel) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? path.join(rel, f.name) : f.name;
      if (f.isDirectory()) { walk(path.join(d, f.name), r); continue; }
      if (ours.test(f.name) && !keep.has(path.normalize(r))) fs.rmSync(path.join(d, f.name), { force: true });
    }
  };
  if (ids.size) walk(shots, '');
}

class ExcelHtmlReporter {
  constructor(options = {}) {
    this.options = options;
    this.byDir = new Map();      // suite folder -> Map(suiteName -> Map(testId -> row))
    this.comments = new Map();   // suite folder -> review_comments.json contents
    this.suiteFiles = new Map(); // suite folder -> absolute path of its test.js (for the full-run check below)
    this.flaky = [];
    this.startedAt = null;
  }

  // The `list` reporter already owns stdout; staying quiet keeps the run readable.
  printsToStdio() { return false; }

  onBegin() { this.startedAt = Date.now(); }

  onTestEnd(test, result) {
    const anns = annotationsOf(test, result);
    const dir = path.dirname(test.location.file);
    const suiteName = suiteNameOf(test);
    if (!this.suiteFiles.has(dir)) this.suiteFiles.set(dir, test.location.file);

    const status = resolveStatus(anns, result);
    const defect = status === 'FAILED' ? firstAnnotation(anns, ANNOTATION.DEFECT) : '';
    const notes = allAnnotations(anns, ANNOTATION.NOTES);
    // A known defect's description leads a FAILED row; on a pass (defect fixed) it is not shown.
    if (defect) notes.unshift(...allAnnotations(anns, ANNOTATION.DEFECT_TEXT).map(d => `Defect ${defect}: ${d}`));
    const error = cleanError(result);
    if (error) notes.push(error);
    if (result.retry > 0 && result.status === 'passed') {
      notes.push(`flaky: passed on retry ${result.retry}`);
      this.flaky.push(`${suiteName} :: ${test.title}`);
    }

    const row = {
      tcId: firstAnnotation(anns, ANNOTATION.ID) || (test.title.match(TC_ID_IN_TITLE) || [test.title])[0],
      status,
      expected: firstAnnotation(anns, ANNOTATION.EXPECTED) || test.title,
      notes: notes.join(' | '),
      // When the test ended. startTime + duration alone ends too early for the first test of a worker: its beforeAll (the
      // login) runs after startTime but is not in duration, so its evidence looked newer than its row and the next
      // REPORT_MERGE dropped it as "ditimpa run lain" (Unit Link Fund 2026-10-23: SF-001/004/005/011/017/019 lost their
      // pictures). onTestEnd runs once the test is over, so the later of the two is the real end.
      timestamp: new Date(Math.max(Date.now(), result.startTime ? new Date(result.startTime).getTime() + (result.duration || 0) : 0)).toISOString(),
      screenshot: parseEvidence(allAnnotations(anns, ANNOTATION.EVIDENCE)),
      durationMs: result.duration,
      defect,
      workbook: firstAnnotation(anns, ANNOTATION.WORKBOOK),
      flow: firstAnnotation(anns, ANNOTATION.FLOW),
    };
    if (!this.comments.has(dir)) this.comments.set(dir, loadComments(dir));
    row.comment = commentFor(this.comments.get(dir), row.tcId, row.status);
    if (!row.flow) delete row.flow;
    if (row.screenshot.length === 0) row.screenshot = null;
    else if (row.screenshot.length === 1) row.screenshot = row.screenshot[0];

    if (!this.byDir.has(dir)) this.byDir.set(dir, new Map());
    const suites = this.byDir.get(dir);
    if (!suites.has(suiteName)) suites.set(suiteName, new Map());
    // A failure is only overturned by a PASS. When the retry is skipped instead (its precondition was used
    // up by the failed attempt), the earlier FAILED stands: letting the skip replace it once turned a real
    // defect into "Blocked — precondition missing" (Insurance Partner ED-011, 2026-09-30).
    const prev = suites.get(suiteName).get(test.id);
    if (prev && prev.status === 'FAILED' && result.status === 'skipped') {
      prev.notes = [prev.notes, `retry ${result.retry} dilewati (${notes.join(' | ') || 'skip'}) — hasil percobaan sebelumnya (FAILED) tetap berlaku`].filter(Boolean).join(' | ');
      return;
    }
    // A retry replaces its earlier attempt: the report shows the final verdict,
    // and the flaky note above is what preserves the fact that it took a retry.
    suites.get(suiteName).set(test.id, row);
  }

  async onEnd(runResult) {
    const written = [];
    const totals = { PASSED: 0, FAILED: 0, SKIPPED: 0, SKIP: 0, MANUAL: 0, COMBINE: 0, INVALID: 0, 'BELUM TERDEVELOPMENT': 0 };

    // REPORT_MERGE=1: this run only re-ran SOME test cases (-g ...). Keep every other row of the last report and replace the
    // re-run ones by tcId, so one report still covers the whole workbook. The rows of the last report live in
    // <suite>/.report-rows.json, written at the end of every run. Off by default: a normal run always reports itself only.
    // A suite whose report.json says "mergePartial": true merges every PARTIAL run without the flag (a forgotten flag once
    // replaced a green 102-row SIT report with 4 rows of a partial re-run); a full run still replaces
    // the report. REPORT_MERGE=0 turns it off for one run.
    const mergeFlag = process.env.REPORT_MERGE;
    for (const [dir, suites] of this.byDir) {
      const payload = [];
      const rowsFile = path.join(dir, '.report-rows.json');
      const metaFile = path.join(dir, '.report-rows.meta.json');   // which environment the saved rows came from (a sidecar: other tools read rowsFile as-is)
      const envNow = process.env.ENV || '';
      // Collected regardless of merge: the PDF filename names the TC(s) THIS run actually executed
      // (what onTestEnd saw), never rows only carried over from a previous merged report.
      const executedTcIds = [...suites.values()].flatMap(rows => [...rows.values()].map(r => r.tcId));
      // Only stamp a TC-range into the PDF filename for a genuinely PARTIAL run of this module
      // (e.g. -g on a subset). A full run — every TC the file defines got executed — keeps the
      // plain "<timestamp>_<suite>.pdf" name; no range suffix needed when nothing was left out.
      const total = totalTestCountInFile(this.suiteFiles.get(dir) || '');
      const isFullRun = total > 0 && new Set(executedTcIds).size >= total;
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf-8')) || {}; } catch (_) { /* no report.json */ }
      const autoMerge = cfg.mergePartial === true && !isFullRun && mergeFlag !== '0';
      const merge = mergeFlag === '1' || autoMerge;
      let saved = {};
      if (merge) {
        try { saved = JSON.parse(fs.readFileSync(rowsFile, 'utf-8')); } catch (_) { saved = {}; }
        // Rows of another environment must never be mixed into this run's report (a DEV re-run merged into a SIT report would
        // present DEV results as SIT's). Files written before this sidecar existed carry no environment and merge as before.
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')); } catch (_) { /* none yet */ }
        if (meta && meta.env && envNow && String(meta.env).toLowerCase() !== envNow.toLowerCase()) {
          console.warn(`[excel-report] REPORT_MERGE ignored for ${path.relative(ROOT, dir)}: the saved rows are from ${meta.env}, this run is ${envNow} — the report holds only this run.`);
          saved = {};
        } else if (autoMerge && mergeFlag !== '1' && Object.keys(saved).length) {
          console.log(`[excel-report] partial run merged into the last ${meta && meta.env || ''} ${path.relative(ROOT, dir)} report (report.json mergePartial; REPORT_MERGE=0 to replace it instead)`);
        }
      }
      const toSave = {};
      for (const [suiteName, rows] of suites) {
        let results = [...rows.values()];
        if (merge && Array.isArray(saved[suiteName])) {
          const byId = new Map(saved[suiteName].map(r => [r.tcId, checkKeptEvidence(dir, r)]));
          const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
          for (const r of results) byId.set(r.tcId, { ...r, notes: `[RE-RUN ${stamp}] ${r.notes || ''}`.trim() });
          results = [...byId.values()];
        }
        // The tester's own pictures / verdicts (<suite>/manual-evidence/) are applied on EVERY generation, merged rows included.
        applyManualEvidence(dir, results);
        results.forEach(r => { if (totals[r.status] !== undefined) totals[r.status]++; });
        payload.push({ suiteName, results });
        toSave[suiteName] = results;
      }
      try {
        fs.writeFileSync(rowsFile, JSON.stringify(toSave), 'utf-8');
        fs.writeFileSync(metaFile, JSON.stringify({ env: envNow || null, flow: process.env.SUITE_FLOW || null, at: new Date().toISOString() }), 'utf-8');
      } catch (_) { /* only costs the next merge */ }
      this.archiveRun(dir, suites);
      pruneStaleEvidence(dir, payload);
      try {
        written.push({ path: generateHTMLReport(payload, dir, 'screenshots'), tcIds: isFullRun ? [] : executedTcIds });
      } catch (err) {
        console.error(`[excel-report] could not write the report for ${dir}: ${err.message}`);
      }
    }

    // A re-render of an old run (scripts/rebuild-report.js) is not a new run.
    if (this.options.history !== false) this.appendHistory(runResult, totals);
    await this.writeWorkbooks();

    if (written.length) {
      console.log(`\n[excel-report] ${written.length} suite report(s):`);
      for (const p of written) console.log(`  ${path.relative(ROOT, p.path)}`);
    }
    if (this.flaky.length) {
      console.log(`[excel-report] ${this.flaky.length} flaky (passed only on retry):`);
      for (const f of this.flaky) console.log(`  ${f}`);
    }

    await this.writePdfs(written);
  }

  /**
   * Opt-in (suites/<Feature>/report.json: { "keepRuns": true }): keep THIS run's own rows and the evidence they link in
   * <suite>/.runs/<env>/<stamp>/ — the next run overwrites both .report-rows.json and screenshots/, and
   * scripts/merge-runs.js builds one report from every kept run of an environment. Best-effort, like the PDFs.
   */
  archiveRun(dir, suites) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf-8')) || {}; } catch (_) { return; }
    if (cfg.keepRuns !== true) return;
    try {
      const pad = n => String(n).padStart(2, '0');
      const d = new Date();
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
      const out = path.join(dir, '.runs', getSelectedEnv() || 'unknown', stamp);
      fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
      const rows = {};
      for (const [suiteName, byId] of suites) rows[suiteName] = [...byId.values()];
      fs.writeFileSync(path.join(out, 'rows.json'), JSON.stringify(rows), 'utf-8');
      let copied = 0;
      for (const list of Object.values(rows)) {
        for (const r of list) {
          for (const sh of [].concat(r.screenshot || [])) {
            const file = typeof sh === 'object' ? sh.file : sh;
            const src = path.join(dir, 'screenshots', file);
            if (file && fs.existsSync(src)) { fs.copyFileSync(src, path.join(out, 'screenshots', file)); copied++; }
          }
        }
      }
      console.log(`[excel-report] run kept: ${path.relative(ROOT, out)} (${copied} evidence files)`);
    } catch (err) {
      console.error(`[excel-report] could not keep the run for ${dir}: ${err.message}`);
    }
  }

  /**
   * Pass/Fail back into each suite's test-case workbook (the describe's `tc.workbook` annotation,
   * "Document/<file>.xlsx#<Sheet>"). Replaces the per-suite update_excel.py that had to be run by
   * hand after every run — and that re-copied the original workbook, wiping the other sheets.
   * Each file is loaded and saved once. Best-effort: a locked or missing workbook is logged and
   * never changes the run's verdict.
   */
  async writeWorkbooks() {
    const files = new Map();   // file -> Map(sheet -> rows)
    for (const suites of this.byDir.values()) {
      for (const rows of suites.values()) {
        for (const r of rows.values()) {
          if (!r.workbook) continue;
          const [file, sheet] = r.workbook.split('#');
          if (!files.has(file)) files.set(file, new Map());
          const sheets = files.get(file);
          if (!sheets.has(sheet)) sheets.set(sheet, []);
          sheets.get(sheet).push(r);
        }
      }
    }
    if (!files.size) return;
    const ExcelJS = require('exceljs');
    const run = { env: process.env.ENV || 'dev', date: new Date().toLocaleDateString('sv-SE') };   // local YYYY-MM-DD, not UTC
    for (const [file, sheets] of files) {
      const abs = path.resolve(ROOT, file);
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(abs);
        const lines = [];
        for (const [sheet, rows] of sheets) lines.push(`${writeTcResults(wb, sheet, rows, run)}/${rows.length} rows → "${sheet}"`);
        await wb.xlsx.writeFile(abs);
        console.log(`[excel-report] ${path.relative(ROOT, abs)}: ${lines.join(', ')}`);
      } catch (err) {
        console.error(`[excel-report] could not update ${file}: ${err.message}`);
      }
    }
  }

  /**
   * Timestamped PDFs into REPORT/, one per suite report.
   *
   * WHY HERE and not in global-teardown.js, which is where it used to live:
   * Playwright runs globalTeardown BEFORE this onEnd, so a teardown that walked
   * suites/ for test_report.html rendered the PREVIOUS run's report every time —
   * the current one had not been written yet, and the very first run found none at
   * all. Here the paths are the ones just written, so the PDF always matches.
   *
   * Best-effort and fully swallowed: a PDF is a convenience deliverable and must
   * never turn a green run red or a red run green.
   */
  async writePdfs(written) {
    if (!written.length) return;
    try {
      const { generateSuitePdfs } = require('../global-teardown');
      const pdfs = await generateSuitePdfs(written);
      if (pdfs.length) {
        console.log(`[excel-report] ${pdfs.length} PDF(s) → REPORT/`);
        for (const p of pdfs) console.log(`  ${path.relative(ROOT, p)}`);
      }
    } catch (err) {
      console.error(`[excel-report] PDF generation failed: ${err.message}`);
    }
  }

  /**
   * One line per run. A single report answers "is it green today"; the history
   * answers "is it getting better", "which test case eats the most time" and
   * "which one is quietly flaky" — the questions a test suite is actually judged on.
   */
  appendHistory(runResult, totals) {
    try {
      const dir = path.join(ROOT, 'reports');
      fs.mkdirSync(dir, { recursive: true });
      const graded = totals.PASSED + totals.FAILED + totals['BELUM TERDEVELOPMENT'];
      const record = {
        at: new Date().toISOString(),
        env: process.env.ENV || null,
        flow: process.env.SUITE_FLOW || null,
        ci: Boolean(process.env.CI),
        commit: (process.env.CI_COMMIT_SHORT_SHA || process.env.GITHUB_SHA || '').slice(0, 12) || null,
        status: runResult.status,
        durationMs: Date.now() - this.startedAt,
        totals,
        passRate: graded ? Number(((totals.PASSED / graded) * 100).toFixed(1)) : null,
        flaky: this.flaky,
      };
      fs.appendFileSync(path.join(dir, 'history.jsonl'), JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[excel-report] could not append run history: ${err.message}`);
    }
  }
}

module.exports = ExcelHtmlReporter;
module.exports.pruneStaleEvidence = pruneStaleEvidence;
// scripts/rebuild-report.js re-attaches fresh review comments to saved rows with these.
module.exports.loadComments = loadComments;
module.exports.commentFor = commentFor;
