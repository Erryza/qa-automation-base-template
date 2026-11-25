const { triageFailure } = require('./failure-triage');
const { CATEGORIES } = require('./explain');
const ExcelJS = require('exceljs');
const path = require('path');

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'object' && value.richText) {
    return value.richText.map(r => r.text).join('');
  }
  if (typeof value === 'object' && value.formula !== undefined) {
    return value.result?.toString().trim() ?? '';
  }
  return value.toString().trim();
}

async function readTestCases(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvedPath);

  const sheet = workbook.worksheets[0];
  const headers = {};
  const testCases = [];

  sheet.getRow(1).eachCell((cell, col) => {
    const val = cellToString(cell.value);
    if (val) headers[col] = val;
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const tc = { _rowNumber: rowNumber };
    let hasData = false;

    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (headers[col]) {
        const val = cellToString(cell.value);
        tc[headers[col]] = val;
        if (val) hasData = true;
      }
    });

    const tcId = tc['TC_ID'] || tc['tc_id'] || tc['TCID'];
    if (hasData && tcId) {
      tc['TC_ID'] = tcId;
      testCases.push(tc);
    }
  });

  return { workbook, sheet, headers, testCases, resolvedPath };
}

function markResult(workbook, rowNumber, status, notes, timestamp) {
  const sheet = workbook.worksheets[0];
  const colMap = {};

  sheet.getRow(1).eachCell((cell, col) => {
    const h = cellToString(cell.value).toLowerCase();
    if (h) colMap[h] = col;
  });

  const statusCol = colMap['test_result'] || colMap['test result'] || colMap['result'];
  const notesCol = colMap['notes'] || colMap['remarks'] || colMap['error'] || colMap['comment'];
  const tsCol = colMap['timestamp'] || colMap['executed_at'] || colMap['execution time'];

  const row = sheet.getRow(rowNumber);

  if (statusCol) {
    const cell = row.getCell(statusCol);
    cell.value = status;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: status === 'PASSED' ? 'FF92D050' : 'FFFF0000' },
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center' };
  }

  if (notesCol && notes) row.getCell(notesCol).value = notes;
  if (tsCol && timestamp) row.getCell(tsCol).value = timestamp;

  row.commit();
}

async function saveWorkbook(workbook, resolvedPath) {
  await workbook.xlsx.writeFile(resolvedPath);
}

async function readAllSheets(filePath) {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolvedPath);

  const sheets = {};
  for (const sheet of workbook.worksheets) {
    const headers = {};
    const testCases = [];

    sheet.getRow(1).eachCell((cell, col) => {
      const val = cellToString(cell.value);
      if (val) headers[col] = val;
    });

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const tc = { _rowNumber: rowNumber, _sheet: sheet.name };
      let hasData = false;
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (headers[col]) {
          const val = cellToString(cell.value);
          tc[headers[col]] = val;
          if (val) hasData = true;
        }
      });
      const tcId = tc['TC_ID'] || tc['tc_id'];
      if (hasData && tcId) { tc['TC_ID'] = tcId; testCases.push(tc); }
    });

    sheets[sheet.name] = { sheet, testCases };
  }

  return { workbook, resolvedPath, sheets };
}

function markSheetResult(workbook, sheetName, rowNumber, status, notes, timestamp) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return;
  const colMap = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const h = cellToString(cell.value).toLowerCase();
    if (h) colMap[h] = col;
  });
  const statusCol = colMap['test_result'] || colMap['test result'] || colMap['result'];
  const notesCol  = colMap['notes'] || colMap['remarks'] || colMap['error'];
  const tsCol     = colMap['timestamp'] || colMap['executed_at'];
  const row = sheet.getRow(rowNumber);
  if (statusCol) {
    const cell = row.getCell(statusCol);
    cell.value = status;
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: status === 'PASSED' ? 'FF92D050' : 'FFFF0000' } };
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center' };
  }
  if (notesCol && notes)     row.getCell(notesCol).value = notes;
  if (tsCol   && timestamp)  row.getCell(tsCol).value    = timestamp;
  row.commit();
}

/**
 * Verdict (tc.status / Playwright status) → the workbook's own Pass/Fail vocabulary.
 * MANUAL is not a verdict: it stays "To Be Executed" and carries its reason in Manual Reason.
 */
const WORKBOOK_STATUS = {
  PASSED: 'Passed', COMBINE: 'Passed', FAILED: 'Failed',
  SKIP: 'Blocked', MANUAL: 'To Be Executed', SKIPPED: 'Invalid', INVALID: 'Invalid',
};

/**
 * Write one run's results into a test-case sheet laid out as blocks, each starting with a header
 * row whose column A is "No." (Feature, …, The Results Obtained, Pass/Fail, Defect ID, Defect
 * Validation). Columns are found by header name in every block; "Testing Type" / "Manual Reason"
 * are appended after "Defect Validation" when a block lacks them.
 *
 * A second layout is accepted too (a common client workbook shape):
 * column A "No" holds a running number and the TC id lives in a "TC ID" column; the verdict column
 * is "Pass/Failed". The TC id is read from "TC ID" when the block has one, else from "No.".
 *
 * Only rows whose TC id is in `rows` are touched, so a `-g` run leaves the rest of the sheet as it
 * was, and the file is edited in place — the other sheets (other suites' results) survive.
 *
 * @param {import('exceljs').Workbook} workbook  already loaded; the caller saves once per file
 * @param {string} sheetName
 * @param {Array<{tcId:string,status:string,notes:string,defect?:string}>} rows
 * @param {{env?:string,date:string}} run
 * @returns {number} rows written
 */
function writeTcResults(workbook, sheetName, rows, run) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`no sheet "${sheetName}"`);
  const byId = new Map(rows.map(r => [r.tcId, r]));
  const headerRows = [];
  sheet.eachRow((row, n) => { if (['No.', 'No'].includes(cellToString(row.getCell(1).value))) headerRows.push(n); });
  let written = 0;
  headerRows.forEach((h, i) => {
    const head = sheet.getRow(h);
    const col = {};
    head.eachCell((cell, c) => { const name = cellToString(cell.value); if (name) col[name] = c; });
    // "Pass/Fail SIT": a per-environment verdict header seen in some master workbooks
    col['Pass/Fail'] = col['Pass/Fail'] || col['Pass/Failed'] || col['Pass/Fail SIT'];
    if (!col['Pass/Fail'] || !col['The Results Obtained']) return;
    const idCol = col['TC ID'] || col['No.'] || 1;
    const ref = col['Defect Validation'] || col['Defect ID'] || col['Pass/Fail'];
    let last = Math.max(...Object.values(col));
    for (const [name, width] of [['Testing Type', 16], ['Manual Reason', 40]]) {
      if (col[name]) continue;
      col[name] = ++last;
      const cell = head.getCell(last);
      cell.value = name;
      cell.style = JSON.parse(JSON.stringify(head.getCell(ref).style || {}));
      sheet.getColumn(last).width = width;
    }
    const end = headerRows[i + 1] || sheet.rowCount + 1;
    for (let n = h + 1; n < end; n++) {
      const row = sheet.getRow(n);
      // The next block's title band ("Test No | PRD_CALC_004", Date, PIC Test) sits above its header
      // row; a one-TC block repeats the TC id there, and writing to it would double-count the row.
      if (/^Test No$/i.test(cellToString(row.getCell(1).value).trim())) break;
      const r = byId.get(cellToString(row.getCell(idCol).value).trim());
      if (!r) continue;
      const status = WORKBOOK_STATUS[r.status] || 'Failed';
      const style = JSON.parse(JSON.stringify(row.getCell(ref).style || {}));
      const manual = r.status === 'MANUAL';
      // A failed row leads with its plain-language triage: the REVIEWED one (review_comments.json, written by someone who
      // read the run — the same block the HTML report shows) when there is one, else the automatic guess
      // (utils/failure-triage.js). The workbook used to carry only the guess while the report showed the review.
      const rv = r.status === 'FAILED' && r.comment && typeof r.comment === 'object' && r.comment.why ? r.comment : null;
      const t = rv ? null : triageFailure(r);
      const lead = rv ? `[${(CATEGORIES[rv.category] || CATEGORIES.cek).label} — direview] ${rv.why} Cara validasi: ${rv.check}${rv.comment ? ` Catatan: ${rv.comment}` : ''} — Detail teknis: `
        : t ? `[${t.label}] ${t.why}${t.detail ? ` ${t.detail}.` : ''} Cara validasi: ${t.check} ${(t.decide || []).map(([v, when]) => `→ ${v} jika ${when}`).join(' ')} — Detail teknis: ` : '';
      const text = lead + (r.notes || (status === 'Passed' ? 'As expected' : ''));
      row.getCell(col['Pass/Fail']).value = status;
      row.getCell(col['The Results Obtained']).value = `[Automated ${run.date}${run.env ? `, ${run.env}` : ''}] ${text}`.trim();
      if (col['Defect ID']) row.getCell(col['Defect ID']).value = status === 'Failed' && r.defect ? r.defect : null;
      for (const [name, value] of [['Testing Type', manual ? 'Manual' : 'Automation'], ['Manual Reason', manual ? r.notes : '']]) {
        const cell = row.getCell(col[name]);
        cell.value = value;
        cell.style = JSON.parse(JSON.stringify(style));
      }
      row.commit();
      written++;
    }
  });
  return written;
}

module.exports = { readTestCases, markResult, markSheetResult, readAllSheets, saveWorkbook, writeTcResults };
