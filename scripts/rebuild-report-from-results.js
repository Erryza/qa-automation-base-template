/**
 * Re-render the per-suite test_report.html (and its REPORT/ PDF) from the LAST run's
 * reports/results.json — without running a single test.
 *
 *   node scripts/rebuild-report-from-results.js                    # every suite in the last run
 *   node scripts/rebuild-report-from-results.js "suites/Sales"     # only that suite
 *
 * WHY: a reviewer's comments on FAILED / SKIP rows (suites/<Feature>/review_comments.json) are
 * written after reading the run's traces. Re-running a full suite just to get them into the
 * report would hit the live server again and could change the very verdicts they explain.
 *
 * It feeds the recorded results through reporters/excel-html-reporter.js itself, so the output
 * is the same document a run writes. `history: false`: a re-render is not a new run and must not
 * add a line to reports/history.jsonl.
 */
const fs = require('fs');
const path = require('path');
const ExcelHtmlReporter = require('../reporters/excel-html-reporter');

const ROOT = path.resolve(__dirname, '..');
const RESULTS = path.join(ROOT, 'reports', 'results.json');

async function main() {
  if (!fs.existsSync(RESULTS)) {
    console.error(`Not found: ${path.relative(ROOT, RESULTS)} — run the suite first.`);
    process.exit(1);
  }
  const only = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : null;
  const json = JSON.parse(fs.readFileSync(RESULTS, 'utf-8'));
  const rootDir = json.config.rootDir || ROOT;

  const reporter = new ExcelHtmlReporter({ history: false });
  reporter.onBegin();
  let fed = 0;

  // results.json nests describes as suites[] under a file-level suite; titlePath is rebuilt as
  // [file, ...describes, test title] — the shape suiteNameOf() expects from a live TestCase.
  const walk = (suite, chain) => {
    for (const spec of suite.specs || []) {
      const file = path.resolve(rootDir, spec.file);
      if (only && path.dirname(file) !== only) continue;
      for (const t of spec.tests) {
        const result = t.results[t.results.length - 1];
        if (!result) continue; // listed but never executed
        const test = {
          id: `${spec.id}-${t.projectId}`,
          title: spec.title,
          annotations: t.annotations || [],
          location: { file },
          titlePath: () => [...chain, spec.title],
        };
        reporter.onTestEnd(test, result);
        fed++;
      }
    }
    for (const child of suite.suites || []) walk(child, [...chain, child.title]);
  };
  for (const fileSuite of json.suites) walk(fileSuite, [fileSuite.title]);

  if (!fed) {
    console.error(`No executed test in ${path.relative(ROOT, RESULTS)}${only ? ` for ${process.argv[2]}` : ''}.`);
    process.exit(1);
  }
  console.log(`[rebuild-report] ${fed} result(s) from ${path.relative(ROOT, RESULTS)}`);
  await reporter.onEnd({ status: json.stats && json.stats.unexpected ? 'failed' : 'passed' });
}

main().catch(err => { console.error(err); process.exit(1); });
