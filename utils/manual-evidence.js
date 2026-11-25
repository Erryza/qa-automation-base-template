/**
 * The tester's OWN evidence and verdicts for test cases that were executed by hand, applied to the report rows EVERY time a report is
 * generated (the reporter's onEnd and scripts/rebuild-report.js) — not only when the test case itself happened to run. A merged report
 * keeps old rows; a picture dropped into the folder afterwards would otherwise never reach them.
 *
 *   <suite>/manual-evidence/<TC id>_manual_<n>[-what].png|jpg   one picture per file; shown as "Manual <n>" (or "Manual" when alone)
 *   <suite>/manual-evidence/manual-results.json                 optional verdicts the tester declares for a TC run by hand:
 *       { "TC-001": { "status": "PASSED", "date": "2026-10-17", "by": "tester", "note": "what was done / seen" } }
 *
 * Rules (a manual file never hides a real failure):
 *   - Pictures are copied into <suite>/screenshots/ and linked once (de-duplicated by file name), so applying twice changes nothing.
 *   - A verdict replaces ONLY a status of SKIP / SKIPPED / MANUAL (the automation did not or could not run it). An automated PASSED
 *     or FAILED is never overruled: a FAILED row with a manual PASSED stays FAILED and says so in its note.
 *   - The row keeps what the automation said: `row.manual = { by, date, automation }` and the note ends with the original status. The
 *     report draws a MANUAL chip next to the status.
 */
const fs = require('fs');
const path = require('path');

const DIR_NAME = 'manual-evidence';
const RESULTS_FILE = 'manual-results.json';
const FILE_RE = /^(.+?)_manual_(\d+)(?:[-_ ].*)?\.(png|jpe?g|gif|webp)$/i;
const OVERRIDABLE = new Set(['SKIP', 'SKIPPED', 'MANUAL']);
const VERDICTS = new Set(['PASSED', 'FAILED']);

const join = (a, b) => [a, b].filter(Boolean).join(' | ');

function readVerdicts(evDir) {
  const file = path.join(evDir, RESULTS_FILE);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.warn(`[manual-evidence] ${path.relative(process.cwd(), file)} is not valid JSON (${e.message}) — verdicts ignored`);
    return {};
  }
}

/**
 * Apply the folder's pictures and verdicts to `results` (the rows of ONE suite folder `suiteDir`), in place.
 * @returns { changed } the number of rows touched (0 = nothing to do, and nothing was written)
 */
function applyManualEvidence(suiteDir, results) {
  const evDir = path.join(suiteDir, DIR_NAME);
  if (!fs.existsSync(evDir) || !Array.isArray(results)) return { changed: 0 };

  const pics = new Map();
  for (const name of fs.readdirSync(evDir)) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    if (!pics.has(m[1])) pics.set(m[1], []);
    pics.get(m[1]).push({ name, n: Number(m[2]) });
  }
  for (const list of pics.values()) list.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));
  const verdicts = readVerdicts(evDir);
  const shots = path.join(suiteDir, 'screenshots');
  let changed = 0;

  for (const r of results) {
    const mine = pics.get(r.tcId) || [];
    if (mine.length) {
      fs.mkdirSync(shots, { recursive: true });
      for (const p of mine) {
        const from = path.join(evDir, p.name);
        const to = path.join(shots, p.name);
        if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
      }
      const cur = r.screenshot == null ? [] : (Array.isArray(r.screenshot) ? r.screenshot.slice() : [r.screenshot]);
      const have = new Set(cur.map(s => (s && typeof s === 'object' ? s.file : s)));
      const fresh = mine.filter(p => !have.has(p.name));
      if (fresh.length) {
        for (const p of fresh) cur.push({ file: p.name, label: mine.length > 1 ? `Manual ${p.n}` : 'Manual' });
        r.screenshot = cur.length === 1 ? cur[0] : cur;
        if (!/bukti manual dari tester/.test(r.notes || '')) {
          r.notes = join(r.notes, `${mine.length} bukti manual dari tester ditautkan sebagai "Manual" (dijalankan manual oleh tester; bukan hasil otomasi)`);
        }
        changed++;
      }
    }

    const v = verdicts[r.tcId];
    if (!v || r.manual) continue;                               // no verdict, or already applied to this row
    const status = String(v.status || '').toUpperCase();
    if (!VERDICTS.has(status)) {
      console.warn(`[manual-evidence] ${r.tcId}: verdict "${v.status}" must be PASSED or FAILED — ignored`);
      continue;
    }
    if (status === r.status) continue;                          // the automation already says the same
    const by = v.by || 'tester';
    if (!OVERRIDABLE.has(r.status)) {
      const msg = `Verdict manual ${status} dari ${by}${v.date ? ` (${v.date})` : ''} TIDAK menimpa hasil otomasi ${r.status}`;
      if (!(r.notes || '').includes(msg)) { r.notes = join(r.notes, msg); changed++; }
      continue;
    }
    const was = r.status;
    r.status = status;
    r.manual = { by, date: v.date || '', automation: was };
    r.notes = `Dijalankan MANUAL oleh ${by}${v.date ? ` (${v.date})` : ''}: ${status}.${v.note ? ' ' + v.note : ''} | Hasil otomasi: ${was}${r.notes ? ' — ' + r.notes : ''}`;
    changed++;
  }
  return { changed };
}

module.exports = { applyManualEvidence, DIR_NAME, RESULTS_FILE };
