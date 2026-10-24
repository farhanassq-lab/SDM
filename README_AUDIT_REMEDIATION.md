# RQ SDM — Panduan Perbaikan 15 Temuan Audit

Tanggal paket: 24 Oktober 2026. Target proyek pada panduan ini: `kodmeuxktfmsaqinmfzk`.

## Ringkasan perbaikan kode

| No. | Temuan | Status di paket |
|---:|---|---|
| 1 | `observer` mungkin null | Diperbaiki dengan optional chaining; `tsc -b` lulus. |
| 2 | Direktori SDM bocor melalui autocomplete publik | Pencarian publik dinonaktifkan. Form menggunakan tautan pribadi per SDM, hash token disimpan server-side, token berlaku 90 hari dan tautan baru mengganti tautan lama. |
| 3 | Pengajuan atas nama SDM lain / nomor tidak cocok | Endpoint memverifikasi token, penugasan, dan nomor WhatsApp dengan `employee_biodata.phone`. |
| 4 | Sekjen dapat mengubah/menghapus profil Super Admin | Trigger database menolak mutasi profil Super Admin oleh non-Super Admin. |
| 5 | Kepala Unit dapat menulis langsung ke `employee_assignments` | Kebijakan RLS tulis langsung dibatasi ke admin SDM. Pencatatan penugasan unit tetap melalui RPC yang memvalidasi kewenangan. |
| 6 | Data absensi/laporan terpotong 1.000 baris | Paginasi `.range()` diterapkan pada direktori, penugasan, roster, jadwal, absensi, dan laporan. |
| 7 | Kata sandi awal tidak wajib diganti / tidak ada reset | Halaman ganti kata sandi wajib, endpoint server untuk menyelesaikan perubahan, tombol reset pada Manajemen Pengguna, dan flag database yang membatasi akses sampai kata sandi diganti. |
| 8 | `xlsx` 0.18.5 | Dependensi dipatok ke tarball resmi SheetJS 0.20.3. Instalasi membutuhkan akses ke CDN resmi SheetJS. |
| 9 | Unit dapat menghapus bukti Storage; file yatim | DELETE Storage dibatasi ke admin. Program dihapus melalui Edge Function yang menghapus bukti terlebih dahulu. Ditambahkan pembersihan file yatim yang tidak lagi direferensikan. Constraint `evidence_url` juga diperbaiki agar menerima path Storage privat. |
| 10 | Signup publik dan profil baru aktif otomatis | Trigger membuat profil baru nonaktif dan menonaktifkan profil tanpa peran/akses. **Pengaturan Allow new users to sign up tetap harus dimatikan manual di Supabase Dashboard.** |
| 11 | `created_by` / `updated_by` dapat dipalsukan dari browser | Trigger database menetapkan pelaku dari `auth.uid()` dan mempertahankan `created_by` saat update. |
| 12 | Tanggal memakai UTC/zona perangkat | Tanggal hari ini, roster, laporan, penilaian, aktivitas, dan form publik menggunakan `Asia/Jakarta`. |
| 13 | NIK utuh dan tombol hapus mencolok | NIK dimasking; aksi pengarsipan dipindahkan ke dialog detail dan memerlukan konfirmasi ketik nama. |
| 14 | Salt tetap, CORS `*`, versi SDK tidak dipatok, rate limit tidak dibersihkan | Salt dibaca dari secret, CORS menggunakan allowlist `PUBLIC_APP_ORIGINS`, SDK Edge Function dipatok ke `2.118.0`, rate limit berbasis hash dan pembersihan harian dijadwalkan jika `pg_cron` tersedia. |
| 15 | ZIP berisi `.env.local`, `supabase/.temp`, email admin | Paket ini tidak menyertakan rahasia, `.temp`, `node_modules`, atau email admin asli. `.gitignore` diperketat dan template bootstrap disediakan. |

## Perubahan form izin publik

Pencarian nama dua huruf tidak dipertahankan karena itu membocorkan direktori SDM. Pengganti yang disiapkan:

1. Sekjen membuka **Pusat Data SDM** dan menekan **Tautan izin** pada SDM yang dipilih.
2. Sistem menerbitkan tautan acak, menyimpan hash token saja, dan menyalin tautan ke clipboard bila browser mengizinkan.
3. Sekjen mengirim tautan itu secara pribadi kepada SDM terkait. Tautan berlaku 90 hari. Membuat tautan baru membatalkan tautan sebelumnya.
4. Form memverifikasi token, menampilkan nama dan penugasan, serta meminta nomor WhatsApp yang harus cocok dengan `employee_biodata.phone`.
5. Satu penugasan terisi otomatis. Jika ada beberapa penugasan aktif, SDM memilih unit/tugas yang relevan.
6. Rentang tanggal hanya muncul untuk cuti. Jenis pengajuan lain memakai satu tanggal. Shift tidak ditanyakan pada formulir publik.
7. Persetujuan kepala unit tetap berjalan melalui modul yang sudah ada.

Tautan pribadi adalah kredensial pembawa (bearer token). Jangan mengirimkannya ke grup. Jika bocor, buat tautan baru untuk membatalkan yang lama.

## Urutan pemasangan

### 1. Cadangkan proyek

Buat salinan `D:\RQ_SDM`, dan pastikan tersedia backup database. Jangan memasukkan `.env.local` ke ZIP atau GitHub.

### 2. Salin paket dan instal dependensi

Ekstrak ZIP dan salin isi proyek ke `D:\RQ_SDM`. Pertahankan `.env.local` lokalmu. Dari terminal Windows:

```cmd
cd /d D:\RQ_SDM
npm install
```

Jika instalasi SheetJS tidak memperbarui dependensi, ikuti instruksi resmi SheetJS:

```cmd
npm uninstall xlsx
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz --save
```

Dokumentasi resmi: https://docs.sheetjs.com/docs/getting-started/installation/nodejs/

### 3. Terapkan migrasi keamanan satu kali

Buka SQL Editor proyek RQ SDM yang benar, periksa reference ID, lalu jalankan isi `15_security_audit_remediation.sql` setelah meninjau dan memastikan tabel tahap sebelumnya tersedia.

Migrasi ini:
- menambahkan `must_change_password`;
- membuat tabel token privat;
- memperketat RLS penugasan dan Storage;
- menambahkan trigger profil Super Admin dan pencatatan pelaku;
- menambahkan rate limiter dan fungsi pembersihan;
- memperbaiki constraint path bukti aktivitas.

Jangan menjalankan `npx supabase db push` sebelum migration history lokal dan remote direkonsiliasi. Jika memilih Supabase CLI, gunakan file `supabase/migrations/20261024000800_security_audit_remediation.sql` melalui alur migrasi yang telah diverifikasi. Jangan menerapkan salinan SQL Editor dan migrasi CLI secara bersamaan tanpa memeriksa riwayatnya.

### 4. Matikan signup publik

Di Supabase Dashboard, buka **Authentication → Settings → User Signups** dan matikan **Allow new users to sign up**. Ini pengaturan Auth Dashboard, bukan sesuatu yang bisa dipastikan hanya dengan SQL. Dokumentasi: https://supabase.com/docs/guides/auth/general-configuration

### 5. Tetapkan Edge Function secrets

Di PowerShell, buat salt acak:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$salt = [BitConverter]::ToString($bytes).Replace('-', '').ToLower()
```

Ganti `https://YOUR-VERCEL-DOMAIN.vercel.app` dengan domain produksi Vercel yang sebenarnya, lalu tetapkan secrets:

```powershell
npx supabase secrets set `
  "PUBLIC_APP_BASE_URL=https://YOUR-VERCEL-DOMAIN.vercel.app" `
  "PUBLIC_APP_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app,http://localhost:5173,http://127.0.0.1:5173" `
  "PUBLIC_FORM_RATE_LIMIT_SALT=$salt" `
  --project-ref kodmeuxktfmsaqinmfzk
```

Untuk produksi yang lebih ketat, hapus origin localhost setelah pengujian lokal selesai. CORS bukan pengganti autentikasi; endpoint admin tetap memeriksa sesi dan peran di server.

### 6. Deploy Edge Functions

Jalankan dari `D:\RQ_SDM` setelah SQL dan secrets siap:

```cmd
npx supabase functions deploy admin-create-user --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy admin-reset-user-password --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy complete-password-change --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy admin-issue-absence-link --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy admin-delete-activity-program --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy cleanup-orphan-activity-evidence --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy admin-invite-user --project-ref kodmeuxktfmsaqinmfzk
npx supabase functions deploy public-absence-submission --no-verify-jwt --project-ref kodmeuxktfmsaqinmfzk
```

`admin-invite-user` sengaja mengembalikan HTTP 410 karena alur undangan email tidak lagi digunakan. Form publik tetap tanpa login, tetapi wajib memiliki tautan pribadi.

### 7. Build dan uji sebelum deploy

```cmd
npm run build
npm run dev
```

Uji minimal:

- Form `/form-izin` tanpa token tidak menampilkan direktori nama.
- Tautan yang dibuat dari Pusat Data SDM bisa diverifikasi.
- Tautan lama gagal setelah diterbitkan tautan baru; token kedaluwarsa ditolak.
- Nomor WhatsApp yang tidak cocok ditolak.
- SDM dengan satu penugasan mendapat unit otomatis; SDM multi-penugasan bisa memilih.
- Cuti dapat memakai rentang tanggal; pengajuan lain hanya satu tanggal.
- Persetujuan/rejeksi tetap dilakukan kepala unit dan tidak menimpa catatan absensi yang sudah ada.
- Akun baru wajib mengganti kata sandi; reset dari admin membuat kewajiban yang sama.
- Sekjen tidak dapat mengubah/menonaktifkan profil Super Admin.
- Kepala Unit gagal menulis langsung ke `employee_assignments`, tetapi RPC yang tervalidasi tetap berfungsi.
- Impor/rekap absensi dengan lebih dari 1.000 baris tidak terpotong.
- Bukti kegiatan dapat disimpan dan dibuka; penghapusan program membersihkan berkas terkait.

### 8. Pembersihan rate limit

Migrasi akan menjadwalkan pembersihan harian jika ekstensi `pg_cron` sudah tersedia. Periksa dengan:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'rq_sdm_rate_limit_cleanup';
```

Jika `pg_cron` tidak tersedia, jalankan `select public.cleanup_public_form_rate_limits();` secara berkala dari SQL Editor atau aktifkan mekanisme jadwal yang didukung proyek.

## Hasil pengujian dalam lingkungan audit

- Frontend `tsc -b --pretty false`: lulus.
- Parsing sintaks 8 file Edge Function TypeScript: 0 diagnostik sintaks.
- Build Vite penuh tidak dapat diverifikasi di lingkungan audit karena `node_modules` Windows dari ZIP tidak membawa binding native Rolldown Linux. Jalankan `npm install` dan `npm run build` di Windows sebelum deployment.
- SQL belum dieksekusi pada proyek Supabase. Migrasi harus ditinjau dan diuji di proyek yang benar.
