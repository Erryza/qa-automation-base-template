#!/usr/bin/env node
/**
 * Convention checker for suites/ — `npm run lint`.
 *
 * Deliberately dependency-free. A template with three runtime dependencies should
 * not grow a linting toolchain just to enforce five project rules, and a check
 * that needs an install is a check that gets skipped. Every rule below encodes a
 * failure this project has actually had.
 *
 * Escape hatch, per line, with a reason:
 *     await page.waitForTimeout(500); // lint-ok: CSS transition has no completion event
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// suites/ only: that is where the project's own code lives. examples/ is documentation and
// tests/ (if someone adds it) is outside the standard — a lint that is red out of the box in a
// fresh clone is a lint everyone learns to ignore.
const SCAN_DIRS = ['suites'];
const ALLOW = /\/\/\s*lint-ok:/;

const RULES = [
  {
    id: 'no-fixed-sleep',
    test: line => /\bwaitForTimeout\s*\(/.test(line),
    message: 'fixed sleep — wait on a real signal instead (utils/waits.js: actAndWait / countChangedFrom / until)',
    why: 'A fixed sleep is wrong in both directions: too short and it fails on a slow day, too long and every run pays the worst case. The predecessor accumulated 936 of them — 14.2 minutes of pure waiting per run, and the main source of flakiness.',
  },
  {
    id: 'no-hardcoded-url',
    test: line => /(["'`])https?:\/\/(?!localhost|127\.0\.0\.1|example\.(com|org))/.test(line),
    message: 'hardcoded URL — put it in environments/<env>.env under a "# used in:" comment',
    why: 'A URL in a suite passes on dev and fails on UAT, and it is how credentials and internal hostnames end up in git.',
  },
  {
    id: 'no-test-only',
    test: line => /\btest\.only\s*\(|\bdescribe\.only\s*\(/.test(line),
    message: 'test.only / describe.only left in the file — it silently drops every other test case',
    why: 'A run that quietly executes one test case still exits 0 and still writes a report, so it looks like a full pass.',
  },
  {
    id: 'no-record-helper',
    // Declaration AND assignment forms. A rule that only matched
    // `function runTC(` was trivially side-stepped by
    // `const runTC = async (...) => {}`, which is the shape people actually reach
    // for — so the guard the docs lean on has to cover both.
    test: line => /^\s*(async\s+)?function\s+(record|runTC)\s*\(/.test(line)
               || /^\s*(const|let|var)\s+(record|runTC)\s*=/.test(line),
    message: 'hand-rolled record()/runTC() — use utils/tc.js and let assertions throw',
    why: 'runTC swallowed assertion errors, so Playwright saw one passing test however many test cases failed and the process exited 0. A fully red suite reported success.',
  },
];

// A test case must be identifiable in the report. The reporter falls back to
// parsing the title, so the id has to be in the title or declared via tc().
// Multi-part ids too: workbook ids such as TC-EXCHRATE-051 carry an 8-letter module part.
const TC_TITLE = /\b[A-Za-z]{2,10}(?:[-_][A-Za-z]{2,10})*[-_]\d{1,4}\b/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'screenshots') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap(d => walk(path.join(ROOT, d)));
const problems = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf-8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    for (const rule of RULES) {
      if (rule.test(line)) {
        problems.push({ rel, line: i + 1, rule, text: line.trim().slice(0, 100) });
      }
    }
  });

  // Every test() should carry a test-case id, either in its title or via tc('..').
  lines.forEach((line, i) => {
    const m = line.match(/^\s*test\s*\(\s*(['"`])(.+?)\1/);
    if (!m) return;
    const title = m[2];
    if (TC_TITLE.test(title)) return;
    const nextFew = lines.slice(i, i + 6).join('\n');
    if (/\btc\s*\(|\bmark(Manual|Blocked|NotApplicable|Invalid|Combined)\s*\(/.test(nextFew)) return;
    problems.push({
      rel, line: i + 1, text: title.slice(0, 80),
      rule: {
        id: 'tc-id-required',
        message: 'test has no test-case id in its title and does not call tc() — it cannot be traced to the workbook',
        why: 'Traceability back to the source workbook is the whole point of the report; an untraceable row is noise.',
      },
    });
  });
}

if (files.length === 0) {
  console.log('[lint] no suites yet — nothing to check.');
  process.exit(0);
}

if (problems.length === 0) {
  console.log(`[lint] ${files.length} file(s) checked, no problems.`);
  process.exit(0);
}

const byRule = new Map();
for (const p of problems) {
  if (!byRule.has(p.rule.id)) byRule.set(p.rule.id, { rule: p.rule, hits: [] });
  byRule.get(p.rule.id).hits.push(p);
}

console.error(`[lint] ${problems.length} problem(s) in ${files.length} file(s):\n`);
for (const { rule, hits } of byRule.values()) {
  console.error(`  ${rule.id} — ${rule.message}`);
  console.error(`    why: ${rule.why}`);
  for (const h of hits) console.error(`    ${h.rel}:${h.line}  ${h.text}`);
  console.error('');
}
console.error('  Genuine exception? Append  // lint-ok: <reason>  to the line.');
process.exit(1);
