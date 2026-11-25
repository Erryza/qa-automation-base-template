/**
 * Plain-language triage for FAILED / SKIP rows of the client report: what KIND of failure it is
 * (a likely application bug, a script mistake, environment data / configuration, a document drift…),
 * WHY in words a manual tester reads at a glance, and HOW to validate it by hand.
 *
 * Two sources, never mixed up in the report:
 *  - reviewed — suites/<Feature>/review_comments.json, written after someone read the run
 *    ({ "TC-X": { "status": "FAILED", "category": "bug", "why": "...", "check": "..." } });
 *  - auto     — guessed here from the row's notes / error text when nobody reviewed it yet. The report
 *    labels it "otomatis, belum direview": a heuristic must not read like a verdict.
 * Neither ever changes a status: Playwright's verdict stays the verdict.
 */

const CATEGORIES = {
  bug:    { label: 'Kemungkinan BUG aplikasi', border: '#C62828', bg: '#FFEBEE', fg: '#B71C1C' },
  script: { label: 'Kesalahan script (suite)', border: '#7B1FA2', bg: '#F3E5F5', fg: '#4A148C' },
  data:   { label: 'Data / environment', border: '#EF6C00', bg: '#FFF3E0', fg: '#E65100' },
  drift:  { label: 'Beda dokumen vs aplikasi', border: '#1565C0', bg: '#E3F2FD', fg: '#0D47A1' },
  config: { label: 'Butuh ubah konfigurasi global', border: '#546E7A', bg: '#ECEFF1', fg: '#37474F' },
  todo:   { label: 'Belum diotomasi', border: '#757575', bg: '#F5F5F5', fg: '#424242' },
  cek:    { label: 'Perlu dicek manual', border: '#F9A825', bg: '#FFFDE7', fg: '#5D4037' },
};

const TRIAGED = new Set(['FAILED', 'SKIP', 'SKIPPED', 'INVALID']);

const strip = s => String(s || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]+m/g, '');

// The mismatches an `expect(problems).toEqual([])` printed: the "+   "..."" lines of the diff.
function listedProblems(text) {
  const out = [];
  for (const m of text.matchAll(/\+\s+"((?:[^"\\]|\\.)*)",?/g)) out.push(m[1].replace(/\\"/g, '"'));
  return out;
}

// The option text a dropdown wait was looking for: hasText: /^\s*United\s*States\s*dollar\s*$/i
function wantedOption(text) {
  const m = text.match(/item-option'\)\.filter\(\{ hasText: \/(.+?)\/i? \}\)/);
  if (!m) return '';
  return m[1].replace(/^\^/, '').replace(/\$$/, '').replace(/\\s\*/g, ' ').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
}

function autoFailed(text) {
  if (/side menu never loaded|Login as \S+ failed|waitForURL|net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/.test(text)) {
    return { category: 'data', why: 'Aplikasi tidak bisa dibuka / login tidak sampai ke Workspace, jadi langkah test belum sempat dijalankan. Ini bukan hasil dari fitur yang dites.', check: 'Buka aplikasi manual (VPN, akun, halaman Workspace). Kalau lancar, jalankan ulang TC ini.' };
  }
  if (/\b500\b|An error occurred when process your request|Internal Server Error|Failed get business parameter/i.test(text)) {
    return { category: 'data', why: 'Server mengembalikan error di tengah langkah test (HTTP 500 / "Failed get business parameter"), jadi fitur tidak bisa dicek sampai selesai.', check: 'Ulangi langkah TC ini manual. Error yang sama muncul → laporkan ke tim aplikasi / environment. Tidak muncul → kemungkinan error sesaat, jalankan ulang.' };
  }
  const opt = wantedOption(text);
  if (opt) {
    return { category: 'cek', why: `Pilihan "${opt}" tidak ditemukan di dropdown.`, check: `Buka dropdown itu manual. Pilihannya ada tapi namanya beda → nama master data beda per environment (data / script menyesuaikan). Pilihannya memang tidak ada → bug atau master data belum disiapkan.` };
  }
  const problems = listedProblems(text);
  if (/toEqual|toBe|toMatch|toContain/.test(text) && problems.length) {
    return { category: 'cek', why: `Aplikasi berbeda dari yang diharapkan FSD / workbook di ${problems.length} poin:`, points: problems, check: 'Cocokkan tiap poin dengan FSD dan tes manual. Aplikasi memang begitu dan FSD bilang lain → bug (atau dokumennya yang belum update). Aplikasi sudah sesuai FSD → script salah membaca layar: sebutkan nomor TC-nya.' };
  }
  if (/Timeout|toBeVisible|element\(s\) not found|waiting for locator/.test(text)) {
    return { category: 'cek', why: 'Tombol / field / halaman yang ditunggu script tidak muncul dalam batas waktu.', check: 'Lihat screenshot. Halaman error atau kosong → environment. Elemennya ada tapi beda nama / letak → script perlu disesuaikan. Fiturnya memang tidak ada → bug.' };
  }
  return { category: 'cek', why: 'Hasil yang dicek script tidak sesuai harapan (detail teknis di atas).', check: 'Ulangi langkah TC ini manual dan bandingkan dengan Expected Result.' };
}

function autoSkipped(text) {
  const key = text.match(/set (\w+?)(?:_\*|\b)[^.]*? in environments/);
  if (key) return { category: 'data', why: `Butuh data atau akun yang belum disiapkan untuk environment ini (${key[1]}).`, check: 'Kalau datanya ada di environment, isi key itu di environments/<env>.env, maka TC ini otomatis jalan. Bukan bug.' };
  if (/global (configuration|setting|parameter)|global setting|shared environment/i.test(text)) return { category: 'config', why: 'TC ini harus mengubah setting yang berlaku untuk semua user di environment (mis. System Parameter / approval model), jadi sengaja tidak dijalankan.', check: 'Tes manual kalau setting boleh diubah sementara, atau minta izin agar script boleh mengubah lalu mengembalikannya.' };
  if (/not automated yet/i.test(text)) return { category: 'todo', why: 'Halaman / langkah ini belum bisa diotomasi karena belum bisa diprobe di environment (mis. halaman task error).', check: 'Tes manual dulu. Bukan bug dari hasil otomasi.' };
  if (/precondition/i.test(text)) return { category: 'data', why: 'Prasyarat TC ini (data yang dibuat langkah / TC sebelumnya) tidak berhasil dibuat, jadi TC ini tidak bisa dimulai.', check: 'Lihat alasan prasyarat di atas dan TC yang membuatnya. TC ini ikut jalan setelah penyebab itu beres.' };
  if (/only \d+ pages?|needs a product|none is configured|no account/i.test(text)) return { category: 'data', why: 'Data di environment ini tidak cukup untuk skenario TC ini.', check: 'Siapkan datanya (lihat alasan di atas) atau tes manual.' };
  return { category: 'cek', why: 'TC ini dilewati (alasan di atas).', check: 'Tes manual bila perlu.' };
}

/**
 * The triage block of one row: { source: 'review' | 'auto', category, why, points?, check, comment? }, or null.
 * `comment` is what review_comments.json gave (a plain string, or { category, why, check, comment }).
 */
function triageOf(row) {
  if (!TRIAGED.has(row.status)) return null;
  const c = row.comment;
  if (c && typeof c === 'object' && (c.why || c.category)) return { source: 'review', ...c };
  if (typeof c === 'string' && c) return { source: 'review', category: '', why: '', check: '', comment: c };
  const text = strip(row.notes);
  if (row.status === 'FAILED') return { source: 'auto', ...autoFailed(text) };
  if (row.status === 'SKIP' || row.status === 'SKIPPED') return { source: 'auto', ...autoSkipped(text) };
  return null;
}

module.exports = { CATEGORIES, triageOf };
