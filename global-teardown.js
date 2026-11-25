/**
 * Global teardown + the REPORT/ PDF renderer.
 *
 * TWO THINGS USED TO BE WRONG HERE, and both are worth remembering:
 *
 * 1. This module ended with `setTimeout(() => process.exit(0), 2000)`. Playwright
 *    runs globalTeardown BEFORE the reporters' `onEnd` (runner: the task list
 *    finishes, THEN `finishTaskRun` awaits `reporter.onEnd`), so that timer raced
 *    report writing — and when the reporters took longer than 2s the forced exit 0
 *    won and a red run reported success. That is exactly the defect the
 *    one-test-per-TC migration removed, re-introduced at the very last step. Never
 *    call `process.exit()` here: let the teardown return and let Playwright set the
 *    exit code. If a stray handle really keeps the process alive, close the handle.
 *
 * 2. For the same ordering reason, walking suites/ for `test_report.html` from
 *    inside the teardown rendered the PREVIOUS run's report — the current one had
 *    not been written yet. PDF generation therefore lives in
 *    `reporters/excel-html-reporter.js`'s `onEnd`, which calls `generateSuitePdfs()`
 *    below with the paths it just wrote. This file only exports the machinery.
 *
 * `npm run report:pdf -- "suites/<Feature>"` (scripts/report-to-pdf.js) remains the
 * way to re-render one suite's PDF by hand without re-running Playwright.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname);

function dirToSuiteName(relDir) {
  return relDir
    .replace(/^suites[\\/]/, '')
    .replace(/[\\/\s]+/g, '_');
}

async function generatePdf(htmlFile, outputPath, screenshotsBase, screenshotsPrefix) {
  const { chromium } = require('@playwright/test');

  let html = fs.readFileSync(htmlFile, 'utf-8');

  const escapedPrefix = screenshotsPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hrefRe = () => new RegExp(`href="${escapedPrefix}([^"]+)"`, 'g');

  const seen = new Set();
  const orderedScreenshots = [];
  html.replace(hrefRe(), (_, filename) => {
    if (!seen.has(filename)) { seen.add(filename); orderedScreenshots.push(filename); }
  });

  html = html.replace(hrefRe(), (_, filename) => {
    const id = 'img-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
    return `href="#${id}"`;
  });
  html = html.replace(/ target="_blank"/g, '');

  let appendix = `
  <div style="margin-top:40px;">
    <div style="page-break-before:always; padding:24px 32px;">
      <h2 style="font-family:'Segoe UI',Arial,sans-serif;color:#1565C0;margin-bottom:24px;">Evidence</h2>`;

  for (const filename of orderedScreenshots) {
    const imgPath = path.join(screenshotsBase, filename);
    const id = 'img-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
    const label = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    let imgTag;
    // WHY this branches on extension: API suites contribute their evidence as TEXT
    // (utils/tc.js evidenceHttp writes the request/response exchange as a .txt),
    // because an API test has no page to screenshot. Base64-inlining a .txt into an
    // <img> produced a broken image in the PDF — the artefact a failed API test
    // leaves behind is the only one it has, so it has to render.
    const ext = path.extname(filename).slice(1).toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
    if (!fs.existsSync(imgPath)) {
      imgTag = `<p style="color:#999;font-style:italic;">Evidence not found: ${filename}</p>`;
    } else if (isImage) {
      const mime = ext === 'svg' ? 'svg+xml' : ext.replace('jpg', 'jpeg');
      const b64 = fs.readFileSync(imgPath).toString('base64');
      // HEADLESS evidence is a 1440x2000 viewport screenshot; scaled to the appendix's content
      // width that comes out close enough to one A3 page's printable height (~1542px at 96dpi,
      // 420mm minus the 6mm top/bottom @page margins) that it, plus the label above it, tips
      // over the edge — Chromium then can't honor page-break-inside:avoid on the wrapping div
      // (an <img> isn't fragmented mid-image, so it defers the WHOLE image to the next page,
      // stranding the label alone on the page before it). Cap the rendered height well inside
      // one page so the pair always fits together, confirmed by re-rendering after this change.
      imgTag = `<img src="data:image/${mime};base64,${b64}" style="max-width:100%;max-height:1300px;border:1px solid #f5f5f5;border-radius:4px;"/>`;
    } else {
      const esc = fs.readFileSync(imgPath, 'utf-8')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      imgTag = `<pre style="background:#fff;border:1px solid #e0e0e0;border-radius:4px;padding:12px 14px;`
             + `font-family:Consolas,'Courier New',monospace;font-size:0.72em;line-height:1.45;`
             + `white-space:pre-wrap;word-break:break-word;margin:0;">${esc}</pre>`;
    }
    appendix += `
      <div id="${id}" style="break-inside:avoid;page-break-inside:avoid;margin-bottom:48px;">
        <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.9em;color:#555;margin-bottom:8px;font-weight:600;break-after:avoid;page-break-after:avoid;">${label}</p>
        ${imgTag}
      </div>`;
  }

  appendix += `\n    </div>\n  </div>`;
  html = html.replace('</body>', appendix + '</body>');

  const pageCSS = `<style>
    @page { margin: 6mm 0mm; background: #f5f5f5; }
    @page :first { margin-top: 0; }
  </style>`;
  html = html.replace('</head>', pageCSS + '</head>');

  const tmpFile = path.join(os.tmpdir(), `report_pdf_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(tmpFile));
  await page.waitForLoadState('networkidle');
  // The evidence images are base64 data: URIs, so 'networkidle' fires before they've actually
  // decoded/laid out (data: URIs raise no network event at all) — printing before that race was
  // confirmed to split an evidence block's label and image across a page break (the label's own
  // height was known, the image's wasn't yet, so the paginator mis-measured the block). Wait for
  // every <img> to finish decoding so the page's real layout height is settled before page.pdf().
  await page.evaluate(() => Promise.all([...document.images].map(img =>
    img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
  )));
  await page.pdf({
    path: outputPath,
    format: 'A3',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  await browser.close();
  fs.unlinkSync(tmpFile);
}


/**
 * Where a suite's PDFs are filed. `suites/<Feature>/report.json` = { "group": "<Group>", "menu": "<Menu>" } puts them in
 * REPORT/<group>/<menu>/ (one folder per menu, grouped by module family); a suite without that file keeps the flat REPORT/.
 */
function reportFolder(suiteDir) {
  const root = path.join(ROOT, 'REPORT');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(suiteDir, 'report.json'), 'utf8'));
    const seg = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();   // a folder name, never a path
    return path.join(root, ...[seg(cfg.group), seg(cfg.menu)].filter(Boolean));
  } catch (_) { return root; }
}

/**
 * `report.json` may also list `also: ["mismatch-report.md"]` — suite-relative files copied beside every PDF written for that suite
 * (e.g. the findings report), so the folder of a menu holds the whole report package. An entry that leaves the suite folder, or
 * that does not exist, is skipped with a warning; a copy problem never changes the run's verdict.
 *
 * @returns {string[]} the file names copied into `reportDir`
 */
function copyReportAlso(suiteDir, reportDir) {
  let names = [];
  try { names = [].concat(JSON.parse(fs.readFileSync(path.join(suiteDir, 'report.json'), 'utf8')).also || []); } catch (_) { return []; }
  const root = path.resolve(suiteDir);
  const copied = [];
  for (const name of names) {
    const src = path.resolve(root, String(name));
    if (!src.startsWith(root + path.sep)) { console.warn(`  [report] "also" entry "${name}" is outside the suite folder — skipped`); continue; }
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { console.warn(`  [report] "also" file "${name}" not found in ${path.relative(ROOT, root)} — skipped`); continue; }
    try {
      fs.copyFileSync(src, path.join(reportDir, path.basename(src)));
      copied.push(path.basename(src));
    } catch (err) { console.warn(`  [report] could not copy "${name}": ${err.message}`); }
  }
  return copied;
}

/**
 * Compact "001,003-004,009-011" style label from a list of TC ids (e.g. "TC-5.1-009"), so a
 * filtered run's PDF filename says which test cases it covers instead of only a timestamp —
 * useful when iterating with `-g` on a subset. Consecutive numbers collapse into a range; a
 * single gap stays its own entry. Numbers are re-padded to the widest id's digit count, so
 * "9" next to "011" still reads "009". Returns '' when no id in the list ends in digits.
 */
function tcRangeLabel(tcIds) {
  const nums = (tcIds || [])
    .map(id => (String(id).match(/(\d+)$/) || [])[1])
    .filter(Boolean)
    .map(s => ({ n: Number(s), w: s.length }));
  if (!nums.length) return '';
  const width = Math.max(...nums.map(x => x.w));
  const pad = n => String(n).padStart(width, '0');
  const sorted = [...new Set(nums.map(x => x.n))].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    ranges.push(start === prev ? pad(start) : `${pad(start)}-${pad(prev)}`);
    if (cur !== undefined) start = prev = cur;
  }
  return ranges.join(',');
}

/**
 * Render one timestamped PDF per suite report into REPORT/ (or REPORT/<group>/<menu>/, see reportFolder),
 * and copy the suite's `also` files beside it (see copyReportAlso).
 *
 * Called from reporters/excel-html-reporter.js `onEnd` with the absolute paths of
 * the `test_report.html` files that reporter just wrote — so every PDF is rendered
 * from THIS run's report, not the previous one's. Best-effort: a PDF failure is
 * logged and never changes the run's verdict.
 *
 * @param {(string|{path: string, tcIds?: string[]})[]} reportFiles absolute paths to
 *   suites/<Feature>/test_report.html, or {path, tcIds} to also stamp the executed TC
 *   range into the PDF filename (tcIds omitted/empty = old plain-path behaviour).
 * @returns {Promise<string[]>} the PDF paths written
 */
async function generateSuitePdfs(reportFiles) {
  const entries = (reportFiles || [])
    .map(f => (typeof f === 'string' ? { path: f, tcIds: [] } : f))
    .filter(e => e && e.path && fs.existsSync(e.path));
  if (entries.length === 0) return [];

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  const written = [];
  for (const { path: htmlFile, tcIds } of entries) {
    const suiteDir = path.dirname(htmlFile);
    const suiteName = dirToSuiteName(path.relative(ROOT, suiteDir));
    const reportDir = reportFolder(suiteDir);
    fs.mkdirSync(reportDir, { recursive: true });
    const range = tcRangeLabel(tcIds);
    const outputPath = path.join(reportDir, `${timestamp}_${suiteName}${range ? `_TC${range}` : ''}.pdf`);
    try {
      await generatePdf(htmlFile, outputPath, path.join(suiteDir, 'screenshots'), 'screenshots/');
      written.push(outputPath);
      const alongside = copyReportAlso(suiteDir, reportDir);
      if (alongside.length) console.log(`  [report] copied beside the PDF: ${alongside.join(', ')}`);
    } catch (err) {
      console.error(`  [PDF] FAILED ${suiteName}: ${err.message}`);
    }
  }
  return written;
}

/**
 * globalTeardown. Deliberately does almost nothing: it runs BEFORE the reporters'
 * onEnd, so anything that reads a report from disk here reads a stale one, and
 * anything that exits the process here throws away Playwright's verdict.
 */
module.exports = async () => {
  console.log('\n[teardown] Global teardown complete.\n');
};

// Exposed for reporters/excel-html-reporter.js (the per-run REPORT/ PDFs) and for
// any tool that wants to re-render a single report without re-running Playwright.
module.exports.generatePdf = generatePdf;
module.exports.generateSuitePdfs = generateSuitePdfs;
module.exports.reportFolder = reportFolder;
module.exports.copyReportAlso = copyReportAlso;
