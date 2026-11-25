const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const suiteDir = process.argv[2];
  if (!suiteDir) {
    console.error('Usage:');
    console.error('  node scripts/report-to-pdf.js "<suite folder path>"');
    console.error('  yarn report:pdf "<suite folder path>"');
    console.error('Example:');
    console.error('  yarn report:pdf "suites/<Feature>"');
    process.exit(1);
  }

  const reportPath = path.join(suiteDir, 'test_report.html');
  const screenshotsDir = path.join(suiteDir, 'screenshots');

  if (!fs.existsSync(reportPath)) {
    console.error('Not found:', reportPath);
    process.exit(1);
  }

  // A suite with a report.json ({group, menu}) is filed under REPORT/<group>/<menu>/ — by the same generator the test run itself
  // uses, so a PDF made by hand is identical to the one a run writes (and lands in the same folder).
  if (fs.existsSync(path.join(suiteDir, 'report.json'))) {
    const { generateSuitePdfs } = require('../global-teardown');
    const written = await generateSuitePdfs([path.resolve(reportPath)]);
    if (!written.length) { console.error('PDF generation failed (see the message above)'); process.exit(1); }
    written.forEach(p => console.log('PDF generated:', p));
    return;
  }

  let html = fs.readFileSync(reportPath, 'utf-8');

  // Collect screenshot filenames in order of appearance
  const seen = new Set();
  const orderedScreenshots = [];
  html.replace(/href="screenshots\/([^"]+)"/g, (_, filename) => {
    if (!seen.has(filename)) {
      seen.add(filename);
      orderedScreenshots.push(filename);
    }
  });

  // Replace each "View" link with an internal anchor link
  html = html.replace(/href="screenshots\/([^"]+)"/g, (_, filename) => {
    const id = 'img-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
    return `href="#${id}"`;
  });
  // Remove target="_blank" so internal links work correctly in PDF
  html = html.replace(/ target="_blank"/g, '');

  // Build screenshot appendix (one image per page)
  let appendix = `
  <div style="margin-top:40px;">
    <div style="page-break-before:always; padding:24px 32px;">
      <h2 style="font-family:'Segoe UI',Arial,sans-serif;color:#1565C0;margin-bottom:24px;">Screenshots</h2>`;

  for (const filename of orderedScreenshots) {
    const imgPath = path.join(screenshotsDir, filename);
    const id = 'img-' + filename.replace(/[^a-zA-Z0-9]/g, '-');
    const label = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');

    let imgTag;
    if (fs.existsSync(imgPath)) {
      const ext = path.extname(filename).slice(1).replace('jpg', 'jpeg');
      const b64 = fs.readFileSync(imgPath).toString('base64');
      // See global-teardown.js's generatePdf() for why: a full-viewport (1440x2000) screenshot
      // scaled to this page's content width comes out close enough to one A3 page's printable
      // height that it, plus the label above it, can tip over the edge and get stranded on its
      // own page. Cap the rendered height so the pair always fits together.
      imgTag = `<img src="data:image/${ext};base64,${b64}" style="max-width:100%;max-height:1300px;border:1px solid #f5f5f5;border-radius:4px;"/>`;
    } else {
      imgTag = `<p style="color:#999;font-style:italic;">Screenshot not found: ${filename}</p>`;
    }

    appendix += `
      <div id="${id}" style="break-inside:avoid;page-break-inside:avoid;margin-bottom:48px;">
        <p style="font-family:'Segoe UI',Arial,sans-serif;font-size:0.9em;color:#555;margin-bottom:8px;font-weight:600;break-after:avoid;page-break-after:avoid;">${label}</p>
        ${imgTag}
      </div>`;
  }

  appendix += `
    </div>
  </div>`;

  html = html.replace('</body>', appendix + '</body>');

  // Inject @page rules: first page 0 margin, rest 6mm top/bottom; page sheet background white
  const pageCSS = `<style>
    @page { margin: 6mm 0mm; background: #f5f5f5; }
    @page :first { margin-top: 0; }
  </style>`;
  html = html.replace('</head>', pageCSS + '</head>');

  // Write temp file
  const tmpFile = path.join(os.tmpdir(), `report_pdf_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf-8');

  // Render with Playwright and export PDF
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(tmpFile));
  await page.waitForLoadState('networkidle');
  // See global-teardown.js's generatePdf() for why: base64 <img> data: URIs raise no network
  // event, so 'networkidle' can fire before they've decoded/laid out, letting the paginator
  // split a screenshot's label from its image across a page break.
  await page.evaluate(() => Promise.all([...document.images].map(img =>
    img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
  )));

  const pdfPath = path.join(suiteDir, 'test_report.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A3',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  await browser.close();
  fs.unlinkSync(tmpFile);

  console.log('PDF generated:', pdfPath);
}

main().catch(err => { console.error(err); process.exit(1); });
