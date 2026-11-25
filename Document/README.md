# Document/

Tempat menyimpan **dokumen sumber dari klien / BA** untuk project ini, di mesin lokal:

| Isi | Contoh |
|---|---|
| Spesifikasi fungsional | `FSD <Modul> v1.0.docx` |
| Workbook test case | `TC-<Modul> v1.0.xlsx`, `[ST]-Scenario-<Modul>.xlsx` |
| Template / data loader per environment | `TEMPLATE LOADER/SIT/<TC-id>_<isi>.txt` |

**Isi folder ini sengaja TIDAK di-commit** (`.gitignore`: `/Document/*`, kecuali README ini).
Dokumen klien bisa berisi data nasabah, nomor rekening, atau informasi kontrak; repo automation
bukan tempatnya, dan history git menyimpannya selamanya walaupun file-nya dihapus.

Yang di-commit adalah turunannya di folder suite:

- workbook TC yang dipakai suite → `suites/<Feature>/<Feature>.xlsx`
- `suites/<Feature>/testcases.json` hasil `node scripts/sync-testcases.js ...` (jangan diedit manual)

Bagikan dokumen aslinya lewat kanal tim (drive / SharePoint / tracker), bukan lewat git.
