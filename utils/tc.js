/**
 * Test-case metadata helpers.
 *
 * These replace the old hand-rolled `record()` bookkeeping. The difference is not
 * cosmetic: `record()` ran inside a single mega-`test()` whose helper swallowed
 * every assertion error, so Playwright saw one passing test no matter how many
 * test cases had failed — and the process exited 0. A suite could be entirely red
 * and CI would be green.
 *
 * Here each test case is a real Playwright `test()`. Assertions are allowed to
 * throw, so pass/fail is Playwright's own verdict and the exit code means
 * something. These helpers only attach the metadata the client-facing report needs
 * (TC id, expected result, notes, evidence); `reporters/excel-html-reporter.js`
 * reads it back and renders the same test_report.html as before.
 *
 * Statuses that are not a pass/fail verdict — MANUAL, SKIP, SKIPPED — are recorded
 * as an annotation and then skip the test, so they appear in the report without
 * pretending to be assertions.
 */

const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { withFit } = require('./evidence-fit');

const STATUS = 'tc.status';
const ID = 'tc.id';
const EXPECTED = 'tc.expected';
const NOTES = 'tc.notes';
const EVIDENCE = 'tc.evidence';
const DEFECT = 'tc.defect';
const DEFECT_TEXT = 'tc.defect.text';
// Set on a describe, not in a test: `test.describe(name, { annotation: { type: 'tc.workbook',
// description: 'Document/<file>.xlsx#<Sheet>' } }, ...)`. The reporter writes every test case's
// Pass/Fail back into that sheet after the run.
const WORKBOOK = 'tc.workbook';
// The flow / variant a test case ran in ("Non-Approval"): see flow() below.
const FLOW = 'tc.flow';

function info() {
  return test.info();
}

function push(type, description) {
  info().annotations.push({ type, description: String(description == null ? '' : description) });
}

/**
 * Name the FLOW this test case ran in (e.g. 'Non-Approval': the same menu with its approval model switched off). Report metadata
 * only — the verdict is unchanged. The report prints it as a badge beside the TC id and lists the flows in its header, so a row
 * from a special flow can never be mistaken for the default flow's result. Call it right after tc().
 */
function flow(name) {
  push(FLOW, name);
}

/**
 * Declare the test case this test covers. Call it first in every test body.
 *
 * @param {string} id        TC id exactly as written in the source workbook (e.g. 'TC-004', 'VEP_030')
 * @param {string} expected  the workbook's expected result, phrased for a report reader
 */
function tc(id, expected) {
  push(ID, id);
  if (expected) push(EXPECTED, expected);
}

/**
 * Add an observation to the report row. Call it as many times as you like; the
 * report joins them. On a PASSED row this is the evidence that makes the pass
 * believable ("term=INV0, 12 rows all match"); on a FAILED row the assertion
 * error is captured automatically, so notes are for extra context only.
 */
function note(text) {
  push(NOTES, text);
}

/**
 * Tiled evidence (opt-in: `opts.tile = {}` or `{ maxW, maxH, margin, maxTiles }` on evidence()).
 *
 * ADAPT: the area finder below uses Ant Design class names (.ant-form-item, .ant-table-wrapper, .ant-layout-content…).
 * On another UI kit they match nothing and the tile falls back to the whole page body — add the kit's own selectors.
 *
 * WHY: a full-page shot of a 50 %-zoomed dashboard form is ~3200 x 5000 px. Opened in a browser tab it is shrunk to fit the window
 * (about 18 %), placed in the PDF it is shrunk to the page width (about 35 %): the text is unreadable although it was shot at 50 % zoom.
 * The picture is therefore CUT to what the test case is about and split into tiles of at most maxW x maxH pixels (default 2200 x 1300),
 * so every tile is shown at 50 % or more of its pixel size in the browser, the HTML report and the PDF:
 *   - focus given -> the area around the focused fields (fields that are close are merged into one area), `margin` around it;
 *   - no focus    -> the tight box of everything visible in the content area (side menu and top bar left out; titles, charts,
 *                    tables, buttons, toasts); a pop-up on screen = the pop-up.
 * A crop is never smaller than minW x minH (default 1000 x 640): a lone button is shown with the form around it.
 * Tile 1 is `<name>.png`, the next ones `<name>_2.png`, `<name>_3.png` ...
 * The page is already zoomed / unclipped / fitted by withFit when this runs; document coordinates = bounding box + scroll offset.
 *
 * @returns {string[]} the files written, first = `abs`
 */
async function tileShots(page, abs, focus, tile) {
  const maxW = tile.maxW || 2200;
  const maxH = tile.maxH || 1300;
  const margin = tile.margin == null ? 60 : tile.margin;
  const maxTiles = tile.maxTiles || 6;
  const minW = tile.minW || 1000;
  const minH = tile.minH || 640;
  // A block that is centred but wider than the viewport overflows to the LEFT of the document, where no screenshot (and no
  // scrolling) can reach it: the Portfolio Approach page showed its title and the first table column cut off that way
  // (TC-SUB-052, 2026-10-14). Widen the viewport until the leftmost content block starts at x >= 0 (withFit restores the size).
  for (let i = 0; i < 3; i++) {
    const left = await page.evaluate(() => {
      let min = 0;
      for (const el of document.querySelectorAll('.ant-table-wrapper, .ant-form-item, .ant-collapse, .ant-card, .ant-modal-content, h1, h2, h3, .ant-btn')) {
        if (el.closest('.ant-layout-sider, .ant-menu')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.left < min && r.left > -3000) min = r.left;
      }
      return min;
    }).catch(() => 0);
    const vp = page.viewportSize();
    if (left >= -2 || !vp) break;
    await page.setViewportSize({ width: Math.min(9000, vp.width + Math.ceil(-left) * 2 + 40), height: vp.height });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  const doc = await page.evaluate(() => ({
    w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    sx: window.scrollX, sy: window.scrollY,
  }));
  const clampBox = (b) => {
    const x = Math.max(0, Math.floor(b.x));
    const y = Math.max(0, Math.floor(b.y));
    return { x, y, w: Math.max(1, Math.min(doc.w, Math.ceil(b.x + b.w)) - x), h: Math.max(1, Math.min(doc.h, Math.ceil(b.y + b.h)) - y) };
  };
  // The tight box (document coordinates) of what is on screen: a pop-up when one is open (a pop-up IS the state being evidenced), else
  // everything visible in the content area — text leaves, charts / images / inputs and the container boxes, plus toasts, so a title,
  // a chart and the buttons are all inside (the shell is aside.ant-layout-sider + header.ant-layout-header + main.ant-layout-content).
  const contentBox = () => page.evaluate(() => {
    const shown = e => !!(e.offsetParent || e.getClientRects().length);
    const pop = [...document.querySelectorAll('.ant-modal-content')].filter(shown);
    const toasts = [...document.querySelectorAll('.ant-message-notice, .ant-notification-notice')].filter(shown);
    const sel = '.ant-form-item, .ant-table-wrapper, .ant-alert, .ant-collapse';
    const main = document.querySelector('main.ant-layout-content, .ant-layout-content') || document.body;
    const items = [];
    if (pop.length) items.push(...pop);
    else {
      for (const el of main.querySelectorAll('*')) {
        if (el.parentElement && el.parentElement.closest('svg')) continue;
        const tag = el.tagName.toLowerCase();
        if (['svg', 'img', 'canvas', 'input', 'textarea', 'video'].includes(tag) || (el.children.length === 0 && (el.textContent || '').trim() !== '')) items.push(el);
      }
      items.push(...main.querySelectorAll(sel), ...toasts);
    }
    const docW = document.documentElement.scrollWidth;
    let x0 = Infinity;
    let x1 = 0;
    let y0 = Infinity;
    let y1 = 0;
    for (const el of items) {
      if (el.closest('.ant-layout-sider, .ant-menu')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || !shown(el)) continue;
      if (r.right <= 0 || r.left >= docW || getComputedStyle(el).visibility === 'hidden') continue;
      x0 = Math.min(x0, r.left + window.scrollX);
      x1 = Math.max(x1, r.right + window.scrollX);
      y0 = Math.min(y0, r.top + window.scrollY);
      y1 = Math.max(y1, r.bottom + window.scrollY);
    }
    return Number.isFinite(x0) && x1 > x0 ? { x0, x1, y0, y1 } : null;
  }).catch(() => null);

  let regions = [];
  const boxes = [];
  const focusLoc = f => (typeof f === 'string' ? page.locator(f) : (f && f.loc) || f).first();
  // A pop-up opened a moment ago is still moving: Ant's zoom motion grows it from ~20 % scale around the CLICK point, and a box read
  // then is a small square beside the dialog (TC-SUB-021 / 028 / 029 came out as an empty corner of the form, 2026-10-19). Wait until
  // every focus box has stopped moving (two readings ~6 frames apart agree), at most ~3 s.
  const settledKey = async () => (await Promise.all(focus.map(async (f) => {
    const b = await focusLoc(f).boundingBox().catch(() => null);
    return b ? [b.x, b.y, b.width, b.height].map(Math.round).join(',') : '-';
  }))).join('|');
  let still = await settledKey();
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    const now = await settledKey();
    if (now === still) break;
    still = now;
  }
  for (const f of focus) {
    const loc = focusLoc(f);
    const b = await loc.boundingBox().catch(() => null);
    // a pop-up is complete in itself: no extra room below it (that would only add an empty strip of the greyed page, a second tile)
    const modal = await loc.evaluate(el => !!el.closest('.ant-modal-content')).catch(() => false);
    // a focus that is the whole page (body) says nothing about WHERE: it counts as no focus
    if (b && b.width > 0 && b.height > 0 && !(b.width >= 0.85 * doc.w && b.height >= 0.7 * doc.h)) boxes.push({ x: b.x + doc.sx, y: b.y + doc.sy, w: b.width, h: b.height, modal });
  }
  let noFocus = false;
  let ext = null;
  if (boxes.length) {
    // one area per cluster of fields that sit close together vertically
    boxes.sort((a, b) => a.y - b.y);
    let cur = null;
    for (const b of boxes) {
      if (cur && b.y <= cur.y + cur.h + maxH / 3) {
        const x0 = Math.min(cur.x, b.x);
        const x1 = Math.max(cur.x + cur.w, b.x + b.w);
        const y1 = Math.max(cur.y + cur.h, b.y + b.h);
        cur = { x: x0, y: cur.y, w: x1 - x0, h: y1 - cur.y, modal: cur.modal && b.modal };
      } else { if (cur) regions.push(cur); cur = { ...b }; }
    }
    if (cur) regions.push(cur);
    // more room below: what belongs to a field (the rows of the table under a heading, an inline error) sits under it
    const below = tile.below == null ? 420 : tile.below;
    regions = regions.map(r => clampBox({ x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + margin + (r.modal ? margin : below) }));
  } else {
    noFocus = true;
    ext = await contentBox();
    regions = ext
      ? [clampBox({ x: ext.x0 - margin, y: ext.y0 - margin, w: ext.x1 - ext.x0 + 2 * margin, h: ext.y1 - ext.y0 + 2 * margin })]
      : [clampBox({ x: 0, y: 0, w: doc.w, h: doc.h })];
  }
  // A crop is never smaller than minW x minH: a lone button / one field is shown with the form around it. The crop grows towards the
  // content (a button at the right end of a form grows to the left), not into empty space.
  if (!ext && regions.some(r => r.w < minW || r.h < minH)) ext = await contentBox();
  regions = regions.map(r => {
    let { x, y, w, h } = r;
    if (w < Math.min(minW, doc.w)) {
      const nw = Math.min(minW, doc.w);
      x = x - (nw - w) / 2;
      if (ext) x = Math.min(x, ext.x1 + margin - nw);   // no empty strip to the right of the content
      if (ext) x = Math.max(x, ext.x0 - margin);        // nor to the left
      x = Math.max(0, Math.min(x, doc.w - nw));
      w = nw;
    }
    if (h < Math.min(minH, doc.h)) {
      const nh = Math.min(minH, doc.h);
      y = Math.max(0, Math.min(y - (nh - h) / 3, doc.h - nh));
      h = nh;
    }
    return clampBox({ x, y, w, h });
  });
  const clips = [];
  for (const r of regions) {
    for (let y = r.y; y < r.y + r.h; y += maxH) {
      for (let x = r.x; x < r.x + r.w; x += maxW) {
        clips.push({ x, y, width: Math.min(maxW, r.x + r.w - x), height: Math.min(maxH, r.y + r.h - y) });
      }
    }
  }
  const files = [];
  // without a focus the top of the page is what matters (alerts, header of the form): at most 3 tiles
  for (const clip of clips.slice(0, noFocus ? Math.min(3, maxTiles) : maxTiles).filter(c => c.width > 4 && c.height > 4)) {
    const file = files.length === 0 ? abs : abs.replace(/\.png$/i, `_${files.length + 1}.png`);
    fs.rmSync(file, { force: true });
    await page.screenshot({ path: file, fullPage: true, clip });
    files.push(file);
  }
  if (!files.length) { await page.screenshot({ path: abs, fullPage: true }); files.push(abs); }
  return files;
}

/**
 * Screenshot into the suite's own screenshots/ folder and link it from the report.
 *
 * Evidence stays beside the suite (not in test-results/) because the per-suite
 * test_report.html is a client deliverable and must keep working when the run
 * output is cleaned. The file is ALSO attached to the Playwright report so it
 * shows up in the trace viewer.
 *
 * Call it more than once per test case for a before/after story (e.g. a config
 * changed elsewhere, then the effect of that change) — pass `opts.label` on each
 * call so the report's links read as that story ("Approval Model — Checker B
 * added", "Checker A still approves it") instead of generic "View 1"/"View 2".
 * A call with no label keeps behaving exactly as before (reporters/*.js and
 * utils/reporter.js already accept a plain filename or a {file,label} object).
 *
 * opts.focus = the field(s) / section(s) the test case validates (Locator | selector | { loc, label }, or an array of them).
 * Each is scrolled into view first; when one is NOT visible no screenshot is taken (a picture that does not show what the
 * test case is about is worse than none) and a note naming the missing field goes on the report row instead.
 *
 * opts.verify = async () => boolean: re-checked AFTER the shot that what the picture is meant to show is still on
 * screen; the shot is retaken (max 3) while assertion and pixels disagree, and a note is added if they never agree.
 *
 * @param {string} [opts.label] caption shown instead of "View N" when a test case
 *   has more than one evidence() call
 * @returns {string|null} the path recorded in the report, relative to the suite's screenshots/; null when not taken
 */
async function evidence(page, name, opts = {}) {
  const i = info();
  const suiteDir = path.dirname(i.file);
  const variant = opts.variant || process.env.TC_VARIANT || '';
  const dir = path.join(suiteDir, 'screenshots', variant);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${name}.png`;
  const abs = path.join(dir, filename);
  // The file name is the same every run. A failed screenshot used to be swallowed and the report still
  // linked the name — i.e. the PREVIOUS run's image, presented as this run's evidence. Remove the old file
  // first, and link nothing (but say so) when this run could not take one.
  fs.rmSync(abs, { force: true });
  // Ant Design opens panels / dropdowns with a JS motion (rc-motion). A shot taken mid-motion showed a
  // Rejecting Task group "open" with no rows painted, although the rows were in the DOM and asserted
  // visible (2026-09-28). Let every running motion finish first; if one never does, say so in the notes.
  // The same goes for notifications / messages (ant-notification-fade-enter-active has no "-motion-"):
  // SF-009's toast was captured half off-screen, its text cut to "No d…" (2026-09-29 audit).
  const settled = await page.waitForFunction(
    // "-prepare" too: a modal still in "ant-zoom-appear-prepare" was shot half-transparent over the form.
    () => !document.querySelector('[class*="-enter-active"], [class*="-leave-active"], [class*="-appear-active"], [class*="-enter-prepare"], [class*="-enter-start"], [class*="-appear-prepare"], [class*="-appear-start"]'),
    null, { timeout: 5000 },
  ).then(() => true, () => false);
  if (!settled) push(NOTES, `evidence "${name}": animasi UI belum selesai saat screenshot diambil`);
  // A table still loading shows its spinner over half-refreshed rows: VW-002 was captured that way (2026-10-01
  // audit). Wait for every Ant Design spinner to stop; if one never does, say so instead of passing it off.
  // A button in its loading state counts too: SF-002..006 were shot with Search still greyed out (2026-10-18 audit).
  const loaded = await page.waitForFunction(
    () => !document.querySelector('.ant-spin-spinning, .ant-btn-loading'),
    null, { timeout: 10000 },
  ).then(() => true, () => false);
  if (!loaded) push(NOTES, `evidence "${name}": indikator loading masih tampil saat screenshot diambil`);
  // opts.zoom (or env EVIDENCE_ZOOM) = e.g. 0.5: shoot the page as a 50 %-zoomed browser would show it, with every scroll box
  // opened so no grid column / row is cropped (utils/evidence-fit.js). Unset = a plain screenshot, as before.
  const zoom = opts.zoom !== undefined ? Number(opts.zoom) : Number(process.env.EVIDENCE_ZOOM || 0);
  const focus = opts.focus ? [].concat(opts.focus) : [];
  // opts.tile = {} | { maxW, maxH, margin, maxTiles }: cut the picture to the area of the focus and split it (see tileShots)
  const tile = opts.tile && opts.fullPage !== false ? (typeof opts.tile === 'object' ? opts.tile : {}) : null;
  const shoot = tile ? () => tileShots(page, abs, focus, tile) : () => page.screenshot({ path: abs, fullPage: opts.fullPage !== false });
  // `verify` re-checks, AFTER the shot, that what the picture is meant to show is still on screen. A Rejecting
  // Task group was asserted with rows and then captured expanded but empty (RT-004, 2026-10-02 audit): the
  // assertion and the pixels disagreed. Re-shoot while they disagree; if they never agree, say so.
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = opts.verify ? await opts.verify().catch(() => false) : true;
    res = await (zoom > 0 || focus.length ? withFit(page, zoom, shoot, { focus }) : shoot().then(value => ({ taken: true, missing: [], value })))
      .catch(error => ({ taken: false, missing: [], value: null, failed: true, error }));
    if (!res.taken || !opts.verify) break;
    if (before && await opts.verify().catch(() => false)) break;
    if (attempt === 3) { push(NOTES, `evidence "${name}": isi yang diverifikasi tidak tampil di screenshot setelah 3 percobaan`); break; }
    await page.waitForFunction(() => !document.querySelector('[class*="-enter-active"], [class*="-leave-active"], .ant-spin-spinning'), null, { timeout: 3000 }).catch(() => {});
  }
  if (!res.taken) {
    if (res.missing.length) note(`Evidence TIDAK diambil: field/section "${res.missing.join('", "')}" tidak terlihat di halaman, jadi gambar tidak akan menunjukkan objek validasi TC ini`);
    else if (res.failed) push(NOTES, `evidence "${name}" tidak dapat diambil: ${String((res.error && res.error.message) || res.error || '').split('\n')[0]}`);
    return null;
  }

  const rel = variant ? `${variant}/${filename}` : filename;
  push(EVIDENCE, opts.label ? JSON.stringify({ file: rel, label: opts.label }) : rel);
  await i.attach(name, { path: abs, contentType: 'image/png' }).catch(() => {});
  // tiled evidence: the further tiles are separate files of the same shot, listed right after the first
  const more = Array.isArray(res.value) ? res.value.slice(1) : [];
  for (const f of more) {
    const base = path.basename(f);
    push(EVIDENCE, variant ? `${variant}/${base}` : base);
    await i.attach(base.replace(/\.png$/i, ''), { path: f, contentType: 'image/png' }).catch(() => {});
  }
  return rel;
}

/**
 * Link an EXISTING screenshot as this test case's evidence (copied into the suite's screenshots/ under `name`).
 *
 * WHY: a shared flow (one real Authorize / one probe of a broken screen) is executed once, by the first test case that needs it;
 * every later test case that depends on it has to show the same state, and re-driving the app to get another picture would
 * repeat the action (or cost minutes). The flow keeps its screenshot; each dependent test case re-attaches a copy.
 *
 * @returns {string|null} the path recorded in the report, or null when the source file is gone
 */
async function evidenceFile(srcAbs, name, opts = {}) {
  if (!srcAbs || !fs.existsSync(srcAbs)) return null;
  const i = info();
  const variant = opts.variant || process.env.TC_VARIANT || '';
  const dir = path.join(path.dirname(i.file), 'screenshots', variant);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${name}.png`;
  const abs = path.join(dir, filename);
  fs.copyFileSync(srcAbs, abs);
  const rel = variant ? `${variant}/${filename}` : filename;
  push(EVIDENCE, rel);
  await i.attach(name, { path: abs, contentType: 'image/png' }).catch(() => {});
  return rel;
}

/**
 * Evidence for an API test case: the request/response pair, written as a readable
 * .txt beside the suite and linked from the report exactly like a screenshot.
 *
 * WHY THIS EXISTS SEPARATELY FROM evidence(): evidence() takes a `page` and calls
 * page.screenshot(). An API test has no page, so it had no way to contribute the
 * artefact the report's evidence column exists for. And an API test has no trace,
 * no video and no screenshot-on-failure either — those are all browser features —
 * so this file is the ONLY artefact a failed API test leaves behind. That makes it
 * more important than a screenshot, not less.
 *
 * The file is written into the same `screenshots/` folder the reporter already
 * links against (screenshotBasePath), so no reporter path changes are needed and
 * the folder stays covered by .gitignore.
 *
 * SECRETS: request bodies here carry pin / pass / client_secret. The report and the
 * PDF are client deliverables, so those keys are redacted by name before writing.
 * Add to REDACT_KEYS rather than hand-scrubbing at a call site.
 *
 * @param {string} name  evidence name, usually the TC id
 * @param {{method:string, url:string, requestHeaders?:object, requestBody?:any,
 *          status:number, responseBody?:any, durationMs?:number}} exchange
 */
const REDACT_KEYS = /^(pin|pass|password|client_secret|clientSecret|authPin|authPass|secret|token|authorization)$/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = REDACT_KEYS.test(k) ? '***REDACTED***' : redact(v);
    return out;
  }
  return value;
}

const pretty = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') {
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch (_) { return v; }
  }
  try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); }
};

async function evidenceHttp(name, exchange) {
  const i = info();
  const suiteDir = path.dirname(i.file);
  const dir = path.join(suiteDir, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });

  const {
    method = '', url = '', requestHeaders = {}, requestBody,
    status = '', responseBody, durationMs,
  } = exchange || {};

  const text = [
    `${method} ${url}`,
    `HTTP ${status}${durationMs != null ? `  ·  ${durationMs} ms` : ''}`,
    '',
    '--- request headers ---',
    pretty(redact(requestHeaders)),
    '',
    '--- request body ---',
    pretty(redact(typeof requestBody === 'string' ? safeParse(requestBody) : requestBody)),
    '',
    '--- response body ---',
    pretty(typeof responseBody === 'string' ? safeParse(responseBody) : responseBody),
    '',
  ].join('\n');

  const filename = `${name}.txt`;
  fs.writeFileSync(path.join(dir, filename), text, 'utf-8');
  push(EVIDENCE, filename);
  await i.attach(name, { body: text, contentType: 'text/plain' }).catch(() => {});
  return filename;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return s; }
}

/**
 * Evidence that a downloaded file is real and readable: parse it (XLSX / XLS / CSV) and screenshot its contents,
 * rendered as a table in a throw-away tab of the same browser context — i.e. "the file, opened".
 *
 * WHY: a picture of the list page after clicking Download proves only that a button was clicked; the
 * filename/size in a label is text the reader has to trust. Showing the parsed rows proves the file opens and
 * carries data. The parse itself is also a check: a corrupt file or an HTML error page saved as .xlsx throws here.
 *
 * @param {import('@playwright/test').Page} page  any page of the context (a new tab is opened and closed)
 * @param {string} name        evidence name, e.g. 'TC-AUD-DT-001_file'
 * @param {Buffer|string} file  the file's bytes, or its path (download.path())
 * @param {{filename?:string, maxRows?:number, label?:string}} [opts]
 * @returns {Promise<{rows:number, columns:string[], sheet:string, path:string|null}>}
 */
async function evidenceDownload(page, name, file, opts = {}) {
  const XLSX = require('xlsx');
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  const filename = opts.filename || (typeof file === 'string' ? path.basename(file) : name);
  const maxRows = opts.maxRows || 25;
  const isZip = buf.slice(0, 2).toString('ascii') === 'PK';
  const isCsv = /\.csv$/i.test(filename) || (!isZip && !/\.xls$/i.test(filename));
  const wb = isCsv ? XLSX.read(buf.toString('utf-8'), { type: 'string' }) : XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.SheetNames[0];
  if (!sheet) throw new Error(`Downloaded file "${filename}" has no sheet / could not be parsed`);
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: false, blankrows: true });
  const filled = (r) => r.filter(v => String(v).trim() !== '').length;
  // Width = the last column that holds a value in any row (drops the empty columns some templates carry).
  const width = grid.reduce((w, r) => { for (let c = r.length - 1; c >= 0; c--) if (String(r[c]).trim() !== '') return Math.max(w, c + 1); return w; }, 0);
  // Header = the first row filling at least half the width — a report title ("ACTIVITY AUDIT REPORT") on row 1 is skipped.
  const headerIdx = Math.max(0, grid.findIndex(r => filled(r) >= Math.max(2, Math.ceil(width / 2))));
  const header = (grid[headerIdx] || []).slice(0, width).map(String);
  const rows = grid.slice(headerIdx + 1).filter(r => filled(r) > 0);
  const colName = (c) => { let s = ''; for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };

  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clip = (v) => { const s = String(v ?? ''); return s.length > 80 ? `${s.slice(0, 80)}…` : s; };
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font:13px -apple-system,Segoe UI,Roboto,sans-serif;margin:16px;color:#1f2328;background:#fff}
    .bar{display:flex;gap:16px;align-items:center;padding:8px 12px;background:#217346;color:#fff;border-radius:6px 6px 0 0}
    .bar b{font-size:14px} .meta{padding:6px 12px;background:#f3f4f6;border:1px solid #d0d7de;border-top:0;font-size:12px}
    table{border-collapse:collapse;width:100%;margin-top:8px} th,td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top;white-space:nowrap}
    th{background:#e8f0ea;position:sticky;top:0} td.n,th.n{color:#6e7781;background:#f6f8fa;text-align:right}
    .more{margin-top:6px;color:#6e7781;font-size:12px}</style>
    <div class="bar"><b>📄 ${esc(filename)}</b><span>${buf.length.toLocaleString()} bytes</span></div>
    <div class="meta">Sheet: <b>${esc(sheet)}</b> · header on row ${headerIdx + 1} · ${rows.length} data row(s) · ${width} column(s) · opened by the test from the downloaded file</div>
    <table><tr><th class="n"></th>${Array.from({ length: width }, (_, c) => `<th class="n" style="text-align:center">${colName(c)}</th>`).join('')}</tr>
    ${grid.slice(0, Math.min(grid.length, headerIdx + 1 + maxRows)).map((r, i) => `<tr${i === headerIdx ? ' style="font-weight:600;background:#e8f0ea"' : ''}><td class="n">${i + 1}</td>${Array.from({ length: width }, (_, c) => `<td>${esc(clip(r[c]))}</td>`).join('')}</tr>`).join('')}
    </table>${grid.length > headerIdx + 1 + maxRows ? `<div class="more">… ${grid.length - headerIdx - 1 - maxRows} more row(s) not shown</div>` : ''}`;

  const viewer = await page.context().newPage();
  try {
    await viewer.setViewportSize({ width: 1600, height: 900 });
    await viewer.setContent(html, { waitUntil: 'load' });
    const rel = await evidence(viewer, name, { label: opts.label || `Downloaded file opened — ${filename}`, fullPage: true });
    return { rows: rows.length, columns: header.map(String), sheet, path: rel };
  } finally {
    await viewer.close().catch(() => {});
  }
}

/**
 * Name the known defect this test case surfaces, with the description a workbook reader needs.
 * Call it before the assertion that fails. Report metadata only — it never changes the verdict: the
 * Defect ID and its text reach the report and the workbook only when the test case actually FAILED,
 * so a fixed defect simply stops appearing there.
 * @param {string} id    defect id as tracked by the team (e.g. 'M1')
 * @param {string} text  what is wrong, phrased for the workbook's "The Results Obtained"
 */
function defect(id, text) {
  push(DEFECT, id);
  if (text) push(DEFECT_TEXT, text);
}

/**
 * Not automatable at all — no UI surface to assert against (email delivery, an
 * audit trail, comparing an exported file's rows one by one against the table).
 *
 * Narrower than it looks: colour IS automatable via getComputedStyle, a service
 * error via page.route, an access-denied case with a no-privilege account, and a
 * download's own type/size via the download fixture. If any of those fit, it is
 * not MANUAL.
 */
function markManual(id, expected, reason) {
  tc(id, expected);
  push(STATUS, 'MANUAL');
  note(reason);
  test.skip(true, `MANUAL: ${reason}`);
}

/**
 * Automatable in principle, but blocked right now — a spec-vs-code mismatch, a
 * missing account or endpoint, absent seed data, or a mutation this project's
 * policy will not perform without an explicit go-ahead.
 *
 * Stays in the suite and the report with its reason so it can be un-blocked later.
 * Never delete a blocked test case: a deleted one is invisible.
 */
function markBlocked(id, expected, reason) {
  tc(id, expected);
  push(STATUS, 'SKIP');
  note(reason);
  test.skip(true, `SKIP: ${reason}`);
}

/**
 * Does not apply to the variant currently running — the control or the whole page
 * is absent on this portal/role.
 */
function markNotApplicable(id, expected, reason) {
  tc(id, expected);
  push(STATUS, 'SKIPPED');
  note(reason);
  test.skip(true, `N/A: ${reason}`);
}

/**
 * Retired by the product owner: the workbook's expected result does not describe
 * how the product is meant to behave, so there is nothing left to verify. This is
 * NOT a defect and NOT a block - it maps to the workbook's own "Invalid" status.
 *
 * Stays in the suite with its reason so the decision is visible; a deleted test
 * case is an invisible one, and the next person would only write it again.
 */
function markInvalid(id, expected, reason) {
  tc(id, expected);
  push(STATUS, 'INVALID');
  note(reason);
  test.skip(true, `INVALID: ${reason}`);
}

/**
 * The FSD specifies a field / requirement the application does not have yet ("Belum
 * Terdevelopment"). Call it AFTER tc(), once the test has looked and found the gap.
 *
 * Unlike markBlocked / markManual this does NOT skip: it records the status and then FAILS the
 * test, so the exit code stays non-zero. A missing requirement is a gap against the spec; a
 * skip would let CI go green over it. The status only names the kind of failure so the report
 * separates "not built yet" from "built but broken".
 *
 * @param {string|string[]} what  the missing field(s) / behaviour, in the FSD's own words
 */
function markNotDeveloped(what) {
  const list = [].concat(what).filter(Boolean);
  push(STATUS, 'BELUM TERDEVELOPMENT');
  note(`Belum Terdevelopment: ${list.join('; ')}`);
  throw new Error(`Belum Terdevelopment — tidak ada di aplikasi: ${list.join('; ')}`);
}

/** One report row standing for several workbook test cases verified together. */
function markCombined(id, expected, coveredIds) {
  tc(id, expected);
  push(STATUS, 'COMBINE');
  note(`Covers: ${[].concat(coveredIds).join(', ')}`);
}

module.exports = {
  tc, note, flow, defect, evidence, evidenceFile, evidenceHttp, evidenceDownload,
  markManual, markBlocked, markNotApplicable, markInvalid, markCombined, markNotDeveloped,
  ANNOTATION: { STATUS, ID, EXPECTED, NOTES, EVIDENCE, DEFECT, DEFECT_TEXT, WORKBOOK, FLOW },
};
