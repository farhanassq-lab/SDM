# RQ SDM — Audit & Perbaikan Antarmuka

Paket ini merupakan **patch** untuk proyek RQ SDM yang dikirim. Paket tidak menyertakan `.env.local`, `node_modules`, atau data rahasia. Jangan menimpa `.env.local` yang sudah ada.

## Temuan audit
1. `src/index.css` membatasi `#root` ke lebar tetap, mengaktifkan warna gelap otomatis, dan meratakan teks ke tengah. Reset diperbaiki agar aplikasi menggunakan lebar layar penuh.
2. Aturan `.side-link > span` lama mengatur lebar ikon dan label teks sekaligus. Selector baru membatasi lebar hanya pada ikon.
3. Foto masjid tidak lagi tampil di sidebar. Foto ditempatkan sebagai aksen global di header setiap halaman dengan lapisan putih transparan agar teks tetap terbaca.
4. Ukuran font, tombol, input, kartu, dan tabel diperbesar dan diseragamkan.
5. Form pencatatan SDM dibagi menjadi langkah visual; data tambahan dan catatan dibuat opsional dalam bagian yang dapat dibuka/tutup.
6. Form tambah akun sekarang dapat mengundang akun sekaligus memilih peran global atau peran unit. Perubahan ini memerlukan deployment ulang Edge Function.
7. Pusat Data SDM memiliki tombol **Hapus SDM**. Bila ada riwayat absensi, jadwal, izin, aktivitas, tugas, penilaian, atau akun terkait, SDM diarsipkan agar riwayat tetap utuh. Bila tidak ada riwayat terkait, data dapat dihapus permanen. SDM nonaktif disembunyikan dari daftar utama dan dapat ditampilkan lewat filter.
8. Migrasi membatasi pemberian/pengubahan/penghapusan peran Super Admin agar hanya akun Super Admin yang dapat melakukannya.
9. Perbaikan cetak PDF menghindari posisi absolut yang dapat memotong laporan multi-halaman dan mempertahankan lebar tabel dalam kertas A4 landscape.
10. Memperbaiki beberapa variabel TypeScript yang tidak digunakan agar pemeriksaan tipe proyek tidak gagal.

## File yang perlu disalin
Ekstrak ZIP, kemudian salin isi folder `RQ_SDM_Audit_Fix` ke `D:\RQ_SDM` dengan mempertahankan struktur folder. Izinkan Windows mengganti file dengan nama sama.

File yang diperbarui:
- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- `src/AttendanceModule.tsx`
- `src/PerformanceModule.tsx`
- `src/ReportsModule.tsx`
- `src/ReportPrintView.tsx`
- `src/ReportPrintView.css`
- `src/UserManagementModule.tsx`
- `src/UserManagementModule.css`
- `public/rq-mosque.jpg`
- `functions/admin-invite-user/index.ts`
- `supabase/functions/admin-invite-user/index.ts`
- `11_safe_employee_removal.sql`
- `supabase/migrations/20261024000100_safe_employee_removal.sql`

Tidak perlu mengganti `package.json`, `package-lock.json`, `src/main.tsx`, atau `.env.local`.

## Langkah pemasangan

### 1. Cadangkan proyek
Di terminal VS Code:
```cmd
cd /d D:\RQ_SDM
mkdir backup-audit-fix
xcopy src backup-audit-fix\src /E /I /H
```
Jika folder backup sudah ada, gunakan nama lain.

### 2. Salin frontend
Salin folder `src` dan `public` dari paket ke `D:\RQ_SDM`. Salin juga folder `functions` dan `supabase` bila ingin memperbarui Edge Function.

### 3. Jalankan migrasi SQL sekali
Buka Supabase Dashboard → SQL Editor → New query. Salin isi file `11_safe_employee_removal.sql`, lalu klik Run. Jangan perlu menjalankan kedua salinan SQL; keduanya identik.

Migrasi ini:
- membuat fungsi `remove_employee_safely`;
- mengarsipkan SDM yang mempunyai riwayat atau akun terkait;
- menghapus permanen hanya data SDM tanpa riwayat terkait;
- membatasi perubahan peran Super Admin.

### 4. Perbarui Edge Function agar akses awal dibuat sekaligus
File standar Supabase CLI berada di:
`supabase/functions/admin-invite-user/index.ts`

Jika fungsi sudah pernah dipasang, deploy ulang dari terminal proyek:
```cmd
npx supabase login
npx supabase link --project-ref PROJECT_REF_ANDA
npx supabase functions deploy admin-invite-user
```
Ganti `PROJECT_REF_ANDA` dengan project ref milik sendiri. Jika proyek sudah di-link sebelumnya, langkah `link` tidak perlu diulang.

Pastikan secret `SUPABASE_SERVICE_ROLE_KEY` sudah tersimpan di Supabase Edge Function Secrets. **Jangan** menaruh service-role key di React, variabel `VITE_*`, atau mengirimkannya ke chat. Jika Edge Function belum dipakai, ikuti petunjuk deployment Supabase terlebih dahulu. Tanpa deployment fungsi terbaru, undangan akun tidak akan otomatis menyimpan peran/unit dari formulir baru.

### 5. Jalankan dan periksa aplikasi
```cmd
npm run dev
```
Setelah semua berfungsi, uji build:
```cmd
npm run build
```

## Skenario pengujian
1. Buka dashboard pada zoom 100%: konten harus memenuhi lebar kerja dengan proporsi wajar.
2. Periksa sidebar: label menu harus terbaca utuh, tidak turun per huruf.
3. Pindah ke Absensi, Kinerja, Laporan, dan Manajemen Pengguna: foto masjid tetap berada di header global.
4. Buat akun uji: pilih jenis akses, peran, dan unit (jika peran unit), lalu kirim undangan. Pastikan daftar pengguna menampilkan akun dan akses awalnya.
5. Coba hapus SDM uji tanpa riwayat: data harus terhapus permanen. Coba pada SDM yang punya riwayat: sistem harus mengarsipkannya dan mempertahankan riwayat.
6. Aktifkan filter “Tampilkan SDM nonaktif” untuk memeriksa arsip.
7. Pratinjau laporan HR, lalu cetak ke PDF dengan A4 landscape. Pastikan hanya laporan yang tercetak dan tabel tidak keluar dari margin.

## Batas verifikasi
Pemeriksaan TypeScript untuk frontend lolos pada salinan proyek ini. Edge Function lolos pemeriksaan sintaks TypeScript. Migrasi SQL dan Edge Function belum dijalankan pada proyek Supabase milik pengguna; lakukan pengujian menggunakan data simulasi sebelum memakai data SDM sebenarnya.
