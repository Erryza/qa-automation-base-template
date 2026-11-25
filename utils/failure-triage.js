/**
 * A first triage of a FAILED row, in plain Indonesian, for the tester who validates it.
 *
 * WHY: a failed row only carried Playwright's own message ("locator.click: Timeout 30000ms exceeded", "Unexpected end of
 * JSON input"). The tester had to work out from that whether it is a bug in the app, a step the script got wrong (the test
 * case actually passes), data the environment does not have, or the network — before any of it could be reported
 * (user request 2026-10-20). This reads the row's notes (the assertion message + Expected / Received, a known defect)
 * and names the LIKELY cause, why, and how to confirm it by hand.
 *
 * It is a reading of the error text, not a verdict: the status stays FAILED, and the kind says "kemungkinan". A suite
 * that knows better says so itself: a known defect (utils/tc.js defect()) always classifies as a bug.
 *
 * The rules are ordered: the first match wins. Add a pattern to the kind it proves, with the case it came from.
 */

// `decide` is the tester's 3-way decision, in the order it is checked by hand: when is it a BUG, when does the test case
// actually PASS (the script is wrong), when is it DATA / environment. The report shows it as a short list under each failed
// row; the workbook joins it into one line (user request 2026-10-23: "validasi failed lebih mudah — bug, sebenarnya pass
// tapi salah ngerjain, atau data").
const KINDS = {
  BUG: {
    label: 'Kemungkinan BUG aplikasi',
    color: '#C62828',
    check: 'Ulangi langkah TC secara manual di aplikasi dan bandingkan dengan screenshot.',
    decide: [
      ['BUG', 'hasil manual sama dengan screenshot dan berbeda dari Expected Result di workbook — laporkan beserta screenshot.'],
      ['Sebenarnya PASS (script salah)', 'hasil manual sesuai Expected Result, tetapi script melaporkan lain.'],
      ['Beda dokumen', 'aplikasi sengaja dibuat begitu dan Expected Result di workbook sudah tidak berlaku — minta BA memperbarui dokumen.'],
    ],
  },
  WORDING: {
    label: 'Pesan muncul, kata-katanya beda',
    color: '#00838F',
    check: 'Buka Expected Result TC ini di workbook dan bandingkan dengan pesan yang tampil di screenshot.',
    decide: [
      ['Sebenarnya PASS (script salah)', 'Expected Result hanya meminta "muncul error / pesan" tanpa kalimat persis — script terlalu ketat, perbaiki script.'],
      ['BUG kecil / beda dokumen', 'Expected Result menulis kalimat persis dan aplikasi menampilkan kalimat lain — laporkan ke BA / developer.'],
    ],
  },
  DATA: {
    label: 'Masalah DATA',
    color: '#EF6C00',
    check: 'Cek di aplikasi apakah data yang disebut memang ada di environment ini.',
    decide: [
      ['Masalah DATA (bukan bug)', 'datanya tidak ada / berbeda — tambahkan datanya atau sesuaikan nilainya di environments/<env>.env, lalu jalankan ulang TC ini.'],
      ['BUG', 'datanya ada, tetapi aplikasi tetap tidak menampilkannya dengan benar.'],
    ],
  },
  ENV: {
    label: 'Gangguan KONEKSI / server',
    color: '#6D4C41',
    check: 'Jalankan ulang TC ini saja (npx playwright test <suite> -g "<TC ID>").',
    decide: [
      ['Gangguan sesaat (bukan bug)', 'TC lolos saat dijalankan ulang.'],
      ['Masalah server / infra', 'gagal terus dengan pesan error server yang sama — laporkan ke tim infra / server.'],
    ],
  },
  SCRIPT: {
    label: 'Kemungkinan masalah SCRIPT otomasi',
    color: '#1565C0',
    check: 'Ulangi langkah TC secara manual.',
    decide: [
      ['Sebenarnya PASS (script salah)', 'di aplikasi berhasil sesuai Expected Result — script otomasinya yang perlu diperbaiki.'],
      ['BUG', 'di aplikasi juga gagal dengan cara yang sama.'],
    ],
  },
  CHECK: {
    label: 'Perlu dicek manual',
    color: '#616161',
    check: 'Buka screenshot dan bandingkan dengan Expected Result, lalu ulangi langkah TC secara manual.',
    decide: [
      ['BUG', 'aplikasi memang tidak sesuai Expected Result.'],
      ['Sebenarnya PASS (script salah)', 'aplikasi sesuai Expected Result.'],
      ['Masalah DATA / ENV', 'data yang dibutuhkan tidak ada, atau server sedang error.'],
    ],
  },
};

// [kind, pattern, plain explanation]. Order matters: the first match wins.
const RULES = [
  ['ENV', /net::ERR_|ERR_TOO_MANY_RETRIES|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ECONNRESET|ETIMEDOUT|socket hang up/i,
    'Halaman aplikasi tidak bisa dibuka saat test berjalan (koneksi ke server terputus / ditolak, mis. ERR_TOO_MANY_RETRIES). Aplikasinya belum sempat dites sama sekali.'],
  ['ENV', /Unexpected end of JSON input|empty \/ unreadable body|\b50[234]\b.*(Bad Gateway|Service Unavailable|Gateway Time-?out)|Failed get (permission|auth menu)|Internal Server Error/i,
    'Server aplikasi menjawab tidak normal (balasan kosong / error server) saat test berjalan. Ini gangguan server sesaat, bukan hasil dari langkah TC.'],
  ['ENV', /login did not establish a session|the app asked for an OTP|Target page, context or browser has been closed/i,
    'Sesi login / browser terputus sebelum langkah TC selesai, jadi TC ini belum benar-benar dites.'],
  ['DATA', /\bno (\w+ )?(record|data|row)s?\b(?! found)|returned nothing|did not (narrow|filter)|unexpectedly has records|\bno [\w ]{1,30} contains\b|nothing to open|data tidak cukup|not enough data|is not in the list/i,
    'Data yang dibutuhkan test tidak ada atau berbeda di environment ini (mis. record / kata kunci pencarian yang dipakai test tidak ditemukan).'],
  ['DATA', /options differ from|differ from the (active|cities|provinces)/i,
    'Pilihan di dropdown berbeda dengan master data dari server — biasanya karena master data di environment ini (mis. nilai kembar / tidak aktif), perlu dicek apakah tampilannya benar.'],
  ['SCRIPT', /\b(TypeError|ReferenceError|RangeError)\b|is not a function|Cannot read properties of (undefined|null)|SyntaxError(?!: Unexpected end of JSON)/,
    'Script otomasi berhenti karena error di kodenya sendiri, sebelum sempat memeriksa hasil aplikasi.'],
  ['SCRIPT', /strict mode violation|resolved to \d+ elements/i,
    'Script menemukan lebih dari satu elemen yang cocok sehingga tidak tahu harus memilih yang mana — penanda (selector) di script perlu diperjelas.'],
  ['SCRIPT', /locator\.(click|fill|check|selectOption|press|hover|waitFor)[^\n]*Timeout|Timeout \d+ms exceeded[^\n]*\n?[^\n]*waiting for (locator|getBy)/i,
    'Script tidak menemukan tombol / field / pilihan yang mau diklik atau diisi dalam batas waktu. Bisa karena namanya beda di environment ini (script perlu disesuaikan), halaman lambat, atau elemen itu memang hilang dari aplikasi.'],
];

/** The assertion's own first line and its Expected / Received pair, as one plain sentence. */
function whatHappened(text) {
  const lines = String(text || '').split(/\n| \| /).map(l => l.trim()).filter(Boolean);
  const msg = lines.find(l => /^Error: /.test(l) && !/^Error: (expect|page\.|locator\.)/.test(l));
  const exp = lines.find(l => /^Expected( pattern| substring| value)?:/.test(l));
  const rec = lines.find(l => /^Received( string| value)?:/.test(l));
  const parts = [];
  if (msg) parts.push(`Pesan test: ${msg.replace(/^Error: /, '')}`);
  if (exp && rec) parts.push(`Diharapkan ${exp.replace(/^Expected[^:]*:\s*/, '')}, tetapi aplikasi menunjukkan ${rec.replace(/^Received[^:]*:\s*/, '')}`);
  return parts.join('. ');
}

/**
 * @param {{status: string, notes?: string, defect?: string}} row  a report row
 * @returns {null | {kind: string, label: string, color: string, why: string, detail: string, check: string}}
 */
function triageFailure(row) {
  if (!row || row.status !== 'FAILED') return null;
  const text = String(row.notes || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
  const detail = whatHappened(text);
  let kind = null;
  let why = '';
  // Network first: a defect id on a row that never reached the app would blame the app for the network.
  for (const [k, re, plain] of RULES.filter(r => r[0] === 'ENV')) if (re.test(text)) { kind = k; why = plain; break; }
  if (!kind && row.defect) {
    kind = 'BUG';
    why = `Perilaku aplikasi berbeda dari dokumen dan sudah dikenali sebagai defect ${row.defect}.`;
  }
  // A message element showed text, only not the words the script expected: 9 Insurance Partner TCs failed this way on
  // 2026-10-23 ("Partner Name is required." vs /Field is required/) and were labelled "Kemungkinan BUG" although the
  // inline error was there. A different wording is a question for the workbook, not a bug by default.
  const shown = (text.match(/Received (?:string|value)?:\s*"([^"]+)"/) || [])[1];
  if (!kind && shown && /Expected (pattern|string|substring)/.test(text)
    && /explain-error|message|notification|alert|toast|modal|error|pesan|refus/i.test(text)) {
    kind = 'WORDING';
    why = `Aplikasi menampilkan pesan di tempat yang benar ("${shown}"), hanya kalimatnya berbeda dari yang dicek script.`;
  }
  if (!kind) for (const [k, re, plain] of RULES) if (re.test(text)) { kind = k; why = plain; break; }
  if (!kind && /Expected|toBe|toEqual|toContain|toMatch|toHave/.test(text)) {
    kind = 'BUG';
    why = 'Aplikasi berjalan, tetapi hasilnya tidak sama dengan Expected Result.';
  }
  if (!kind) { kind = 'CHECK'; why = 'Penyebabnya tidak dapat disimpulkan dari pesan error.'; }
  const check = KINDS[kind].check.replace('<TC ID>', row.tcId || '<TC ID>');
  return { kind, ...KINDS[kind], check, why, detail };
}

module.exports = { triageFailure, FAILURE_KINDS: KINDS };
