#!/usr/bin/env node
/**
 * Re-render <suite>/test_report.html (and the PDF in REPORT/) from <suite>/.report-rows.json without running a test.
 *
 *   node scripts/rebuild-report.js suites/<Feature>
 *
 * For when the rows were corrected after the fact (a row whose test case cannot be repeated because the data it consumed is
 * gone). The reporter writes .report-rows.json at the end of every run; REPORT_MERGE=1 merges a partial re-run into it.
 */
const fs = require('fs');
const path = require('path');
const { generateHTMLReport } = require('../utils/reporter');
const { applyManualEvidence } = require('../utils/manual-evidence');

(async () => {
  const dirArg = process.argv[2];
  if (!dirArg) { console.error('usage: rebuild-report.js <suite folder>'); process.exit(2); }
  const dir = path.resolve(__dirname, '..', dirArg);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.report-rows.json'), 'utf8'));
  // the tester's pictures / verdicts of <suite>/manual-evidence/ (utils/manual-evidence.js); rows are written back only when that changed one
  let touched = 0;
  for (const results of Object.values(saved)) touched += applyManualEvidence(dir, results).changed;
  if (touched) fs.writeFileSync(path.join(dir, '.report-rows.json'), JSON.stringify(saved), 'utf-8');
  console.log('[rebuild] manual evidence applied: ' + touched + ' change(s)');
  // review_comments.json may have been written after the run: attach it as it is now.
  const { loadComments, commentFor } = require('../reporters/excel-html-reporter');
  const comments = loadComments(dir);
  for (const rows of Object.values(saved)) for (const r of rows) r.comment = commentFor(comments, r.tcId, r.status);
  const payload = Object.entries(saved).map(([suiteName, results]) => ({ suiteName, results }));
  const out = generateHTMLReport(payload, dir, 'screenshots');
  const totals = {};
  payload.forEach(p => p.results.forEach(r => { totals[r.status] = (totals[r.status] || 0) + 1; }));
  console.log('[rebuild] wrote', path.relative(path.resolve(__dirname, '..'), out), JSON.stringify(totals));
  try {
    const { generateSuitePdfs } = require('../global-teardown');
    const pdfs = await generateSuitePdfs([out]);
    pdfs.forEach(p => console.log('[rebuild] PDF', path.relative(path.resolve(__dirname, '..'), p)));
  } catch (err) { console.error('[rebuild] PDF generation failed: ' + err.message); }
})().catch(e => { console.error('[rebuild] ' + e.message); process.exit(1); });
