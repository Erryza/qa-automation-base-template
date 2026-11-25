# QA Automation Base Template

Base Playwright yang bisa dipakai ulang untuk automation UI web dashboard. Isinya **framework,
konvensi, dan satu reference suite** — tanpa suite project, tanpa data, tanpa report. Clone,
sesuaikan login, tambahkan suite. (English: [README.md](README.md).)

- **Satu test case = satu `test()` sungguhan.** Assertion dibiarkan throw, verdict milik
  Playwright, jadi exit code dan gate CI benar-benar berarti.
- **Suite tidak pernah menulis report.** `reporters/excel-html-reporter.js` membangun
  `suites/<Feature>/test_report.html` + PDF dari anotasi yang dipasang tiap test lewat
  `utils/tc.js`, dan bisa menulis hasilnya balik ke workbook TC.
- **Environment** `dev` / `sit` / `uat` dari `environments/<env>.env` (di-ignore git).
- **Lint** (`npm run lint`) menolak sleep tetap, URL hardcode, `test.only`, TC tanpa id, dan pola
  lama `record()` / `runTC()`.

## Struktur

```
.
├── .claude/                     # setting Claude Code + skill (generate-live-test-suite, run-tests)
├── Document/                    # dokumen klien lokal (FSD, workbook TC, loader) — isinya di-ignore git
├── environments/example.env     # template profil → copy jadi dev.env / sit.env / uat.env
├── examples/_reference-suite/   # suite acuan: copy lalu sesuaikan (tidak pernah dijalankan)
├── reporters/                   # excel-html-reporter.js — report HTML/PDF, deteksi flaky, history
├── scripts/                     # lint, run-suite, preflight, sync-testcases, rebuild/merge/PDF report, publish
├── suites/                      # suite Anda: suites/<Feature>/test.js (kosong di clone baru)
├── utils/                       # tc, waits, login(+login-config), profile, accounts, seed, reporter, excel, evidence…
├── global-setup.js              # pilih env + satu login bersama → .auth/state.json
├── global-teardown.js           # helper render PDF yang dipakai reporter
├── playwright.config.js
├── .gitlab-ci.yml               # lint tiap push, run nightly + manual
└── CLAUDE.md                    # router untuk sesi AI: standar, peta repo, house rules
```

## Mulai cepat

```bash
npm install
npx playwright install chromium
npm run lint                                     # → "[lint] no suites yet — nothing to check."
npx playwright test --list --pass-with-no-tests  # → "Total: 0 tests in 0 files"

cp environments/example.env environments/dev.env # isi url / username / password (/ otp)
# sesuaikan utils/login-config.js dengan form login aplikasi
# isi bagian "This project" di CLAUDE.md
```

Lalu copy `examples/_reference-suite/test.js` ke `suites/<Feature>/test.js` dan sesuaikan.

## Menjalankan

```bash
ENV=dev npx playwright test "suites/<Feature>/test.js" -g "TC-001"   # iterasi satu test case
ENV=dev npx playwright test "suites/<Feature>/test.js"               # satu suite
npm run suite -- --suite <Feature> --env sit                         # preflight + run + lokasi report
npm run test:ci                                                      # CI=1 HEADLESS=1
```

| Variabel | Efek |
|---|---|
| `ENV=dev\|sit\|uat` | `environments/<env>.env` yang dipakai. Tidak di-set + TTY → ditanya; tanpa TTY → `dev`. |
| `HEADLESS=1` | Browser headless (default: terlihat). |
| `COUNTRY=…` | Filter varian (opsional). |
| `IGNORE_HTTPS_ERRORS=1` | Terima sertifikat expired / self-signed (hanya host internal). |
| `SKIP_UI_LOGIN=1` | Tanpa login bersama di global setup (run API saja). |
| `REPORT_MERGE=1` | Gabungkan run parsial (`-g`) ke report sebelumnya. |

Hasil: `suites/<Feature>/test_report.html`, `REPORT/<timestamp>_<Suite>.pdf`,
`reports/` (HTML Playwright, JSON, junit, `history.jsonl`). Debug kegagalan dengan
`npx playwright show-trace test-results/<…>/trace.zip` (trace disimpan saat retry pertama).

## Menulis suite

Baca berurutan: `examples/_reference-suite/test.js` → `utils/tc.js` →
`.claude/skills/generate-live-test-suite/references/test-js-anatomy.md`. House rules ada di
`CLAUDE.md`; ringkasnya: assert hasil bukan keberadaan, jangan pernah buang TC (pakai
`markBlocked` / `markNotApplicable` / `markManual`), tunggu sinyal bukan jam (`utils/waits.js`),
nilai per environment di `environments/<env>.env`, jangan ubah data asli tanpa izin.

## CI

`.gitlab-ci.yml`: lint tiap push; job test nightly dan manual di image Playwright yang di-pin.
`environments/<env>.env` dibuat dari masked CI variable saat run lalu dihapus. Playwright di-pin
ke **1.60.0** — naikkan `package.json`, versi terpasang, dan tag image bersamaan.
