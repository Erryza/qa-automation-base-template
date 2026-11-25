/**
 * Screenshots that are never cropped.
 *
 * WHY THIS EXISTS: a plain `page.screenshot()` of a typical SPA dashboard cuts the evidence twice. The app scrolls inside its
 * own panels (the document itself never scrolls, so `fullPage` captures nothing extra), and every result grid sits in a
 * fixed ~1340 px card with its own horizontal scroll — on a 22-column grid only the first 8 columns ended up on the
 * picture, even at a 2880 px wide viewport.
 *
 * WHAT IT DOES, only for the moment of the shot, and puts everything back afterwards:
 *   1. ZOOM  — the viewport is enlarged by 1/zoom (0.5 -> twice as wide and tall). The layout is exactly what a browser
 *              zoomed to 50 % would lay out, but the pixels stay full size, so the text stays readable when opened.
 *   2. UNCLIP — every scrollable / clipped container of the page body (grid bodies, the app's content panel, ...) is switched
 *              to `overflow: visible; max-height: none`, and the ancestors of a horizontally clipped box are allowed to be
 *              as wide as their content, so the whole grid — every column, every row, Sub Total / Total — is on the picture.
 *   3. FIT   — the viewport is then grown (to a cap) until the document is as wide / tall as its content.
 * Pop-ups (Ant modals, dropdowns, tooltips) and the side menu are left alone: they are already complete.
 *
 * Usage:  await withFit(page, 0.5, () => page.screenshot({ path }));
 * `zoom` outside (0,1) means "no zoom" (1): unclip + fit still apply.
 */

const MAX_W = 6000;
const MAX_H = 7000;

/** Runs in the page: unclip everything clipped inside the main content, remember the old inline style for undo. */
function unclipInPage() {
  // ADAPT: Ant Design class names (side menu, overlays). On another UI kit they simply match nothing — add
  // the kit's own sidebar / overlay selectors here so they are left out of the shot.
  const SKIP = '.ant-layout-sider, .ant-menu, .ant-modal-wrap, .ant-modal-mask, .ant-select-dropdown, .ant-picker-dropdown, .ant-tooltip, .ant-popover, .ant-message, .ant-notification, .ant-dropdown';
  const orig = new Map();                       // element -> its inline style before we touched it
  const remember = el => { if (!orig.has(el)) orig.set(el, el.getAttribute('style')); };
  const clips = v => v === 'auto' || v === 'scroll' || v === 'hidden' || v === 'overlay';
  const done = new Set();
  // Fixpoint: opening a grid's own scroll box makes its content overflow into the NEXT clipping ancestor, which only
  // then reports scrollWidth > clientWidth. One pass would leave that ancestor (the app's content panel) clipping.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const el of document.querySelectorAll('body *')) {
      if (done.has(el) || el.closest(SKIP) || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const y = clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
      const x = clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 2;
      if (!x && !y) continue;
      done.add(el);
      changed = true;
      remember(el);
      el.style.setProperty('overflow', 'visible', 'important');
      if (y) { el.style.setProperty('max-height', 'none', 'important'); el.style.setProperty('height', 'auto', 'important'); }
      if (x) {
        // The content card is centred (`margin: auto`) in a ~1340 px column while the grid spills out of it to the right, so
        // growing the viewport to fit the grid would add the same blank space to the LEFT of the picture. Left-align the
        // card's ancestors instead. (Tried and rejected: `min-width: max-content` on the ancestors — it makes the cards
        // follow the viewport width and wrecks the layout.)
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          if (a.closest(SKIP)) break;
          remember(a);
          a.style.setProperty('margin-left', '0', 'important');
          a.style.setProperty('margin-right', '0', 'important');
        }
      }
    }
    if (!changed) break;
  }
  // the fixed-height layout shells would keep the page one screen tall: let the page body grow
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
    if (!el) continue;
    remember(el);
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('min-height', '100vh', 'important');
  }
  window.__evSaved = [...orig];
  return orig.size;
}

function restoreInPage() {
  for (const [el, style] of window.__evSaved || []) {
    if (style == null) el.removeAttribute('style'); else el.setAttribute('style', style);
  }
  window.__evSaved = [];
}

const measure = () => ({
  w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
  h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
});

async function currentSize(page) {
  return page.viewportSize() || page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/**
 * FOCUS: the fields / sections the test case validates. A focus item is a Locator, a CSS selector string, or
 * `{ loc, label }` (label = what the report calls it). Each one is scrolled into view; if any is NOT visible the picture
 * would not show what the test case is about, so no screenshot is taken and the missing ones are returned by name.
 */
const describeFocus = (f, i) => (f && f.label) || (typeof f === 'string' ? f : (f && f.loc ? String(f.loc) : String(f)) || `#${i + 1}`);
async function checkFocus(page, focus) {
  const missing = [];
  for (const [i, f] of focus.entries()) {
    const loc = (typeof f === 'string' ? page.locator(f) : (f && f.loc) || f).first();
    let ok = false;
    try {
      if (await loc.count()) {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        const box = await loc.boundingBox();
        ok = !!box && box.width > 0 && box.height > 0 && (await loc.isVisible());
      }
    } catch (_) { ok = false; }
    if (!ok) missing.push(describeFocus(f, i));
  }
  return missing;
}

/**
 * Run `fn` (normally a screenshot) with the page zoomed out, unclipped and fitted; always restore the page afterwards.
 * Never throws because of the preparation itself — an evidence helper that fails the test case would be worse than a
 * plain screenshot — it falls back to calling `fn` on the page as it is.
 *
 * @returns {{ taken: boolean, missing: string[], value: any }}  `taken` is false (and `fn` NOT run) when a focus item
 *          is not visible; `missing` names those items.
 */
async function withFit(page, zoom, fn, { focus = [] } = {}) {
  let base = null;
  let prepared = false;
  try {
    base = await currentSize(page);
    const z = zoom > 0 && zoom < 1 ? zoom : 1;
    const want = { width: Math.round(base.width / z), height: Math.round(base.height / z) };
    await page.setViewportSize(want);
    await page.evaluate(unclipInPage);
    prepared = true;
    // the app re-flows after the viewport / overflow change; wait for the layout to stop moving (2 equal readings)
    let last = '';
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const m = await page.evaluate(measure);
      const next = { width: Math.min(MAX_W, Math.max(want.width, m.w)), height: Math.min(MAX_H, Math.max(want.height, m.h)) };
      const key = `${next.width}x${next.height}`;
      if (key === last) break;
      last = key;
      await page.setViewportSize(next);
    }
  } catch (_) { /* fall through: shoot the page as it is */ }
  try {
    const missing = await checkFocus(page, focus);
    if (missing.length) return { taken: false, missing, value: null };
    return { taken: true, missing: [], value: await fn() };
  } finally {
    if (prepared) await page.evaluate(restoreInPage).catch(() => {});
    if (base) await page.setViewportSize({ width: base.width, height: base.height }).catch(() => {});
  }
}

module.exports = { withFit, checkFocus };
