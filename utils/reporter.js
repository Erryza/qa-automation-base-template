const fs = require('fs');
const path = require('path');
const { triageFailure, FAILURE_KINDS } = require('./failure-triage');
const { CATEGORIES, triageOf } = require('./explain');

/** HTML-escape text that came from the app or from a test (a TC payload like <script> included). */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// WHY the full text is kept: the notes column is where a failed row says WHY it failed (brief:
// "catat setiap error dan detail penyebabnya"). It used to be cut to its first line / 150
// characters and replaced by a generic "Timeout waiting for …", which threw that away.
const NOTES_MAX = 2000;

function cleanNotes(raw) {
  if (!raw) return '';
  // Strip ANSI escape codes (both full \x1B[...m and leftover [0m forms)
  const clean = raw
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\[[0-9;]+m/g, '')
    .trim();
  // A bare locator failure reads better with a plain-language lead; the detail stays after it.
  const textMatch = clean.match(/getByText\(['"](.+?)['"]\)/);
  const roleMatch = clean.match(/getByRole\([^)]*name:\s*['"](.+?)['"]/);
  const lead = textMatch ? `Expected "${textMatch[1]}" not found on page — `
    : roleMatch ? `Expected "${roleMatch[1]}" not found on page — ` : '';
  const text = (lead + clean).slice(0, NOTES_MAX) + (clean.length + lead.length > NOTES_MAX ? ' …' : '');
  return esc(text).replace(/\n/g, '<br>');
}

/**
 * OPT-IN full notes (suites/<Feature>/report.json: { "fullNotes": true }). cleanNotes() keeps only the first 150 characters, which
 * suits a one-line Playwright error but cuts a curated note (the customer used, the expected vs actual text, the API call that
 * answered an error — "CAUSE (API)") in the middle of a sentence. A suite that writes its own notes asks for them whole: every
 * " | "-separated part on its own line, HTML-escaped (notes quote texts such as "<Customer Name>").
 */
function fullNotesHtml(raw) {
  if (!raw) return '';
  const clean = String(raw).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]+m/g, '');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return clean.split(' | ').map(p => esc(p.trim())).filter(Boolean).join('<br>');
}

function suiteOptions(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf-8')) || {}; } catch (_) { return {}; }
}

function humanizeExpected(raw) {
  if (!raw) return '';

  if (raw.startsWith('ROLE:')) {
    const parts = raw.substring(5).split(':');
    const role = parts[0].trim();
    const name = parts.slice(1).join(':').trim();
    if (role === 'heading') return `Heading "${name}" is visible`;
    if (role === 'button') return `Button "${name}" is visible`;
    if (role === 'combobox') return `Dropdown "${name}" is visible`;
    if (role === 'columnheader') return `Table column "${name}" exists`;
    if (role === 'link') return `Link "${name}" is visible`;
    return `${role} "${name}" is visible`;
  }

  if (raw.startsWith('TESTID:')) {
    const id = raw.substring(7).trim();
    // Optional per-project prettifier: map a testid to a human label, e.g.
    // { filterDateRange: 'Filter Date input' }. Empty by default.
    const labels = {};
    return `${labels[id] || '"' + id + '"'} is visible`;
  }

  if (raw.startsWith('MODAL:')) {
    const parts = raw.substring(6).split(':');
    const btn = parts[0].trim();
    const title = parts[1].trim();
    const close = parts[2]?.trim() || 'Cancel';
    return `Click "${btn}" → modal "${title}" appears → close with "${close}"`;
  }

  if (raw.startsWith('URL:')) return `URL contains "${raw.substring(4).trim()}"`;
  if (raw.startsWith('ELEMENT:')) return `Element "${raw.substring(8).trim()}" is visible`;

  // detail_fields format: key="value" pairs, e.g. Owner Name="Acme Corp", Account Status="Active"
  if (raw.includes('="')) return `Details show: ${raw.replace(/="/g, ' = "').replace(/",/g, '",').replace(/,(?=[^ ])/g, ', ')}`;

  return raw;
}

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A reviewer's comment on a FAILED / SKIP / INVALID row (suites/<Feature>/review_comments.json, attached by
 * reporters/excel-html-reporter.js). Rendered as its own block, NOT through cleanNotes(): that
 * collapses the notes to one line of 150 characters and would swallow the comment.
 */
function renderComment(comment) {
  if (!comment) return '';
  return `<div style="margin-top:6px;padding:4px 8px;background:#FFF8E1;border-left:3px solid #FFB300;color:#5D4037"><b>Comment:</b> ${escapeHtml(comment)}</div>`;
}

/**
 * The plain-language triage of a FAILED / SKIP row (utils/explain.js): category badge, why, how to
 * validate by hand. A reviewed entry says "direview"; a guessed one says it is not reviewed yet.
 */
function renderTriage(row) {
  const t = triageOf(row);
  if (!t) return '';
  if (!t.category && !t.why) return renderComment(t.comment);
  const cat = CATEGORIES[t.category] || CATEGORIES.cek;
  const source = t.source === 'review' ? 'direview' : 'otomatis, belum direview';
  const points = (t.points || []).length
    ? `<ul style="margin:2px 0 2px 18px;padding:0">${t.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : '';
  return `<div style="margin-top:6px;padding:6px 8px;background:${cat.bg};border-left:4px solid ${cat.border};color:#333;font-size:1.05em">`
    + `<span style="background:${cat.border};color:#fff;padding:1px 8px;border-radius:3px;font-weight:bold">${escapeHtml(cat.label)}</span>`
    + ` <span style="color:#777;font-size:0.9em">(${source})</span>`
    + (t.why ? `<div style="margin-top:4px;color:${cat.fg}"><b>Kenapa:</b> ${escapeHtml(t.why)}</div>` : '')
    + points
    + (t.check ? `<div style="margin-top:3px"><b>Cara validasi:</b> ${escapeHtml(t.check)}</div>` : '')
    + (t.comment ? `<div style="margin-top:3px;color:#5D4037"><b>Catatan:</b> ${escapeHtml(t.comment)}</div>` : '')
    + '</div>';
}

/**
 * Whether a row carries a REVIEWED triage (review_comments.json). It then replaces main's automatic one
 * (utils/failure-triage.js, triageHtml) instead of showing beside it: one triage per row, the reviewed one first.
 */
function reviewed(row) {
  const t = triageOf(row);
  return Boolean(t && t.source === 'review');
}

const STATUS_COLORS = {
  PASSED:  { bg: '#92D050', text: '#FFFFFF', notes: '#888' },
  FAILED:  { bg: '#FF0000', text: '#FFFFFF', notes: '#c62828' },
  COMBINE: { bg: '#9C27B0', text: '#FFFFFF', notes: '#6A1B9A' },
  MANUAL:  { bg: '#4A90D9', text: '#FFFFFF', notes: '#1565C0' },
  SKIP:    { bg: '#2196F3', text: '#FFFFFF', notes: '#1565C0' },
  SKIPPED: { bg: '#9E9E9E', text: '#FFFFFF', notes: '#777' },
  // Retired by the product owner: the workbook's expected result was wrong, so the
  // test case is not a pass, a fail or a block. Amber, so it never reads as red.
  INVALID: { bg: '#FF9800', text: '#FFFFFF', notes: '#E65100' },
  // A field / requirement the FSD specifies that the application does not have yet. It is a
  // gap against the spec, so the test still FAILS (non-zero exit) — the status only names the
  // kind of failure so it is not confused with a regression. Dark red, never green or grey.
  'BELUM TERDEVELOPMENT': { bg: '#8E24AA', text: '#FFFFFF', notes: '#6A1B9A' },
};

const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The plain-language triage of a FAILED row (utils/failure-triage.js), shown above its technical notes: the likely cause,
 * why, and how the tester confirms it by hand — so a failure can be sorted into bug / script / data / network quickly.
 */
function triageHtml(r) {
  const t = triageFailure(r);
  if (!t) return '';
  return `<div style="border-left:4px solid ${t.color};background:#fafafa;padding:6px 8px;margin-bottom:6px;color:#333">`
    + `<span style="background:${t.color};color:#fff;padding:1px 8px;border-radius:10px;font-weight:600;font-size:0.9em">${esc(t.label)}</span>`
    + `<div style="margin-top:4px"><b>Kenapa gagal:</b> ${esc(t.why)}${t.detail ? `<br><i>${esc(t.detail)}</i>` : ''}</div>`
    + `<div style="margin-top:4px"><b>Cara validasi:</b> ${esc(t.check)}</div>`
    + ((t.decide || []).length ? `<ul style="margin:3px 0 0 18px;padding:0">${t.decide.map(([v, when]) => `<li><b>→ ${esc(v)}</b> jika ${esc(when)}</li>`).join('')}</ul>` : '')
    + '</div><div style="font-size:0.9em;color:#999">Detail teknis:</div>';
}

/** One card per likely cause over every FAILED row, so the tester sees at a glance what the failures are made of. */
function triageSummaryHtml(allResults) {
  const counts = new Map();
  for (const s of allResults) for (const r of s.results) {
    const t = triageFailure(r);
    if (t) counts.set(t.kind, (counts.get(t.kind) || 0) + 1);
  }
  if (!counts.size) return '';
  const cards = Object.entries(FAILURE_KINDS).filter(([k]) => counts.has(k)).map(([k, v]) =>
    `<div style="background:#fff;border-radius:8px;padding:10px 16px;box-shadow:0 1px 4px rgba(0,0,0,0.12);border-top:3px solid ${v.color};min-width:180px">`
    + `<div style="font-size:1.6em;font-weight:700;color:${v.color}">${counts.get(k)}</div><div style="font-size:0.85em;color:#555">${esc(v.label)}</div></div>`).join('');
  return `<div style="padding:0 32px 16px"><div style="font-weight:600;margin-bottom:8px">Analisis Failed (kemungkinan penyebab, perlu divalidasi manual — lihat kolom Notes tiap TC)</div>`
    + `<div style="display:flex;gap:12px;flex-wrap:wrap">${cards}</div></div>`;
}

function generateHTMLReport(allResults, outputDir, screenshotBasePath = '../screenshots') {
  fs.mkdirSync(outputDir, { recursive: true });

  // Rows that ran in a named flow (utils/tc.js flow(), e.g. "Non-Approval"): counted per flow for the header line
  const flows = new Map();
  for (const s of allResults) for (const r of s.results) if (r.flow) flows.set(r.flow, (flows.get(r.flow) || 0) + 1);
  const fullNotes = suiteOptions(outputDir).fullNotes === true;

  let totalPassed = 0;
  let totalFailed = 0;
  let totalManual = 0;
  let totalCombine = 0;
  let totalSkip = 0;
  let totalSkipped = 0;
  let totalInvalid = 0;
  let totalNotDev = 0;
  let suiteRows = '';

  for (const suite of allResults) {
    const passed = suite.results.filter(r => r.status === 'PASSED').length;
    const failed = suite.results.filter(r => r.status === 'FAILED').length;
    const manual = suite.results.filter(r => r.status === 'MANUAL').length;
    const combine = suite.results.filter(r => r.status === 'COMBINE').length;
    const skip = suite.results.filter(r => r.status === 'SKIP').length;
    // Every status in STATUS_COLORS must also be tallied here and rendered as a
    // summary card. A status that is rendered in the table but missing from the
    // totals makes the report under-report its own scope.
    const skipped = suite.results.filter(r => r.status === 'SKIPPED').length;
    const invalid = suite.results.filter(r => r.status === 'INVALID').length;
    const notDev = suite.results.filter(r => r.status === 'BELUM TERDEVELOPMENT').length;
    totalPassed += passed;
    totalFailed += failed;
    totalSkip += skip;
    totalSkipped += skipped;
    totalInvalid += invalid;
    totalNotDev += notDev;

    const suiteColor = failed === 0 && notDev === 0 ? '#E8F5E9' : '#FFEBEE';
    suiteRows += `
      <tr style="background:${suiteColor}">
        <td colspan="6" style="font-weight:bold;padding:10px 8px;">
          ${suite.suiteName} &nbsp;
          <span style="color:#2e7d32">${passed} passed</span> /
          <span style="color:#c62828">${failed} failed</span>${manual > 0 ? ` / <span style="color:#1565C0">${manual} manual</span>` : ''}${combine > 0 ? ` / <span style="color:#6A1B9A">${combine} combine</span>` : ''}${skip > 0 ? ` / <span style="color:#1565C0">${skip} skip</span>` : ''}${skipped > 0 ? ` / <span style="color:#777">${skipped} skipped</span>` : ''}${invalid > 0 ? ` / <span style="color:#E65100">${invalid} invalid</span>` : ''}${notDev > 0 ? ` / <span style="color:#6A1B9A">${notDev} belum terdevelopment</span>` : ''}
        </td>
      </tr>`;

    for (const r of suite.results) {
      const colors = STATUS_COLORS[r.status] || STATUS_COLORS.FAILED;
      // r.screenshot may be: a filename string, OR an array of filenames / { file, label }
      // objects (e.g. before/after evidence). Render each as its own link.
      const shots = r.screenshot
        ? (Array.isArray(r.screenshot) ? r.screenshot : [r.screenshot]).filter(Boolean)
        : [];
      const screenshotLink = shots.length
        ? shots.map((sh, i) => {
            const file = typeof sh === 'object' ? sh.file : sh;
            const label = typeof sh === 'object' && sh.label ? sh.label : (shots.length > 1 ? `View ${i + 1}` : 'View');
            return `<a href="${screenshotBasePath}/${file}" target="_blank">${label}</a>`;
          }).join(' &nbsp;|&nbsp; ')
        : '-';

      suiteRows += `
        <tr>
          <td style="padding-left:24px;white-space:nowrap">${r.tcId}${r.flow ? `<br><span style="background:#00796B;color:#fff;padding:1px 7px;border-radius:10px;font-size:0.75em;font-weight:600">${escHtml(r.flow)}</span>` : ''}</td>
          <td style="white-space:nowrap;overflow-wrap:normal;word-break:normal">
            <span style="background:${colors.bg};color:${colors.text};padding:2px 10px;border-radius:4px;font-weight:bold">
              ${r.status}
            </span>${r.manual ? `<br><span title="${escHtml(`Dijalankan manual oleh ${r.manual.by}${r.manual.date ? ` (${r.manual.date})` : ''}; hasil otomasi: ${r.manual.automation}`)}" style="display:inline-block;margin-top:4px;background:${STATUS_COLORS.MANUAL.bg};color:#fff;padding:1px 7px;border-radius:10px;font-size:0.75em;font-weight:600">MANUAL</span>` : ''}
          </td>
          <td>${screenshotLink}</td>
          <td style="font-size:0.85em;color:#555">${esc(humanizeExpected(r.expected)).replace(/\n/g, '<br>')}</td>
          <td style="font-size:0.85em;color:${r.status === 'FAILED' ? '#c62828' : r.status === 'MANUAL' ? '#1565C0' : r.status === 'COMBINE' ? '#6A1B9A' : r.status === 'SKIP' ? '#1565C0' : r.status === 'SKIPPED' ? '#777' : (STATUS_COLORS[r.status] || {}).notes || '#888'}">${reviewed(r) ? '' : triageHtml(r)}${fullNotes ? fullNotesHtml(r.notes) : cleanNotes(r.notes)}${reviewed(r) ? renderTriage(r) : ''}</td>
          <td style="font-size:0.85em;color:#888">${r.timestamp || ''}</td>
        </tr>`;
    }
  }

  totalManual = allResults.reduce((acc, s) => acc + s.results.filter(r => r.status === 'MANUAL').length, 0);
  totalCombine = allResults.reduce((acc, s) => acc + s.results.filter(r => r.status === 'COMBINE').length, 0);
  // A not-yet-developed requirement is a failure against the spec, so it counts in the denominator.
  const total = totalPassed + totalFailed + totalNotDev;
  const passRate = total > 0 ? ((totalPassed / total) * 100).toFixed(1) : '0.0';
  const now = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automation Test Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #1565C0; color: white; padding: 24px 32px; }
    .header h1 { font-size: 1.8em; font-weight: 600; }
    .header p { opacity: 0.85; margin-top: 4px; }
    .summary { display: flex; gap: 16px; padding: 24px 32px; flex-wrap: wrap; }
    .card { background: white; border-radius: 8px; padding: 20px 28px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12); min-width: 130px; text-align: center; }
    .card .number { font-size: 2.4em; font-weight: 700; }
    .card .label { font-size: 0.85em; color: #666; margin-top: 4px; }
    .card.pass .number { color: #2e7d32; }
    .card.fail .number { color: #c62828; }
    .card.rate .number { color: #1565C0; }
    .content { padding: 0 32px 32px; }
    table { width: 100%; border-collapse: collapse; background: white;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12); border-radius: 8px; overflow: hidden; }
    th { background: #1565C0; color: white; padding: 10px 12px; text-align: left; font-weight: 500; }
    /* overflow-wrap:anywhere — a note holding a long token with no space (a JSON list such as ["T+0","T+1",…]) used to
       widen the table past the A3 page, so the PDF cut the Notes / Executed At columns off on the right (2026-10-22). */
    td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: middle; overflow-wrap: anywhere; word-break: break-word; }
    tr:last-child td { border-bottom: none; }
    a { color: #1565C0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Automation Test Report</h1>
    <p>Generated: ${now}</p>
    ${flows.size ? `<p>Flow: ${[...flows].map(([n, c]) => `<b>${escHtml(n)}</b> (${c} TC)`).join(', ')} — rows marked with the flow name below ran in that flow</p>` : ''}
  </div>
  <div class="summary">
    <div class="card"><div class="number">${total + totalManual + totalCombine + totalSkip + totalSkipped + totalInvalid}</div><div class="label">Total TCs</div></div>
    <div class="card pass"><div class="number">${totalPassed}</div><div class="label">Passed</div></div>
    <div class="card fail"><div class="number">${totalFailed}</div><div class="label">Failed</div></div>
    <div class="card" style="border-top:3px solid #4A90D9"><div class="number" style="color:#1565C0">${totalManual}</div><div class="label">Manual</div></div>
    <div class="card" style="border-top:3px solid #9C27B0"><div class="number" style="color:#6A1B9A">${totalCombine}</div><div class="label">Combine</div></div>
    <div class="card" style="border-top:3px solid #2196F3"><div class="number" style="color:#1565C0">${totalSkip}</div><div class="label">Skip</div></div>
    <div class="card" style="border-top:3px solid #9E9E9E"><div class="number" style="color:#777">${totalSkipped}</div><div class="label">Skipped</div></div>
    <div class="card" style="border-top:3px solid #FF9800"><div class="number" style="color:#E65100">${totalInvalid}</div><div class="label">Invalid</div></div>
    <div class="card" style="border-top:3px solid #8E24AA"><div class="number" style="color:#6A1B9A">${totalNotDev}</div><div class="label">Belum Terdevelopment</div></div>
    <div class="card rate"><div class="number">${passRate}%</div><div class="label">Pass Rate</div></div>
  </div>
  ${triageSummaryHtml(allResults)}
  <div class="content">
    <table>
      <thead>
        <tr>
          <th style="white-space:nowrap;min-width:80px">TC ID</th>
          <th>Status</th>
          <th>Evidence</th>
          <th>Expected Result</th>
          <th>Notes</th>
          <th>Executed At</th>
        </tr>
      </thead>
      <tbody>
        ${suiteRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  const outputPath = path.join(outputDir, 'test_report.html');
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}

module.exports = { generateHTMLReport };
